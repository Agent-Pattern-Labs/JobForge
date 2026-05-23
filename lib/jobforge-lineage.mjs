import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import {
  checkLineage,
  emptyLineageGraph,
  loadLineageGraph,
  parseJson,
  recordLineage,
  verifyLineageGraph,
} from '@agent-pattern-labs/iso-lineage';

export const LINEAGE_FILE = '.jobforge-lineage.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeLineagePath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_LINEAGE || join(projectDir, LINEAGE_FILE);
}

export function lineageExists(projectDir = resolveProjectDir()) {
  return existsSync(jobForgeLineagePath(projectDir));
}

export function readJobForgeLineage(projectDir = resolveProjectDir()) {
  const path = jobForgeLineagePath(projectDir);
  return loadLineageGraph(parseJson(readFileSync(path, 'utf8'), path));
}

export function readJobForgeLineageOrEmpty(projectDir = resolveProjectDir()) {
  return lineageExists(projectDir) ? readJobForgeLineage(projectDir) : emptyLineageGraph();
}

export function writeJobForgeLineage(graph, options = {}, projectDir = resolveProjectDir()) {
  const out = options.out || jobForgeLineagePath(projectDir);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  return out;
}

export function recordJobForgeLineage(options = {}, projectDir = resolveProjectDir()) {
  const graph = options.graph || readJobForgeLineageOrEmpty(projectDir);
  const updated = recordLineage(graph, {
    root: projectDir,
    artifact: required(options.artifact, '--artifact'),
    inputs: options.inputs || [],
    optionalInputs: options.optionalInputs || [],
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.command ? { command: options.command } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  });
  const out = writeJobForgeLineage(updated, { out: options.out }, projectDir);
  const artifact = storedPath(projectDir, options.artifact);
  const record = updated.records.find((item) => item.artifact.path === artifact);
  if (!record) throw new Error(`${artifact} was not recorded`);
  return { graph: updated, record, out };
}

export function checkJobForgeLineage(options = {}, projectDir = resolveProjectDir()) {
  const graph = options.graph || readJobForgeLineage(projectDir);
  return checkLineage(graph, {
    root: projectDir,
    ...(options.artifact ? { artifact: options.artifact } : {}),
  });
}

export function staleJobForgeLineage(options = {}, projectDir = resolveProjectDir()) {
  return checkJobForgeLineage(options, projectDir);
}

export function verifyJobForgeLineage(options = {}, projectDir = resolveProjectDir()) {
  const graph = options.graph || readJobForgeLineage(projectDir);
  return verifyLineageGraph(graph);
}

export function jobForgeLineageSummary(projectDir = resolveProjectDir()) {
  if (!lineageExists(projectDir)) {
    return {
      path: jobForgeLineagePath(projectDir),
      exists: false,
      records: 0,
      current: 0,
      stale: 0,
      missing: 0,
    };
  }
  const graph = readJobForgeLineage(projectDir);
  const result = checkJobForgeLineage({ graph }, projectDir);
  return {
    path: jobForgeLineagePath(projectDir),
    exists: true,
    id: graph.id,
    records: graph.records.length,
    current: result.current,
    stale: result.stale,
    missing: result.missing,
    ok: result.ok,
  };
}

export function normalizeJobForgeLineageArtifact(projectDir = resolveProjectDir(), artifact = '') {
  return storedPath(projectDir, artifact);
}

function required(value, flag) {
  if (!value) throw new Error(`lineage:record requires ${flag}`);
  return value;
}

function storedPath(root, path) {
  const absRoot = resolve(root);
  const abs = resolve(absRoot, path);
  const rel = relative(absRoot, abs);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return normalizePath(rel);
  return normalizePath(abs);
}

function normalizePath(path) {
  return path.split(sep).join('/');
}
