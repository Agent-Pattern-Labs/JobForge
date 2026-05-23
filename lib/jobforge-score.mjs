import { readFileSync } from 'fs';
import { join } from 'path';
import {
  compareScoreResults,
  computeScore,
  evaluateGate,
  loadScoreConfig,
  parseJson,
  scoreResultId,
  verifyScoreResult,
} from '@agent-pattern-labs/iso-score';

export const SCORE_CONFIG_FILE = 'templates/score.json';
export const SCORE_PROFILE = 'jobforge';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeScoreConfigPath(projectDir = resolveProjectDir()) {
  return process.env.JOB_FORGE_SCORE_CONFIG || join(projectDir, SCORE_CONFIG_FILE);
}

export function readJobForgeScoreConfig(projectDir = resolveProjectDir()) {
  const path = jobForgeScoreConfigPath(projectDir);
  return loadScoreConfig(parseJson(readFileSync(path, 'utf8'), path));
}

export function readJsonFile(path) {
  return parseJson(readFileSync(path, 'utf8'), path);
}

export function normalizeJobForgeScoreInput(input) {
  if (!isObject(input)) throw new Error('score input must be a JSON object');

  if ('dimensions' in input) {
    return {
      ...input,
      profile: stringOr(input.profile, SCORE_PROFILE),
    };
  }

  if (!isObject(input.scores)) {
    throw new Error('score input must contain either dimensions or JobForge scores');
  }

  const dimensions = {};
  for (const [id, raw] of Object.entries(input.scores)) {
    if (!isObject(raw)) throw new Error(`scores.${id} must be a JSON object`);
    dimensions[id] = {
      score: Number(raw.score),
      note: stringOr(raw.rationale, stringOr(raw.note, '')),
      evidence: Array.isArray(raw.evidence) ? raw.evidence.filter((item) => typeof item === 'string') : [],
    };
  }

  return stripUndefined({
    subject: [input.company, input.role].filter((value) => typeof value === 'string' && value.length > 0).join(' - ') || undefined,
    profile: SCORE_PROFILE,
    dimensions,
    facts: stripUndefined({
      report_num: jsonScalar(input.report_num),
      company: jsonScalar(input.company),
      role: jsonScalar(input.role),
      archetype: jsonScalar(input.archetype),
      url: jsonScalar(input.url),
      date: jsonScalar(input.date),
    }),
    meta: stripUndefined({
      sourceShape: 'jobforge-score-json',
      expectedWeightedTotal: jsonScalar(input.weighted_total),
      recommendation: jsonScalar(input.recommendation),
      pdf_threshold_met: typeof input.pdf_threshold_met === 'boolean' ? input.pdf_threshold_met : undefined,
      draft_answers_threshold_met: typeof input.draft_answers_threshold_met === 'boolean' ? input.draft_answers_threshold_met : undefined,
    }),
  });
}

export function computeJobForgeScore(input, options = {}, projectDir = resolveProjectDir()) {
  const config = readJobForgeScoreConfig(projectDir);
  const normalized = normalizeJobForgeScoreInput(input);
  const result = computeScore(config, normalized, { profile: options.profile || normalized.profile || SCORE_PROFILE });
  return withJobForgeIssues(result, normalized);
}

export function checkJobForgeScore(input, options = {}, projectDir = resolveProjectDir()) {
  const result = computeJobForgeScore(input, options, projectDir);
  const errors = result.issues.filter((issue) => issue.severity === 'error').length;
  const warnings = result.issues.filter((issue) => issue.severity === 'warn').length;
  return {
    ok: errors === 0,
    errors,
    warnings,
    result,
    issues: result.issues,
  };
}

