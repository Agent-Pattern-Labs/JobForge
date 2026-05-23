import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  loadMigrationConfig,
  parseJson,
  runMigrations,
} from '@agent-pattern-labs/iso-migrate';

export const MIGRATION_CONFIG_FILE = 'templates/migrations.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeMigrationConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_MIGRATIONS_CONFIG || join(projectDir, MIGRATION_CONFIG_FILE);
}

export function migrationConfigExists(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeMigrationConfigPath(projectDir));
}

export function readJobForgeMigrationConfig(projectDir = resolveProjectDir()) {
  const path = jobForgeMigrationConfigPath(projectDir);
  return loadMigrationConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function runJobForgeMigrations(options = {}, projectDir = resolveProjectDir()) {
  return runMigrations(readJobForgeMigrationConfig(projectDir), {
    root: options.root || projectDir,
    dryRun: options.dryRun,
  });
}
