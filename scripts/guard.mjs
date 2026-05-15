#!/usr/bin/env node

import { dirname, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { audit, formatAuditResult, formatPolicyExplanation, loadPolicy, resultFails } from '@razroo/iso-guard';
import {
  buildSessionGraph,
  collectDispatchCalls,
  descendantIds,
  discoverProjectSessions,
  findObservedSession,
  loadObservedSession,
  messageEvents,
  objectOrEmpty,
  redactSecrets,
  safeJson,
  stringValue,
  toolRecords,
} from '../lib/jobforge-observability.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const PROJECT_DIR = process.env.JOB_FORGE_PROJECT || process.cwd();
const DEFAULT_SINCE = '24h';

const USAGE = `job-forge guard - deterministic JobForge policy audits over local traces

Usage:
  job-forge guard:audit [latest|<id-or-prefix>] [--since 24h] [--cwd <dir>] [--harness <name>] [--policy <path>] [--json] [--fail-on error|warn|off] [--root-only]
  job-forge guard:explain [--policy <path>] [--json]

The default policy is templates/guards/jobforge-baseline.yaml. Guard audits are
local-only and passive: JobForge converts normalized session events into
iso-guard inputs and never asks agents or MCPs to emit extra telemetry.`;

const [cmd = 'help', ...args] = process.argv.slice(2);

function defaultPolicyPath() {
  return join(PKG_ROOT, 'templates/guards/jobforge-baseline.yaml');
}

function parseArgs(rawArgs, { allowSession = false } = {}) {
  const opts = {
    since: DEFAULT_SINCE,
    cwd: PROJECT_DIR,
    harness: '',
    policy: defaultPolicyPath(),
    json: false,
    failOn: 'error',
    includeChildren: true,
  };
  const positional = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--since') {
      opts.since = valueAfter(rawArgs, ++i, '--since');
    } else if (arg.startsWith('--since=')) {
      opts.since = arg.slice('--since='.length);
    } else if (arg === '--cwd') {
      opts.cwd = valueAfter(rawArgs, ++i, '--cwd');
    } else if (arg.startsWith('--cwd=')) {
      opts.cwd = arg.slice('--cwd='.length);
    } else if (arg === '--harness') {
      opts.harness = valueAfter(rawArgs, ++i, '--harness');
    } else if (arg.startsWith('--harness=')) {
      opts.harness = arg.slice('--harness='.length);
    } else if (arg === '--policy') {
      opts.policy = valueAfter(rawArgs, ++i, '--policy');
    } else if (arg.startsWith('--policy=')) {
      opts.policy = arg.slice('--policy='.length);
    } else if (arg === '--fail-on') {
      opts.failOn = valueAfter(rawArgs, ++i, '--fail-on');
    } else if (arg.startsWith('--fail-on=')) {
      opts.failOn = arg.slice('--fail-on='.length);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--root-only') {
      opts.includeChildren = false;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg.startsWith('--')) {
      opts.error = `unknown flag "${arg}"`;
    } else if (allowSession) {
      positional.push(arg);
    } else {
      opts.error = `unexpected argument "${arg}"`;
    }
  }

  opts.cwd = resolve(opts.cwd || PROJECT_DIR);
  opts.policy = resolve(opts.policy || defaultPolicyPath());
  if (!['error', 'warn', 'off'].includes(opts.failOn)) {
    opts.error = '--fail-on must be one of: error, warn, off';
  }
  return { opts, positional };
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function selectSession(refs, roots, positional) {
  const requested = positional[0];
  if (!requested || requested === 'latest') return roots[0] || refs[0] || null;
  return findObservedSession(refs, requested);
}

function buildGuardEvents(sessionEntries, childIds) {
  const events = [];

  for (const entry of sessionEntries) {
    const { ref, session } = entry;
    let requestIndex = 0;

    for (const message of messageEvents(session)) {
      if (message.role === 'user') requestIndex += 1;
      events.push({
        type: 'message',
        name: message.role,
        at: message.at,
        source: `${ref.source.harness}:${session.id}`,
        text: message.text || '',
        data: {
          sessionId: session.id,
          sessionTitle: ref.title || session.title || '',
          isChildSession: childIds.has(session.id),
          requestIndex,
        },
      });
    }

    for (const record of toolRecords(session)) {
      if (!record.name) continue;
      const text = toolText(record);
      const base = {
        sessionId: session.id,
        sessionTitle: ref.title || session.title || '',
        isChildSession: childIds.has(session.id),
        requestIndex,
        status: record.result ? (record.result.error ? 'failed' : 'completed') : 'unknown',
        input: objectOrEmpty(record.input),
      };
      const event = {
        type: 'tool_call',
        name: record.name,
        at: record.at,
        source: `${ref.source.harness}:${session.id}`,
        text,
        data: base,
      };
      events.push(event);
      events.push(...derivedToolEvents(event));
    }
  }

  return events
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')))
    .map((event, index) => ({ ...event, index }));
}

