import { existsSync } from 'fs';
import { join } from 'path';
import {
  cacheKey,
  hasCacheEntry,
  listCacheEntries,
  pruneCache,
  putCacheEntry,
  readCacheContent,
  resolveCacheDir,
  verifyCache,
} from '@agent-pattern-labs/iso-cache';
import { canonicalizeJobForgeUrl } from './jobforge-canon.mjs';

export const CACHE_DIR = '.jobforge-cache';
export const JD_CACHE_NAMESPACE = 'jobforge.jd';
export const JD_CACHE_VERSION = '1';
export const JD_CACHE_KIND = 'jd';
export const DEFAULT_JD_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeCacheDir(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_CACHE || join(projectDir, CACHE_DIR);
}

export function jobForgeCacheSummary(projectDir = resolveProjectDir()) {
  const root = resolveCacheDir(jobForgeCacheDir(projectDir));
  const entries = listCacheEntries(root, { includeExpired: true });
  return {
    root,
    exists: existsSync(root),
    entries: entries.length,
    active: entries.filter((entry) => !entry.expiresAt || new Date(entry.expiresAt).getTime() > Date.now()).length,
  };
}

export function jobDescriptionCacheKey(url) {
  return cacheKey({
    namespace: JD_CACHE_NAMESPACE,
    version: JD_CACHE_VERSION,
    parts: { url: normalizeJobUrl(url) },
  });
}

export function putJobDescriptionCache(url, content, options = {}, projectDir = resolveProjectDir()) {
  const normalizedUrl = normalizeJobUrl(url);
  return putCacheEntry(
    jobForgeCacheDir(projectDir),
    jobDescriptionCacheKey(normalizedUrl),
    content,
    {
      kind: options.kind || JD_CACHE_KIND,
      contentType: options.contentType || 'text/markdown',
      ttlMs: options.expiresAt ? undefined : (options.ttlMs ?? DEFAULT_JD_TTL_MS),
      expiresAt: options.expiresAt,
      metadata: {
        url: normalizedUrl,
        source: options.source || 'job-forge',
        ...(options.metadata || {}),
      },
    },
  );
}

export function readJobDescriptionCache(url, options = {}, projectDir = resolveProjectDir()) {
  return readCacheContent(jobForgeCacheDir(projectDir), jobDescriptionCacheKey(url), options);
}

export function hasJobDescriptionCache(url, options = {}, projectDir = resolveProjectDir()) {
  return hasCacheEntry(jobForgeCacheDir(projectDir), jobDescriptionCacheKey(url), options);
}

export function readJobForgeCache(key, options = {}, projectDir = resolveProjectDir()) {
  return readCacheContent(jobForgeCacheDir(projectDir), key, options);
}

export function putJobForgeCache(key, content, options = {}, projectDir = resolveProjectDir()) {
  return putCacheEntry(jobForgeCacheDir(projectDir), key, content, options);
}

export function listJobForgeCache(options = {}, projectDir = resolveProjectDir()) {
  return listCacheEntries(jobForgeCacheDir(projectDir), options);
}

export function verifyJobForgeCache(projectDir = resolveProjectDir()) {
  return verifyCache(jobForgeCacheDir(projectDir));
}

export function pruneJobForgeCache(options = {}, projectDir = resolveProjectDir()) {
  return pruneCache(jobForgeCacheDir(projectDir), options);
}

export function normalizeJobUrl(url) {
  const text = String(url || '').trim();
  if (!text) throw new Error('url is required');
  try {
    return canonicalizeJobForgeUrl(text).canonical;
  } catch {
    try {
      const parsed = new URL(text);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return text;
    }
  }
}
