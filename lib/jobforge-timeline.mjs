import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative } from 'path';
import {
  checkTimeline,
  filterTimelineResult,
  loadTimelineConfig,
  parseJson,
  parseJsonLines,
  planTimeline,
  verifyTimelineResult,
} from '@agent-pattern-labs/iso-timeline';
import { DATA_APPS_DIR, PROJECT_DIR, readAllEntries } from '../tracker-lib.mjs';
import { jobForgeCompanyRoleKey, jobForgeUrlKey, legacyCompanyRoleKey, legacyUrlKey } from './jobforge-canon.mjs';

export const TIMELINE_CONFIG_FILE = 'templates/timeline.json';
export const TIMELINE_FILE = '.jobforge-timeline.json';
export const TIMELINE_EVENTS_FILE = '.jobforge-timeline-events.jsonl';
export const USER_TIMELINE_EVENTS_FILE = 'data/timeline-events.jsonl';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeTimelineConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_TIMELINE_CONFIG || join(projectDir, TIMELINE_CONFIG_FILE);
}

export function jobForgeTimelinePath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_TIMELINE || join(projectDir, TIMELINE_FILE);
}

export function jobForgeTimelineEventsPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_TIMELINE_EVENTS || join(projectDir, TIMELINE_EVENTS_FILE);
}

export function readJobForgeTimelineConfig(projectDir = resolveProjectDir()) {
  const path = jobForgeTimelineConfigPath(projectDir);
  return loadTimelineConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function timelineExists(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeTimelinePath(projectDir));
}

export function timelineEventsExist(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeTimelineEventsPath(projectDir));
}

export function readJobForgeTimeline(projectDir = resolveProjectDir()) {
  const path = jobForgeTimelinePath(projectDir);
  return parseJson(readFileSync(path, 'utf8'), path);
}

export function buildJobForgeTimelineEvents(projectDir = resolveProjectDir()) {
  const events = [
    ...applicationEvents(projectDir),
    ...pipelineEvents(projectDir),
    ...userEvents(projectDir),
  ];
  events.sort(compareEvents);
  return events;
}

export function writeJobForgeTimelineEvents(events, options = {}, projectDir = resolveProjectDir()) {
  const out = options.out || jobForgeTimelineEventsPath(projectDir);
  mkdirSync(dirname(out), { recursive: true });
  const content = events.map((event) => JSON.stringify(event)).join('\n');
  writeFileSync(out, `${content}${content ? '\n' : ''}`, 'utf8');
  return out;
}

export function planJobForgeTimeline(options = {}, projectDir = resolveProjectDir()) {
  const config = readJobForgeTimelineConfig(projectDir);
  const events = options.events || buildJobForgeTimelineEvents(projectDir);
  return planTimeline(config, events, { now: options.now });
}

export function dueJobForgeTimeline(options = {}, projectDir = resolveProjectDir()) {
  return filterTimelineResult(planJobForgeTimeline(options, projectDir), ['overdue', 'due']);
}

export function checkJobForgeTimeline(options = {}, projectDir = resolveProjectDir()) {
  const config = readJobForgeTimelineConfig(projectDir);
  const events = options.events || buildJobForgeTimelineEvents(projectDir);
  return checkTimeline(config, events, { now: options.now, failOn: options.failOn });
}

export function buildJobForgeTimeline(options = {}, projectDir = resolveProjectDir()) {
  const events = buildJobForgeTimelineEvents(projectDir);
  const result = planJobForgeTimeline({ now: options.now, events }, projectDir);
  const eventsOut = writeJobForgeTimelineEvents(events, { out: options.eventsOut }, projectDir);
  const out = options.out || jobForgeTimelinePath(projectDir);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return { result, events, out, eventsOut };
}

export function verifyJobForgeTimeline(options = {}, projectDir = resolveProjectDir()) {
  const result = options.result || readJobForgeTimeline(projectDir);
  return verifyTimelineResult(result);
}

export function jobForgeTimelineSummary(projectDir = resolveProjectDir()) {
  if (!timelineExists(projectDir)) {
    return {
      path: jobForgeTimelinePath(projectDir),
      eventsPath: jobForgeTimelineEventsPath(projectDir),
      config: jobForgeTimelineConfigPath(projectDir),
      exists: false,
      eventsExists: timelineEventsExist(projectDir),
      items: 0,
      due: 0,
      overdue: 0,
    };
  }
  const result = readJobForgeTimeline(projectDir);
  return {
    path: jobForgeTimelinePath(projectDir),
    eventsPath: jobForgeTimelineEventsPath(projectDir),
    config: jobForgeTimelineConfigPath(projectDir),
    exists: true,
    eventsExists: timelineEventsExist(projectDir),
    items: result.stats?.total || 0,
    due: result.stats?.due || 0,
    overdue: result.stats?.overdue || 0,
    generatedAt: result.generatedAt,
    id: result.id,
  };
}

