#!/usr/bin/env node

import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import {
  clean,
  discoverProjectSessions,
  findObservedSession,
  loadObservedSession,
  pad,
  safeJson,
  shorten,
  statsForSessions,
} from '../lib/jobforge-observability.mjs';

const require = createRequire(import.meta.url);
const PROJECT_DIR = process.env.JOB_FORGE_PROJECT || process.cwd();

const USAGE = `job-forge trace — local transcript observability across supported harnesses

Usage:
  job-forge trace:list [--since 7d] [--cwd <dir>] [--harness <name>] [--json]
  job-forge trace:stats [<id-or-prefix>...] [--since 7d] [--cwd <dir>] [--harness <name>] [--json]
  job-forge trace:show <id-or-prefix> [--cwd <dir>] [--harness <name>] [--events <kinds>] [--grep <regex>]
  job-forge trace <iso-trace args...>

Common aliases default to sessions for the current JobForge project.
Use "job-forge trace sources" or "job-forge trace where" for raw iso-trace passthrough.`;

const [cmd = 'help', ...args] = process.argv.slice(2);

function parseFilters(rawArgs) {
  const opts = { since: '7d', cwd: PROJECT_DIR, harness: '', json: false };
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--since') {
      opts.since = rawArgs[++i];
    } else if (arg.startsWith('--since=')) {
      opts.since = arg.slice('--since='.length);
    } else if (arg === '--cwd') {
      opts.cwd = rawArgs[++i];
    } else if (arg.startsWith('--cwd=')) {
      opts.cwd = arg.slice('--cwd='.length);
    } else if (arg === '--harness') {
      opts.harness = rawArgs[++i];
    } else if (arg.startsWith('--harness=')) {
      opts.harness = arg.slice('--harness='.length);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      opts.error = `unknown flag "${arg}"`;
    } else {
      positional.push(arg);
    }
  }

  opts.cwd = resolve(opts.cwd || PROJECT_DIR);
  return { opts, positional };
}

function parseShowArgs(rawArgs) {
  const opts = { cwd: PROJECT_DIR, harness: '' };
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--cwd') {
      opts.cwd = rawArgs[++i];
    } else if (arg.startsWith('--cwd=')) {
      opts.cwd = arg.slice('--cwd='.length);
    } else if (arg === '--harness') {
      opts.harness = rawArgs[++i];
    } else if (arg.startsWith('--harness=')) {
      opts.harness = arg.slice('--harness='.length);
    } else if (arg === '--events') {
      const raw = rawArgs[++i] || '';
      opts.events = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--events=')) {
      const raw = arg.slice('--events='.length);
      opts.events = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
    } else if (arg === '--grep') {
      opts.grep = compileRegex(rawArgs[++i], 'trace:show');
    } else if (arg.startsWith('--grep=')) {
      opts.grep = compileRegex(arg.slice('--grep='.length), 'trace:show');
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      opts.error = `unknown flag "${arg}"`;
    } else {
      positional.push(arg);
    }
  }

  opts.cwd = resolve(opts.cwd || PROJECT_DIR);
  return { opts, positional };
}

function compileRegex(pattern, context) {
  try {
    return new RegExp(pattern || '', 'i');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`${context}: invalid --grep regex: ${message}`);
  }
}

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function printSessionTable(refs) {
  const rows = refs.map((ref) => [
    ref.id,
    ref.source.harness,
    ref.startedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z'),
    shorten(ref.title || '', 24),
    shorten(ref.cwd, 40),
    String(ref.turnCount),
    sizeLabel(ref.sizeBytes),
  ]);
  const header = ['id', 'harness', 'started', 'title', 'cwd', 'turns', 'size'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));

  console.log(header.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) {
    console.log(row.map((cell, i) => pad(cell, widths[i])).join('  '));
  }
}

function printStats(result) {
  console.log(`sessions:  ${result.sessions}`);
  console.log(`turns:     ${result.turns}`);
  console.log(`duration:  ${Math.round(result.durationMs / 1000)}s`);
  console.log(`tokens:    input=${result.tokens.input} output=${result.tokens.output} cache_read=${result.tokens.cacheRead} cache_created=${result.tokens.cacheCreated}`);

  console.log('\ntool calls:');
  for (const [name, count] of Object.entries(result.toolCalls).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(name, 28)} ${count}`);
  }

  console.log('\nfile ops:');
  for (const [name, count] of Object.entries(result.fileOps).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(name, 8)} ${count}`);
  }
}

