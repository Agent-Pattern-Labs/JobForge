#!/usr/bin/env node

import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import {
  buildSessionGraph,
  clean,
  collectDispatchCalls,
  descendantIds,
  discoverProjectSessions,
  duplicateDispatchUrlCount,
  findObservedSession,
  hasOutcome,
  hasProxyLeak,
  inspectionForSession,
  isFreeModelRoute,
  mentionsLimitedCandidatePool,
  mergeModelUsage,
  messageEvents,
  modelLabel,
  modelUsageFromSession,
  outcomeFromText,
  pad,
  providerErrorsForSession,
  providerErrorCategory,
  redactSecrets,
  relativeToProject,
  requestedJobCount,
  shorten,
  statusCodeFromText,
  stringValue,
  summarizeChildSession,
  userRequestSummaries,
  loadObservedSession,
} from '../lib/jobforge-observability.mjs';
import { jobForgeLedgerSummary } from '../lib/jobforge-ledger.mjs';

const PROJECT_DIR = process.env.JOB_FORGE_PROJECT || process.cwd();
const DEFAULT_SINCE = '24h';

const USAGE = `job-forge telemetry — JobForge pipeline view over local traces

Usage:
  job-forge telemetry:list [--since 24h] [--cwd <dir>] [--harness <name>] [--json]
  job-forge telemetry:status [--since 24h] [--cwd <dir>] [--harness <name>] [--json]
  job-forge telemetry:show <id-or-prefix> [--cwd <dir>] [--harness <name>] [--json]
  job-forge telemetry:watch [--since 24h] [--cwd <dir>] [--harness <name>] [--interval 5]

Telemetry is local-only and passive. It derives status from normalized local
traces plus JobForge tracker files; agents do not need to emit custom events.`;

const [cmd = 'help', ...args] = process.argv.slice(2);

function parseArgs(rawArgs, { allowSession = false, allowInterval = false } = {}) {
  const opts = { since: DEFAULT_SINCE, cwd: PROJECT_DIR, harness: '', json: false, interval: 5 };
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
    } else if (allowInterval && arg === '--interval') {
      opts.interval = Number(rawArgs[++i] || 5);
    } else if (allowInterval && arg.startsWith('--interval=')) {
      opts.interval = Number(arg.slice('--interval='.length));
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
  if (!Number.isFinite(opts.interval) || opts.interval < 1) opts.interval = 5;
  return { opts, positional };
}

function rootRefs(refs, graph) {
  return graph.roots.length > 0 ? graph.roots : refs;
}

function loadContext(refs) {
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
  const refsById = new Map(refs.map((ref) => [ref.id, ref]));
  return { refsById, sessionsById, graph, loadedRefs, loadErrors };
}

