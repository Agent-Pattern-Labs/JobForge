#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FALLBACK_PACKAGE = '@geometra/mcp@1.61.3';
const RESOLVE_ONLY_FLAG = '--job-forge-resolve-target';

function normalizeEnv(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveExplicitPath(rawPath) {
  const resolvedPath = resolve(rawPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`JOB_FORGE_GEOMETRA_MCP_PATH points to a missing file: ${resolvedPath}`);
  }
  return resolvedPath;
}

export function resolveGeometraMcpLaunchTarget() {
  const explicitPath = normalizeEnv(process.env.JOB_FORGE_GEOMETRA_MCP_PATH);
  if (explicitPath) {
    const resolvedPath = resolveExplicitPath(explicitPath);
    return {
      source: 'env-path',
      command: process.execPath,
      args: [resolvedPath],
      resolvedPath,
    };
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const siblingRepoPath = resolve(scriptDir, '../../geometra/mcp/dist/index.js');
  if (existsSync(siblingRepoPath)) {
    return {
      source: 'sibling-repo',
      command: process.execPath,
      args: [siblingRepoPath],
      resolvedPath: siblingRepoPath,
    };
  }

  const packageSpec = normalizeEnv(process.env.JOB_FORGE_GEOMETRA_MCP_PACKAGE) ?? DEFAULT_FALLBACK_PACKAGE;
  return {
    source: 'npm-package',
    command: 'npx',
    args: ['-y', packageSpec],
    packageSpec,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const target = resolveGeometraMcpLaunchTarget();

  if (argv.length === 1 && argv[0] === RESOLVE_ONLY_FLAG) {
    process.stdout.write(`${JSON.stringify(target, null, 2)}\n`);
    return;
  }

  const child = spawn(target.command, [...target.args, ...argv], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
