#!/usr/bin/env node

import { relative } from 'path';
import {
  formatCanonResult,
  formatCompareResult,
  formatConfigSummary,
} from '@agent-pattern-labs/iso-canon';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  canonicalizeJobForgeEntity,
  compareJobForgeCanon,
  jobForgeCanonConfigPath,
  jobForgeCanonProfile,
} from '../lib/jobforge-canon.mjs';

const USAGE = `job-forge canon - deterministic identity keys for JobForge

Usage:
  job-forge canon:normalize <url|company|role> <value> [--json]
  job-forge canon:normalize company-role --company <name> --role <title> [--json]
  job-forge canon:key <url|company|role> <value> [--json]
  job-forge canon:key company-role --company <name> --role <title> [--json]
  job-forge canon:compare <url|company|role> <left> <right> [--json]
  job-forge canon:compare company-role --left-company <name> --left-role <title> --right-company <name> --right-role <title> [--json]
  job-forge canon:explain [--json]
  job-forge canon:path

The policy is templates/canon.json. These commands are local, model-free, and
use the same keys that JobForge ledger/cache helpers use internally.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeCanonConfigPath(PROJECT_DIR));
  } else if (cmd === 'normalize') {
    normalize(opts, false);
  } else if (cmd === 'key') {
    normalize(opts, true);
  } else if (cmd === 'compare') {
    compare(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown canon command "${cmd}"\n`);
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
    values: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--company') {
      opts.company = valueAfter(args, ++i, '--company');
    } else if (arg.startsWith('--company=')) {
      opts.company = arg.slice('--company='.length);
    } else if (arg === '--role') {
      opts.role = valueAfter(args, ++i, '--role');
    } else if (arg.startsWith('--role=')) {
      opts.role = arg.slice('--role='.length);
    } else if (arg === '--left-company') {
      opts.leftCompany = valueAfter(args, ++i, '--left-company');
    } else if (arg.startsWith('--left-company=')) {
      opts.leftCompany = arg.slice('--left-company='.length);
    } else if (arg === '--left-role') {
      opts.leftRole = valueAfter(args, ++i, '--left-role');
    } else if (arg.startsWith('--left-role=')) {
      opts.leftRole = arg.slice('--left-role='.length);
    } else if (arg === '--right-company') {
      opts.rightCompany = valueAfter(args, ++i, '--right-company');
    } else if (arg.startsWith('--right-company=')) {
      opts.rightCompany = arg.slice('--right-company='.length);
    } else if (arg === '--right-role') {
      opts.rightRole = valueAfter(args, ++i, '--right-role');
    } else if (arg.startsWith('--right-role=')) {
      opts.rightRole = arg.slice('--right-role='.length);
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}"`);
    } else {
      opts.values.push(arg);
    }
  }

  return opts;
}

function normalize(opts, keyOnly) {
  const type = parseType(opts.values.shift(), keyOnly ? 'key' : 'normalize');
  const input = normalizeInput(type, opts);
  const result = canonicalizeJobForgeEntity(type, input, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (keyOnly) {
    console.log(result.key);
  } else {
    console.log(formatCanonResult(result));
  }
}

function compare(opts) {
  const type = parseType(opts.values.shift(), 'compare');
  const [left, right] = compareInputs(type, opts);
  const result = compareJobForgeCanon(type, left, right, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatCompareResult(result));
}

function explain(opts) {
  const profile = jobForgeCanonProfile(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(profile, null, 2));
    return;
  }
  console.log(`config: ${relativePath(jobForgeCanonConfigPath(PROJECT_DIR))}`);
  console.log(formatConfigSummary({ version: 1, profiles: [profile] }));
}

function normalizeInput(type, opts) {
  if (type === 'company-role') {
    if (!opts.company || !opts.role) throw new Error('company-role requires --company and --role');
    return { company: opts.company, role: opts.role };
  }
  if (opts.values.length !== 1) throw new Error(`${type}: provide exactly one value; quote values containing spaces`);
  return opts.values[0];
}

function compareInputs(type, opts) {
  if (type === 'company-role') {
    if (!opts.leftCompany || !opts.leftRole || !opts.rightCompany || !opts.rightRole) {
      throw new Error('company-role compare requires --left-company, --left-role, --right-company, and --right-role');
    }
    return [
      { company: opts.leftCompany, role: opts.leftRole },
      { company: opts.rightCompany, role: opts.rightRole },
    ];
  }
  if (opts.values.length !== 2) throw new Error(`${type}: provide exactly two values; quote values containing spaces`);
  return [opts.values[0], opts.values[1]];
}

function parseType(value, command) {
  if (value === 'url' || value === 'company' || value === 'role' || value === 'company-role') return value;
  throw new Error(`${command}: expected type url, company, role, or company-role`);
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
