#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  companyRoleKey,
  legacyCompanyRoleKey,
  legacyUrlKey,
  readJobForgeLedger,
  slugPart,
  urlKey,
} from '../lib/jobforge-ledger.mjs';
import { readJobForgeRedactConfig } from '../lib/jobforge-redact.mjs';

const RECEIPTS_DIR = '.jobforge-receipts';
const USAGE = `job-forge receipts - portable local evidence receipts

Usage:
  job-forge receipts:create [--kind <kind>] [--out <receipt.agent.zip|dir>] [--subject <text>] [--run-id <id>]
    [--url <url>] [--company <name> --role <role>] [--status <status>]
    [--artifact <file> ...] [--geometra <file> ...] [--portal <file> ...]
    [--include-ledger | --all-ledger] [--verdict <json|@file>] [--proof <json|@file>] [--redact] [--json]
  job-forge receipts:capture [--out <receipt.agent.zip|dir>] [--subject <text>] [--run-id <id>] [--json] -- <command> [args...]
  job-forge receipts:verify <receipt.agent.zip|dir> [--json]
  job-forge receipts:inspect <receipt.agent.zip|dir> [--json]
  job-forge receipts:redact <receipt.agent.zip|dir> --out <receipt.agent.zip|dir> [--json]
  job-forge receipts:path

Use receipts at workflow boundaries: application submission, blocked-site
manual handoff, release, repro, or inter-agent handoff. Do not create receipts
for routine reads or ordinary local edits.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  const receipts = await loadIsoReceipts();
  if (cmd === 'path') {
    console.log(receiptsDir());
  } else if (cmd === 'create') {
    await create(receipts, opts);
  } else if (cmd === 'capture') {
    await capture(receipts, opts);
  } else if (cmd === 'verify') {
    verify(receipts, opts);
  } else if (cmd === 'inspect') {
    inspect(receipts, opts);
  } else if (cmd === 'redact') {
    redact(receipts, opts);
  } else {
    console.error(`unknown receipts command "${cmd}"\n`);
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const opts = {
    artifacts: [],
    geometra: [],
    portal: [],
    command: [],
    json: false,
    help: false,
    includeLedger: false,
    allLedger: false,
    redact: false,
  };
  let afterDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (afterDoubleDash) {
      opts.command.push(arg);
    } else if (arg === '--') {
      afterDoubleDash = true;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--redact') {
      opts.redact = true;
    } else if (arg === '--include-ledger') {
      opts.includeLedger = true;
    } else if (arg === '--all-ledger') {
      opts.allLedger = true;
    } else if (arg === '--out' || arg === '-o') {
      opts.out = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
    } else if (arg === '--kind') {
      opts.kind = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--kind=')) {
      opts.kind = arg.slice('--kind='.length);
    } else if (arg === '--subject') {
      opts.subject = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--subject=')) {
      opts.subject = arg.slice('--subject='.length);
    } else if (arg === '--run-id') {
      opts.runId = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--run-id=')) {
      opts.runId = arg.slice('--run-id='.length);
    } else if (arg === '--url') {
      opts.url = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--url=')) {
      opts.url = arg.slice('--url='.length);
    } else if (arg === '--company') {
      opts.company = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--company=')) {
      opts.company = arg.slice('--company='.length);
    } else if (arg === '--role') {
      opts.role = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--role=')) {
      opts.role = arg.slice('--role='.length);
    } else if (arg === '--status') {
      opts.status = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--status=')) {
      opts.status = arg.slice('--status='.length);
    } else if (arg === '--artifact') {
      opts.artifacts.push(valueAfter(args, ++i, arg));
    } else if (arg.startsWith('--artifact=')) {
      opts.artifacts.push(arg.slice('--artifact='.length));
    } else if (arg === '--geometra') {
      opts.geometra.push(valueAfter(args, ++i, arg));
    } else if (arg.startsWith('--geometra=')) {
      opts.geometra.push(arg.slice('--geometra='.length));
    } else if (arg === '--portal') {
      opts.portal.push(valueAfter(args, ++i, arg));
    } else if (arg.startsWith('--portal=')) {
      opts.portal.push(arg.slice('--portal='.length));
    } else if (arg === '--verdict') {
      opts.verdict = readJsonArg(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith('--verdict=')) {
      opts.verdict = readJsonArg(arg.slice('--verdict='.length), '--verdict');
    } else if (arg === '--proof') {
      opts.proof = readJsonArg(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith('--proof=')) {
      opts.proof = readJsonArg(arg.slice('--proof='.length), '--proof');
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (!arg.startsWith('--') && !opts.input) {
      opts.input = arg;
    } else {
      throw new Error(`unknown argument "${arg}"`);
    }
  }
  return opts;
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function create(receipts, opts) {
  const kind = opts.kind || 'application';
  const artifacts = opts.artifacts.map((path) => fileInput(path, 'artifacts'));
  const geometraReplay = [
    ...opts.geometra.map((path) => fileInput(path, 'geometra-replay')),
    ...opts.portal.map((path) => fileInput(path, 'geometra-replay')),
  ];
  const events = [
    {
      type: 'jobforge.receipt.created',
      data: compactObject({
        kind,
        url: opts.url,
        company: opts.company,
        role: opts.role,
        status: opts.status,
      }),
      meta: { source: 'job-forge' },
    },
  ];

  if (opts.includeLedger || opts.allLedger) {
    const ledger = selectLedgerEvents(opts);
    artifacts.push({
      path: 'artifacts/jobforge-ledger-events.jsonl',
      content: `${ledger.map((event) => JSON.stringify(event)).join('\n')}${ledger.length ? '\n' : ''}`,
      kind: 'artifact',
      contentType: 'application/jsonl',
    });
    events.push({
      type: 'jobforge.ledger.snapshot',
      data: {
        count: ledger.length,
        all: Boolean(opts.allLedger),
        filters: ledgerFilters(opts),
      },
      meta: { source: 'job-forge' },
    });
  }

  let receipt = receipts.createReceipt({
    subject: subjectFor(opts, kind),
    runId: opts.runId,
    generator: { name: 'job-forge', version: packageVersion() },
    events,
    artifacts,
    geometraReplay,
    verdict: opts.verdict,
    proof: opts.proof,
    extensions: {
      jobforge: compactObject({
        kind,
        projectDir: PROJECT_DIR,
        url: opts.url,
        company: opts.company,
        role: opts.role,
        status: opts.status,
      }),
    },
  });
  if (opts.redact) receipt = receipts.redactReceipt(receipt, {
    policy: readJobForgeRedactConfig(PROJECT_DIR),
    policyName: 'templates/redact.json',
  });

  const out = resolveOutputPath(opts.out || defaultReceiptPath(kind, opts));
  writeOutput(receipts, receipt, out);
  const verifyResult = receipts.verifyReceipt(receipt);
  output(opts, {
    out,
    receiptId: receipt.manifest.receiptId,
    entries: receipt.manifest.entries.length,
    verify: verifyResult,
  }, () => {
    console.log(`receipts: wrote ${relativePath(out)} (${receipt.manifest.receiptId})`);
    console.log(receipts.formatReceiptVerifyResult(verifyResult));
  });
}

async function capture(receipts, opts) {
  if (opts.command.length === 0) throw new Error('capture requires a command after --');
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(opts.command[0], opts.command.slice(1), {
    cwd: PROJECT_DIR,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  const endedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  const exitCode = result.status ?? (result.error ? 127 : null);

  const receipt = receipts.createReceipt({
    subject: opts.subject || `jobforge:command:${opts.command[0]}`,
    runId: opts.runId,
    generator: { name: 'job-forge', version: packageVersion() },
    command: {
      argv: opts.command,
      cwd: PROJECT_DIR,
      exitCode,
      signal: result.signal ?? null,
      startedAt,
      endedAt,
      durationMs,
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    },
    events: [
      { type: 'jobforge.command.started', at: startedAt, data: { argv: opts.command, cwd: PROJECT_DIR } },
      {
        type: 'jobforge.command.exited',
        at: endedAt,
        data: compactObject({
          exitCode,
          signal: result.signal,
          durationMs,
          error: result.error?.message,
        }),
      },
    ],
    artifacts: [
      { path: 'artifacts/stdout.txt', content: result.stdout || Buffer.alloc(0), contentType: 'text/plain' },
      { path: 'artifacts/stderr.txt', content: result.stderr || Buffer.alloc(0), contentType: 'text/plain' },
    ],
  });

  const out = resolveOutputPath(opts.out || defaultReceiptPath('command', opts));
  writeOutput(receipts, receipt, out);
  output(opts, {
    out,
    receiptId: receipt.manifest.receiptId,
    exitCode,
  }, () => {
    console.log(`receipts: wrote ${relativePath(out)} (${receipt.manifest.receiptId}, command exit ${exitCode ?? 'signal'})`);
  });
}

function verify(receipts, opts) {
  if (!opts.input) throw new Error('verify requires a receipt path');
  const result = receipts.verifyReceipt(resolveInputPath(opts.input));
  output(opts, result, () => console.log(receipts.formatReceiptVerifyResult(result)));
  if (!result.ok) process.exit(1);
}

function inspect(receipts, opts) {
  if (!opts.input) throw new Error('inspect requires a receipt path');
  const result = receipts.inspectReceipt(resolveInputPath(opts.input));
  output(opts, result, () => console.log(receipts.formatReceiptInspectResult(result)));
}

function redact(receipts, opts) {
  if (!opts.input) throw new Error('redact requires a receipt path');
  if (!opts.out) throw new Error('redact requires --out <path>');
  const redacted = receipts.redactReceipt(receipts.readReceipt(resolveInputPath(opts.input)), {
    policy: readJobForgeRedactConfig(PROJECT_DIR),
    policyName: 'templates/redact.json',
  });
  const out = resolveOutputPath(opts.out);
  writeOutput(receipts, redacted, out);
  output(opts, {
    out,
    receiptId: redacted.manifest.receiptId,
    redaction: redacted.manifest.redaction,
  }, () => {
    console.log(`receipts: redacted ${redacted.manifest.receiptId} to ${relativePath(out)}`);
  });
}

function fileInput(input, bucket) {
  const path = resolveInputPath(input);
  if (!existsSync(path)) throw new Error(`artifact not found: ${input}`);
  if (!statSync(path).isFile()) throw new Error(`artifact is not a file: ${input}`);
  return {
    path: receiptArtifactPath(path, bucket),
    content: readFileSync(path),
    kind: bucket === 'geometra-replay' ? 'geometra-replay' : 'artifact',
  };
}

function receiptArtifactPath(path, bucket) {
  const rel = relative(PROJECT_DIR, path).replace(/\\/g, '/');
  if (rel && !rel.startsWith('../') && rel !== '..' && !isAbsolute(rel)) return `${bucket}/${rel}`;
  return `${bucket}/external/${basename(path)}`;
}

function selectLedgerEvents(opts) {
  const events = readJobForgeLedger(PROJECT_DIR);
  if (opts.allLedger) return statusFiltered(events, opts.status);
  const keys = ledgerFilterKeys(opts);
  if (keys.length === 0) {
    throw new Error('--include-ledger requires --url or --company/--role; use --all-ledger to attach every ledger event');
  }
  return statusFiltered(events.filter((event) => keys.includes(event.key)), opts.status);
}

function ledgerFilterKeys(opts) {
  const keys = [];
  if (opts.url) keys.push(urlKey(opts.url, PROJECT_DIR), legacyUrlKey(opts.url));
  if (opts.company || opts.role) {
    if (!opts.company || !opts.role) throw new Error('--company and --role must be provided together');
    keys.push(companyRoleKey(opts.company, opts.role, PROJECT_DIR), legacyCompanyRoleKey(opts.company, opts.role));
  }
  return [...new Set(keys)];
}

function statusFiltered(events, status) {
  if (!status) return events;
  return events.filter((event) => event.data?.status === status);
}

function ledgerFilters(opts) {
  return compactObject({
    url: opts.url,
    company: opts.company,
    role: opts.role,
    status: opts.status,
    keys: ledgerFilterKeys(opts),
  });
}

function subjectFor(opts, kind) {
  if (opts.subject) return opts.subject;
  if (opts.company && opts.role) return `jobforge:application:${companyRoleKey(opts.company, opts.role, PROJECT_DIR)}`;
  if (opts.url) return `jobforge:url:${urlKey(opts.url, PROJECT_DIR)}`;
  if (opts.runId) return `jobforge:run:${opts.runId}`;
  return `jobforge:${kind}`;
}

function defaultReceiptPath(kind, opts) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const seed = opts.company || opts.role || opts.url || opts.subject || opts.runId || kind;
  const slug = slugPart(seed).slice(0, 80) || kind;
  return join(RECEIPTS_DIR, `${stamp}-${slug}.agent.zip`);
}

function writeOutput(receipts, receipt, out) {
  mkdirSync(dirname(out), { recursive: true });
  if (out.endsWith('.zip')) receipts.packReceipt(receipt, out);
  else receipts.writeReceiptDirectory(receipt, out);
}

async function loadIsoReceipts() {
  const explicit = process.env.JOB_FORGE_ISO_RECEIPTS_MODULE;
  if (explicit) return import(pathToFileURL(resolve(explicit)).href);

  try {
    return await import('@agent-pattern-labs/iso-receipts');
  } catch {
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const sibling = resolve(scriptDir, '../../iso/packages/iso-receipts/dist/index.js');
    if (existsSync(sibling)) return import(pathToFileURL(sibling).href);
    throw new Error(
      'Could not load @agent-pattern-labs/iso-receipts. Install dependencies, ' +
      'or build the sibling iso repo so ../iso/packages/iso-receipts/dist/index.js exists.',
    );
  }
}

function packageVersion() {
  try {
    const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version;
  } catch {
    return undefined;
  }
}

function readJsonArg(raw, flag) {
  const text = raw.startsWith('@') ? readFileSync(resolveInputPath(raw.slice(1)), 'utf8') : raw;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected object');
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${flag}: invalid JSON: ${detail}`);
  }
}

function resolveInputPath(path) {
  return isAbsolute(path) ? path : resolve(PROJECT_DIR, path);
}

function resolveOutputPath(path) {
  return isAbsolute(path) ? path : resolve(PROJECT_DIR, path);
}

function receiptsDir() {
  return join(PROJECT_DIR, RECEIPTS_DIR);
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}

function output(opts, jsonValue, textWriter) {
  if (opts.json) console.log(JSON.stringify(jsonValue, null, 2));
  else textWriter();
}

function compactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const clean = jsonValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function jsonValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(jsonValue).filter((item) => item !== undefined);
  if (typeof value === 'object') return compactObject(value);
  return String(value);
}
