import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadPreflightConfig,
  parseJson,
  planPreflight,
} from '@agent-pattern-labs/iso-preflight';

export const PREFLIGHT_CONFIG_FILE = 'templates/preflight.json';
export const PREFLIGHT_WORKFLOW = 'jobforge.apply';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgePreflightConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_PREFLIGHT_CONFIG || join(projectDir, PREFLIGHT_CONFIG_FILE);
}

export function readJobForgePreflightConfig(projectDir = resolveProjectDir()) {
  const path = jobForgePreflightConfigPath(projectDir);
  return loadPreflightConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function planJobForgePreflight(candidateInput, options = {}, projectDir = resolveProjectDir()) {
  return planPreflight(readJobForgePreflightConfig(projectDir), candidateInput, {
    workflow: options.workflow || PREFLIGHT_WORKFLOW,
  });
}
