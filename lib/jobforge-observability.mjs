import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  defaultOpenCodeDbPath,
  discoverSessions as discoverTraceSessions,
  findSessionById,
  inspectSession,
  iterateEvents,
  loadSessionFromPath,
  parseOpenCode,
  parseSinceCutoff,
  refFromPath,
  sessionRefsFromOpenCodeRows,
  stats as traceStats,
} from '@razroo/iso-trace';

export const DISPATCH_TOOL_NAMES = new Set(['task', 'spawn_agent']);

export async function discoverProjectSessions({ cwd, since, harness } = {}) {
  const resolvedCwd = cwd ? resolve(cwd) : undefined;
  if (!resolvedCwd) {
    return discoverTraceSessions({
      cwd: resolvedCwd,
      since,
      ...(harness ? { harness } : {}),
    });
  }

  const refs = [];
  const byHarness = projectTraceRootsByHarness(resolvedCwd, since);
  const harnesses = harness ? [harness] : ['claude-code', 'cursor', 'codex', 'opencode'];

  for (const name of harnesses) {
    if (name === 'codex') {
      refs.push(...discoverCodexRefs(resolvedCwd, byHarness.codex || []));
      continue;
    }
    if (name === 'opencode') {
      refs.push(...discoverOpenCodeRefs(resolvedCwd, since, byHarness.opencode?.[0]));
      continue;
    }
    const roots = byHarness[harnessKey(name)] || [];
    if (roots.length === 0) continue;
    const found = await discoverTraceSessions({
      cwd: resolvedCwd,
      since,
      harness: name,
      roots,
    });
    refs.push(...found);
  }

  refs.sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0));
  return refs;
}

export function loadObservedSession(ref) {
  if (ref?.source?.harness === 'opencode' && /#session=/.test(ref.source.path || '')) {
    return loadObservedOpenCodeSession(ref);
  }
  return loadSessionFromPath(ref.source.path, ref.source.harness);
}

export function inspectionForSession(session, options = {}) {
  return inspectSession(session, options);
}

export function statsForSessions(sessions) {
  return traceStats(sessions);
}

export function findObservedSession(refs, idOrPrefix) {
  return findSessionById(refs, idOrPrefix);
}

export function messageEvents(session, role) {
  const events = [];
  for (const item of iterateEvents(session)) {
    if (item.event.kind !== 'message') continue;
    if (role && item.event.role !== role) continue;
    events.push({
      at: item.at,
      atMs: Date.parse(item.at),
      role: item.event.role,
      text: item.event.text || '',
      turnIndex: item.turnIndex,
    });
  }
  return events;
}

export function toolRecords(session) {
  const records = [];
  const pending = new Map();

  for (const item of iterateEvents(session)) {
    if (item.event.kind === 'tool_call') {
      const record = {
        id: item.event.id || '',
        name: item.event.name || '',
        input: item.event.input,
        at: item.at,
        atMs: Date.parse(item.at),
        role: item.role,
        turnIndex: item.turnIndex,
      };
      records.push(record);
      if (record.id) pending.set(record.id, record);
      continue;
    }

    if (item.event.kind === 'tool_result') {
      const result = {
        toolUseId: item.event.toolUseId || '',
        output: item.event.output || '',
        error: item.event.error || '',
        truncated: Boolean(item.event.truncated),
        at: item.at,
        atMs: Date.parse(item.at),
        role: item.role,
        turnIndex: item.turnIndex,
      };
      const record = pending.get(result.toolUseId);
      if (record && !record.result) {
        record.result = result;
      } else {
        records.push({
          id: result.toolUseId,
          name: '',
          input: null,
          at: result.at,
          atMs: result.atMs,
          role: result.role,
          turnIndex: result.turnIndex,
          result,
        });
      }
    }
  }

  return records;
}

export function collectDispatchCalls(session) {
  return toolRecords(session)
    .filter((record) => DISPATCH_TOOL_NAMES.has(record.name))
    .map((record) => dispatchSummary(record));
}

export function referencedChildSessionIds(session) {
  return collectDispatchCalls(session)
    .map((call) => call.sessionId)
    .filter(Boolean);
}