function applicationEvents(projectDir) {
  const { entries } = readAllEntries();
  return entries
    .map((entry) => applicationEvent(entry, projectDir))
    .filter(Boolean);
}

function applicationEvent(entry, projectDir) {
  const at = dateToIso(entry.date);
  if (!at || !entry.company || !entry.role || !entry.status) return null;
  const status = canonicalStatus(entry.status);
  const key = safeCompanyRoleKey(entry.company, entry.role, projectDir);
  return {
    id: `jobforge:application-status:${entry.num}:${key}:${at}`,
    key,
    type: 'application.status',
    at,
    data: compactObject({
      num: entry.num,
      date: entry.date,
      company: entry.company,
      role: entry.role,
      score: entry.score,
      status,
      pdf: entry.pdf,
      report: entry.report,
      notes: entry.notes,
    }),
    source: sourceForApplication(entry, projectDir),
  };
}

function pipelineEvents(projectDir) {
  const pipelinePath = join(projectDir, 'data', 'pipeline.md');
  if (!existsSync(pipelinePath)) return [];
  const scanDates = scanHistoryDates(projectDir);
  const lines = readFileSync(pipelinePath, 'utf8').split('\n');
  const events = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*-\s*\[([ xX])\]\s+(https?:\/\/[^|\s#]+)(.*)$/);
    if (!match) return;
    const url = match[2].trim();
    const at = dateToIso(scanDates.get(url) || firstDateInText(line));
    if (!at) return;
    const fields = (match[3] || '').split('|').map((field) => field.trim()).filter(Boolean);
    const status = match[1].toLowerCase() === 'x' ? 'processed' : 'pending';
    const key = safeUrlKey(url, projectDir);
    events.push({
      id: `jobforge:pipeline:${status}:${key}:${at}`,
      key,
      type: status === 'processed' ? 'pipeline.processed' : 'pipeline.item',
      at,
      data: compactObject({
        status,
        url,
        company: fields[0],
        role: fields[1],
      }),
      source: {
        path: 'data/pipeline.md',
        line: index + 1,
      },
    });
  });
  return events;
}

function userEvents(projectDir) {
  const path = join(projectDir, USER_TIMELINE_EVENTS_FILE);
  if (!existsSync(path)) return [];
  return parseJsonLines(readFileSync(path, 'utf8'), path);
}

function scanHistoryDates(projectDir) {
  const path = join(projectDir, 'data', 'scan-history.tsv');
  const dates = new Map();
  if (!existsSync(path)) return dates;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const date = parts[0]?.trim();
    const url = parts[3]?.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(date) && /^https?:\/\//.test(url)) dates.set(url, date);
  }
  return dates;
}

function sourceForApplication(entry, projectDir) {
  const raw = String(entry._sourceFile || '');
  if (/^\d{4}-\d{2}-\d{2}\.md$/.test(raw)) {
    return { path: relativePath(projectDir, join(DATA_APPS_DIR, raw)) };
  }
  if (raw) return { path: relativePath(projectDir, raw) };
  return undefined;
}

function dateToIso(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T12:00:00.000Z`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function firstDateInText(value) {
  return String(value || '').match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '';
}

function canonicalStatus(value) {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  const map = new Map([
    ['evaluated', 'Evaluated'],
    ['applied', 'Applied'],
    ['responded', 'Responded'],
    ['contacted', 'Contacted'],
    ['interview', 'Interview'],
    ['offer', 'Offer'],
    ['rejected', 'Rejected'],
    ['discarded', 'Discarded'],
    ['failed', 'Failed'],
    ['skip', 'SKIP'],
  ]);
  return map.get(lower) || text;
}

function safeCompanyRoleKey(company, role, projectDir) {
  try {
    return jobForgeCompanyRoleKey(company, role, projectDir);
  } catch {
    return legacyCompanyRoleKey(company, role);
  }
}

function safeUrlKey(url, projectDir) {
  try {
    return jobForgeUrlKey(url, projectDir);
  } catch {
    return legacyUrlKey(url);
  }
}

function compactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

function compareEvents(a, b) {
  return `${a.at}\0${a.key}\0${a.type}\0${a.id || ''}`.localeCompare(`${b.at}\0${b.key}\0${b.type}\0${b.id || ''}`);
}

function relativePath(projectDir, value) {
  const text = String(value || '');
  if (!text) return '';
  const rel = relative(projectDir, text);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.replace(/\\/g, '/');
  return text.replace(/\\/g, '/');
}
