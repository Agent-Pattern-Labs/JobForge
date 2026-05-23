#!/usr/bin/env node

import { readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import {
  formatConfigSummary,
  formatPostflightResult,
  loadPostflightConfig,
  parseJson,
  settlePostflight,
} from '@agent-pattern-labs/iso-postflight';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  jobForgePostflightConfigPath,
  readJobForgePostflightConfig,
  settleJobForgePostflight,
} from '../lib/jobforge-postflight.mjs';

const USAGE = `job-forge postflight - deterministic dispatch settlement for JobForge

Usage:
  job-forge postflight:status --plan <file> --outcomes <file> [--workflow jobforge.apply] [--json]
  job-forge postflight:check --plan <file> --outcomes <file> [--workflow jobforge.apply] [--json]
  job-forge postflight:explain [--json]
  job-forge postflight:path

Plan files are JSON objects with rounds, such as the JSON output from
job-forge preflight:plan. Outcome files are JSON objects with dispatches,
outcomes, and post-step observations. The policy is templates/postflight.json.
This is local project state, not an MCP and not prompt context.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(configPath(opts));
  } else if (cmd === 'status' || cmd === 'check') {
    runSettlement(cmd, opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown postflight command "${cmd}"\n`);
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
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--plan' || arg === '-p') {
      opts.plan = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--plan=')) {
      opts.plan = arg.slice('--plan='.length);
    } else if (arg === '--outcomes' || arg === '--observations' || arg === '-o') {
      opts.outcomes = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--outcomes=')) {
      opts.outcomes = arg.slice('--outcomes='.length);
    } else if (arg.startsWith('--observations=')) {
      opts.outcomes = arg.slice('--observations='.length);
    } else if (arg === '--workflow') {
      opts.workflow = valueAfter(args, ++i, '--workflow');
    } else if (arg.startsWith('--workflow=')) {
      opts.workflow = arg.slice('--workflow='.length);
    } else if (arg === '--config') {
      opts.config = valueAfter(args, ++i, '--config');
    } else if (arg.startsWith('--config=')) {
      opts.config = arg.slice('--config='.length);
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`unknown flag "${arg}"`);
    }
  }

  return opts;
}

function runSettlement(mode, opts) {
  if (!opts.plan) throw new Error(`${mode} requires --plan <file>`);
  if (!opts.outcomes) throw new Error(`${mode} requires --outcomes <file>`);
  const plan = readJsonFile(resolveInputPath(opts.plan));
  const observations = readJsonFile(resolveInputPath(opts.outcomes));
  const result = opts.config
    ? settlePostflight(readConfig(opts), plan, observations, { workflow: opts.workflow })
    : settleJobForgePostflight(plan, observations, { workflow: opts.workflow }, PROJECT_DIR);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPostflightResult(result, mode));
  }

  if (mode === 'check' && !result.ok) process.exit(1);
}

function explain(opts) {
  const config = readConfig(opts);
  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(`config: ${relativePath(configPath(opts))}`);
  console.log(formatConfigSummary(config));
}

function readConfig(opts) {
  if (opts.config) {
    const path = resolveInputPath(opts.config);
    return loadPostflightConfig(readJsonFile(path));
  }
  return readJobForgePostflightConfig(PROJECT_DIR);
}

function configPath(opts) {
  return opts.config ? resolveInputPath(opts.config) : jobForgePostflightConfigPath(PROJECT_DIR);
}

function readJsonFile(path) {
  return parseJson(readFileSync(path, 'utf8'), path);
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function resolveInputPath(path) {
  return isAbsolute(path) ? path : resolve(PROJECT_DIR, path);
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