function printSession(ref, session, opts) {
  console.log(`id:        ${ref.id}`);
  console.log(`harness:   ${ref.source.harness}`);
  console.log(`source:    ${ref.source.format}`);
  console.log(`path:      ${ref.source.path}`);
  console.log(`cwd:       ${ref.cwd}`);
  if (ref.title) console.log(`title:     ${ref.title}`);
  if (session.model) console.log(`model:     ${session.model}`);
  console.log(`started:   ${ref.startedAt}`);
  if (ref.endedAt) console.log(`ended:     ${ref.endedAt}`);
  console.log(`turns:     ${session.turns.length}`);
  console.log('');

  for (const turn of session.turns) {
    for (const event of turn.events) {
      if (opts.events && !opts.events.has(event.kind)) continue;
      const line = `${turn.at} ${event.kind}: ${formatEvent(event)}`;
      if (opts.grep && !opts.grep.test(line)) continue;
      console.log(line);
    }
  }
}

function formatEvent(event) {
  if (event.kind === 'message') {
    return `${event.role}: ${oneLine(event.text, 360)}`;
  }
  if (event.kind === 'tool_call') {
    return `${event.name || 'unknown'} ${oneLine(safeJson(event.input), 360)}`;
  }
  if (event.kind === 'tool_result') {
    const suffix = event.error ? ` error=${oneLine(event.error, 160)}` : '';
    return `${event.toolUseId || '(unknown)'}${suffix}${event.output ? ` => ${oneLine(event.output, 240)}` : ''}`;
  }
  if (event.kind === 'file_op') {
    return `${event.op} ${event.path} (${event.tool})`;
  }
  if (event.kind === 'token_usage') {
    return `input=${event.input} output=${event.output} cache_read=${event.cacheRead} cache_created=${event.cacheCreated}${event.model ? ` model=${event.model}` : ''}`;
  }
  return oneLine(safeJson(event), 360);
}

function oneLine(value, max) {
  return shorten(clean(value), max);
}

function resolveIsoTraceCli() {
  const pkgJsonPath = require.resolve('@agent-pattern-labs/iso-trace/package.json');
  return join(dirname(pkgJsonPath), 'dist/cli.js');
}

function passthroughIsoTrace(rawArgs) {
  const cliPath = resolveIsoTraceCli();
  const result = spawnSync(process.execPath, [cliPath, ...rawArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });
  return result.status ?? 1;
}

function tryLoadSession(ref) {
  try {
    return { ref, session: loadObservedSession(ref), error: null };
  } catch (error) {
    return {
      ref,
      session: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return 0;
  }

  if (cmd === 'list') {
    const { opts } = parseFilters(args);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge trace:list: ${opts.error}`);
      return 2;
    }
    const refs = await discoverProjectSessions(opts);
    if (opts.json) {
      console.log(JSON.stringify(refs, null, 2));
      return 0;
    }
    if (refs.length === 0) {
      console.error('job-forge trace:list: no sessions found for this project');
      return 2;
    }
    printSessionTable(refs);
    return 0;
  }

  if (cmd === 'stats') {
    const { opts, positional } = parseFilters(args);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge trace:stats: ${opts.error}`);
      return 2;
    }
    const refs = await discoverProjectSessions(opts);
    const selected = positional.length === 0
      ? refs
      : positional.map((id) => {
          const ref = findObservedSession(refs, id);
          if (!ref) throw new Error(`job-forge trace:stats: no session matches "${id}"`);
          return ref;
        });
    const loaded = selected.map(tryLoadSession);
    const failures = loaded.filter((item) => item.error);
    if (positional.length > 0 && failures.length > 0) {
      throw new Error(`job-forge trace:stats: could not load session "${failures[0].ref.id}": ${failures[0].error}`);
    }
    const sessions = loaded.filter((item) => item.session).map((item) => item.session);
    if (sessions.length === 0) {
      throw new Error('job-forge trace:stats: no readable sessions found for this selection');
    }
    const result = statsForSessions(sessions);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (failures.length > 0) {
        console.error(`job-forge trace:stats: skipped ${failures.length} unreadable session(s)`);
      }
      printStats(result);
    }
    return 0;
  }

  if (cmd === 'show') {
    const { opts, positional } = parseShowArgs(args);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge trace:show: ${opts.error}`);
      return 2;
    }
    if (opts.grep instanceof Error) {
      console.error(opts.grep.message);
      return 2;
    }
    if (positional.length === 0) {
      console.error('job-forge trace:show: missing <id-or-prefix>');
      return 2;
    }
    const refs = await discoverProjectSessions({ cwd: opts.cwd, harness: opts.harness, since: undefined });
    const ref = findObservedSession(refs, positional[0]);
    if (!ref) {
      console.error(`job-forge trace:show: no session matches "${positional[0]}"`);
      return 2;
    }
    const loaded = tryLoadSession(ref);
    if (!loaded.session) {
      console.error(`job-forge trace:show: could not load session "${ref.id}": ${loaded.error}`);
      return 2;
    }
    const session = loaded.session;
    printSession(ref, session, opts);
    return 0;
  }

  return passthroughIsoTrace([cmd, ...args]);
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
