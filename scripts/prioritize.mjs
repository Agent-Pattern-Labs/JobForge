#!/usr/bin/env node

import { readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import {
  formatCheckResult,
  formatConfigSummary,
  formatPrioritizeResult,
  formatVerifyResult,
  loadPrioritizeItems,
  parseJson,
} from '@agent-pattern-labs/iso-prioritize';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  buildJobForgePrioritizeItems,
  checkJobForgePrioritize,
  jobForgePrioritizeConfigPath,
  jobForgePrioritizeItemsPath,
  jobForgePrioritizePath,
  jobForgePrioritizeSummary,
  prioritizeExists,
  rankJobForgePrioritize,
  readJobForgePrioritizeConfig,
  selectJobForgePrioritize,
  verifyJobForgePrioritize,
  writeJobForgePrioritize,
  writeJobForgePrioritizeItems,
} from '../lib/jobforge-prioritize.mjs';

const USAGE = `job-forge prioritize - deterministic next-action ranking

Usage:
  job-forge prioritize:status [--json]
  job-forge prioritize:items [--now <iso>] [--out <file>] [--json]
  job-forge prioritize:build [--now <iso>] [--profile <name>] [--limit N] [--out <file>] [--items-out <file>] [--json]
  job-forge prioritize:rank [--items <file>] [--profile <name>] [--limit N] [--json]
  job-forge prioritize:select [--items <file>] [--profile <name>] [--limit N] [--json]
  job-forge prioritize:check [--items <file>] [--profile <name>] [--limit N] [--min-selected N] [--fail-on blocked|skipped,blocked|none] [--json]
  job-forge prioritize:verify [--json]
  job-forge prioritize:explain [--profile <name>] [--json]
  job-forge prioritize:path [--config|--items]

Default policy is templates/prioritize.json. The generated queue is local
project state (.jobforge-prioritize.json), derived from source-backed facts and
due timeline items.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    path(opts);
  } else if (cmd === 'status') {
    status(opts);
  } else if (cmd === 'items') {
    items(opts);
  } else if (cmd === 'build') {
    build(opts);
  } else if (cmd === 'rank') {
    rank(opts);
  } else if (cmd === 'select') {
    select(opts);
  } else if (cmd === 'check') {
    check(opts);
  } else if (cmd === 'verify') {
    verify(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown prioritize command "${cmd}"\n`);
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
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--no-rebuild') {
      opts.rebuild = false;
    } else if (arg === '--profile') {
      opts.profile = valueAfter(args, ++i, '--profile');
    } else if (arg.startsWith('--profile=')) {
      opts.profile = arg.slice('--profile='.length);
    } else if (arg === '--limit') {
      opts.limit = parsePositiveInteger(valueAfter(args, ++i, '--limit'), '--limit');
    } else if (arg.startsWith('--limit=')) {
      opts.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--min-selected') {
      opts.minSelected = parseNonNegativeInteger(valueAfter(args, ++i, '--min-selected'), '--min-selected');
    } else if (arg.startsWith('--min-selected=')) {
      opts.minSelected = parseNonNegativeInteger(arg.slice('--min-selected='.length), '--min-selected');
    } else if (arg === '--fail-on') {
      opts.failOn = parseFailOn(valueAfter(args, ++i, '--fail-on'));
    } else if (arg.startsWith('--fail-on=')) {
      opts.failOn = parseFailOn(arg.slice('--fail-on='.length));
    } else if (arg === '--now') {
      opts.now = valueAfter(args, ++i, '--now');
    } else if (arg.startsWith('--now=')) {
      opts.now = arg.slice('--now='.length);
    } else if (arg === '--items') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        opts.itemsPath = true;
      } else {
        opts.items = valueAfter(args, ++i, '--items');
      }
    } else if (arg.startsWith('--items=')) {
      opts.items = arg.slice('--items='.length);
    } else if (arg === '--out') {
      opts.out = resolveInputPath(valueAfter(args, ++i, '--out'));
    } else if (arg.startsWith('--out=')) {
      opts.out = resolveInputPath(arg.slice('--out='.length));
    } else if (arg === '--items-out') {
      opts.itemsOut = resolveInputPath(valueAfter(args, ++i, '--items-out'));
    } else if (arg.startsWith('--items-out=')) {
      opts.itemsOut = resolveInputPath(arg.slice('--items-out='.length));
    } else if (arg === '--config') {
      opts.configPath = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`unknown flag "${arg}"`);
    }
  }

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

function parseNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}

