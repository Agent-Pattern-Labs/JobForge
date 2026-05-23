#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { relative, resolve } from 'path';
import {
  formatCheckResult,
  formatComparison,
  formatConfigSummary,
  formatGateResult,
  formatScoreResult,
  formatVerifyResult,
} from '@agent-pattern-labs/iso-score';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  checkJobForgeScore,
  compareJobForgeScores,
  computeJobForgeScore,
  evaluateJobForgeScoreGate,
  jobForgeScoreConfigPath,
  readJobForgeScoreConfig,
  readJsonFile,
  verifyJobForgeScoreResult,
} from '../lib/jobforge-score.mjs';

const USAGE = `job-forge score - deterministic JobForge offer scoring

Usage:
  job-forge score:compute --input <file> [--out <file>] [--profile jobforge] [--json]
  job-forge score:check --input <file> [--profile jobforge] [--json]
  job-forge score:gate --input <file> [--gate apply] [--profile jobforge] [--json]
  job-forge score:verify --score <file> [--json]
  job-forge score:compare --left <file> --right <file> [--profile jobforge] [--json]
  job-forge score:explain [--profile jobforge] [--json]
  job-forge score:path

Default config is templates/score.json. The input may be native iso-score
JSON or JobForge's existing report score JSON shape with a top-level scores map.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeScoreConfigPath(PROJECT_DIR));
  } else if (cmd === 'compute') {
    compute(opts);
  } else if (cmd === 'check') {
    check(opts);
  } else if (cmd === 'gate') {
    gate(opts);
  } else if (cmd === 'verify') {
    verify(opts);
  } else if (cmd === 'compare') {
    compare(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown score command "${cmd}"\n`);
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
    profile: '',
    gate: '',
    input: '',
    score: '',
    left: '',
    right: '',
    out: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--profile') {
      opts.profile = valueAfter(args, ++i, '--profile');
    } else if (arg.startsWith('--profile=')) {
      opts.profile = arg.slice('--profile='.length);
    } else if (arg === '--gate') {
      opts.gate = valueAfter(args, ++i, '--gate');
    } else if (arg.startsWith('--gate=')) {
      opts.gate = arg.slice('--gate='.length);
    } else if (arg === '--input') {
      opts.input = valueAfter(args, ++i, '--input');
    } else if (arg.startsWith('--input=')) {
      opts.input = arg.slice('--input='.length);
    } else if (arg === '--score') {
      opts.score = valueAfter(args, ++i, '--score');
    } else if (arg.startsWith('--score=')) {
      opts.score = arg.slice('--score='.length);
    } else if (arg === '--left') {
      opts.left = valueAfter(args, ++i, '--left');
    } else if (arg.startsWith('--left=')) {
      opts.left = arg.slice('--left='.length);
    } else if (arg === '--right') {
      opts.right = valueAfter(args, ++i, '--right');
    } else if (arg.startsWith('--right=')) {
      opts.right = arg.slice('--right='.length);
    } else if (arg === '--out') {
      opts.out = valueAfter(args, ++i, '--out');
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
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

function compute(opts) {
  if (!opts.input) throw new Error('score:compute requires --input');
  const result = computeJobForgeScore(readJsonFile(resolve(opts.input)), { profile: opts.profile }, PROJECT_DIR);
  if (opts.out) writeFileSync(resolve(opts.out), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatScoreResult(result));
  }
}

function check(opts) {
  if (!opts.input) throw new Error('score:check requires --input');
  const result = checkJobForgeScore(readJsonFile(resolve(opts.input)), { profile: opts.profile }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatCheckResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function gate(opts) {
  if (!opts.input) throw new Error('score:gate requires --input');
  const result = evaluateJobForgeScoreGate(readJsonFile(resolve(opts.input)), {
    gate: opts.gate || 'apply',
    profile: opts.profile,
  }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatGateResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function verify(opts) {
  if (!opts.score) throw new Error('score:verify requires --score');
  const result = verifyJobForgeScoreResult(readJsonFile(resolve(opts.score)));
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function compare(opts) {
  if (!opts.left) throw new Error('score:compare requires --left');
  if (!opts.right) throw new Error('score:compare requires --right');
  const result = compareJobForgeScores(
    readJsonFile(resolve(opts.left)),
    readJsonFile(resolve(opts.right)),
    { profile: opts.profile },
    PROJECT_DIR,
  );
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatComparison(result));
  }
  const hasErrors = [...result.left.issues, ...result.right.issues].some((issue) => issue.severity === 'error');
  process.exit(hasErrors ? 1 : 0);
}

function explain(opts) {
  const config = readJobForgeScoreConfig(PROJECT_DIR);
  if (opts.json) {
    const value = opts.profile
      ? { ...config, profiles: config.profiles.filter((profile) => profile.name === opts.profile) }
      : config;
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(`config: ${relative(PROJECT_DIR, jobForgeScoreConfigPath(PROJECT_DIR))}`);
    console.log(formatConfigSummary(config, opts.profile || undefined));
  }
}
