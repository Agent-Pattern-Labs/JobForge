import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  buildFacts,
  checkFactRequirements,
  factId,
  hasFact,
  loadFactsConfig,
  parseJson,
  queryFacts,
  verifyFactSet,
} from '@agent-pattern-labs/iso-facts';
import {
  jobForgeCompanyRoleKey,
  jobForgeUrlKey,
  legacyCompanyRoleKey,
  legacyUrlKey,
} from './jobforge-canon.mjs';

export const FACTS_FILE = '.jobforge-facts.json';
export const FACTS_CONFIG_FILE = 'templates/facts.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeFactsPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_FACTS || join(projectDir, FACTS_FILE);
}

export function jobForgeFactsConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_FACTS_CONFIG || join(projectDir, FACTS_CONFIG_FILE);
}

export function factsExist(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeFactsPath(projectDir));
}

export function readJobForgeFactsConfig(projectDir = resolveProjectDir()) {
  const path = jobForgeFactsConfigPath(projectDir);
  return loadFactsConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function buildJobForgeFacts(options = {}, projectDir = resolveProjectDir()) {
  const config = readJobForgeFactsConfig(projectDir);
  const factSet = canonicalizeJobForgeFacts(buildFacts(config, { root: projectDir }), projectDir);
  const out = options.out || jobForgeFactsPath(projectDir);
  if (options.write !== false) {
    writeFileSync(out, `${JSON.stringify(factSet, null, 2)}\n`, 'utf8');
  }
  return { factSet, out };
}

export function readJobForgeFacts(projectDir = resolveProjectDir()) {
  const path = jobForgeFactsPath(projectDir);
  return parseJson(readFileSync(path, 'utf8'), path);
}

export function ensureJobForgeFacts(options = {}, projectDir = resolveProjectDir()) {
  if (options.rebuild !== false || !factsExist(projectDir)) {
    return buildJobForgeFacts({ out: options.out }, projectDir).factSet;
  }
  return readJobForgeFacts(projectDir);
}

export function queryJobForgeFacts(query = {}, options = {}, projectDir = resolveProjectDir()) {
  return queryFacts(ensureJobForgeFacts(options, projectDir), query);
}

export function hasJobForgeFact(query = {}, options = {}, projectDir = resolveProjectDir()) {
  return hasFact(ensureJobForgeFacts(options, projectDir), query);
}

export function verifyJobForgeFacts(options = {}, projectDir = resolveProjectDir()) {
  const factSet = options.factSet || ensureJobForgeFacts(options, projectDir);
  return verifyFactSet(factSet);
}

export function checkJobForgeFacts(options = {}, projectDir = resolveProjectDir()) {
  const factSet = options.factSet || ensureJobForgeFacts(options, projectDir);
  const config = readJobForgeFactsConfig(projectDir);
  return checkFactRequirements(factSet, config.requirements || []);
}

export function jobForgeFactsSummary(projectDir = resolveProjectDir()) {
  if (!factsExist(projectDir)) {
    return {
      path: jobForgeFactsPath(projectDir),
      config: jobForgeFactsConfigPath(projectDir),
      exists: false,
      facts: 0,
      files: 0,
      sources: 0,
    };
  }
  const factSet = readJobForgeFacts(projectDir);
  return {
    path: jobForgeFactsPath(projectDir),
    config: jobForgeFactsConfigPath(projectDir),
    exists: true,
    facts: factSet.stats?.facts || 0,
    files: factSet.stats?.files || 0,
    sources: factSet.stats?.sources || 0,
    configHash: factSet.configHash,
  };
}

function canonicalizeJobForgeFacts(factSet, projectDir) {
  const facts = (factSet.facts || []).map((fact) => canonicalizeJobForgeFact(fact, projectDir));
  facts.sort(compareFacts);
  return {
    ...factSet,
    facts,
    stats: {
      ...(factSet.stats || {}),
      facts: facts.length,
    },
  };
}

function canonicalizeJobForgeFact(fact, projectDir) {
  const key = canonicalFactKey(fact, projectDir);
  if (key === fact.key) return fact;
  const updated = { ...fact, key };
  return { ...updated, id: factId(updated) };
}

function canonicalFactKey(fact, projectDir) {
  if (isCompanyRoleFact(fact)) {
    const { company, role } = companyRoleFields(fact);
    if (company && role) return safeCompanyRoleKey(company, role, projectDir);
  }
  if (isUrlFact(fact)) {
    const url = fact.fields?.url;
    if (url) return safeUrlKey(url, projectDir);
  }
  return fact.key;
}

function isCompanyRoleFact(fact) {
  return fact.key?.startsWith('company-role:') ||
    fact.fact === 'application.status' ||
    fact.fact === 'tracker.addition' ||
    fact.fact === 'candidate.ready';
}

function companyRoleFields(fact) {
  const fields = fact.fields || {};
  return {
    company: fields.company || fields.Company,
    role: fields.role || fields.Role,
  };
}

function isUrlFact(fact) {
  return fact.key?.startsWith('url:') || fact.fact === 'job.url';
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

function compareFacts(a, b) {
  return `${a.fact}\0${a.key || ''}\0${a.value || ''}\0${a.source?.path || ''}\0${a.source?.line || ''}\0${a.id}`
    .localeCompare(`${b.fact}\0${b.key || ''}\0${b.value || ''}\0${b.source?.path || ''}\0${b.source?.line || ''}\0${b.id}`);
}
