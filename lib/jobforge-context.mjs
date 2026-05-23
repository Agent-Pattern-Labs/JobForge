import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  bundleNames,
  formatContextPlan,
  formatResolvedContextBundle,
  loadContextPolicy,
  planContext,
  renderContextPlan,
  resolveContextBundle,
} from '@agent-pattern-labs/iso-context';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
export const CONTEXT_RELATIVE_PATH = 'templates/context.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeContextPath(projectDir = resolveProjectDir()) {
  const projectPath = join(projectDir, CONTEXT_RELATIVE_PATH);
  if (existsSync(projectPath)) return projectPath;
  return join(PKG_ROOT, CONTEXT_RELATIVE_PATH);
}

export function loadJobForgeContextPolicy(projectDir = resolveProjectDir()) {
  const path = jobForgeContextPath(projectDir);
  return loadContextPolicy(JSON.parse(readFileSync(path, 'utf-8')));
}

export function listJobForgeContextBundles(projectDir = resolveProjectDir()) {
  return bundleNames(loadJobForgeContextPolicy(projectDir));
}

export function resolveJobForgeContextBundle(name, projectDir = resolveProjectDir()) {
  return resolveContextBundle(loadJobForgeContextPolicy(projectDir), name);
}

export function planJobForgeContextBundle(name, options = {}, projectDir = resolveProjectDir()) {
  return planContext(loadJobForgeContextPolicy(projectDir), name, options);
}

export function formatJobForgeContextPlan(plan) {
  return formatContextPlan(plan);
}

export function formatJobForgeContextBundle(bundle) {
  return formatResolvedContextBundle(bundle);
}

export function renderJobForgeContextPlan(plan, target = 'markdown') {
  return renderContextPlan(plan, target);
}
