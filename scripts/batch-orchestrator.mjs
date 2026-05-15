#!/usr/bin/env node
/**
 * Durable JobForge batch runner powered by @razroo/iso-orchestrator.
 *
 * This preserves the public batch-runner.sh interface while moving the
 * load-bearing control loop into a resumable workflow:
 *   - one durable workflow record per project
 *   - idempotent bundle execution keyed by URL + retry count
 *   - bounded fan-out through workflow.forEach(..., { maxParallel })
 *   - mutexed state/report-number writes across parallel workers
 *   - renewable leases + heartbeats for worker liveness inspection
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runWorkflow } from '@razroo/iso-orchestrator';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const PROJECT_DIR = process.env.JOB_FORGE_PROJECT || process.cwd();

const BATCH_DIR = join(PROJECT_DIR, 'batch');
const INPUT_FILE = join(BATCH_DIR, 'batch-input.tsv');
const STATE_FILE = join(BATCH_DIR, 'batch-state.tsv');
const PROMPT_FILE = join(BATCH_DIR, 'batch-prompt.md');
const LOGS_DIR = join(BATCH_DIR, 'logs');
const TRACKER_DIR = join(BATCH_DIR, 'tracker-additions');
const REPORTS_DIR = join(PROJECT_DIR, 'reports');
const APPLICATIONS_DIR = join(PROJECT_DIR, 'data', 'applications');
const TSV_MERGED_DIR = join(TRACKER_DIR, 'merged');
const LOCK_FILE = join(BATCH_DIR, 'batch-runner.pid');
const WORKFLOW_DIR = join(PROJECT_DIR, '.jobforge-runs');
const DEFAULT_WORKFLOW_ID = 'jobforge-batch';

const STATE_HEADER = 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries';

function usage() {
  console.log(`job-forge batch runner - process job offers in batch via AI CLI workers
Uses the selected runner's default project configuration.

Usage: batch-runner.sh [OPTIONS]

Options:
  --runner NAME        Worker CLI: opencode or codex (default: ${process.env.JOBFORGE_BATCH_RUNNER || 'opencode'})
  --parallel N         Number of parallel workers (default: 1)
  --bundle-size N      Offers per worker invocation (default: 5, use 1 for
                       legacy per-offer mode). Each worker processes N
                       offers sequentially, amortizing the system prompt.
  --dry-run            Show what would be processed, don't execute
  --retry-failed       Only retry offers marked as "failed" in state
  --start-from N       Start from offer ID N
  --max-retries N      Max retry attempts per offer (default: 2)
  --workflow-id ID     Durable workflow id (default: ${DEFAULT_WORKFLOW_ID})
  -h, --help           Show this help

Files:
  batch-input.tsv      Input offers (id, url, source, notes)
  batch-state.tsv      Processing state (auto-managed)
  .jobforge-runs/      Durable iso-orchestrator workflow records
  batch-prompt.md      Prompt template for workers
  logs/                Per-bundle logs
  tracker-additions/   Tracker lines for post-batch merge`);
}

function parseArgs(argv) {
  const options = {
    runner: parseRunner(process.env.JOBFORGE_BATCH_RUNNER || 'opencode'),
    parallel: 1,
    dryRun: false,
    retryFailed: false,
    startFrom: 0,
    maxRetries: 2,
    bundleSize: 5,
    workflowId: DEFAULT_WORKFLOW_ID,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[i];
    };

    switch (arg) {
      case '--runner':
        options.runner = parseRunner(next());
        break;
      case '--parallel':
        options.parallel = parsePositiveInt(next(), '--parallel');
        break;
      case '--bundle-size':
        options.bundleSize = parsePositiveInt(next(), '--bundle-size');
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--retry-failed':
        options.retryFailed = true;
        break;
      case '--start-from':
        options.startFrom = parseNonNegativeInt(next(), '--start-from');
        break;
      case '--max-retries':
        options.maxRetries = parsePositiveInt(next(), '--max-retries');
        break;
      case '--workflow-id':
        options.workflowId = sanitizeWorkflowId(next());
        break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function parseRunner(value) {
  const runner = String(value || '').trim().toLowerCase();
  if (runner === 'opencode' || runner === 'codex') return runner;
  throw new Error(`--runner must be one of: opencode, codex`);
}

function parsePositiveInt(value, label) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return n;
}

function parseNonNegativeInt(value, label) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return n;
}

function sanitizeWorkflowId(value) {
  const clean = value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '-');
  if (!clean) throw new Error('--workflow-id cannot be empty');
  return clean;
}

function hash(value, length = 12) {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function nowIso() {
  return new Date().toISOString();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeCell(value, fallback = '-') {
  const text = value === undefined || value === null || value === '' ? fallback : String(value);
  return text.replace(/[\t\r\n]+/g, ' ').trim() || fallback;
}

function padReportNum(n) {
  return String(n).padStart(3, '0');
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

async function readTextIfExists(path) {
  if (!existsSync(path)) return '';
  return readFile(path, 'utf8');
}

async function checkPrerequisites({ dryRun, runner }) {
  if (!existsSync(INPUT_FILE)) {
    throw new Error(`${INPUT_FILE} not found. Add offers first.`);
  }
  if (!existsSync(PROMPT_FILE)) {
    throw new Error(`${PROMPT_FILE} not found.`);
  }
  if (!dryRun) {
    const command = workerCommandName(runner);
    const result = spawnSync(command, ['--help'], { stdio: 'ignore' });
    if (result.error?.code === 'ENOENT') {
      throw new Error(`'${command}' CLI not found in PATH.`);
    }
  }

  await ensureDir(LOGS_DIR);
  await ensureDir(TRACKER_DIR);
  await ensureDir(REPORTS_DIR);
  await ensureDir(WORKFLOW_DIR);
}

async function acquirePidLock({ dryRun }) {
  if (dryRun) return () => {};

  if (existsSync(LOCK_FILE)) {
    const oldPid = (await readTextIfExists(LOCK_FILE)).trim();
    if (oldPid) {
      try {
        process.kill(Number(oldPid), 0);
        throw new Error(`Another batch-runner is already running (PID ${oldPid}). If this is stale, remove ${LOCK_FILE}`);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    console.log(`WARN: Stale lock file found (PID ${oldPid || 'unknown'} not running). Removing.`);
    await rm(LOCK_FILE, { force: true });
  }

  await writeFile(LOCK_FILE, String(process.pid), 'utf8');

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await rm(LOCK_FILE, { force: true });
  };
}

async function initState() {
  if (existsSync(STATE_FILE)) return;
  await ensureDir(dirname(STATE_FILE));
  await writeFile(STATE_FILE, `${STATE_HEADER}\n`, 'utf8');
}

async function readState() {
  await initState();
  const content = await readFile(STATE_FILE, 'utf8');
  const rows = new Map();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts[0] === 'id') continue;
    const row = normalizeStateRow({
      id: parts[0],
      url: parts[1],
      status: parts[2],
      started_at: parts[3],
      completed_at: parts[4],
      report_num: parts[5],
      score: parts[6],
      error: parts[7],
      retries: parts[8],
    });
    if (row.id) rows.set(row.id, row);
  }

  return rows;
}

function normalizeStateRow(row) {
  return {
    id: sanitizeCell(row.id, ''),
    url: sanitizeCell(row.url),
    status: sanitizeCell(row.status, 'pending'),
    started_at: sanitizeCell(row.started_at),
    completed_at: sanitizeCell(row.completed_at),
    report_num: sanitizeCell(row.report_num),
    score: sanitizeCell(row.score),
    error: sanitizeCell(row.error),
    retries: String(Number.parseInt(row.retries, 10) || 0),
  };
}

async function writeState(rows) {
  const sorted = [...rows.values()].sort((a, b) => {
    const na = Number.parseInt(a.id, 10);
    const nb = Number.parseInt(b.id, 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) return a.id.localeCompare(b.id);
    return na - nb;
  });

  const lines = [STATE_HEADER];
  for (const row of sorted) {
    lines.push([
      row.id,
      row.url,
      row.status,
      row.started_at,
      row.completed_at,
      row.report_num,
      row.score,
      row.error,
      row.retries,
    ].map((value) => sanitizeCell(value)).join('\t'));
  }
  await writeFile(STATE_FILE, `${lines.join('\n')}\n`, 'utf8');
}

async function updateStateRow(workflow, nextRow) {
  return workflow.withMutex('batch-state', async () => {
    const rows = await readState();
    const current = rows.get(nextRow.id) || {};
    const row = normalizeStateRow({ ...current, ...nextRow });
    rows.set(row.id, row);
    await writeState(rows);
    return row;
  });
}

async function readInputOffers() {
  const content = await readFile(INPUT_FILE, 'utf8');
  const offers = [];

  for (const rawLine of content.split('\n')) {
    if (!rawLine.trim()) continue;
    const parts = rawLine.split('\t');
    if (parts[0] === 'id') continue;
    const id = sanitizeCell(parts[0], '');
    const url = sanitizeCell(parts[1], '');
    if (!id || !url) continue;
    offers.push({
      id,
      url,
      source: sanitizeCell(parts[2]),
      notes: sanitizeCell(parts.slice(3).join(' ')),
    });
  }

  return offers;
}

function retriesFor(rows, id) {
  const n = Number.parseInt(rows.get(id)?.retries, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function statusFor(rows, id) {
  return rows.get(id)?.status || 'none';
}

function selectPendingOffers(offers, rows, options) {
  const pending = [];

  for (const offer of offers) {
    const numericId = Number.parseInt(offer.id, 10);
    if (!Number.isNaN(numericId) && numericId < options.startFrom) continue;

    const status = statusFor(rows, offer.id);
    const retries = retriesFor(rows, offer.id);

    if (options.retryFailed) {
      if (status !== 'failed') continue;
      if (retries >= options.maxRetries) {
        console.log(`SKIP #${offer.id}: max retries (${options.maxRetries}) reached`);
        continue;
      }
    } else {
      if (status === 'completed') continue;
      if (status === 'failed' && retries >= options.maxRetries) {
        console.log(`SKIP #${offer.id}: failed and max retries reached (use --retry-failed to force)`);
        continue;
      }
    }

    pending.push(offer);
  }

  return pending;
}

function partition(items, size) {
  const bundles = [];
  for (let i = 0; i < items.length; i += size) {
    bundles.push(items.slice(i, i + size));
  }
  return bundles;
}

async function maxReportNumberFromFiles(rows) {
  let max = 0;

  async function scanDir(dir, visitor) {
    if (!existsSync(dir)) return;
    for (const file of await readdir(dir)) {
      const full = join(dir, file);
      const info = await stat(full);
      if (info.isFile()) await visitor(file, full);
    }
  }

  await scanDir(REPORTS_DIR, async (file) => {
    const match = file.match(/^(\d+)-.*\.md$/);
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  });

  await scanDir(APPLICATIONS_DIR, async (file, full) => {
    if (!file.endsWith('.md')) return;
    const content = await readFile(full, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^\|\s*(\d+)\s*\|/);
      if (match) max = Math.max(max, Number.parseInt(match[1], 10));
    }
  });

  for (const dir of [TRACKER_DIR, TSV_MERGED_DIR]) {
    await scanDir(dir, async (file, full) => {
      if (!file.endsWith('.tsv')) return;
      const nameMatch = file.match(/^(\d+)-/);
      if (nameMatch) {
        max = Math.max(max, Number.parseInt(nameMatch[1], 10));
        return;
      }
      const content = await readFile(full, 'utf8');
      const firstLine = content.split('\n').find((line) => line.trim());
      if (!firstLine) return;
      const n = Number.parseInt(firstLine.split('\t')[0], 10);
      if (!Number.isNaN(n)) max = Math.max(max, n);
    });
  }

  for (const row of rows.values()) {
    const n = Number.parseInt(row.report_num, 10);
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }

  return max;
}

async function reserveBundle(workflow, bundle, startedAt) {
  return workflow.withMutex('report-number', async () => {
    const rows = await readState();
    let next = await maxReportNumberFromFiles(rows);
    const specs = [];

    for (const offer of bundle) {
      const current = rows.get(offer.id);
      const existingReportNum = current?.status === 'processing' && current?.report_num && current.report_num !== '-'
        ? current.report_num
        : null;
      const reportNum = existingReportNum || padReportNum(++next);
      const retries = retriesFor(rows, offer.id);

      rows.set(offer.id, normalizeStateRow({
        id: offer.id,
        url: offer.url,
        status: 'processing',
        started_at: startedAt,
        completed_at: '-',
        report_num: reportNum,
        score: '-',
        error: '-',
        retries,
      }));

      specs.push({
        id: offer.id,
        url: offer.url,
        jd_file: `/tmp/batch-jd-${offer.id}.txt`,
        report_num: reportNum,
        date: today(),
      });
    }

    await writeState(rows);
    return specs;
  });
}

function bundleStepName(bundle, rows) {
  const key = bundle
    .map((offer) => `${offer.id}\0${offer.url}\0${retriesFor(rows, offer.id)}`)
    .join('\n');
  const ids = bundle.map((offer) => offer.id).join('_');
  return `batch-bundle:${ids}:${hash(key)}`;
}

function bundleTag(bundle) {
  return `bundle-${bundle.map((offer) => offer.id).join('_')}`;
}

function buildBundlePrompt(specs) {
  return `Process these ${specs.length} offers sequentially using the full pipeline in batch-prompt.md
(Step 1 JD retrieval -> Steps 2-6 evaluate/report/PDF/tracker line). Do each
offer fully before starting the next. Continue to the next offer even if one
fails. After each offer, emit ONE single-line JSON on its own line with this
exact shape (no extra prose, no code fences around it):

{"id":"<id>","status":"completed|failed","report_num":"<num>","company":"...","role":"...","score":<num-or-null>,"pdf":"<path-or-null>","report":"<path-or-null>","error":"<msg-or-null>"}

The orchestrator parses these lines to update state. Anything between status
JSONs is fine, but do NOT omit or reorder the required keys.

Offers:
${JSON.stringify(specs)}`;
}

async function runOpencode(prompt, logFile) {
  await ensureDir(dirname(logFile));

  return new Promise((resolve) => {
    const child = spawn('opencode', [
      'run',
      '--dangerously-skip-permissions',
      '--file',
      PROMPT_FILE,
      prompt,
    ], {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        JOB_FORGE_PROJECT: PROJECT_DIR,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));

    child.on('error', async (error) => {
      chunks.push(Buffer.from(`\n${error.stack || error.message}\n`));
    });

    child.on('close', async (code) => {
      const output = Buffer.concat(chunks).toString('utf8');
      await writeFile(logFile, output, 'utf8');
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

let batchTemplateCache;

async function batchTemplateText() {
  if (batchTemplateCache === undefined) {
    batchTemplateCache = await readFile(PROMPT_FILE, 'utf8');
  }
  return batchTemplateCache;
}

function workerCommandName(runner) {
  return runner === 'codex' ? 'codex' : 'opencode';
}

async function runCodex(prompt, logFile) {
  await ensureDir(dirname(logFile));
  const finalMessageFile = `${logFile}.last-message.txt`;
  const combinedPrompt = `${(await batchTemplateText()).trim()}\n\n${prompt}`;

  return new Promise((resolveRun) => {
    const child = spawn('codex', [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      PROJECT_DIR,
      '--output-last-message',
      finalMessageFile,
      combinedPrompt,
    ], {
      cwd: PROJECT_DIR,
      env: {
        ...process.env,
        JOB_FORGE_PROJECT: PROJECT_DIR,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));

    child.on('error', async (error) => {
      chunks.push(Buffer.from(`\n${error.stack || error.message}\n`));
    });

    child.on('close', async (code) => {
      const output = Buffer.concat(chunks).toString('utf8');
      const finalMessage = await readTextIfExists(finalMessageFile);
      const logOutput = finalMessage
        ? `${output}\n\n--- FINAL MESSAGE ---\n${finalMessage}`
        : output;
      await writeFile(logFile, logOutput, 'utf8');
      resolveRun({
        exitCode: code ?? 1,
        output: finalMessage || output,
      });
    });
  });
}

async function runWorker(runner, prompt, logFile) {
  if (runner === 'codex') return runCodex(prompt, logFile);
  return runOpencode(prompt, logFile);
}

function parseStatusLines(output) {
  const seen = new Map();
  for (const line of output.split('\n')) {
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(line.slice(start, end + 1));
      if (!parsed || typeof parsed !== 'object') continue;
      if (!parsed.id || !parsed.status) continue;
      const id = String(parsed.id);
      if (!seen.has(id)) seen.set(id, parsed);
    } catch {
      // Workers may print non-JSON diagnostics; only exact status JSON matters.
    }
  }
  return seen;
}

async function withWorkerLiveness(workflow, { runner, tag, ids, logFile }, run) {
  const leaseKey = `worker:${tag}`;
  const holder = `${runner}:${process.pid}:${tag}`;
  const detail = {
    runner,
    ids,
    log: relativeProjectPath(logFile),
  };

  await workflow.touchLease(leaseKey, {
    holder,
    ttlMs: 120_000,
    detail: {
      ...detail,
      phase: 'starting',
    },
  });
  await workflow.heartbeat(leaseKey, {
    ...detail,
    phase: 'starting',
  });

  const timer = setInterval(() => {
    workflow.touchLease(leaseKey, {
      holder,
      ttlMs: 120_000,
      detail: {
        ...detail,
        phase: 'running',
      },
    }).catch(() => {});
    workflow.heartbeat(leaseKey, {
      ...detail,
      phase: 'running',
    }).catch(() => {});
  }, 30_000);
  timer.unref?.();

  try {
    return await run();
  } finally {
    clearInterval(timer);
    await workflow.heartbeat(leaseKey, {
      ...detail,
      phase: 'finished',
    }).catch(() => {});
    await workflow.releaseLease(leaseKey, holder).catch(() => {});
  }
}

async function processBundle(workflow, bundle, options) {
  const startedAt = nowIso();
  const specs = await reserveBundle(workflow, bundle, startedAt);
  const tag = bundleTag(bundle);
  const logFile = join(LOGS_DIR, `${tag}.log`);

  console.log(`--- Processing bundle of ${bundle.length} offer(s): ${bundle.map((offer) => offer.id).join(' ')}`);
  await workflow.appendEvent({
    type: 'batch.bundle.started',
    detail: {
      ids: bundle.map((offer) => offer.id),
      runner: options.runner,
      log: relativeProjectPath(logFile),
    },
  });

  const { exitCode, output } = await withWorkerLiveness(workflow, {
    runner: options.runner,
    tag,
    ids: bundle.map((offer) => offer.id),
    logFile,
  }, () => runWorker(options.runner, buildBundlePrompt(specs), logFile));
  const completedAt = nowIso();
  const statuses = parseStatusLines(output);
  const outcomes = [];

  for (const spec of specs) {
    const parsed = statuses.get(spec.id);
    const rows = await readState();
    const retries = retriesFor(rows, spec.id);
    const offer = bundle.find((candidate) => candidate.id === spec.id);

    if (parsed) {
      const status = parsed.status === 'completed' ? 'completed' : 'failed';
      const nextRetries = status === 'failed' ? retries + 1 : retries;
      const score = parsed.score === null || parsed.score === undefined ? '-' : parsed.score;
      const error = parsed.error === null || parsed.error === undefined ? '-' : parsed.error;
      await updateStateRow(workflow, {
        id: spec.id,
        url: offer?.url || spec.url,
        status,
        started_at: startedAt,
        completed_at: completedAt,
        report_num: sanitizeCell(parsed.report_num, spec.report_num),
        score: sanitizeCell(score),
        error: sanitizeCell(error),
        retries: String(nextRetries),
      });
      outcomes.push({
        id: spec.id,
        status,
        score: sanitizeCell(score),
        report_num: sanitizeCell(parsed.report_num, spec.report_num),
      });
      await workflow.heartbeat(`worker:${tag}`, {
        runner: options.runner,
        ids: bundle.map((candidate) => candidate.id),
        offerId: spec.id,
        phase: 'settling',
        status,
      }).catch(() => {});
      console.log(`    ${status === 'completed' ? 'OK' : 'FAIL'} #${spec.id} (status=${status}, score=${sanitizeCell(score)}, report=${sanitizeCell(parsed.report_num, spec.report_num)})`);
      continue;
    }

    const error = exitCode === 0
      ? 'Worker finished without emitting status JSON for this offer'
      : `Worker exited ${exitCode} without emitting status JSON for this offer`;
    await updateStateRow(workflow, {
      id: spec.id,
      url: offer?.url || spec.url,
      status: 'failed',
      started_at: startedAt,
      completed_at: completedAt,
      report_num: spec.report_num,
      score: '-',
      error,
      retries: String(retries + 1),
    });
    outcomes.push({
      id: spec.id,
      status: 'failed',
      score: '-',
      report_num: spec.report_num,
    });
    await workflow.heartbeat(`worker:${tag}`, {
      runner: options.runner,
      ids: bundle.map((candidate) => candidate.id),
      offerId: spec.id,
      phase: 'settling',
      status: 'failed',
    }).catch(() => {});
    console.log(`    FAIL #${spec.id} (no status emitted; see ${relativeProjectPath(logFile)})`);
  }

  if (exitCode !== 0) {
    console.log(`    WARN worker exit code ${exitCode}; see ${relativeProjectPath(logFile)}`);
  }

  await workflow.appendEvent({
    type: 'batch.bundle.completed',
    detail: {
      ids: bundle.map((offer) => offer.id),
      runner: options.runner,
      exitCode,
      log: relativeProjectPath(logFile),
      outcomes,
    },
  });

  return {
    ids: bundle.map((offer) => offer.id),
    exitCode,
    log: relativeProjectPath(logFile),
    outcomes,
  };
}

function relativeProjectPath(path) {
  return path.startsWith(PROJECT_DIR)
    ? path.slice(PROJECT_DIR.length + 1)
    : path;
}

async function runNodeScript(relPath, args = [], { allowFailure = false } = {}) {
  const scriptPath = join(PKG_ROOT, relPath);
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: PROJECT_DIR,
    env: {
      ...process.env,
      JOB_FORGE_PROJECT: PROJECT_DIR,
    },
    stdio: 'inherit',
  });

  if (!allowFailure && (result.status ?? 1) !== 0) {
    throw new Error(`${relPath} exited with status ${result.status ?? 1}`);
  }

  return result.status ?? 1;
}

async function mergeTracker() {
  console.log('\n=== Merging tracker additions ===');
  await runNodeScript('merge-tracker.mjs');
  console.log('\n=== Verifying pipeline integrity ===');
  const verifyStatus = await runNodeScript('verify-pipeline.mjs', [], { allowFailure: true });
  if (verifyStatus !== 0) {
    console.log('WARN Verification found issues (see above)');
  }
}

async function costReport(sinceMinutes = 180) {
  console.log(`\n=== Token usage (last ${sinceMinutes} min, warn at $1.00) ===`);
  await runNodeScript('bin/job-forge.mjs', [
    'session-report',
    '--since-minutes',
    String(sinceMinutes),
    '--log',
    '--warn-at',
    '1.00',
  ], { allowFailure: true });
}

async function summaryFromState() {
  const rows = await readState();
  let total = 0;
  let completed = 0;
  let failed = 0;
  let pending = 0;
  let scoreSum = 0;
  let scoreCount = 0;

  for (const row of rows.values()) {
    total += 1;
    if (row.status === 'completed') {
      completed += 1;
      const score = Number.parseFloat(row.score);
      if (!Number.isNaN(score)) {
        scoreSum += score;
        scoreCount += 1;
      }
    } else if (row.status === 'failed') {
      failed += 1;
    } else {
      pending += 1;
    }
  }

  return {
    total,
    completed,
    failed,
    pending,
    averageScore: scoreCount > 0 ? Number((scoreSum / scoreCount).toFixed(1)) : null,
    scoreCount,
  };
}

async function printSummary() {
  console.log('\n=== Batch Summary ===');
  const summary = await summaryFromState();
  console.log(`Total: ${summary.total} | Completed: ${summary.completed} | Failed: ${summary.failed} | Pending: ${summary.pending}`);
  if (summary.averageScore !== null) {
    console.log(`Average score: ${summary.averageScore}/5 (${summary.scoreCount} scored)`);
  }
  return summary;
}

async function run(options) {
  await checkPrerequisites(options);
  const releaseLock = await acquirePidLock(options);

  process.once('SIGINT', async () => {
    await releaseLock();
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await releaseLock();
    process.exit(143);
  });

  try {
    await initState();

    const offers = await readInputOffers();
    const totalInput = offers.length;
    if (totalInput === 0) {
      console.log(`No offers in ${INPUT_FILE}. Add offers first.`);
      return;
    }

    const startedAt = nowIso();
    const stateRows = await readState();
    const pending = selectPendingOffers(offers, stateRows, options);

    console.log('=== job-forge batch runner ===');
    console.log(`Runner: ${options.runner} | Parallel: ${options.parallel} | Bundle size: ${options.bundleSize} | Max retries: ${options.maxRetries}`);
    console.log(`Workflow: ${options.workflowId} (${relativeProjectPath(WORKFLOW_DIR)})`);
    console.log(`Input: ${totalInput} offers`);
    console.log('');

    if (pending.length === 0) {
      console.log('No offers to process.');
      await printSummary();
      return;
    }

    console.log(`Pending: ${pending.length} offers`);
    console.log('');

    if (options.dryRun) {
      console.log('=== DRY RUN (no processing) ===');
      for (const offer of pending) {
        console.log(`  #${offer.id}: ${offer.url} [${offer.source}] (status: ${statusFor(stateRows, offer.id)})`);
      }
      console.log('');
      console.log(`Would process ${pending.length} offers`);
      return;
    }

    const bundles = partition(pending, options.bundleSize);
    console.log(`Partitioned into ${bundles.length} bundle(s) of up to ${options.bundleSize} offer(s) each`);

    await runWorkflow(
      {
        workflowId: options.workflowId,
        dir: WORKFLOW_DIR,
        initialState: {
          kind: 'jobforge-batch',
          runs: 0,
          lastRun: null,
        },
      },
      async (workflow) => {
        await workflow.updateState((state) => ({
          ...state,
          runs: Number(state.runs || 0) + 1,
          lastRun: {
            startedAt,
            totalInput,
            pending: pending.length,
            bundles: bundles.length,
            runner: options.runner,
            parallel: options.parallel,
            bundleSize: options.bundleSize,
          },
        }));

        const rowsBeforeRun = await readState();
        const summary = await workflow.forEach(
          bundles,
          async (bundle) => {
            const stepName = bundleStepName(bundle, rowsBeforeRun);
            return workflow.step(
              stepName,
              async () => processBundle(workflow, bundle, options),
              {
                idempotencyKey: stepName,
              },
            );
          },
          {
            maxParallel: options.parallel,
            stopOnError: false,
          },
        );

        await workflow.appendEvent({
          type: 'batch.bundles.finished',
          detail: {
            fulfilled: summary.fulfilled,
            rejected: summary.rejected,
          },
        });

        await workflow.step(
          `merge-and-verify:${hash(startedAt)}`,
          async () => {
            await mergeTracker();
            return { ok: true };
          },
        );

        const finalSummary = await printSummary();
        await workflow.updateState((state) => ({
          ...state,
          lastRun: {
            ...state.lastRun,
            completedAt: nowIso(),
            summary: finalSummary,
          },
        }));

        if (process.env.JOBFORGE_SKIP_COST_REPORT !== '1') {
          await costReport(180);
        }

        return {
          bundles: bundles.length,
          summary: finalSummary,
        };
      },
    );
  } finally {
    await releaseLock();
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  await run(options);
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
