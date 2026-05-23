import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  contractNames,
  explainContract,
  formatIssue,
  getContract,
  loadContractCatalog,
  parseRecord,
  renderRecord,
  validateRecord,
} from '@agent-pattern-labs/iso-contract';
import { DEFAULT_STATES, loadCanonicalStates } from './canonical-states.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
export const CONTRACTS_RELATIVE_PATH = 'templates/contracts.json';

export function resolveProjectDir(projectDir = process.env.JOB_FORGE_PROJECT || process.cwd()) {
  return projectDir;
}

export function jobForgeContractsPath(projectDir = resolveProjectDir()) {
  const projectPath = join(projectDir, CONTRACTS_RELATIVE_PATH);
  if (existsSync(projectPath)) return projectPath;
  return join(PKG_ROOT, CONTRACTS_RELATIVE_PATH);
}

export function loadJobForgeContractCatalog(projectDir = resolveProjectDir()) {
  const path = jobForgeContractsPath(projectDir);
  const input = JSON.parse(readFileSync(path, 'utf-8'));
  applyCanonicalStatusValues(input, projectDir);
  return loadContractCatalog(input);
}

export function listJobForgeContracts(projectDir = resolveProjectDir()) {
  return contractNames(loadJobForgeContractCatalog(projectDir));
}

export function getJobForgeContract(name, projectDir = resolveProjectDir()) {
  return getContract(loadJobForgeContractCatalog(projectDir), name);
}

export function explainJobForgeContract(name, projectDir = resolveProjectDir()) {
  return explainContract(getJobForgeContract(name, projectDir));
}

export function getTrackerRowContract(projectDir = resolveProjectDir()) {
  return getJobForgeContract('jobforge.tracker-row', projectDir);
}

export function validateTrackerRow(record, options = {}) {
  const projectDir = resolveProjectDir(options.projectDir);
  const normalized = normalizeTrackerRowRecord(record, options);
  const contract = options.allowMissingReport
    ? trackerRowContractWithOptionalReport(getTrackerRowContract(projectDir))
    : getTrackerRowContract(projectDir);
  return validateRecord(contract, normalized);
}

export function parseTrackerRow(text, formatName = 'tsv', options = {}) {
  const projectDir = resolveProjectDir(options.projectDir);
  const contract = getTrackerRowContract(projectDir);
  const parsed = parseRecord(contract, text, formatName);
  const normalized = normalizeTrackerRowRecord(parsed.record, options);
  const validation = validateRecord(contract, normalized);
  return { record: validation.record, validation, format: formatName };
}

export function renderTrackerRow(record, formatName = 'tsv', options = {}) {
  const projectDir = resolveProjectDir(options.projectDir);
  const normalized = normalizeTrackerRowRecord(record, options);
  return renderRecord(getTrackerRowContract(projectDir), normalized, formatName);
}

export function formatContractIssues(result) {
  return result.issues.map(formatIssue).join('; ');
}

export function canonicalStatusValues(projectDir = resolveProjectDir()) {
  return loadCanonicalStates(projectDir) || loadCanonicalStates(PKG_ROOT) || DEFAULT_STATES;
}

function normalizeTrackerRowRecord(record, options = {}) {
  const out = { ...record };
  if (out.status !== undefined && options.normalizeStatus) {
    out.status = options.normalizeStatus(String(out.status));
  }
  return out;
}

function trackerRowContractWithOptionalReport(contract) {
  return {
    ...contract,
    fields: contract.fields.map((field) => (
      field.name === 'report' ? { ...field, required: false } : field
    )),
  };
}

function applyCanonicalStatusValues(input, projectDir) {
  const statuses = canonicalStatusValues(projectDir);
  for (const contract of input.contracts || []) {
    if (contract.name !== 'jobforge.tracker-row') continue;
    const field = (contract.fields || []).find((item) => item.name === 'status');
    if (field) field.values = statuses;
  }
}
