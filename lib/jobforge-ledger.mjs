import { existsSync } from 'fs';
import { isAbsolute, join, relative } from 'path';
import {
  appendEvent,
  hasEvent,
  materializeLedger,
  queryEvents,
  readLedger,
  verifyLedger,
} from '@agent-pattern-labs/iso-ledger';
import {
  jobForgeApplicationSubject,
  jobForgeCompanyRoleKey,
  jobForgeUrlKey,
  legacyCompanyRoleKey,
  legacySlugPart,
  legacyUrlKey,
} from './jobforge-canon.mjs';

export { legacyCompanyRoleKey, legacyUrlKey };

export const LEDGER_DIR = '.jobforge-ledger';
export const LEDGER_FILE = 'events.jsonl';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeLedgerPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_LEDGER || join(projectDir, LEDGER_DIR, LEDGER_FILE);
}

export function jobForgeLedgerOptions(projectDir = resolveProjectDir()) {
  return { path: jobForgeLedgerPath(projectDir) };
}

export function ledgerExists(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeLedgerPath(projectDir));
}

export function readJobForgeLedger(projectDir = resolveProjectDir()) {
  if (!ledgerExists(projectDir)) return [];
  return readLedger(jobForgeLedgerOptions(projectDir));
}

export function verifyJobForgeLedger(projectDir = resolveProjectDir()) {
  return verifyLedger(jobForgeLedgerOptions(projectDir));
}

export function queryJobForgeLedger(options = {}, projectDir = resolveProjectDir()) {
  return queryEvents(readJobForgeLedger(projectDir), options);
}

export function hasJobForgeEvent(options = {}, projectDir = resolveProjectDir()) {
  return hasEvent(readJobForgeLedger(projectDir), options);
}

export function jobForgeLedgerSummary(projectDir = resolveProjectDir()) {
  const events = readJobForgeLedger(projectDir);
  const materialized = materializeLedger(events);
  return {
    path: jobForgeLedgerPath(projectDir),
    exists: ledgerExists(projectDir),
    events: events.length,
    entities: materialized.entityCount,
    latest: events.at(-1) || null,
  };
}

export function appendJobForgeEvent(input, projectDir = resolveProjectDir()) {
  return appendEvent(jobForgeLedgerOptions(projectDir), input);
}

export function recordTrackerAdditionWritten(addition, options = {}) {
  const projectDir = resolveProjectDir(options.projectDir);
  return appendJobForgeEvent(buildApplicationEvent('jobforge.tracker_addition.written', addition, {
    projectDir,
    sourceFile: options.sourceFile,
    idempotencyPrefix: 'tracker-addition-written',
    meta: options.meta,
  }), projectDir);
}

export function recordTrackerMergeResult(addition, options = {}) {
  const projectDir = resolveProjectDir(options.projectDir);
  const outcome = options.outcome || 'processed';
  return appendJobForgeEvent(buildApplicationEvent(`jobforge.tracker_merge.${outcome}`, addition, {
    projectDir,
    sourceFile: options.sourceFile,
    idempotencyPrefix: `tracker-merge-${outcome}`,
    data: {
      outcome,
      duplicateNum: jsonValue(options.duplicateNum),
      reason: jsonValue(options.reason),
    },
    meta: options.meta,
  }), projectDir);
}

export function buildApplicationEvent(type, app, options = {}) {
  const projectDir = resolveProjectDir(options.projectDir);
  const key = companyRoleKey(app.company, app.role, projectDir);
  const sourceFile = options.sourceFile ? relativePath(projectDir, options.sourceFile) : '';
  const idempotencyParts = [
    options.idempotencyPrefix || type,
    sourceFile,
    app.num,
    app.date,
    key,
    app.status,
    app.score,
  ].filter((value) => value !== undefined && value !== null && String(value).length > 0);

  return {
    type,
    key,
    subject: applicationSubject(app.company, app.role, projectDir),
    idempotencyKey: idempotencyParts.join(':'),
    data: compactObject({
      num: numberOrString(app.num),
      date: stringOrEmpty(app.date),
      company: stringOrEmpty(app.company),
      role: stringOrEmpty(app.role),
      score: stringOrEmpty(app.score),
      status: stringOrEmpty(app.status),
      pdf: stringOrEmpty(app.pdf),
      report: stringOrEmpty(app.report),
      notes: stringOrEmpty(app.notes),
      sourceFile,
      ...compactObject(options.data || {}),
    }),
    meta: compactObject({
      source: 'job-forge',
      ...compactObject(options.meta || {}),
    }),
  };
}

export function buildPipelineEvent(item, options = {}) {
  const projectDir = resolveProjectDir(options.projectDir);
  const key = item.url ? urlKey(item.url, projectDir) : `pipeline:${item.lineNumber || 'unknown'}`;
  const sourceFile = options.sourceFile ? relativePath(projectDir, options.sourceFile) : 'data/pipeline.md';
  const state = item.checked ? 'processed' : 'pending';

  return {
    type: 'jobforge.pipeline.item',
    key,
    subject: key,
    idempotencyKey: `pipeline:${state}:${item.url || item.lineNumber || item.line || 'unknown'}`,
    data: compactObject({
      state,
      checked: Boolean(item.checked),
      url: stringOrEmpty(item.url),
      company: stringOrEmpty(item.company),
      role: stringOrEmpty(item.role),
      line: stringOrEmpty(item.line),
      lineNumber: numberOrString(item.lineNumber),
      sourceFile,
    }),
    meta: compactObject({
      source: 'job-forge',
      ...compactObject(options.meta || {}),
    }),
  };
}

export function companyRoleKey(company, role, projectDir = resolveProjectDir()) {
  try {
    return jobForgeCompanyRoleKey(company, role, projectDir);
  } catch {
    return legacyCompanyRoleKey(company, role);
  }
}

export function applicationSubject(company, role, projectDir = resolveProjectDir()) {
  try {
    return jobForgeApplicationSubject(company, role, projectDir);
  } catch {
    const key = legacyCompanyRoleKey(company, role).slice('company-role:'.length);
    return `application:${key}`;
  }
}

export function urlKey(url, projectDir = resolveProjectDir()) {
  try {
    return jobForgeUrlKey(url, projectDir);
  } catch {
    return legacyUrlKey(url);
  }
}

export function slugPart(value) {
  return legacySlugPart(value);
}

function relativePath(projectDir, value) {
  const text = String(value || '');
  if (!text) return '';
  const rel = relative(projectDir, text);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.replace(/\\/g, '/');
  return text.replace(/\\/g, '/');
}

function compactObject(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const clean = jsonValue(value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

function jsonValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(jsonValue).filter((item) => item !== undefined);
  if (typeof value === 'object') return compactObject(value);
  return String(value);
}

function stringOrEmpty(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text.length > 0 ? text : undefined;
}

function numberOrString(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && String(value).trim() !== '' ? number : String(value);
}