export function evaluateJobForgeScoreGate(input, options = {}, projectDir = resolveProjectDir()) {
  const config = readJobForgeScoreConfig(projectDir);
  const normalized = normalizeJobForgeScoreInput(input);
  const base = evaluateGate(config, normalized, {
    profile: options.profile || normalized.profile || SCORE_PROFILE,
    gate: options.gate,
  });
  const result = withJobForgeIssues(base.result, normalized);
  const errors = result.issues.some((issue) => issue.severity === 'error');
  const gate = errors
    ? { ...base.gate, pass: false, reason: `${base.gate.reason}; score has error issues` }
    : base.gate;
  return {
    ok: gate.pass,
    gate,
    result,
  };
}

export function verifyJobForgeScoreResult(result) {
  return verifyScoreResult(result);
}

export function compareJobForgeScores(leftInput, rightInput, options = {}, projectDir = resolveProjectDir()) {
  const left = computeJobForgeScore(leftInput, options, projectDir);
  const right = computeJobForgeScore(rightInput, options, projectDir);
  return compareScoreResults(left, right);
}

function withJobForgeIssues(result, normalized) {
  const issues = [...result.issues, ...jobForgeShapeIssues(result, normalized)];
  if (issues.length === result.issues.length) return result;
  const updated = { ...result, issues };
  updated.id = scoreResultId(updated);
  return updated;
}

function jobForgeShapeIssues(result, normalized) {
  if (normalized.meta?.sourceShape !== 'jobforge-score-json') return [];

  const issues = [];
  const expectedTotal = normalized.meta.expectedWeightedTotal;
  if (typeof expectedTotal === 'number' && Math.abs(round1(expectedTotal) - result.score) > 0.0001) {
    issues.push(error('weighted-total-mismatch', `weighted_total ${expectedTotal} does not match computed score ${result.score}`));
  }

  const expectedRecommendation = recommendationFor(result.score);
  if (normalized.meta.recommendation !== undefined && normalized.meta.recommendation !== expectedRecommendation) {
    issues.push(error('recommendation-mismatch', `recommendation must be "${expectedRecommendation}" for score ${result.score}`));
  }

  const expectedPdf = result.score >= 3;
  if (normalized.meta.pdf_threshold_met !== undefined && normalized.meta.pdf_threshold_met !== expectedPdf) {
    issues.push(error('pdf-threshold-mismatch', `pdf_threshold_met must be ${expectedPdf} for score ${result.score}`));
  }

  const expectedDraft = result.score >= 3.5;
  if (normalized.meta.draft_answers_threshold_met !== undefined && normalized.meta.draft_answers_threshold_met !== expectedDraft) {
    issues.push(error('draft-answers-threshold-mismatch', `draft_answers_threshold_met must be ${expectedDraft} for score ${result.score}`));
  }

  for (const dimension of result.dimensions) {
    if (!isHalfStep(dimension.score)) {
      issues.push(error('invalid-score-step', `dimension "${dimension.id}" score must use 0.5 increments`, dimension.id));
    }
    if (!dimension.note || dimension.note.trim().length === 0) {
      issues.push(error('missing-rationale', `dimension "${dimension.id}" rationale is required`, dimension.id));
    } else if (dimension.note.length > 80) {
      issues.push(error('rationale-too-long', `dimension "${dimension.id}" rationale must be <= 80 characters`, dimension.id));
    } else if (hasMarkdown(dimension.note)) {
      issues.push(error('rationale-markdown', `dimension "${dimension.id}" rationale must not contain markdown`, dimension.id));
    }
  }

  return issues;
}

function recommendationFor(score) {
  if (score >= 3.5) return 'apply';
  if (score >= 3) return 'apply_with_caveats';
  return 'skip';
}

function isHalfStep(value) {
  return Number.isFinite(value) && Number.isInteger(value * 2);
}

function hasMarkdown(value) {
  return /(`|\*\*|__|\[[^\]]+\]\(|^#{1,6}\s)/.test(value);
}

function error(code, message, dimension) {
  return stripUndefined({ severity: 'error', code, message, dimension });
}

function stringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function jsonScalar(value) {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
