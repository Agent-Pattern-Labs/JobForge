#!/usr/bin/env node

import { relative, resolve } from 'path';
import {
  formatCheckResult,
  formatExplainGraph,
  formatRecordResult,
  formatStaleResult,
  formatVerifyResult,
  parseJson,
} from '@agent-pattern-labs/iso-lineage';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  checkJobForgeLineage,
  jobForgeLineagePath,
  jobForgeLineageSummary,
  lineageExists,
  normalizeJobForgeLineageArtifact,
  readJobForgeLineage,
  readJobForgeLineageOrEmpty,
  recordJobForgeLineage,
  staleJobForgeLineage,
  verifyJobForgeLineage,
} from '../lib/jobforge-lineage.mjs';

const USAGE = `job-forge lineage - deterministic artifact lineage and stale-output checks

Usage:
  job-forge lineage:status [--json]
  job-forge lineage:record --artifact <file> [--input <file>...] [--optional-input <file>...] [--kind <kind>] [--command <cmd>] [--metadata <json>] [--now <iso>] [--json]
  job-forge lineage:check [--artifact <file>] [--json]
  job-forge lineage:stale [--json]
  job-forge lineage:verify [--json]
  job-forge lineage:explain [--artifact <file>] [--json]
  job-forge lineage:path

Default graph is .jobforge-lineage.json. Record generated reports, PDFs, and
other derived artifacts against their source CV/profile/report inputs, then
check whether outputs are stale after inputs change.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeLineagePath(PROJECT_DIR));
  } else if (cmd === 'status') {
    status(opts);
  } else if (cmd === 'record') {
    record(opts);
  } else if (cmd === 'check') {
    check(opts);
  } else if (cmd === 'stale') {
    stale(opts);
  } else if (cmd === 'verify') {
    verify(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown lineage command "${cmd}"\n`);
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
    inputs: [],
    optionalInputs: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--artifact') {
      opts.artifact = valueAfter(args, ++i, '--artifact');
    } else if (arg.startsWith('--artifact=')) {
      opts.artifact = arg.slice('--artifact='.length);
    } else if (arg === '--input') {
      opts.inputs.push(valueAfter(args, ++i, '--input'));
    } else if (arg.startsWith('--input=')) {
      opts.inputs.push(arg.slice('--input='.length));
    } else if (arg === '--optional-input') {
      opts.optionalInputs.push(valueAfter(args, ++i, '--optional-input'));
    } else if (arg.startsWith('--optional-input=')) {
      opts.optionalInputs.push(arg.slice('--optional-input='.length));
    } else if (arg === '--kind') {
      opts.kind = valueAfter(args, ++i, '--kind');
    } else if (arg.startsWith('--kind=')) {
      opts.kind = arg.slice('--kind='.length);
    } else if (arg === '--command') {
      opts.command = valueAfter(args, ++i, '--command');
    } else if (arg.startsWith('--command=')) {
      opts.command = arg.slice('--command='.length);
    } else if (arg === '--metadata') {
      opts.metadata = parseMetadata(valueAfter(args, ++i, '--metadata'));
    } else if (arg.startsWith('--metadata=')) {
      opts.metadata = parseMetadata(arg.slice('--metadata='.length));
    } else if (arg === '--now') {
      opts.now = valueAfter(args, ++i, '--now');
    } else if (arg.startsWith('--now=')) {
      opts.now = arg.slice('--now='.length);
    } else if (arg === '--out') {
      opts.out = resolve(PROJECT_DIR, valueAfter(args, ++i, '--out'));
    } else if (arg.startsWith('--out=')) {
      opts.out = resolve(PROJECT_DIR, arg.slice('--out='.length));
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

function parseMetadata(value) {
  const parsed = parseJson(value, '--metadata');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--metadata must be a JSON object');
  }
  return parsed;
}

function status(opts) {
  const summary = jobForgeLineageSummary(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!summary.exists) {
    console.log(`lineage: missing (${relativePath(summary.path)})`);
    console.log('run: job-forge lineage:record --artifact <file> --input <file>');
    return;
  }
  console.log(`lineage: ${relativePath(summary.path)}`);
  console.log(`records: ${summary.records}`);
  console.log(`current: ${summary.current}`);
  console.log(`stale:   ${summary.stale}`);
  console.log(`missing: ${summary.missing}`);
  console.log(`check:   ${summary.ok ? 'PASS' : 'STALE'}`);
}

function record(opts) {
  const result = recordJobForgeLineage({
    artifact: opts.artifact,
    inputs: opts.inputs,
    optionalInputs: opts.optionalInputs,
    kind: opts.kind,
    command: opts.command,
    metadata: opts.metadata,
    now: opts.now,
    out: opts.out,
  }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatRecordResult(result.graph, result.record, relativePath(result.out)));
}

function check(opts) {
  if (!lineageExists(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeLineagePath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`lineage: missing (${relativePath(jobForgeLineagePath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = checkJobForgeLineage({ artifact: opts.artifact }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatCheckResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function stale(opts) {
  if (!lineageExists(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeLineagePath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`lineage: missing (${relativePath(jobForgeLineagePath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = staleJobForgeLineage({}, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatStaleResult(result));
  }
}

function verify(opts) {
  if (!lineageExists(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeLineagePath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`lineage: missing (${relativePath(jobForgeLineagePath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = verifyJobForgeLineage({}, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function explain(opts) {
  const graph = lineageExists(PROJECT_DIR) ? readJobForgeLineage(PROJECT_DIR) : readJobForgeLineageOrEmpty(PROJECT_DIR);
  const artifact = opts.artifact
    ? normalizeJobForgeLineageArtifact(PROJECT_DIR, opts.artifact)
    : undefined;
  if (opts.json) {
    const records = artifact ? graph.records.filter((record) => record.artifact.path === artifact) : graph.records;
    console.log(JSON.stringify({ ...graph, records }, null, 2));
    return;
  }
  console.log(formatExplainGraph(graph, artifact));
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
