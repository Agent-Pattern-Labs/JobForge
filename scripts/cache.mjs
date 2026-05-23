#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import {
  formatCacheEntries,
  formatPruneResult,
  formatVerifyResult,
} from '@agent-pattern-labs/iso-cache';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  DEFAULT_JD_TTL_MS,
  JD_CACHE_KIND,
  jobDescriptionCacheKey,
  jobForgeCacheDir,
  jobForgeCacheSummary,
  listJobForgeCache,
  pruneJobForgeCache,
  putJobDescriptionCache,
  putJobForgeCache,
  readJobDescriptionCache,
  readJobForgeCache,
  verifyJobForgeCache,
} from '../lib/jobforge-cache.mjs';

const USAGE = `job-forge cache - local deterministic artifact cache

Usage:
  job-forge cache:key --url <url> [--json]
  job-forge cache:status [--json]
  job-forge cache:has (--url <url> | --key <key>) [--allow-expired] [--json]
  job-forge cache:get (--url <url> | --key <key>) [--allow-expired] [--output <file>] [--json]
  job-forge cache:put (--url <url> | --key <key>) --input <text|@file|-> [--ttl 14d] [--kind <kind>] [--content-type <type>] [--meta <json|@file>] [--json]
  job-forge cache:list [--kind <kind>] [--include-expired] [--json]
  job-forge cache:verify [--json]
  job-forge cache:prune [--expired] [--dry-run] [--json]
  job-forge cache:path

Default path is .jobforge-cache/ unless JOB_FORGE_CACHE is set. This is local
project state, not an MCP and not prompt context.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    console.log(jobForgeCacheDir(PROJECT_DIR));
  } else if (cmd === 'key') {
    key(opts);
  } else if (cmd === 'status') {
    status(opts);
  } else if (cmd === 'has') {
    has(opts);
  } else if (cmd === 'get') {
    get(opts);
  } else if (cmd === 'put') {
    put(opts);
  } else if (cmd === 'list') {
    list(opts);
  } else if (cmd === 'verify') {
    verify(opts);
  } else if (cmd === 'prune') {
    prune(opts);
  } else {
    console.error(`unknown cache command "${cmd}"\n`);
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
    allowExpired: false,
    includeExpired: false,
    dryRun: false,
    expired: false,
    ttlMs: DEFAULT_JD_TTL_MS,
    metadata: {},
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--url') {
      opts.url = valueAfter(args, ++i, '--url');
    } else if (arg.startsWith('--url=')) {
      opts.url = arg.slice('--url='.length);
    } else if (arg === '--key') {
      opts.key = valueAfter(args, ++i, '--key');
    } else if (arg.startsWith('--key=')) {
      opts.key = arg.slice('--key='.length);
    } else if (arg === '--input') {
      opts.input = valueAfter(args, ++i, '--input');
    } else if (arg.startsWith('--input=')) {
      opts.input = arg.slice('--input='.length);
    } else if (arg === '--output') {
      opts.output = valueAfter(args, ++i, '--output');
    } else if (arg.startsWith('--output=')) {
      opts.output = arg.slice('--output='.length);
    } else if (arg === '--kind') {
      opts.kind = valueAfter(args, ++i, '--kind');
    } else if (arg.startsWith('--kind=')) {
      opts.kind = arg.slice('--kind='.length);
    } else if (arg === '--content-type') {
      opts.contentType = valueAfter(args, ++i, '--content-type');
    } else if (arg.startsWith('--content-type=')) {
      opts.contentType = arg.slice('--content-type='.length);
    } else if (arg === '--ttl') {
      opts.ttlMs = parseDuration(valueAfter(args, ++i, '--ttl'));
    } else if (arg.startsWith('--ttl=')) {
      opts.ttlMs = parseDuration(arg.slice('--ttl='.length));
    } else if (arg === '--expires-at') {
      opts.expiresAt = valueAfter(args, ++i, '--expires-at');
      opts.ttlMs = undefined;
    } else if (arg.startsWith('--expires-at=')) {
      opts.expiresAt = arg.slice('--expires-at='.length);
      opts.ttlMs = undefined;
    } else if (arg === '--meta') {
      opts.metadata = parseMetadata(valueAfter(args, ++i, '--meta'));
    } else if (arg.startsWith('--meta=')) {
      opts.metadata = parseMetadata(arg.slice('--meta='.length));
    } else if (arg === '--allow-expired') {
      opts.allowExpired = true;
    } else if (arg === '--include-expired') {
      opts.includeExpired = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--expired') {
      opts.expired = true;
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

function key(opts) {
  const keyValue = keyFromOptions(opts);
  if (opts.json) {
    console.log(JSON.stringify({ key: keyValue, url: opts.url || null }, null, 2));
    return;
  }
  console.log(keyValue);
}

function status(opts) {
  const summary = jobForgeCacheSummary(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`cache:   ${summary.root}`);
  console.log(`exists:  ${summary.exists ? 'yes' : 'no'}`);
  console.log(`entries: ${summary.active} active, ${summary.entries - summary.active} expired`);
}

function has(opts) {
  const hit = read(opts);
  if (opts.json) {
    console.log(JSON.stringify({ hit: Boolean(hit?.hit), stale: Boolean(hit?.stale), key: keyFromOptions(opts) }, null, 2));
  } else {
    console.log(hit?.hit ? `HIT${hit.stale ? ' stale' : ''}` : 'MISS');
  }
  process.exit(hit?.hit ? 0 : 1);
}

function get(opts) {
  const hit = read(opts);
  if (!hit?.hit || hit.content === undefined) {
    if (opts.json) {
      console.log(JSON.stringify({ hit: false, stale: Boolean(hit?.stale), key: keyFromOptions(opts) }, null, 2));
    } else {
      console.log('MISS');
    }
    process.exit(1);
  }
  if (opts.output) {
    writeFileSync(opts.output, hit.content, 'utf8');
  }
  if (opts.json) {
    console.log(JSON.stringify({ hit: true, stale: hit.stale, entry: hit.entry, content: opts.output ? undefined : hit.content }, null, 2));
  } else if (opts.output) {
    console.log(`WROTE ${opts.output}`);
  } else {
    process.stdout.write(hit.content);
    if (!hit.content.endsWith('\n')) process.stdout.write('\n');
  }
}

function put(opts) {
  if (!opts.input) throw new Error('cache:put requires --input <text|@file|->');
  const content = readInput(opts.input);
  const entry = opts.url
    ? putJobDescriptionCache(opts.url, content, {
      kind: opts.kind || JD_CACHE_KIND,
      contentType: opts.contentType,
      ttlMs: opts.ttlMs,
      expiresAt: opts.expiresAt,
      metadata: opts.metadata,
    }, PROJECT_DIR)
    : putJobForgeCache(requiredKey(opts), content, {
      kind: opts.kind,
      contentType: opts.contentType,
      ttlMs: opts.expiresAt ? undefined : opts.ttlMs,
      expiresAt: opts.expiresAt,
      metadata: opts.metadata,
    }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  console.log(`STORED ${entry.key} ${entry.contentHash}`);
}

function list(opts) {
  const entries = listJobForgeCache({
    kind: opts.kind,
    includeExpired: opts.includeExpired,
  }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  console.log(formatCacheEntries(entries));
}

function verify(opts) {
  const result = verifyJobForgeCache(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function prune(opts) {
  const result = pruneJobForgeCache({
    expired: opts.expired || undefined,
    dryRun: opts.dryRun,
  }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatPruneResult(result));
}

function read(opts) {
  if (opts.url) {
    return readJobDescriptionCache(opts.url, { allowExpired: opts.allowExpired }, PROJECT_DIR);
  }
  return readJobForgeCache(requiredKey(opts), { allowExpired: opts.allowExpired }, PROJECT_DIR);
}

function keyFromOptions(opts) {
  if (opts.url) return jobDescriptionCacheKey(opts.url);
  return requiredKey(opts);
}

function requiredKey(opts) {
  if (!opts.key) throw new Error('expected --url or --key');
  return opts.key;
}

function readInput(input) {
  if (input === '-') return readFileSync(0, 'utf8');
  if (input.startsWith('@')) return readFileSync(input.slice(1), 'utf8');
  return input;
}

function parseMetadata(raw) {
  const text = raw.startsWith('@') ? readFileSync(raw.slice(1), 'utf8') : raw;
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--meta must be a JSON object');
  }
  return parsed;
}

function parseDuration(raw) {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(String(raw).trim());
  if (!match) throw new Error('--ttl must be a duration like 14d, 2h, 30m, 10s, or 500ms');
  const value = Number(match[1]);
  const unit = match[2] || 'ms';
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return value * multipliers[unit];
}
