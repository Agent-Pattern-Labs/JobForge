import { readFileSync } from 'fs';
import { join } from 'path';
import {
  canonicalizeCompany,
  canonicalizeCompanyRole,
  canonicalizeEntity,
  canonicalizeRole,
  canonicalizeUrl,
  compareCanon,
  loadCanonConfig,
  parseJson,
  resolveProfile,
} from '@agent-pattern-labs/iso-canon';

export const CANON_CONFIG_FILE = 'templates/canon.json';
export const CANON_PROFILE = 'jobforge';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeCanonConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_CANON_CONFIG || join(projectDir, CANON_CONFIG_FILE);
}

export function readJobForgeCanonConfig(projectDir = resolveProjectDir()) {
  const path = jobForgeCanonConfigPath(projectDir);
  return loadCanonConfig(parseJson(readFileSync(path, 'utf8'), path), path);
}

export function jobForgeCanonProfile(projectDir = resolveProjectDir()) {
  return resolveProfile(readJobForgeCanonConfig(projectDir), process.env.JOB_FORGE_CANON_PROFILE || CANON_PROFILE);
}

export function canonicalizeJobForgeUrl(url, projectDir = resolveProjectDir()) {
  return canonicalizeUrl(url, jobForgeCanonProfile(projectDir));
}

export function canonicalizeJobForgeCompany(company, projectDir = resolveProjectDir()) {
  return canonicalizeCompany(company, jobForgeCanonProfile(projectDir));
}

export function canonicalizeJobForgeRole(role, projectDir = resolveProjectDir()) {
  return canonicalizeRole(role, jobForgeCanonProfile(projectDir));
}

export function canonicalizeJobForgeCompanyRole(company, role, projectDir = resolveProjectDir()) {
  return canonicalizeCompanyRole(company, role, jobForgeCanonProfile(projectDir));
}

export function canonicalizeJobForgeEntity(type, input, projectDir = resolveProjectDir()) {
  return canonicalizeEntity(type, input, jobForgeCanonProfile(projectDir));
}

export function compareJobForgeCanon(type, left, right, projectDir = resolveProjectDir()) {
  return compareCanon(type, left, right, jobForgeCanonProfile(projectDir));
}

export function jobForgeUrlKey(url, projectDir = resolveProjectDir()) {
  return canonicalizeJobForgeUrl(url, projectDir).key;
}

export function jobForgeCompanyRoleKey(company, role, projectDir = resolveProjectDir()) {
  return canonicalizeJobForgeCompanyRole(company, role, projectDir).key;
}

export function jobForgeApplicationSubject(company, role, projectDir = resolveProjectDir()) {
  const companyKey = canonicalizeJobForgeCompany(company, projectDir).key.slice('company:'.length);
  const roleKey = canonicalizeJobForgeRole(role, projectDir).key.slice('role:'.length);
  return `application:${companyKey}:${roleKey}`;
}

export function legacyCompanyRoleKey(company, role) {
  return `company-role:${legacySlugPart(company)}:${legacySlugPart(role)}`;
}

export function legacyUrlKey(url) {
  return `url:${String(url || '').trim()}`;
}

export function legacySlugPart(value) {
  const slug = String(value || 'unknown')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unknown';
}