export function buildSessionGraph(refs, sessionsById) {
  const childIds = new Set();
  const childrenBySession = new Map();

  for (const ref of refs) {
    const session = sessionsById.get(ref.id);
    const childList = session ? referencedChildSessionIds(session) : [];
    childrenBySession.set(ref.id, childList);
    for (const childId of childList) childIds.add(childId);
  }

  const roots = refs.filter((ref) => !childIds.has(ref.id));
  return { childIds, childrenBySession, roots };
}

export function descendantIds(rootId, childrenBySession) {
  const visited = new Set();
  const queue = [...(childrenBySession.get(rootId) || [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const child of childrenBySession.get(current) || []) {
      if (!visited.has(child)) queue.push(child);
    }
  }

  return [...visited];
}

export function userRequestSummaries(session) {
  return messageEvents(session, 'user')
    .map((event) => {
      const prompt = clean(redactSecrets(event.text));
      return {
        at: event.at,
        atMs: event.atMs,
        prompt,
        requestedJobs: requestedJobCount(prompt),
      };
    })
    .filter((request) => request.prompt.length > 0);
}

export function providerErrorsForSession(session) {
  const seen = new Set();
  const models = modelUsageFromSession(session);
  const primary = models[0] || { provider: '', model: '' };
  const errors = [];

  for (const item of iterateEvents(session)) {
    let raw = '';
    if (item.event.kind === 'message' && item.event.role === 'assistant') {
      raw = item.event.text || '';
    } else if (item.event.kind === 'tool_result' && item.event.error) {
      raw = item.event.error;
    }
    if (!raw) continue;

    const statusCode = statusCodeFromText(raw);
    const category = providerErrorCategory(raw, statusCode);
    if (!statusCode && category === 'provider-error' && !/\berror\b/i.test(raw)) continue;

    const message = redactSecrets(raw);
    const key = `${item.at}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push({
      at: item.at,
      provider: primary.provider,
      model: primary.model,
      statusCode,
      category,
      message,
    });
  }

  return errors;
}

export function modelUsageFromSession(session) {
  const counts = new Map();

  for (const item of iterateEvents(session)) {
    if (item.event.kind !== 'token_usage' || !item.event.model) continue;
    addModelCount(counts, item.event.model);
  }

  if (counts.size === 0 && session.model) addModelCount(counts, session.model);

  return [...counts.values()].sort((a, b) => b.count - a.count || modelLabel(a).localeCompare(modelLabel(b)));
}

export function mergeModelUsage(groups) {
  const counts = new Map();
  for (const group of groups || []) {
    for (const item of group || []) {
      const provider = stringValue(item.provider);
      const model = stringValue(item.model);
      const key = `${provider}\u0000${model}`;
      const current = counts.get(key) || { provider, model, count: 0 };
      current.count += Number(item.count || 0);
      counts.set(key, current);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || modelLabel(a).localeCompare(modelLabel(b)));
}

export function summarizeChildSession(session) {
  const inspection = inspectionForSession(session);
  const assistantTexts = messageEvents(session, 'assistant').map((event) => event.text || '');
  const finalText = assistantTexts.slice(-5).join('\n');
  const trackerWrites = [
    ...inspection.filesTouched.written,
    ...inspection.filesTouched.edited,
  ].filter((path) => /batch\/tracker-additions\/.*\.tsv/.test(path)).length;
  const providerErrors = providerErrorsForSession(session);
  const dispatchCalls = collectDispatchCalls(session);
  const dedupeMiss = /\b(DUPLICATE|already\s+\*{0,2}Applied|already applied|per \[H2\]|Hard Limit #2|No re-dispatch needed)\b/i.test(finalText) ||
    /\bpreviously applied (on|as|under)\b/i.test(finalText);

  return {
    id: session.id,
    title: session.title || '',
    startedAt: session.startedAt,
    startedAtMs: Date.parse(session.startedAt),
    endedAt: session.endedAt,
    outcome: outcomeFromText(finalText, trackerWrites),
    providerErrors: providerErrors.length,
    taskCalls: dispatchCalls.filter((call) => call.name === 'task').length,
    dispatchCalls: dispatchCalls.length,
    toolErrors: inspection.toolErrorCount,
    dedupeMiss,
    trackerWrites,
    models: modelUsageFromSession(session),
  };
}

export function outcomeFromText(text, trackerWrites = 0) {
  const explicitFailed = /\b(APPLICATION OUTCOME|RESULT|STATUS)(?:\*\*)?\s*[:|-]\s*\*{0,2}\s*(FAILED|APPLY FAILED)\b/i.test(text) ||
    /\|\s*\*\*?Status\*\*?\s*\|\s*\*\*?Failed\*\*?/i.test(text);
  const explicitSkipped = /\b(APPLICATION OUTCOME|RESULT|STATUS)(?:\*\*)?\s*[:|-]\s*\*{0,2}\s*(SKIP|SKIPPED|DISCARDED|DISCARD)\b/i.test(text) ||
    /\|\s*\*\*?Status\*\*?\s*\|\s*\*\*?(SKIP|SKIPPED|Discarded|DISCARDED)\*\*?/i.test(text);
  const explicitApplied = /\b(APPLICATION OUTCOME|RESULT|STATUS)(?:\*\*)?\s*[:|-]\s*\*{0,2}\s*APPLIED\b/i.test(text) ||
    /\|\s*\*\*?Status\*\*?\s*\|\s*\*\*?Applied\*\*?/i.test(text);

  if (explicitFailed) return 'Failed';
  if (explicitSkipped) return 'Discarded';
  if (explicitApplied) return 'Applied';

  if (/\bAPPLY FAILED\b/i.test(text) || /^\s*(FAILED|Failed)\b/m.test(text)) return 'Failed';
  if (/^\s*(SKIP|SKIPPED|DISCARDED|Discarded)\b/m.test(text) ||
    /\b(DUPLICATE|job posting closed|role no longer available)\b/i.test(text)) return 'Discarded';
  if (/\bwith\s+\*\*?Applied\*\*?\s+status\b/i.test(text) ||
    /\bAPPLIED\s+https?:\/\//i.test(text) ||
    /\b(successfully submitted|Applied via|Thank you for applying|confirmation page)\b/i.test(text)) return 'Applied';
  if (trackerWrites > 0) return 'TSV written';
  return 'unknown';
}

export function hasOutcome(text) {
  return outcomeFromText(text) !== 'unknown' ||
    /tracker-additions\/.*\.tsv/i.test(text) ||
    /\bAll\s+\d+\s+jobs?\s+dispatched\b/i.test(text) ||
    /\*\*(Applied|Skipped|Failed|Discarded)\s*\(\d+\):\*\*/i.test(text);
}

export function requestedJobCount(prompt) {
  const text = String(prompt || '').toLowerCase();
  if (!/\b(job|jobs|application|applications)\b/.test(text)) return null;
  if (!/\b(apply|applt|another|nother|more|process)\b/.test(text)) return null;
  const match = text.match(/\b(\d{1,3})\b/);
  return match ? Number(match[1]) : null;
}

export function firstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s)>\]]+/i);
  return match ? match[0].replace(/[.,;]+$/, '') : '';
}

export function duplicateDispatchUrlCount(calls) {
  const seen = new Set();
  const duplicates = new Set();
  for (const call of calls) {
    if (!call.url || call.isStatusPoll) continue;
    if (seen.has(call.url)) duplicates.add(call.url);
    seen.add(call.url);
  }
  return duplicates.size;
}

export function mentionsLimitedCandidatePool(text) {
  return /\b(only|just)\s+\d+\s+(candidate|candidates|jobs?|applications?)\b/i.test(text) ||
    /\b(no more|not enough|ran out of|exhausted)\s+(candidate|candidates|jobs?|applications?|pipeline)\b/i.test(text);
}

export function statusCodeFromText(text) {
  const match = String(text).match(/\b(40[0-9]|42[0-9]|50[0-9])\b/);
  return match ? Number(match[1]) : undefined;
}

export function providerErrorCategory(text, statusCode) {
  if (statusCode === 402 || /insufficient|balance|credits|diem/i.test(text)) return 'balance';
  if (statusCode === 429 || /rate.?limit|quota/i.test(text)) return 'rate-limit';
  if (/overload|temporarily unavailable|timeout/i.test(text)) return 'transient';
  return 'provider-error';
}

export function hasProxyLeak(text) {
  const raw = String(text || '');
  if (!/proxy/i.test(raw)) return false;
  return /\b(server|username|password|bypass)["']?\s*[:=]\s*["']?[^"',\s)}]+/i.test(raw) ||
    /brd-customer|superproxy|oxylabs|smartproxy|soax/i.test(raw);
}

export function redactSecrets(text) {
  return String(text || '')
    .replace(/\b(password|username|server|bypass)["']?\s*[:=]\s*["']?[^"',\s)}]+/gi, '$1=<redacted>')
    .replace(/brd-customer-[A-Za-z0-9_.-]+/g, '<redacted-proxy-user>');
}

export function relativeToProject(file, projectDir) {
  const root = resolve(projectDir || '.');
  return String(file || '').startsWith(`${root}/`) ? String(file).slice(root.length + 1) : String(file || '');
}

export function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function shorten(value, max) {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}...`;
}

export function pad(value, width) {
  const text = String(value ?? '');
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

export function stringValue(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function modelLabel(model) {
  return `${model.provider || '(unknown)'}/${model.model || '(unknown)'} x${model.count}`;
}

export function isFreeModelRoute(provider, model) {
  const route = `${provider}/${model}`.toLowerCase();
  return route.includes(':free') ||
    route.includes('/big-pickle') ||
    route.includes('minimax-m2.5-free') ||
    route.includes('glm-4.5-air') ||
    route.includes('gpt-oss-20b') ||
    route.includes('qwen3-next-80b-a3b-instruct:free');
}

function dispatchSummary(record) {
  const input = objectOrEmpty(record.input);
  const prompt = promptTextFromInput(input);
  const description = stringValue(input.description || input.message || firstLine(prompt));
  const sessionId = dispatchSessionId(record.name, input, record.result?.output);
  const subagentType = stringValue(
    input.subagent_type ||
    input.agent_type ||
    input.profile ||
    input.agent ||
    input.model ||
    objectOrEmpty(input.metadata).subagent_type ||
    objectOrEmpty(input.metadata).agent,
  );
  const isStatusPoll = record.name === 'task' && (
    Boolean(input.task_id) ||
    /\b(check|poll|status|force|abort|progress|result)\b/i.test(description) ||
    /\b(return your final outcome now|if still working|current status|report your current status|still running)\b/i.test(prompt)
  );

  return {
    name: record.name,
    at: record.at,
    atMs: record.atMs,
    description,
    prompt,
    promptBytes: Buffer.byteLength(prompt, 'utf8'),
    sessionId,
    subagentType,
    status: record.result ? (record.result.error ? 'failed' : 'completed') : 'unknown',
    isStatusPoll,
    proxyLeak: hasProxyLeak(prompt),
    url: firstUrl(prompt),
  };
}

function dispatchSessionId(toolName, input, outputText) {
  if (toolName === 'spawn_agent') {
    const resultObject = parseMaybeJson(outputText);
    const outputId = objectIdForDispatch(resultObject);
    if (outputId) return outputId;
  }

  const metadata = objectOrEmpty(input.metadata);
  const direct = [
    stringValue(input.task_id),
    stringValue(input.sessionId),
    stringValue(input.session_id),
    stringValue(metadata.sessionId),
    stringValue(input.target),
  ].find(Boolean);
  if (direct) return direct;

  const fromInputObject = objectIdForDispatch(input);
  if (fromInputObject) return fromInputObject;

  const fromOutput = objectIdForDispatch(parseMaybeJson(outputText)) || idFromText(outputText);
  return fromOutput || '';
}

function promptTextFromInput(input) {
  const parts = [];
  if (typeof input.prompt === 'string' && input.prompt) parts.push(input.prompt);
  if (typeof input.message === 'string' && input.message) parts.push(input.message);
  if (Array.isArray(input.items)) {
    for (const item of input.items) {
      if (item && typeof item === 'object' && typeof item.text === 'string' && item.text) {
        parts.push(item.text);
      }
    }
  }
  return parts.join('\n');
}

function firstLine(text) {
  return String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
}

function addModelCount(counts, route) {
  const raw = String(route || '').trim();
  if (!raw) return;
  const slash = raw.indexOf('/');
  const provider = slash === -1 ? '' : raw.slice(0, slash);
  const model = slash === -1 ? raw : raw.slice(slash + 1);
  const key = `${provider}\u0000${model}`;
  const current = counts.get(key) || { provider, model, count: 0 };
  current.count += 1;
  counts.set(key, current);
}

function objectIdForDispatch(value, depth = 0) {
  if (!value || depth > 4) return '';
  if (typeof value === 'string') return isLikelySessionId(value) ? value : '';
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = objectIdForDispatch(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';

  for (const key of ['sessionId', 'session_id', 'task_id', 'agent_id', 'target']) {
    const direct = value[key];
    if (typeof direct === 'string' && isLikelySessionId(direct)) return direct;
  }
  if (typeof value.id === 'string' && isLikelySessionId(value.id)) return value.id;

  for (const nested of Object.values(value)) {
    const found = objectIdForDispatch(nested, depth + 1);
    if (found) return found;
  }
  return '';
}

function parseMaybeJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function idFromText(text) {
  const raw = String(text || '');
  const patterns = [
    /\b(?:session|task|agent)[-_ ]?id["'\s:=]+([A-Za-z0-9._:-]{8,})/i,
    /\b([0-9a-f]{8}-[0-9a-f-]{27,})\b/i,
    /\b([A-Za-z]{2,8}_[A-Za-z0-9._:-]{6,})\b/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1] && isLikelySessionId(match[1])) return match[1];
  }
  return '';
}

function isLikelySessionId(value) {
  const text = String(value || '').trim();
  if (text.length < 8 || /\s/.test(text)) return false;
  return /^[A-Za-z0-9._:-]+$/.test(text);
}

function projectTraceRootsByHarness(cwd, since) {
  return {
    claude: [claudeProjectRoot(cwd)].filter(safeExists),
    cursor: [cursorProjectRoot(cwd)].filter(safeExists),
    codex: codexProjectRoots(since).filter(safeExists),
    opencode: [defaultOpenCodeDbPath()].filter(safeExists),
  };
}

function harnessKey(name) {
  if (name === 'claude-code') return 'claude';
  return name;
}

function claudeProjectRoot(cwd) {
  return join(homedir(), '.claude', 'projects', cwd.replace(/\//g, '-'));
}

function cursorProjectRoot(cwd) {
  return join(homedir(), '.cursor', 'projects', cwd.replace(/^\/+/, '').replace(/\//g, '-'));
}

function codexProjectRoots(since) {
  const base = join(homedir(), '.codex', 'sessions');
  if (!safeExists(base)) return [];
  const cutoff = parseSinceCutoff(since);
  if (cutoff === undefined) return [base];

  const roots = [];
  for (const year of readDirNames(base)) {
    if (!/^\d{4}$/.test(year)) continue;
    const yearDir = join(base, year);
    for (const month of readDirNames(yearDir)) {
      if (!/^\d{2}$/.test(month)) continue;
      const monthDir = join(yearDir, month);
      for (const day of readDirNames(monthDir)) {
        if (!/^\d{2}$/.test(day)) continue;
        const start = Date.UTC(Number(year), Number(month) - 1, Number(day));
        const end = start + 86_400_000 - 1;
        if (end >= cutoff) roots.push(join(monthDir, day));
      }
    }
  }
  return roots.length > 0 ? roots : [base];
}

function discoverCodexRefs(cwd, roots) {
  if (roots.length === 0) return [];
  if (!commandExists('rg')) {
    return discoverCodexRefsFallback(roots, cwd);
  }

  const pattern = `"cwd":"${cwd}"`;
  const result = spawnSync('rg', [
    '-l',
    '--fixed-strings',
    '--glob',
    '*.jsonl',
    pattern,
    ...roots,
  ], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if ((result.status ?? 1) !== 0 && (result.status ?? 1) !== 1) {
    return discoverCodexRefsFallback(roots, cwd);
  }

  const files = (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return files.map((file) => refFromPath(file, 'codex'));
}

function discoverOpenCodeRefs(cwd, since, dbPath = defaultOpenCodeDbPath()) {
  if (!safeExists(dbPath)) return [];
  const where = [
    's.time_archived is null',
    `s.directory = ${sqlString(cwd)}`,
  ];
  const sinceMs = parseSinceCutoff(since);
  if (sinceMs !== undefined) where.push(`s.time_created >= ${Number(sinceMs)}`);

  const sql = [
    'select',
    '  s.id,',
    "  replace(replace(coalesce(s.title, ''), char(10), ' '), char(13), ' ') as title,",
    '  s.directory,',
    '  s.time_created,',
    '  s.time_updated,',
    '  (select count(*) from message m where m.session_id = s.id) as turn_count,',
    '  (',
    '    (select coalesce(sum(length(data)), 0) from message m where m.session_id = s.id) +',
    '    (select coalesce(sum(length(data)), 0) from part p where p.session_id = s.id)',
    '  ) as size_bytes',
    'from session s',
    `where ${where.join(' and ')}`,
    'order by s.time_updated desc',
  ].join(' ');

  const result = runOpenCodeSqliteQuery(dbPath, sql);
  if ((result.status ?? 0) !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    throw new Error(`job-forge observability: sqlite3 query failed: ${detail}`);
  }

  const rows = (result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, title, directory, time_created, time_updated, turn_count, size_bytes] = line.split('\x1f');
      return {
        id,
        title: title || null,
        directory,
        time_created: Number(time_created),
        time_updated: Number(time_updated),
        turn_count: Number(turn_count || 0),
        size_bytes: Number(size_bytes || 0),
      };
    });

  return sessionRefsFromOpenCodeRows(rows, dbPath);
}

function loadObservedOpenCodeSession(ref) {
  const sessionId = sessionIdFromOpenCodeLocator(ref?.source?.path || '');
  if (!sessionId) {
    return loadSessionFromPath(ref.source.path, ref.source.harness);
  }

  const errors = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'jobforge-opencode-session-'));
    const exportPath = join(tmpRoot, `${sessionId}.json`);
    try {
      exportOpenCodeSessionToFile(sessionId, exportPath);
      const session = parseOpenCode(exportPath);
      return {
        ...session,
        source: ref.source,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  }

  throw new Error(`job-forge observability: failed to load OpenCode session ${sessionId}: ${errors.join(' | ')}`);
}

function exportOpenCodeSessionToFile(sessionId, exportPath) {
  const result = spawnSync(process.env.SHELL || 'sh', [
    '-lc',
    `opencode export ${shellQuote(sessionId)} > ${shellQuote(exportPath)}`,
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
  if ((result.status ?? 0) !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    throw new Error(`opencode export ${sessionId} failed: ${detail}`);
  }
}

function sessionIdFromOpenCodeLocator(path) {
  const match = String(path || '').match(/#session=([^#]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function runOpenCodeSqliteQuery(dbPath, sql) {
  let lastResult;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = spawnSync('sqlite3', ['-separator', '\x1f', dbPath, sql], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    if ((result.status ?? 0) === 0) return result;
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status ?? 1}`;
    lastResult = result;
    if (!/database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(detail)) {
      return result;
    }
    sleepMs(100 * (attempt + 1));
  }
  return lastResult;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function discoverCodexRefsFallback(roots, cwd) {
  return discoverCodexJsonl(roots)
    .map((file) => {
      try {
        return refFromPath(file, 'codex');
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((ref) => ref.cwd === cwd);
}

function discoverCodexJsonl(roots) {
  const files = [];
  for (const root of roots) files.push(...walkJsonl(root));
  return files;
}

function walkJsonl(root) {
  const out = [];
  for (const name of readDirNames(root)) {
    const full = join(root, name);
    if (safeDir(full)) {
      out.push(...walkJsonl(full));
    } else if (name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
}

function readDirNames(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function safeExists(path) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function safeDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return !result.error;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
