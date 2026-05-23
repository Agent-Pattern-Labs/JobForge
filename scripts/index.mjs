#!/usr/bin/env node

import { relative } from 'path';
import {
  formatBuildResult,
  formatConfigSummary,
  formatIndexRecords,
  formatVerifyResult,
} from '@agent-pattern-labs/iso-index';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  buildJobForgeIndex,
  hasJobForgeIndexRecord,
  indexExists,
  jobForgeIndexConfigPath,
  jobForgeIndexPath,
  jobForgeIndexSummary,
  queryJobForgeIndex,
  readJobForgeIndexConfig,
  verifyJobForgeIndex,
} from '../lib/jobforge-index.mjs';

const USAGE = `job-forge index - local deterministic artifact lookup

Usage:
  job-forge index:status [--json]
  job-forge index:build [--json]
  job-forge index:query [text] [--kind <kind>] [--key <key>] [--value <value>] [--source <path>] [--limit N] [--no-rebuild] [--json]
  job-forge index:has [text] [--kind <kind>] [--key <key>] [--value <value>] [--source <path>] [--no-rebuild] [--json]
  job-forge index:verify [--no-rebuild] [--json]
  job-forge index:explain [--json]
  job-forge index:path

Default config is templates/index.json. Default output is .jobforge-index.json.
Query, has, and verify rebuild the index by default so consumer projects need no
manual setup. Use --no-rebuild to inspect the existing index file only.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeIndexPath(PROJECT_DIR));
  } else if (cmd === 'status') {
    status(opts);
  } else if (cmd === 'build') {
    build(opts);
  } else if (cmd === 'query') {
    query(opts);
  } else if (cmd === 'has') {
    has(opts);
  } else if (cmd === 'verify') {
    verify(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown index command "${cmd}"\n`);
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const opts = {
    json: false,
    help: false,
    rebuild: true,
    query: {},
    text: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--no-rebuild') {
      opts.rebuild = false;
    } else if (arg === '--rebuild') {
      opts.rebuild = true;
    } else if (arg === '--kind') {
      opts.query.kind = valueAfter(args, ++i, '--kind');
    } else if (arg.startsWith('--kind=')) {
      opts.query.kind = arg.slice('--kind='.length);
    } else if (arg === '--key') {
      opts.query.key = valueAfter(args, ++i, '--key');
    } else if (arg.startsWith('--key=')) {
      opts.query.key = arg.slice('--key='.length);
    } else if (arg === '--value') {
      opts.query.value = valueAfter(args, ++i, '--value');
    } else if (arg.startsWith('--value=')) {
      opts.query.value = arg.slice('--value='.length);
    } else if (arg === '--source') {
      opts.query.source = valueAfter(args, ++i, '--source');
    } else if (arg.startsWith('--source=')) {
      opts.query.source = arg.slice('--source='.length);
    } else if (arg === '--limit') {
      opts.query.limit = parsePositiveInteger(valueAfter(args, ++i, '--limit'), '--limit');
    } else if (arg.startsWith('--limit=')) {
      opts.query.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}"`);
    } else {
      opts.text.push(arg);
    }
  }

  if (opts.text.length > 0) opts.query.text = opts.text.join(' ');
  return opts;
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function status(opts) {
  const summary = jobForgeIndexSummary(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!summary.exists) {
    console.log(`index: missing (${relativePath(summary.path)})`);
    console.log('run: job-forge index:build');
    return;
  }
  const result = verifyJobForgeIndex({ rebuild: false }, PROJECT_DIR);
  console.log(`index:   ${relativePath(summary.path)}`);
  console.log(`config:  ${relativePath(summary.config)}`);
  console.log(`sources: ${summary.sources}`);
  console.log(`files:   ${summary.files}`);
  console.log(`records: ${summary.records}`);
  console.log(`verify:  ${result.ok ? 'PASS' : 'FAIL'} (${result.issues.length} issue(s))`);
}

function build(opts) {
  const { index, out } = buildJobForgeIndex({}, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify({ out, stats: index.stats }, null, 2));
    return;
  }
  console.log(formatBuildResult(index, out));
}

function query(opts) {
  const records = queryJobForgeIndex(opts.query, { rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  console.log(formatIndexRecords(records));
}

function has(opts) {
  const hit = hasJobForgeIndexRecord(opts.query, { rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify({ hit, query: opts.query }, null, 2));
  } else {
    console.log(hit ? 'MATCH' : 'MISS');
  }
  process.exit(hit ? 0 : 1);
}

function verify(opts) {
  if (!opts.rebuild && !indexExists(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeIndexPath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`index: missing (${relativePath(jobForgeIndexPath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = verifyJobForgeIndex({ rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function explain(opts) {
  const config = readJobForgeIndexConfig(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(formatConfigSummary(config));
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