function analyzeSession(ref, context, opts) {
  const session = context.sessionsById.get(ref.id);
  const inspection = inspectionForSession(session);
  const userRequests = userRequestSummaries(session);
  const activeRequest = userRequests.at(-1) || null;
  const prompt = activeRequest?.prompt || userRequests[0]?.prompt || inspection.preview.firstUser || '';
  const dispatchCalls = collectDispatchCalls(session);
  const latestDispatchCalls = activeRequest
    ? dispatchCalls.filter((call) => call.atMs >= activeRequest.atMs)
    : dispatchCalls;
  const providerErrors = providerErrorsForSession(session);
  const rootModels = modelUsageFromSession(session);
  const tracker = trackerStatus(opts.cwd);

  const childRefs = (context.graph.childrenBySession.get(ref.id) || [])
    .map((id) => context.refsById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const children = childRefs
    .map((childRef) => summarizeChildSession(context.sessionsById.get(childRef.id)))
    .filter(Boolean);
  const latestChildren = activeRequest
    ? children.filter((child) => child.startedAtMs >= activeRequest.atMs)
    : children;
  const models = mergeModelUsage([rootModels, ...children.map((child) => child.models)]);
  const unresolvedChildren = dispatchCalls.filter((call) => call.sessionId && !children.find((child) => child.id === call.sessionId));
  const policyIssues = detectPolicyIssues(ref, session, providerErrors, {
    dispatchCalls,
    latestDispatchCalls,
    children,
    latestChildren,
    unresolvedChildren,
    activeRequest,
    models,
    inspection,
    isChildSession: context.graph.childIds.has(ref.id),
  });

  const childOutcomes = children.filter((child) => child.outcome !== 'unknown').length;
  const childProviderErrors = children.reduce((sum, child) => sum + child.providerErrors, 0);
  const status = sessionStatus({
    dispatchCalls,
    children,
    unresolvedChildren,
    childOutcomes,
    childProviderErrors,
    policyIssues,
    providerErrors,
  });
  const recommendations = nextActions({ tracker, policyIssues, providerErrors, dispatchCalls, children });

  return {
    session: {
      id: ref.id,
      harness: ref.source.harness,
      title: ref.title || session.title || '',
      startedAt: ref.startedAt,
      endedAt: ref.endedAt,
    },
    projectDir: opts.cwd,
    status,
    prompt,
    userRequests,
    latestRequest: activeRequest ? {
      ...activeRequest,
      taskDispatches: latestDispatchCalls.filter((call) => !call.isStatusPoll).length,
      children: latestChildren.length,
      childOutcomes: latestChildren.filter((child) => child.outcome !== 'unknown').length,
    } : null,
    tasks: {
      total: dispatchCalls.length,
      statusPolls: dispatchCalls.filter((call) => call.isStatusPoll).length,
      running: children.filter((child) => child.outcome === 'unknown').length + unresolvedChildren.length,
      calls: dispatchCalls,
    },
    children: {
      total: children.length + unresolvedChildren.length,
      withOutcomes: childOutcomes,
      providerErrors: childProviderErrors,
      toolErrors: children.reduce((sum, child) => sum + child.toolErrors, 0),
      sessions: [
        ...children,
        ...unresolvedChildren.map((call) => ({
          id: call.sessionId,
          title: call.description || '',
          startedAt: call.at,
          outcome: 'unknown',
          providerErrors: 0,
          taskCalls: 0,
          dispatchCalls: 0,
          toolErrors: 0,
          dedupeMiss: false,
          trackerWrites: 0,
          models: [],
        })),
      ],
    },
    models,
    providerErrors,
    policyIssues,
    tracker,
    recommendations,
  };
}

function detectPolicyIssues(ref, session, providerErrors, context = {}) {
  const issues = [];
  const dispatchCalls = context.dispatchCalls || [];
  const latestDispatchCalls = context.latestDispatchCalls || dispatchCalls;
  const children = context.children || [];
  const latestChildren = context.latestChildren || children;
  const unresolvedChildren = context.unresolvedChildren || [];
  const activeRequest = context.activeRequest || null;
  const assistantTexts = messageEvents(session, 'assistant');
  const latestAssistantText = assistantTexts
    .filter((event) => !activeRequest || event.atMs >= activeRequest.atMs)
    .map((event) => event.text || '')
    .join('\n');
  const finalText = assistantTexts.slice(-5).map((event) => event.text || '').join('\n');

  const statusPolls = dispatchCalls.filter((call) => call.isStatusPoll);
  if (statusPolls.length > 0) {
    issues.push({
      type: 'task_status_poll',
      severity: 'high',
      count: statusPolls.length,
      detail: 'A dispatch call tried to poll/check an existing subagent session.',
    });
  }

  const proxyLeakCount = dispatchCalls.filter((call) => call.proxyLeak).length;
  if (proxyLeakCount > 0) {
    issues.push({
      type: 'proxy_prompt_leak',
      severity: 'high',
      count: proxyLeakCount,
      detail: 'Prompt/tool input appears to contain proxy field values. Values are intentionally not printed.',
    });
  }

  if (context.isChildSession && dispatchCalls.length > 0) {
    issues.push({
      type: 'subagent_spawned_task',
      severity: 'high',
      count: dispatchCalls.length,
      detail: 'A child/subagent session spawned more child work.',
    });
  }

  const provider402 = providerErrors.filter((err) => err.statusCode === 402).length;
  if (provider402 > 0) {
    issues.push({
      type: 'provider_balance_error',
      severity: 'medium',
      count: provider402,
      detail: 'Provider reported insufficient balance/credits.',
    });
  }

  const dedupeMisses = children.filter((child) => child.dedupeMiss).length;
  if (dedupeMisses > 0) {
    issues.push({
      type: 'dedupe_preflight_missed',
      severity: 'high',
      count: dedupeMisses,
      detail: 'One or more child sessions found an already-applied duplicate that should have been filtered before dispatch.',
    });
  }

  const freeModels = context.models?.filter((model) => isFreeModelRoute(model.provider, model.model)) || [];
  if (freeModels.length > 0) {
    issues.push({
      type: 'free_model_usage',
      severity: 'high',
      count: freeModels.reduce((sum, model) => sum + model.count, 0),
      detail: `Trace used free/legacy model routes: ${freeModels.map(modelLabel).join(', ')}.`,
    });
  }

  const duplicateUrlCount = duplicateDispatchUrlCount(dispatchCalls);
  if (duplicateUrlCount > 0) {
    issues.push({
      type: 'duplicate_task_url',
      severity: 'high',
      count: duplicateUrlCount,
      detail: 'The same job URL was dispatched more than once in this root session.',
    });
  }

  if (unresolvedChildren.length > 0) {
    issues.push({
      type: 'task_still_running',
      severity: 'high',
      count: unresolvedChildren.length,
      detail: 'One or more dispatches reference child sessions that do not yet have a visible terminal outcome.',
    });
  }

  const latestDispatches = latestDispatchCalls.filter((call) => !call.isStatusPoll).length;
  if (activeRequest?.requestedJobs && latestDispatches > 0 && latestDispatches < activeRequest.requestedJobs && !mentionsLimitedCandidatePool(latestAssistantText)) {
    issues.push({
      type: 'requested_count_not_met',
      severity: 'high',
      count: activeRequest.requestedJobs - latestDispatches,
      detail: `Latest request asked for ${activeRequest.requestedJobs} jobs, but only ${latestDispatches} dispatches are visible after that prompt.`,
    });
  }

  if (latestDispatches > 0 && latestChildren.some((child) => child.outcome === 'unknown') && !/round .*in flight|still running|waiting/i.test(latestAssistantText)) {
    issues.push({
      type: 'latest_children_missing_outcomes',
      severity: 'high',
      count: latestChildren.filter((child) => child.outcome === 'unknown').length,
      detail: 'Latest request has child sessions without visible terminal outcomes.',
    });
  }

  if (latestDispatches > 0 && !hasOutcome(latestAssistantText) && !/round .*in flight|still running|waiting/i.test(latestAssistantText)) {
    issues.push({
      type: 'latest_request_no_visible_final_outcome',
      severity: 'high',
      count: 1,
      detail: 'Latest request dispatched child work but assistant text after that request has no final outcome or in-flight notice.',
    });
  } else if (dispatchCalls.length > 0 && !hasOutcome(finalText) && !/round .*in flight|still running|waiting/i.test(finalText)) {
    issues.push({
      type: 'no_visible_final_outcome',
      severity: 'medium',
      count: 1,
      detail: 'Session dispatched child work but recent assistant text has no final outcome or in-flight notice.',
    });
  }

  return issues;
}

function sessionStatus({ dispatchCalls, children, unresolvedChildren, childOutcomes, childProviderErrors, policyIssues, providerErrors }) {
  if (policyIssues.some((issue) => issue.severity === 'high')) return 'attention';
  if (providerErrors.length > 0) return 'attention';
  if (childProviderErrors > 0) return 'attention';
  if (unresolvedChildren.length > 0) return 'in-flight-or-incomplete';
  if (dispatchCalls.length > 0 && children.length > childOutcomes) return 'in-flight-or-incomplete';
  if (dispatchCalls.length > 0 && children.length === childOutcomes) return 'complete';
  return 'observed';
}

function trackerStatus(projectDir) {
  const pendingDir = join(projectDir, 'batch', 'tracker-additions');
  const mergedDir = join(pendingDir, 'merged');
  let ledger;
  try {
    ledger = jobForgeLedgerSummary(projectDir);
  } catch (error) {
    ledger = {
      exists: true,
      events: 0,
      entities: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    pending: listTsv(pendingDir),
    mergedCount: listTsv(mergedDir).length,
    ledger,
  };
}

function listTsv(dir) {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.tsv'))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

function nextActions({ tracker, policyIssues, providerErrors, children }) {
  const actions = [];
  if (tracker.pending.length > 0) actions.push('Run `npm run merge && npm run verify` when you are ready to fold pending TSV outcomes into day files.');
  if (policyIssues.some((issue) => issue.type === 'task_status_poll')) actions.push('Avoid resuming by spawning "check status" child sessions; inspect telemetry/trace and tracker files instead.');
  if (policyIssues.some((issue) => issue.type === 'proxy_prompt_leak')) actions.push('Refresh the harness instructions so new sessions inherit the proxy prompt hygiene rule.');
  if (policyIssues.some((issue) => issue.type === 'free_model_usage')) actions.push('Refresh the harness config so application tiers use the intended paid/default route.');
  if (policyIssues.some((issue) => issue.type === 'requested_count_not_met')) actions.push('Resume the latest apply request or start a new run for the remaining requested jobs; telemetry did not see enough dispatches after the latest prompt.');
  if (policyIssues.some((issue) => issue.type === 'latest_request_no_visible_final_outcome')) actions.push('Inspect the latest child sessions before treating the current run as complete.');
  if (policyIssues.some((issue) => issue.type === 'duplicate_task_url')) actions.push('Do not re-dispatch duplicate URLs automatically; inspect the prior child result and tracker TSV before retrying.');
  if (policyIssues.some((issue) => issue.type === 'dedupe_preflight_missed')) actions.push('Tighten candidate preflight: grep all application day files plus pending/merged TSVs before dispatching replacements.');
  if (providerErrors.some((err) => err.statusCode === 402)) actions.push('Provider balance errors occurred; use a non-402 fallback or add provider credits before retrying paid routes.');
  if (children.some((child) => child.outcome === 'unknown')) actions.push('Some child sessions have no visible final outcome; inspect them with `npm run telemetry:show -- <child-session-id>`.');
  return actions;
}

function summaryForList(telemetry) {
  return {
    id: telemetry.session.id,
    harness: telemetry.session.harness,
    startedAt: telemetry.session.startedAt,
    updatedAt: telemetry.session.endedAt,
    status: telemetry.status,
    prompt: telemetry.prompt,
    tasks: telemetry.tasks.total,
    children: telemetry.children.total,
    outcomes: telemetry.children.withOutcomes,
    issues: telemetry.policyIssues.length,
    providerErrors: telemetry.providerErrors.length + telemetry.children.providerErrors,
  };
}

function printList(items) {
  const rows = items.map((item) => [
    item.id,
    item.harness,
    item.startedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z'),
    item.status,
    String(item.tasks),
    `${item.outcomes}/${item.children}`,
    String(item.issues + item.providerErrors),
    shorten(item.prompt || '', 36),
  ]);
  const header = ['session', 'harness', 'started', 'status', 'dispatches', 'outcomes', 'alerts', 'prompt'];
  printTable(header, rows);
}

function printStatus(telemetry) {
  console.log(`project:    ${telemetry.projectDir}`);
  console.log(`session:    ${telemetry.session.id}`);
  console.log(`harness:    ${telemetry.session.harness}`);
  console.log(`status:     ${telemetry.status}`);
  console.log(`started:    ${telemetry.session.startedAt}`);
  if (telemetry.session.title) console.log(`title:      ${telemetry.session.title}`);
  console.log(`prompt:     ${shorten(telemetry.prompt || '', 100)}`);
  if (telemetry.userRequests.length > 1 || telemetry.latestRequest?.requestedJobs) {
    const latest = telemetry.latestRequest;
    const requestDetail = latest?.requestedJobs
      ? `latest ${latest.taskDispatches}/${latest.requestedJobs} dispatches`
      : `latest ${latest?.taskDispatches ?? 0} dispatches`;
    console.log(`requests:   ${telemetry.userRequests.length} user prompt${telemetry.userRequests.length === 1 ? '' : 's'} (${requestDetail})`);
  }
  console.log(`dispatches: ${telemetry.tasks.total} (${telemetry.tasks.statusPolls} status-poll, ${telemetry.tasks.running} unresolved)`);
  console.log(`children:   ${telemetry.children.withOutcomes}/${telemetry.children.total} with outcomes`);
  console.log(`tracker:    ${telemetry.tracker.pending.length} pending TSVs, ${telemetry.tracker.mergedCount} merged TSVs`);
  console.log(`ledger:     ${telemetry.tracker.ledger.error ? `error: ${telemetry.tracker.ledger.error}` : telemetry.tracker.ledger.exists ? `${telemetry.tracker.ledger.events} events` : 'missing'}`);
  console.log(`models:     ${telemetry.models.slice(0, 3).map(modelLabel).join(', ') || 'none'}`);
  console.log(`errors:     ${telemetry.providerErrors.length} root, ${telemetry.children.providerErrors} child provider errors, ${telemetry.children.toolErrors} child tool errors`);
  console.log(`issues:     ${telemetry.policyIssues.length}`);

  if (telemetry.policyIssues.length > 0) {
    console.log('\nissues:');
    for (const issue of telemetry.policyIssues) {
      console.log(`  - ${issue.severity} ${issue.type} x${issue.count}: ${issue.detail}`);
    }
  }

  if (telemetry.tracker.pending.length > 0) {
    console.log('\npending TSVs:');
    for (const file of telemetry.tracker.pending.slice(0, 12)) {
      console.log(`  - ${relativeToProject(file, telemetry.projectDir)}`);
    }
    if (telemetry.tracker.pending.length > 12) console.log(`  - ...${telemetry.tracker.pending.length - 12} more`);
  }

  if (telemetry.children.sessions.length > 0) {
    console.log('\nchild sessions:');
    for (const child of telemetry.children.sessions) {
      const alerts = [];
      if (child.providerErrors) alerts.push(`${child.providerErrors} provider error`);
      if (child.toolErrors) alerts.push(`${child.toolErrors} tool error`);
      if (child.dedupeMiss) alerts.push('dedupe miss');
      if (child.taskCalls) alerts.push(`${child.taskCalls} task call`);
      console.log(`  - ${child.id}  ${child.outcome}  ${child.title}${alerts.length ? ` (${alerts.join(', ')})` : ''}`);
    }
  }

  if (telemetry.recommendations.length > 0) {
    console.log('\nnext:');
    for (const action of telemetry.recommendations) console.log(`  - ${action}`);
  }
}

function printShow(telemetry) {
  printStatus(telemetry);
  if (telemetry.tasks.calls.length > 0) {
    console.log('\ndispatches:');
    for (const task of telemetry.tasks.calls) {
      const flags = [
        task.isStatusPoll ? 'status-poll' : '',
        task.status && task.status !== 'completed' ? task.status : '',
        task.proxyLeak ? 'proxy-values-detected' : '',
      ].filter(Boolean).join(', ');
      console.log(`  - ${task.at} ${task.name} ${task.description || '(no description)'} ${task.sessionId || ''} ${task.subagentType || ''}${flags ? ` [${flags}]` : ''}`);
    }
  }
  if (telemetry.providerErrors.length > 0) {
    console.log('\nprovider errors:');
    for (const err of telemetry.providerErrors) {
      console.log(`  - ${err.at} ${err.provider || '(unknown)'}/${err.model || '(unknown)'} ${err.statusCode || ''} ${err.category}: ${err.message}`);
    }
  }
}

function printTable(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  console.log(header.map((h, i) => pad(h, widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(row.map((cell, i) => pad(cell, widths[i])).join('  '));
}

async function recentTelemetry(opts) {
  const refs = await discoverProjectSessions(opts);
  if (refs.length === 0) return { refs, context: null, telemetry: null };
  const context = loadContext(refs);
  const roots = rootRefs(context.loadedRefs, context.graph);
  const selected = roots[0] || refs[0] || null;
  return {
    refs,
    context,
    telemetry: selected ? analyzeSession(selected, context, opts) : null,
  };
}

async function runWatch(opts) {
  while (true) {
    console.clear();
    console.log(new Date().toISOString());
    const { telemetry } = await recentTelemetry(opts);
    if (!telemetry) {
      console.log('No recent JobForge sessions found.');
    } else {
      printStatus(telemetry);
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, opts.interval * 1000));
  }
}

async function main() {
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return 0;
  }

  if (cmd === 'list') {
    const { opts } = parseArgs(args);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge telemetry:list: ${opts.error}`);
      return 2;
    }
    const refs = await discoverProjectSessions(opts);
    if (refs.length === 0) {
      console.error('job-forge telemetry:list: no recent JobForge sessions found');
      return 2;
    }
    const context = loadContext(refs);
    const items = rootRefs(context.loadedRefs, context.graph).map((ref) => summaryForList(analyzeSession(ref, context, opts)));
    if (opts.json) {
      console.log(JSON.stringify(items, null, 2));
    } else {
      printList(items);
    }
    return 0;
  }

  if (cmd === 'status') {
    const { opts } = parseArgs(args);
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge telemetry:status: ${opts.error}`);
      return 2;
    }
    const { telemetry } = await recentTelemetry(opts);
    if (!telemetry) {
      console.error('job-forge telemetry:status: no recent JobForge sessions found');
      return 2;
    }
    if (opts.json) console.log(JSON.stringify(telemetry, null, 2));
    else printStatus(telemetry);
    return 0;
  }

  if (cmd === 'show') {
    const { opts, positional } = parseArgs(args, { allowSession: true });
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge telemetry:show: ${opts.error}`);
      return 2;
    }
    if (positional.length === 0) {
      console.error('job-forge telemetry:show: missing <id-or-prefix>');
      return 2;
    }
    const refs = await discoverProjectSessions({ ...opts, since: undefined });
    const sessionRef = findObservedSession(refs, positional[0]);
    if (!sessionRef) {
      console.error(`job-forge telemetry:show: no session matches "${positional[0]}"`);
      return 2;
    }
    const context = loadContext(refs);
    if (!context.sessionsById.has(sessionRef.id)) {
      console.error(`job-forge telemetry:show: could not load session "${sessionRef.id}": ${context.loadErrors.get(sessionRef.id) || 'unknown parse error'}`);
      return 2;
    }
    const telemetry = analyzeSession(sessionRef, context, opts);
    if (opts.json) console.log(JSON.stringify(telemetry, null, 2));
    else printShow(telemetry);
    return 0;
  }

  if (cmd === 'watch') {
    const { opts } = parseArgs(args, { allowInterval: true });
    if (opts.help) {
      console.log(USAGE);
      return 0;
    }
    if (opts.error) {
      console.error(`job-forge telemetry:watch: ${opts.error}`);
      return 2;
    }
    await runWatch(opts);
    return 0;
  }

  console.error(`job-forge telemetry: unknown command "${cmd}"\n`);
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
