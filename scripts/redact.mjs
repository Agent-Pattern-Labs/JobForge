#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';
import {
  formatConfigSummary,
  formatScanResult,
  loadRedactConfig,
  parseJson,
  redactText,
  scanSources,
} from '@agent-pattern-labs/iso-redact';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  jobForgeRedactConfigPath,
  readJobForgeRedactConfig,
} from '../lib/jobforge-redact.mjs';

const USAGE = `job-forge redact - deterministic local redaction for exports

Usage:
  job-forge redact:scan   [--input <file> ...] [--stdin] [--config <file>] [--json]
  job-forge redact:verify [--input <file> ...] [--stdin] [--config <file>] [--json]
  job-forge redact:apply  (--input <file> | --stdin) [--output <file>] [--config <file>] [--json]
  job-forge redact:explain [--config <file>] [--json]
  job-forge redact:path

Default policy is templates/redact.json. Findings never print matched values;
previews are redacted length markers. Use apply to write a sanitized copy
before exporting traces, prompts, reports, or fixture text.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(configPath(opts));
  } else if (cmd === 'scan' || cmd === 'verify') {
    scan(cmd, opts);
  } else if (cmd === 'apply') {
    apply(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown redact command "${cmd}"\n`);
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const opts = {
    inputs: [],
    stdin: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--input' || arg === '-i') {
      opts.inputs.push(valueAfter(args, ++i, arg));
    } else if (arg.startsWith('--input=')) {
      opts.inputs.push(arg.slice('--input='.length));
    } else if (arg === '--stdin') {
      opts.stdin = true;
    } else if (arg === '--output' || arg === '-o') {
      opts.output = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--output=')) {
      opts.output = arg.slice('--output='.length);
    } else if (arg === '--config' || arg === '-c') {
      opts.config = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--config=')) {
      opts.config = arg.slice('--config='.length);
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag "${arg}"`);
    } else {
      opts.inputs.push(arg);
    }
  }

  return opts;
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function scan(mode, opts) {
  const sources = readSources(opts);
  if (sources.length === 0) throw new Error(`${mode} requires at least one --input or --stdin source`);
  const result = scanSources(readConfig(opts), sources);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatScanResult(result, mode));
  }
  if (mode === 'verify' && !result.ok) process.exit(1);
}

function apply(opts) {
  const sources = readSources(opts);
  if (sources.length !== 1) throw new Error('apply requires exactly one --input or --stdin source');
  const source = sources[0];
  const result = redactText(readConfig(opts), source.text, { source: source.name });
  if (opts.output) {
    const output = resolveOutputPath(opts.output);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, result.text, 'utf8');
    if (opts.json) {
      console.log(JSON.stringify({ ...result, text: undefined, output }, null, 2));
    } else {
      console.log(`iso-redact: wrote ${relativePath(output)} (${result.findings.length} finding(s) redacted)`);
    }
  } else if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.text);
  }
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

function readSources(opts) {
  const sources = opts.inputs.map((input) => {
    const path = resolveInputPath(input);
    return {
      name: relativePath(path),
      text: readFileSync(path, 'utf8'),
    };
  });
  if (opts.stdin) sources.push({ name: '<stdin>', text: readFileSync(0, 'utf8') });
  return sources;
}

function readConfig(opts) {
  if (opts.config) {
    const path = resolveInputPath(opts.config);
    return loadRedactConfig(parseJson(readFileSync(path, 'utf8'), path));
  }
  return readJobForgeRedactConfig(PROJECT_DIR);
}

function configPath(opts) {
  return opts.config ? resolveInputPath(opts.config) : jobForgeRedactConfigPath(PROJECT_DIR);
}

function resolveInputPath(path) {
  return isAbsolute(path) ? path : resolve(PROJECT_DIR, path);
}

function resolveOutputPath(path) {
  return isAbsolute(path) ? path : resolve(PROJECT_DIR, path);
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}
