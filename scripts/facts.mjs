#!/usr/bin/env node

import { relative } from 'path';
import {
  formatBuildResult,
  formatCheckResult,
  formatConfigSummary,
  formatFacts,
  formatVerifyResult,
} from '@agent-pattern-labs/iso-facts';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  buildJobForgeFacts,
  checkJobForgeFacts,
  factsExist,
  hasJobForgeFact,
  jobForgeFactsConfigPath,
  jobForgeFactsPath,
  jobForgeFactsSummary,
  queryJobForgeFacts,
  readJobForgeFactsConfig,
  verifyJobForgeFacts,
} from '../lib/jobforge-facts.mjs';

const USAGE = `job-forge facts - local deterministic fact materialization

Usage:
  job-forge facts:status [--json]
  job-forge facts:build [--json]
  job-forge facts:query [text] [--fact <fact>] [--key <key>] [--value <value>] [--source <path>] [--tag <tag>] [--limit N] [--no-rebuild] [--json]
  job-forge facts:has [text] [--fact <fact>] [--key <key>] [--value <value>] [--source <path>] [--tag <tag>] [--no-rebuild] [--json]
  job-forge facts:verify [--no-rebuild] [--json]
  job-forge facts:check [--no-rebuild] [--json]
  job-forge facts:explain [--json]
  job-forge facts:path

Default config is templates/facts.json. Default output is .jobforge-facts.json.
Query, has, verify, and check rebuild facts by default so consumer projects need
no manual setup. Use --no-rebuild to inspect the existing fact set only.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeFactsPath(PROJECT_DIR));
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
  } else if (cmd === 'check') {
    check(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown facts command "${cmd}"\n`);
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
    } else if (arg === '--fact') {
      opts.query.fact = valueAfter(args, ++i, '--fact');
    } else if (arg.startsWith('--fact=')) {
      opts.query.fact = arg.slice('--fact='.length);
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
    } else if (arg === '--tag') {
      opts.query.tag = valueAfter(args, ++i, '--tag');
    } else if (arg.startsWith('--tag=')) {
      opts.query.tag = arg.slice('--tag='.length);
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
  const summary = jobForgeFactsSummary(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!summary.exists) {
    console.log(`facts: missing (${relativePath(summary.path)})`);
    console.log('run: job-forge facts:build');
    return;
  }
  const result = verifyJobForgeFacts({ rebuild: false }, PROJECT_DIR);
  console.log(`facts:   ${relativePath(summary.path)}`);
  console.log(`config:  ${relativePath(summary.config)}`);
  console.log(`sources: ${summary.sources}`);
  console.log(`files:   ${summary.files}`);
  console.log(`facts:   ${summary.facts}`);
  console.log(`verify:  ${result.ok ? 'PASS' : 'FAIL'} (${result.issues.length} issue(s))`);
}

function build(opts) {
  const { factSet, out } = buildJobForgeFacts({}, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify({ out, stats: factSet.stats }, null, 2));
    return;
  }
  console.log(formatBuildResult(factSet, out));
}

function query(opts) {
  const facts = queryJobForgeFacts(opts.query, { rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(facts, null, 2));
    return;
  }
  console.log(formatFacts(facts));
}

function has(opts) {
  const hit = hasJobForgeFact(opts.query, { rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify({ hit, query: opts.query }, null, 2));
  } else {
    console.log(hit ? 'MATCH' : 'MISS');
  }
  process.exit(hit ? 0 : 1);
}

function verify(opts) {
  if (!opts.rebuild && !factsExist(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeFactsPath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`facts: missing (${relativePath(jobForgeFactsPath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = verifyJobForgeFacts({ rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function check(opts) {
  if (!opts.rebuild && !factsExist(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeFactsPath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`facts: missing (${relativePath(jobForgeFactsPath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = checkJobForgeFacts({ rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatCheckResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function explain(opts) {
  const config = readJobForgeFactsConfig(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(`config: ${relativePath(jobForgeFactsConfigPath(PROJECT_DIR))}`);
  console.log(formatConfigSummary(config));
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
