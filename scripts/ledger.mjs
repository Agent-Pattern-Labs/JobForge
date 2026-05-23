#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import {
  formatEvents,
  formatVerifyResult,
  queryEvents,
} from '@agent-pattern-labs/iso-ledger';
import { PROJECT_DIR, readAllEntries } from '../tracker-lib.mjs';
import {
  appendJobForgeEvent,
  buildApplicationEvent,
  buildPipelineEvent,
  companyRoleKey,
  jobForgeLedgerPath,
  jobForgeLedgerSummary,
  ledgerExists,
  legacyCompanyRoleKey,
  legacyUrlKey,
  readJobForgeLedger,
  urlKey,
  verifyJobForgeLedger,
} from '../lib/jobforge-ledger.mjs';

const USAGE = `job-forge ledger - local deterministic workflow state

Usage:
  job-forge ledger:status [--json]
  job-forge ledger:rebuild [--reset] [--json]
  job-forge ledger:verify [--json]
  job-forge ledger:has --url <url> [--json]
  job-forge ledger:has --company <name> --role <role> [--status Applied] [--json]
  job-forge ledger:query [--type <type>] [--key <key>] [--where field=value] [--limit N] [--json]
  job-forge ledger:path

The ledger is stored at .jobforge-ledger/events.jsonl by default. It is local
personal workflow state, not an MCP and not prompt context.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeLedgerPath(PROJECT_DIR));
  } else if (cmd === 'status') {
    status(opts);
  } else if (cmd === 'rebuild') {
    rebuild(opts);
  } else if (cmd === 'verify') {
    verify(opts);
  } else if (cmd === 'has') {
    has(opts);
  } else if (cmd === 'query') {
    query(opts);
  } else {
    console.error(`unknown ledger command "${cmd}"\n`);
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const opts = { where: {}, json: false, reset: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--reset') {
      opts.reset = true;
    } else if (arg === '--url') {
      opts.url = valueAfter(args, ++i, '--url');
    } else if (arg.startsWith('--url=')) {
      opts.url = arg.slice('--url='.length);
    } else if (arg === '--company') {
      opts.company = valueAfter(args, ++i, '--company');
    } else if (arg.startsWith('--company=')) {
      opts.company = arg.slice('--company='.length);
    } else if (arg === '--role') {
      opts.role = valueAfter(args, ++i, '--role');
    } else if (arg.startsWith('--role=')) {
      opts.role = arg.slice('--role='.length);
    } else if (arg === '--status') {
      opts.status = valueAfter(args, ++i, '--status');
    } else if (arg.startsWith('--status=')) {
      opts.status = arg.slice('--status='.length);
    } else if (arg === '--type') {
      opts.type = valueAfter(args, ++i, '--type');
    } else if (arg.startsWith('--type=')) {
      opts.type = arg.slice('--type='.length);
    } else if (arg === '--key') {
      opts.key = valueAfter(args, ++i, '--key');
    } else if (arg.startsWith('--key=')) {
      opts.key = arg.slice('--key='.length);
    } else if (arg === '--where') {
      addWhere(opts.where, valueAfter(args, ++i, '--where'));
    } else if (arg.startsWith('--where=')) {
      addWhere(opts.where, arg.slice('--where='.length));
    } else if (arg === '--limit') {
      opts.limit = Number(valueAfter(args, ++i, '--limit'));
    } else if (arg.startsWith('--limit=')) {
      opts.limit = Number(arg.slice('--limit='.length));
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`unknown flag "${arg}"`);
    }
  }
  if (opts.status) opts.where.status = opts.status;
  return opts;
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function addWhere(where, raw) {
  const index = raw.indexOf('=');
  if (index <= 0) throw new Error('--where must be field=value');
  where[raw.slice(0, index)] = parsePrimitive(raw.slice(index + 1));
}

function parsePrimitive(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  const number = Number(value);
  return Number.isFinite(number) && value.trim() !== '' ? number : value;
}

function status(opts) {
  const summary = jobForgeLedgerSummary(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!summary.exists) {
    console.log(`ledger: missing (${relativeLedgerPath()})`);
    console.log('run: job-forge ledger:rebuild');
    return;
  }
  const verifyResult = verifyJobForgeLedger(PROJECT_DIR);
  console.log(`ledger:   ${relativeLedgerPath()}`);
  console.log(`events:   ${summary.events}`);
  console.log(`entities: ${summary.entities}`);
  console.log(`verify:   ${verifyResult.ok ? 'PASS' : 'FAIL'} (${verifyResult.errors} errors, ${verifyResult.warnings} warnings)`);
  if (summary.latest) {
    console.log(`latest:   ${summary.latest.type} @ ${summary.latest.at}`);
  }
}

function rebuild(opts) {
  const ledgerPath = jobForgeLedgerPath(PROJECT_DIR);
  if (opts.reset && existsSync(ledgerPath)) rmSync(ledgerPath);
  mkdirSync(dirname(ledgerPath), { recursive: true });

  const results = [];
  for (const event of collectProjectEvents()) {
    results.push(appendJobForgeEvent(event, PROJECT_DIR));
  }

  const summary = {
    path: ledgerPath,
    eventsSeen: results.length,
    appended: results.filter((result) => result.appended).length,
    deduped: results.filter((result) => !result.appended).length,
  };

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`ledger: ${relativeLedgerPath()}`);
  console.log(`events: ${summary.appended} appended, ${summary.deduped} already present`);
}

function verify(opts) {
  if (!ledgerExists(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeLedgerPath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`ledger: missing (${relativeLedgerPath()})`);
    }
    return;
  }
  const result = verifyJobForgeLedger(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.errors > 0 ? 1 : 0);
}

function has(opts) {
  const filters = queryFilterCandidates(opts);
  const ledger = readJobForgeLedger(PROJECT_DIR);
  const events = uniqueEvents(filters.flatMap((filter) => queryEvents(ledger, filter)));
  if (opts.json) {
    console.log(JSON.stringify({ match: events.length > 0, count: events.length, filters }, null, 2));
  } else if (events.length > 0) {
    console.log(`MATCH (${events.length} event(s))`);
  } else {
    console.log('MISS');
  }
  process.exit(events.length > 0 ? 0 : 1);
}

function query(opts) {
  const filters = queryFilters(opts);
  const events = queryEvents(readJobForgeLedger(PROJECT_DIR), filters);
  if (opts.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  console.log(formatEvents(events));
}

function queryFilters(opts) {
  const filters = {};
  if (opts.type) filters.type = opts.type;
  if (opts.key) filters.key = opts.key;
  if (opts.url) filters.key = urlKey(opts.url);
  if (opts.company || opts.role) {
    if (!opts.company || !opts.role) throw new Error('--company and --role must be provided together');
    filters.key = companyRoleKey(opts.company, opts.role);
  }
  if (Object.keys(opts.where || {}).length > 0) filters.where = opts.where;
  if (Number.isFinite(opts.limit) && opts.limit > 0) filters.limit = opts.limit;
  return filters;
}

function queryFilterCandidates(opts) {
  const primary = queryFilters(opts);
  const candidates = [primary];
  const legacy = { ...primary };
  if (opts.url) legacy.key = legacyUrlKey(opts.url);
  if (opts.company || opts.role) legacy.key = legacyCompanyRoleKey(opts.company, opts.role);
  if (legacy.key && legacy.key !== primary.key) candidates.push(legacy);
  return candidates;
}

function uniqueEvents(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    const id = event.id || event.idempotencyKey || JSON.stringify(event);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(event);
  }
  return out;
}

function collectProjectEvents() {
  const events = [];
  const { entries } = readAllEntries();
  for (const entry of entries) {
    events.push(buildApplicationEvent('jobforge.application.tracker', entry, {
      projectDir: PROJECT_DIR,
      sourceFile: entry._sourceFile,
      idempotencyPrefix: 'tracker-entry',
    }));
  }

  for (const item of collectTrackerTsvs('batch/tracker-additions', 'pending')) {
    events.push(buildApplicationEvent(`jobforge.tracker_addition.${item.state}`, item.addition, {
      projectDir: PROJECT_DIR,
      sourceFile: item.path,
      idempotencyPrefix: `tracker-addition-${item.state}`,
      data: { state: item.state },
    }));
  }

  for (const item of collectTrackerTsvs('batch/tracker-additions/merged', 'merged')) {
    events.push(buildApplicationEvent(`jobforge.tracker_addition.${item.state}`, item.addition, {
      projectDir: PROJECT_DIR,
      sourceFile: item.path,
      idempotencyPrefix: `tracker-addition-${item.state}`,
      data: { state: item.state },
    }));
  }

  for (const item of collectPipelineItems()) {
    events.push(buildPipelineEvent(item, {
      projectDir: PROJECT_DIR,
      sourceFile: join(PROJECT_DIR, 'data', 'pipeline.md'),
    }));
  }

  return events;
}

function collectTrackerTsvs(relDir, state) {
  const dir = join(PROJECT_DIR, relDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.tsv')).sort()) {
    const path = join(dir, name);
    const addition = parseTsvContent(readFileSync(path, 'utf8'), name);
    if (addition) out.push({ path, state, addition });
  }
  return out;
}

function parseTsvContent(content, filename) {
  const text = content.trim();
  if (!text) return null;
  let parts;
  if (text.startsWith('|')) {
    parts = text.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 8) return null;
    return {
      num: parts[0],
      date: parts[1],
      company: parts[2],
      role: parts[3],
      score: parts[4],
      status: parts[5],
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
  }

  parts = text.split('\t');
  if (parts.length < 8) return null;
  const col4 = parts[4].trim();
  const col5 = parts[5].trim();
  const col4LooksLikeScore = looksLikeScore(col4);
  const col5LooksLikeScore = looksLikeScore(col5);
  return {
    num: parts[0],
    date: parts[1],
    company: parts[2],
    role: parts[3],
    status: col4LooksLikeScore && !col5LooksLikeScore ? col5 : col4,
    score: col4LooksLikeScore && !col5LooksLikeScore ? col4 : col5,
    pdf: parts[6],
    report: parts[7],
    notes: parts[8] || '',
    sourceFile: filename,
  };
}

function looksLikeScore(value) {
  return /^\d+\.?\d*\/5$/.test(value) || value === 'N/A' || value === 'DUP';
}

function collectPipelineItems() {
  const path = join(PROJECT_DIR, 'data', 'pipeline.md');
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n');
  const out = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s+([^|#\s]+)(.*)$/);
    if (!match) return;
    const rest = match[3] || '';
    const fields = rest.split('|').map((field) => field.trim()).filter(Boolean);
    out.push({
      checked: match[1].toLowerCase() === 'x',
      url: match[2].trim(),
      company: fields[0] || '',
      role: fields[1] || '',
      line,
      lineNumber: index + 1,
    });
  });
  return out;
}

function relativeLedgerPath() {
  return jobForgeLedgerPath(PROJECT_DIR).replace(`${PROJECT_DIR}/`, '');
}
