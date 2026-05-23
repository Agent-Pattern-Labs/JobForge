import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  checkRoleCapability,
  formatCheckResult,
  formatResolvedRole,
  loadCapabilityPolicy,
  renderRole,
  resolveRole,
  roleNames,
} from '@agent-pattern-labs/iso-capabilities';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
export const CAPABILITIES_RELATIVE_PATH = 'templates/capabilities.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeCapabilitiesPath(projectDir = resolveProjectDir()) {
  const projectPath = join(projectDir, CAPABILITIES_RELATIVE_PATH);
  if (existsSync(projectPath)) return projectPath;
  return join(PKG_ROOT, CAPABILITIES_RELATIVE_PATH);
}

export function loadJobForgeCapabilityPolicy(projectDir = resolveProjectDir()) {
  const path = jobForgeCapabilitiesPath(projectDir);
  return loadCapabilityPolicy(JSON.parse(readFileSync(path, 'utf-8')));
}

export function listJobForgeCapabilityRoles(projectDir = resolveProjectDir()) {
  return roleNames(loadJobForgeCapabilityPolicy(projectDir));
}

export function resolveJobForgeCapabilityRole(name, projectDir = resolveProjectDir()) {
  return resolveRole(loadJobForgeCapabilityPolicy(projectDir), name);
}

export function checkJobForgeCapability(name, request, projectDir = resolveProjectDir()) {
  return checkRoleCapability(loadJobForgeCapabilityPolicy(projectDir), name, request);
}

export function formatJobForgeCapabilityCheck(result) {
  return formatCheckResult(result);
}

export function formatJobForgeCapabilityRole(role) {
  return formatResolvedRole(role);
}

export function renderJobForgeCapabilityRole(role, target = 'markdown') {
  return renderRole(role, target);
}
