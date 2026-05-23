#!/usr/bin/env node

import { relative } from 'path';
import {
  formatConfigSummary,
  formatMigrationResult,
} from '@agent-pattern-labs/iso-migrate';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  jobForgeMigrationConfigPath,
  readJobForgeMigrationConfig,
  runJobForgeMigrations,
} from '../lib/jobforge-migrate.mjs';

const USAGE = `job-forge migrate - deterministic consumer-project migrations

Usage:
  job-forge migrate:plan [--json]
  job-forge migrate:apply [--json]
  job-forge migrate:check [--json]
  job-forge migrate:explain [--json]
  job-forge migrate:path

The policy is templates/migrations.json. Sync applies these migrations
automatically unless JOB_FORGE_SKIP_MIGRATIONS=1 is set.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeMigrationConfigPath(PROJECT_DIR));
  } else if (cmd === 'plan') {
    run('plan', opts);
  } else if (cmd === 'apply') {
    run('apply', opts);
  } else if (cmd === 'check') {
    const result = run('check', opts);
    process.exit(result.changed ? 1 : 0);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown migrate command "${cmd}"\n`);
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const opts = { json: false, help: false };
  for (const arg of args) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown flag "${arg}"`);
  }
  return opts;
}

function run(mode, opts) {
  const result = runJobForgeMigrations({ dryRun: mode !== 'apply' }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatMigrationResult(result, mode));
  }
  return result;
}

function explain(opts) {
  const config = readJobForgeMigrationConfig(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(`config: ${relativePath(jobForgeMigrationConfigPath(PROJECT_DIR))}`);
  console.log(formatConfigSummary(config));
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
