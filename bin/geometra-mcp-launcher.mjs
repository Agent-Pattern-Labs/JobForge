#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FALLBACK_PACKAGE = '@geometra/mcp@1.62.1';
const RESOLVE_ONLY_FLAG = '--job-forge-resolve-target';
const DEFAULT_LOG_RELATIVE_PATH = '.jobforge-mcp/geometra-mcp.jsonl';
const DEFAULT_HEARTBEAT_MS = 15_000;
const MAX_STDERR_LOG_CHARS = 4_000;
const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGTERM: 143,
};

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

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function boolEnvDisabled(value) {
  if (typeof value !== 'string') return false;
  return ['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

function positiveIntEnv(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createLifecycleLogger(projectDir) {
  if (boolEnvDisabled(process.env.JOB_FORGE_GEOMETRA_MCP_LOG)) {
    return {
      enabled: false,
      logPath: null,
      write() {},
    };
  }

  const configuredPath = normalizeEnv(process.env.JOB_FORGE_GEOMETRA_MCP_LOG_PATH);
  const logPath = configuredPath ? resolve(configuredPath) : join(projectDir, DEFAULT_LOG_RELATIVE_PATH);

  function write(event, detail = {}) {
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, `${JSON.stringify({
        ts: new Date().toISOString(),
        event,
        pid: process.pid,
        ppid: process.ppid,
        projectDir,
        ...detail,
      })}\n`);
    } catch {
      // Logging must never break MCP startup or stdio protocol handling.
    }
  }

  return {
    enabled: true,
    logPath,
    write,
  };
}

function targetForLog(target) {
  return {
    source: target.source,
    command: target.command,
    args: target.args,
    resolvedPath: target.resolvedPath,
    packageSpec: target.packageSpec,
  };
}

function envForLog() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    geometraStealth: process.env.GEOMETRA_STEALTH ?? null,
    geometraBrowser: process.env.GEOMETRA_BROWSER ?? null,
    explicitMcpPath: Boolean(normalizeEnv(process.env.JOB_FORGE_GEOMETRA_MCP_PATH)),
    explicitMcpPackage: Boolean(normalizeEnv(process.env.JOB_FORGE_GEOMETRA_MCP_PACKAGE)),
    explicitLogPath: Boolean(normalizeEnv(process.env.JOB_FORGE_GEOMETRA_MCP_LOG_PATH)),
  };
}

function processHealthForLog() {
  const memory = process.memoryUsage();
  const resourceUsage = typeof process.resourceUsage === 'function' ? process.resourceUsage() : null;
  return {
    uptimeMs: Math.round(process.uptime() * 1000),
    memory,
    resourceUsage,
  };
}

function stderrChunkForLog(chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  return {
    text: text.slice(0, MAX_STDERR_LOG_CHARS),
    bytes: Buffer.byteLength(text),
    truncated: text.length > MAX_STDERR_LOG_CHARS,
  };
}

function readProjectPathFromPackageJson(projectDir) {
  const packagePath = join(projectDir, 'package.json');
  if (!existsSync(packagePath)) return null;
  const pkg = readJsonFile(packagePath);
  const rawPath = pkg?.jobForge?.geometraMcpPath;
  return normalizeEnv(rawPath);
}

function readProjectPathFromOpencodeConfig(projectDir) {
  const configPath = join(projectDir, 'opencode.json');
  if (!existsSync(configPath)) return null;
  const config = readJsonFile(configPath);
  const rawPath = config?.mcp?.geometra?.environment?.JOB_FORGE_GEOMETRA_MCP_PATH;
  return normalizeEnv(rawPath);
}

function resolveProjectConfiguredPath(projectDir) {
  const packagePath = readProjectPathFromPackageJson(projectDir);
  if (packagePath) {
    return {
      source: 'project-package-json',
      resolvedPath: resolve(projectDir, packagePath),
    };
  }

  const opencodePath = readProjectPathFromOpencodeConfig(projectDir);
  if (opencodePath) {
    return {
      source: 'project-opencode-json',
      resolvedPath: resolve(projectDir, opencodePath),
    };
  }

  return null;
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

  const projectDir = process.env.JOB_FORGE_PROJECT || process.cwd();
  const projectConfigured = resolveProjectConfiguredPath(projectDir);
  if (projectConfigured) {
    const resolvedPath = resolveExplicitPath(projectConfigured.resolvedPath);
    return {
      source: projectConfigured.source,
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

  const projectDir = process.env.JOB_FORGE_PROJECT || process.cwd();
  const logger = createLifecycleLogger(projectDir);
  const heartbeatMs = boolEnvDisabled(process.env.JOB_FORGE_GEOMETRA_MCP_HEARTBEAT)
    ? 0
    : positiveIntEnv(process.env.JOB_FORGE_GEOMETRA_MCP_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS);

  logger.write('launcher_start', {
    argv,
    target: targetForLog(target),
    env: envForLog(),
    logPath: logger.logPath,
    heartbeatMs,
  });

  const child = spawn(target.command, [...target.args, ...argv], {
    stdio: ['inherit', 'inherit', 'pipe'],
    env: process.env,
  });
  let exiting = false;
  let heartbeat = null;

  logger.write('child_spawn', {
    childPid: child.pid,
    target: targetForLog(target),
  });

  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logger.write('child_stderr', {
        childPid: child.pid,
        ...stderrChunkForLog(chunk),
      });
    });
  }

  if (heartbeatMs > 0) {
    heartbeat = setInterval(() => {
      logger.write('heartbeat', {
        childPid: child.pid,
        childKilled: child.killed,
        health: processHealthForLog(),
      });
    }, heartbeatMs);
    heartbeat.unref();
  }

  const signalNames = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGTERM'];
  for (const signal of signalNames) {
    process.once(signal, () => {
      if (exiting) return;
      exiting = true;
      if (heartbeat) clearInterval(heartbeat);
      logger.write('signal_received', {
        signal,
        childPid: child.pid,
        childKilled: child.killed,
        health: processHealthForLog(),
      });
      if (!child.killed) child.kill(signal);
      process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
    });
  }

  process.once('uncaughtException', (error) => {
    logger.write('uncaught_exception', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      health: processHealthForLog(),
    });
    throw error;
  });

  process.once('unhandledRejection', (reason) => {
    logger.write('unhandled_rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : null,
      health: processHealthForLog(),
    });
  });

  child.on('error', (error) => {
    if (heartbeat) clearInterval(heartbeat);
    logger.write('child_error', {
      childPid: child.pid,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      health: processHealthForLog(),
    });
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (heartbeat) clearInterval(heartbeat);
    logger.write('child_exit', {
      childPid: child.pid,
      code,
      signal,
      health: processHealthForLog(),
    });
    if (signal) {
      for (const signalName of signalNames) process.removeAllListeners(signalName);
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
