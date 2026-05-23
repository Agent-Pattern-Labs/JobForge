import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import {
  checkPrioritize,
  loadPrioritizeConfig,
  parseJson,
  prioritize,
  selectPrioritized,
  verifyPrioritizeResult,
} from '@agent-pattern-labs/iso-prioritize';
import { ensureJobForgeFacts } from './jobforge-facts.mjs';
import { dueJobForgeTimeline } from './jobforge-timeline.mjs';

export const PRIORITIZE_CONFIG_FILE = 'templates/prioritize.json';
export const PRIORITIZE_FILE = '.jobforge-prioritize.json';
export const PRIORITIZE_ITEMS_FILE = '.jobforge-prioritize-items.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgePrioritizeConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_PRIORITIZE_CONFIG || join(projectDir, PRIORITIZE_CONFIG_FILE);
}

export function jobForgePrioritizePath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_PRIORITIZE || join(projectDir, PRIORITIZE_FILE);
}

export function jobForgePrioritizeItemsPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_PRIORITIZE_ITEMS || join(projectDir, PRIORITIZE_ITEMS_FILE);
}

export function prioritizeExists(projectDir = resolveProjectDir()) {
  return existsSync(jobForgePrioritizePath(projectDir));
}

export function readJobForgePrioritizeConfig(projectDir = resolveProjectDir()) {
  const path = jobForgePrioritizeConfigPath(projectDir);
  return loadPrioritizeConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function readJobForgePrioritize(projectDir = resolveProjectDir()) {
  const path = jobForgePrioritizePath(projectDir);
  return parseJson(readFileSync(path, 'utf8'), path);
}

export function readJobForgePrioritizeItems(projectDir = resolveProjectDir()) {
  const path = jobForgePrioritizeItemsPath(projectDir);
  return parseJson(readFileSync(path, 'utf8'), path);
}

export function buildJobForgePrioritizeItems(options = {}, projectDir = resolveProjectDir()) {
  const factSet = options.facts || ensureJobForgeFacts({ rebuild: options.rebuild !== false }, projectDir);
  const items = [];

  for (const fact of factSet.facts || []) {
    const candidate = candidateItem(fact);
    if (candidate) items.push(candidate);

    const evaluated = evaluatedTrackerItem(fact);
    if (evaluated) items.push(evaluated);
  }

  for (const item of dueJobForgeTimeline({ now: options.now }, projectDir).items || []) {
    const followup = timelineItem(item);
    if (followup) items.push(followup);
  }

  return { items: dedupeItems(items) };
}

export function rankJobForgePrioritize(options = {}, projectDir = resolveProjectDir()) {
  const config = options.config || readJobForgePrioritizeConfig(projectDir);
  const items = options.items || buildJobForgePrioritizeItems(options, projectDir);
  return prioritize(config, items, { profile: options.profile, limit: options.limit });
}

export function selectJobForgePrioritize(options = {}, projectDir = resolveProjectDir()) {
  return selectPrioritized(rankJobForgePrioritize(options, projectDir));
}

export function checkJobForgePrioritize(options = {}, projectDir = resolveProjectDir()) {
  const config = options.config || readJobForgePrioritizeConfig(projectDir);
  const items = options.items || buildJobForgePrioritizeItems(options, projectDir);
  return checkPrioritize(config, items, {
    profile: options.profile,
    limit: options.limit,
    minSelected: options.minSelected,
    failOn: options.failOn,
  });
}

export function writeJobForgePrioritize(result, options = {}, projectDir = resolveProjectDir()) {
  const out = options.out || jobForgePrioritizePath(projectDir);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  return out;
}

export function writeJobForgePrioritizeItems(items, options = {}, projectDir = resolveProjectDir()) {
  const out = options.out || jobForgePrioritizeItemsPath(projectDir);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
  return out;
}

export function verifyJobForgePrioritize(options = {}, projectDir = resolveProjectDir()) {
  const result = options.result || readJobForgePrioritize(projectDir);
  return verifyPrioritizeResult(result);
}

export function jobForgePrioritizeSummary(projectDir = resolveProjectDir()) {
  if (!prioritizeExists(projectDir)) {
    return {
      path: jobForgePrioritizePath(projectDir),
      itemsPath: jobForgePrioritizeItemsPath(projectDir),
      config: jobForgePrioritizeConfigPath(projectDir),
      exists: false,
      items: 0,
      selected: 0,
      candidate: 0,
      skipped: 0,
      blocked: 0,
    };
  }

  const result = readJobForgePrioritize(projectDir);
  return {
    path: jobForgePrioritizePath(projectDir),
    itemsPath: jobForgePrioritizeItemsPath(projectDir),
    config: jobForgePrioritizeConfigPath(projectDir),
    exists: true,
    items: result.stats?.total || 0,
    selected: result.stats?.selected || 0,
    candidate: result.stats?.candidate || 0,
    skipped: result.stats?.skipped || 0,
    blocked: result.stats?.blocked || 0,
    id: result.id,
    profile: result.profile,
  };
}

function candidateItem(fact) {
  if (fact.fact !== 'candidate.ready') return null;
  const fields = fact.fields || {};
  const company = stringField(fields.company);
  const role = stringField(fields.role);
  const score = parseScore(fields.score);

  return compactItem({
    id: `candidate-${slug(fields.id || fact.key || fact.id)}`,
    key: fact.key,
    type: 'apply',
    title: title(company, role, 'apply'),
    tags: ['apply', 'candidate'],
    data: compactObject({
      company,
      role,
      score,
      urgency: score >= 4 ? 8 : 6,
      ageDays: 0,
      sourceQuality: sourceQuality(fact, score),
      status: fields.gateStatus || 'Evaluated',
      gateStatus: fields.gateStatus,
      locationStatus: fields.locationStatus,
      url: fields.url,
    }),
    source: fact.source,
  });
}

function evaluatedTrackerItem(fact) {
  if (fact.fact !== 'application.status') return null;
  const fields = fact.fields || {};
  const status = stringField(fields.status || fact.value);
  if (status !== 'Evaluated') return null;
  const company = stringField(fields.company);
  const role = stringField(fields.role);
  const score = parseScore(fields.score);

  return compactItem({
    id: `evaluated-${slug(fields.num || fact.key || fact.id)}`,
    key: fact.key,
    type: 'apply',
    title: title(company, role, 'apply'),
    tags: ['apply', 'tracker'],
    data: compactObject({
      company,
      role,
      score,
      urgency: score >= 4 ? 8 : 5,
      ageDays: ageDays(fields.date),
      sourceQuality: sourceQuality(fact, score),
      status,
      report: fields.report,
      pdf: fields.pdf,
    }),
    source: fact.source,
  });
}

function timelineItem(item) {
  const data = item.event?.data || {};
  const company = stringField(data.company);
  const role = stringField(data.role);
  const score = parseScore(data.score);

  return compactItem({
    id: `timeline-${slug(item.id)}`,
    key: item.key,
    type: 'followup',
    title: title(company, role, item.action || 'follow-up'),
    tags: ['followup', item.state],
    data: compactObject({
      company,
      role,
      score,
      urgency: item.state === 'overdue' ? 10 : 8,
      ageDays: ageDays(item.event?.at),
      sourceQuality: sourceQuality(item.event, score),
      status: data.status,
      timelineState: item.state,
      action: item.action,
      rule: item.rule,
    }),
    source: item.event?.source,
  });
}

function dedupeItems(items) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || priorityValue(item) > priorityValue(existing)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function priorityValue(item) {
  return Number(item.data?.score || 0) * 100 +
    Number(item.data?.urgency || 0) * 10 +
    Number(item.data?.sourceQuality || 0);
}

function parseScore(value) {
  const match = String(value || '').match(/([0-9]+(?:\.[0-9]+)?)(?:\s*\/\s*5)?/);
  if (!match) return 0;
  return Math.max(0, Math.min(5, Number(match[1])));
}

function ageDays(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
}

function sourceQuality(sourceLike, score) {
  if (sourceLike?.source?.path && score > 0) return 1;
  return score > 0 ? 0.8 : 0;
}

function stringField(value) {
  return value === undefined || value === null ? '' : String(value);
}

function title(company, role, suffix) {
  const base = [company, role].filter(Boolean).join(' - ');
  return suffix && base ? `${base} ${suffix}` : base || suffix || 'JobForge item';
}

function slug(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function compactItem(item) {
  return {
    ...item,
    tags: (item.tags || []).filter(Boolean),
    ...(item.source ? { source: item.source } : {}),
  };
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}