function derivedToolEvents(event) {
  const text = event.text || '';
  const events = [];
  if (runsCommand(text, /\b(npx\s+)?job-forge\s+merge\b|\bnpm\s+run\s+merge\b/)) {
    events.push(derivedToolEvent(event, 'job-forge-merge'));
  }
  if (runsCommand(text, /\b(npx\s+)?job-forge\s+verify\b|\bnpm\s+run\s+verify\b/)) {
    events.push(derivedToolEvent(event, 'job-forge-verify'));
  }
  if (runsCommand(text, /\bgeometra_disconnect\b/)) {
    events.push(derivedToolEvent(event, 'geometra_disconnect'));
  }
  if (runsCommand(text, /\bgeometra_list_sessions\b/)) {
    events.push(derivedToolEvent(event, 'geometra_list_sessions'));
  }
  return events;
}

function derivedToolEvent(event, name) {
  return {
    ...event,
    name,
    data: {
      ...(event.data || {}),
      derivedFrom: event.name,
    },
  };
}

function runsCommand(text, pattern) {
  return /(^|[\s"])(bash|shell|exec|command|terminal|run_command)\b/i.test(text) && pattern.test(text);
}

function toolText(record) {
  const fragments = [
    record.name,
    safeJson(record.input),
    record.result?.output || '',
    record.result?.error || '',
  ];
  return redactSecrets(fragments.filter(Boolean).join('\n'));
}

function printablePath(path) {
  const rel = relative(PROJECT_DIR, path);
  return rel && !rel.startsWith('..') ? rel : path;
}

function printAudit({ selected, includedRefs, policy, result }) {
  const children = includedRefs.length - 1;
  console.log(`session: ${selected.id}${selected.title ? ` (${selected.title})` : ''}`);
  if (children > 0) console.log(`children: ${children}`);
  console.log(`policy:  ${printablePath(policy.sourcePath || defaultPolicyPath())}`);
  console.log(formatAuditResult(result));
}

async function main() {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return 0;
  }

  if (cmd === 'explain') {
    const { opts } = parseArgs(args);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge guard:explain: ${opts.error}`);
      return 2;
    }
    const policy = loadPolicy(opts.policy);
    if (opts.json) {
      console.log(JSON.stringify(policy, null, 2));
    } else {
      console.log(formatPolicyExplanation(policy));
    }
    return 0;
  }

  if (cmd === 'audit') {
    const { opts, positional } = parseArgs(args, { allowSession: true });
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge guard:audit: ${opts.error}`);
      return 2;
    }

    const refs = await discoverProjectSessions(opts);
    if (refs.length === 0) {
      console.error('job-forge guard:audit: no sessions found for this project');
      return 2;
    }

    const sessionsById = new Map();
    const loadErrors = new Map();
    for (const ref of refs) {
      try {
        sessionsById.set(ref.id, loadObservedSession(ref));
      } catch (error) {
        loadErrors.set(ref.id, error instanceof Error ? error.message : String(error));
      }
    }
    const loadedRefs = refs.filter((ref) => sessionsById.has(ref.id));
    const graph = buildSessionGraph(loadedRefs, sessionsById);
    const selected = selectSession(loadedRefs, graph.roots, positional);
    if (!selected) {
      console.error(`job-forge guard:audit: no session matches "${positional[0]}"`);
      return 2;
    }
    if (!sessionsById.has(selected.id)) {
      console.error(`job-forge guard:audit: could not load session "${selected.id}": ${loadErrors.get(selected.id) || 'unknown parse error'}`);
      return 2;
    }

    const includedIds = opts.includeChildren
      ? [selected.id, ...descendantIds(selected.id, graph.childrenBySession)]
      : [selected.id];
    const childIds = new Set(includedIds.slice(1));
    const includedRefs = includedIds
      .map((id) => loadedRefs.find((ref) => ref.id === id))
      .filter(Boolean);
    const sessionEntries = includedRefs.map((ref) => ({
      ref,
      session: sessionsById.get(ref.id),
    })).filter((entry) => entry.session);
    const policy = loadPolicy(opts.policy);
    const events = buildGuardEvents(sessionEntries, childIds);
    const result = audit(policy, events);

    if (opts.json) {
      console.log(JSON.stringify({
        session: selected,
        includedSessions: includedRefs.map((ref) => ({
          id: ref.id,
          title: ref.title,
          startedAt: ref.startedAt,
          endedAt: ref.endedAt,
          harness: ref.source.harness,
        })),
        policy: policy.sourcePath,
        result,
      }, null, 2));
    } else {
      printAudit({ selected, includedRefs, policy, result });
    }
    return resultFails(result, opts.failOn) ? 1 : 0;
  }

  console.error(`job-forge guard: unknown command "${cmd}"`);
  console.error(USAGE);
  return 2;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
