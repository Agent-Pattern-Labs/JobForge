import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  loadRedactConfig,
  parseJson,
} from '@agent-pattern-labs/iso-redact';

export const REDACT_CONFIG_FILE = 'templates/redact.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeRedactConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_REDACT_CONFIG || join(projectDir, REDACT_CONFIG_FILE);
}

export function redactConfigExists(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeRedactConfigPath(projectDir));
}

export function readJobForgeRedactConfig(projectDir = resolveProjectDir()) {
  const path = jobForgeRedactConfigPath(projectDir);
  return loadRedactConfig(parseJson(readFileSync(path, 'utf8'), path));
}