function parseFailOn(value) {
  if (value === 'none') return 'none';
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function path(opts) {
  if (opts.configPath) {
    console.log(jobForgePrioritizeConfigPath(PROJECT_DIR));
  } else if (opts.itemsPath) {
    console.log(jobForgePrioritizeItemsPath(PROJECT_DIR));
  } else {
    console.log(jobForgePrioritizePath(PROJECT_DIR));
  }
}

function status(opts) {
  const summary = jobForgePrioritizeSummary(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!summary.exists) {
    console.log(`prioritize: missing (${relativePath(summary.path)})`);
    console.log('run: job-forge prioritize:build');
    return;
  }
  const result = verifyJobForgePrioritize({}, PROJECT_DIR);
  console.log(`prioritize: ${relativePath(summary.path)}`);
  console.log(`items:      ${relativePath(summary.itemsPath)}`);
  console.log(`profile:    ${summary.profile}`);
  console.log(`total:      ${summary.items}`);
  console.log(`selected:   ${summary.selected}`);
  console.log(`candidate:  ${summary.candidate}`);
  console.log(`skipped:    ${summary.skipped}`);
  console.log(`blocked:    ${summary.blocked}`);
  console.log(`verify:     ${result.ok ? 'PASS' : 'FAIL'} (${result.errors} errors, ${result.warnings} warnings)`);
}

function items(opts) {
  const input = buildJobForgePrioritizeItems({ now: opts.now, rebuild: opts.rebuild }, PROJECT_DIR);
  if (opts.out) writeJobForgePrioritizeItems(input, { out: opts.out }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(input, null, 2));
    return;
  }
  if (opts.out) console.log(`items: wrote ${relativePath(opts.out)}`);
  console.log(`items: ${input.items.length}`);
}

function build(opts) {
  const input = readItems(opts) || buildJobForgePrioritizeItems({ now: opts.now, rebuild: opts.rebuild }, PROJECT_DIR);
  const result = rankJobForgePrioritize({
    items: input,
    profile: opts.profile,
    limit: opts.limit,
  }, PROJECT_DIR);
  const itemsOut = writeJobForgePrioritizeItems(input, { out: opts.itemsOut }, PROJECT_DIR);
  const out = writeJobForgePrioritize(result, { out: opts.out }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify({ out, itemsOut, result }, null, 2));
    return;
  }
  console.log(`prioritize: wrote ${relativePath(out)}`);
  console.log(`items:      wrote ${relativePath(itemsOut)}`);
  console.log(formatPrioritizeResult(result));
}

function rank(opts) {
  const result = rankJobForgePrioritize({
    items: readItems(opts),
    profile: opts.profile,
    limit: opts.limit,
    now: opts.now,
    rebuild: opts.rebuild,
  }, PROJECT_DIR);
  if (opts.out) writeJobForgePrioritize(result, { out: opts.out }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatPrioritizeResult(result));
}

function select(opts) {
  const result = selectJobForgePrioritize({
    items: readItems(opts),
    profile: opts.profile,
    limit: opts.limit,
    now: opts.now,
    rebuild: opts.rebuild,
  }, PROJECT_DIR);
  if (opts.out) writeJobForgePrioritize(result, { out: opts.out }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatPrioritizeResult(result));
}

function check(opts) {
  const result = checkJobForgePrioritize({
    items: readItems(opts),
    profile: opts.profile,
    limit: opts.limit,
    minSelected: opts.minSelected,
    failOn: opts.failOn,
    now: opts.now,
    rebuild: opts.rebuild,
  }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatCheckResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function verify(opts) {
  if (!prioritizeExists(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgePrioritizePath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`prioritize: missing (${relativePath(jobForgePrioritizePath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = verifyJobForgePrioritize({}, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function explain(opts) {
  const config = readJobForgePrioritizeConfig(PROJECT_DIR);
  if (opts.json) {
    const value = opts.profile
      ? { ...config, profiles: config.profiles.filter((profile) => profile.name === opts.profile) }
      : config;
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  console.log(`config: ${relativePath(jobForgePrioritizeConfigPath(PROJECT_DIR))}`);
  console.log(formatConfigSummary(config, opts.profile));
}

function readItems(opts) {
  if (!opts.items) return undefined;
  const path = resolveInputPath(opts.items);
  return { items: loadPrioritizeItems(parseJson(readFileSync(path, 'utf8'), path)) };
}

function resolveInputPath(path) {
  return isAbsolute(path) ? path : resolve(PROJECT_DIR, path);
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
