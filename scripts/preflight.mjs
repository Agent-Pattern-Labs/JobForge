#!/usr/bin/env node

import { readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import {
  formatConfigSummary,
  formatPreflightPlan,
  loadPreflightConfig,
  parseJson,
  planPreflight,
} from '@agent-pattern-labs/iso-preflight';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  jobForgePreflightConfigPath,
  planJobForgePreflight,
  readJobForgePreflightConfig,
} from '../lib/jobforge-preflight.mjs';

const USAGE = `job-forge preflight - deterministic dispatch planning for JobForge

Usage:
  job-forge preflight:plan --candidates <file> [--workflow jobforge.apply] [--json]
  job-forge preflight:check --candidates <file> [--workflow jobforge.apply] [--json]
  job-forge preflight:explain [--json]
  job-forge preflight:path

Candidate files are JSON arrays, or objects with a candidates array. The policy
is templates/preflight.json. This is local project state, not an MCP and not
prompt context.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(configPath(opts));
  } else if (cmd === 'plan' || cmd === 'check') {
    runPlan(cmd, opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown preflight command "${cmd}"\n`);
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
    } else if (arg === '--candidates' || arg === '-c') {
      opts.candidates = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--candidates=')) {
      opts.candidates = arg.slice('--candidates='.length);
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

function runPlan(mode, opts) {
  if (!opts.candidates) throw new Error(`${mode} requires --candidates <file>`);
  const candidates = readJsonFile(resolveInputPath(opts.candidates));
  const result = opts.config
    ? planPreflight(readConfig(opts), candidates, { workflow: opts.workflow })
    : planJobForgePreflight(candidates, { workflow: opts.workflow }, PROJECT_DIR);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatPreflightPlan(result, mode));
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
    return loadPreflightConfig(readJsonFile(path));
  }
  return readJobForgePreflightConfig(PROJECT_DIR);
}

function configPath(opts) {
  return opts.config ? resolveInputPath(opts.config) : jobForgePreflightConfigPath(PROJECT_DIR);
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
