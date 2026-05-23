import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadPostflightConfig,
  parseJson,
  settlePostflight,
} from '@agent-pattern-labs/iso-postflight';

export const POSTFLIGHT_CONFIG_FILE = 'templates/postflight.json';
export const POSTFLIGHT_WORKFLOW = 'jobforge.apply';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgePostflightConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_POSTFLIGHT_CONFIG || join(projectDir, POSTFLIGHT_CONFIG_FILE);
}

export function readJobForgePostflightConfig(projectDir = resolveProjectDir()) {
  const path = jobForgePostflightConfigPath(projectDir);
  return loadPostflightConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function settleJobForgePostflight(planInput, observationsInput, options = {}, projectDir = resolveProjectDir()) {
  return settlePostflight(readJobForgePostflightConfig(projectDir), planInput, observationsInput, {
    workflow: options.workflow || POSTFLIGHT_WORKFLOW,
  });
}
