import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildIndex,
  hasIndexRecord,
  loadIndexConfig,
  parseJson,
  queryIndex,
  recordId,
  verifyIndex,
} from '@agent-pattern-labs/iso-index';
import {
  jobForgeCompanyRoleKey,
  jobForgeUrlKey,
  legacyCompanyRoleKey,
  legacyUrlKey,
} from './jobforge-canon.mjs';

export const INDEX_FILE = '.jobforge-index.json';
export const INDEX_CONFIG_FILE = 'templates/index.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeIndexPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_INDEX || join(projectDir, INDEX_FILE);
}

export function jobForgeIndexConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_INDEX_CONFIG || join(projectDir, INDEX_CONFIG_FILE);
}

export function indexExists(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeIndexPath(projectDir));
}

export function readJobForgeIndexConfig(projectDir = resolveProjectDir()) {
  const path = jobForgeIndexConfigPath(projectDir);
  return loadIndexConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function buildJobForgeIndex(options = {}, projectDir = resolveProjectDir()) {
  const config = readJobForgeIndexConfig(projectDir);
  const index = canonicalizeJobForgeIndex(buildIndex(config, { root: projectDir }), projectDir);
  const out = options.out || jobForgeIndexPath(projectDir);
  if (options.write !== false) {
    writeFileSync(out, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  }
  return { index, out };
}

export function readJobForgeIndex(projectDir = resolveProjectDir()) {
  const path = jobForgeIndexPath(projectDir);
  return parseJson(readFileSync(path, 'utf8'), path);
}

export function ensureJobForgeIndex(options = {}, projectDir = resolveProjectDir()) {
  if (options.rebuild !== false || !indexExists(projectDir)) {
    return buildJobForgeIndex({ out: options.out }, projectDir).index;
  }
  return readJobForgeIndex(projectDir);
}

export function queryJobForgeIndex(query = {}, options = {}, projectDir = resolveProjectDir()) {
  return queryIndex(ensureJobForgeIndex(options, projectDir), query);
}

export function hasJobForgeIndexRecord(query = {}, options = {}, projectDir = resolveProjectDir()) {
  return hasIndexRecord(ensureJobForgeIndex(options, projectDir), query);
}

export function verifyJobForgeIndex(options = {}, projectDir = resolveProjectDir()) {
  const index = options.index || ensureJobForgeIndex(options, projectDir);
  return verifyIndex(index);
}

export function jobForgeIndexSummary(projectDir = resolveProjectDir()) {
  if (!indexExists(projectDir)) {
    return {
      path: jobForgeIndexPath(projectDir),
      config: jobForgeIndexConfigPath(projectDir),
      exists: false,
      records: 0,
      files: 0,
      sources: 0,
    };
  }
  const index = readJobForgeIndex(projectDir);
  return {
    path: jobForgeIndexPath(projectDir),
    config: jobForgeIndexConfigPath(projectDir),
    exists: true,
    records: index.stats?.records || 0,
    files: index.stats?.files || 0,
    sources: index.stats?.sources || 0,
    configHash: index.configHash,
  };
}

function canonicalizeJobForgeIndex(index, projectDir) {
  const records = (index.records || []).map((record) => canonicalizeJobForgeIndexRecord(record, projectDir));
  records.sort(compareRecords);
  return {
    ...index,
    records,
    stats: {
      ...(index.stats || {}),
      records: records.length,
    },
  };
}

function canonicalizeJobForgeIndexRecord(record, projectDir) {
  const key = canonicalIndexKey(record, projectDir);
  if (key === record.key) return record;
  const updated = { ...record, key };
  return { ...updated, id: recordId(updated) };
}

function canonicalIndexKey(record, projectDir) {
  if (isCompanyRoleRecord(record)) {
    const { company, role } = companyRoleFields(record);
    if (company && role) return safeCompanyRoleKey(company, role, projectDir);
  }
  if (isUrlRecord(record)) {
    const url = record.fields?.url;
    if (url) return safeUrlKey(url, projectDir);
  }
  return record.key;
}

function isCompanyRoleRecord(record) {
  return record.kind === 'jobforge.application' || record.kind === 'jobforge.tracker-addition';
}

function companyRoleFields(record) {
  const fields = record.fields || {};
  return {
    company: fields.company || fields.Company,
    role: fields.role || fields.Role,
  };
}

function isUrlRecord(record) {
  return record.kind === 'jobforge.report.url' || record.kind === 'jobforge.pipeline.url' || record.kind === 'jobforge.scan.url';
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

function compareRecords(a, b) {
  return `${a.kind}\0${a.key}\0${a.source?.path || ''}\0${a.source?.line || ''}\0${a.id}`
    .localeCompare(`${b.kind}\0${b.key}\0${b.source?.path || ''}\0${b.source?.line || ''}\0${b.id}`);
}
