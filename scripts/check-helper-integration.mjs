#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');

const pkg = readJson('package.json');
const migrations = readJson('templates/migrations.json');
const bin = readText('bin/job-forge.mjs');
const create = readText('bin/create-job-forge.mjs');
const reference = readText('modes/reference-local-helpers.md');
const rootIgnore = readText('.gitignore');
const architecture = readText('docs/ARCHITECTURE.md');

const migrationScripts = migrationValue('jobforge-managed-scripts', '/scripts');
const migrationIgnores = migrationValue('jobforge-generated-ignores');

const groups = [
  helper('trace', '@agent-pattern-labs/iso-trace', ['list', 'stats', 'show']),
  helper('telemetry', '', ['list', 'status', 'show', 'watch']),
  helper('guard', '@agent-pattern-labs/iso-guard', ['audit', 'explain'], { template: 'templates/guards/jobforge-baseline.yaml' }),
  helper('ledger', '@agent-pattern-labs/iso-ledger', ['status', 'rebuild', 'verify', 'has', 'query'], { artifacts: ['.jobforge-ledger/'] }),
  helper('capabilities', '@agent-pattern-labs/iso-capabilities', ['list', 'explain', 'check', 'render'], { template: 'templates/capabilities.json', migrated: true }),
  helper('context', '@agent-pattern-labs/iso-context', ['list', 'explain', 'plan', 'check', 'render'], { template: 'templates/context.json', migrated: true }),
  helper('cache', '@agent-pattern-labs/iso-cache', ['key', 'has', 'get', 'put', 'status', 'list', 'verify', 'prune'], { artifacts: ['.jobforge-cache/'], migrated: true }),
  helper('index', '@agent-pattern-labs/iso-index', ['build', 'status', 'query', 'has', 'verify', 'explain'], { template: 'templates/index.json', artifacts: ['.jobforge-index.json'], migrated: true }),
  helper('facts', '@agent-pattern-labs/iso-facts', ['build', 'status', 'verify', 'check', 'has', 'query', 'explain'], { template: 'templates/facts.json', artifacts: ['.jobforge-facts.json'], migrated: true }),
  helper('score', '@agent-pattern-labs/iso-score', ['compute', 'verify', 'check', 'gate', 'compare', 'explain'], { template: 'templates/score.json', migrated: true }),
  helper('canon', '@agent-pattern-labs/iso-canon', ['normalize', 'key', 'compare', 'explain'], { template: 'templates/canon.json', migrated: true }),
  helper('preflight', '@agent-pattern-labs/iso-preflight', ['plan', 'check', 'explain'], { template: 'templates/preflight.json', artifacts: ['batch/preflight-candidates.json', 'batch/preflight-plan.json'], migrated: true }),
  helper('postflight', '@agent-pattern-labs/iso-postflight', ['status', 'check', 'explain'], { template: 'templates/postflight.json', artifacts: ['batch/postflight-outcomes.json'], migrated: true }),
  helper('timeline', '@agent-pattern-labs/iso-timeline', ['status', 'build', 'plan', 'due', 'check', 'verify', 'explain'], { template: 'templates/timeline.json', artifacts: ['.jobforge-timeline.json', '.jobforge-timeline-events.jsonl', 'data/timeline-events.jsonl'], migrated: true }),
  helper('prioritize', '@agent-pattern-labs/iso-prioritize', ['status', 'items', 'build', 'rank', 'select', 'check', 'verify', 'explain'], { template: 'templates/prioritize.json', artifacts: ['.jobforge-prioritize.json', '.jobforge-prioritize-items.json'], migrated: true }),
  helper('lineage', '@agent-pattern-labs/iso-lineage', ['status', 'record', 'check', 'stale', 'verify', 'explain'], { artifacts: ['.jobforge-lineage.json'], migrated: true }),
  helper('redact', '@agent-pattern-labs/iso-redact', ['scan', 'verify', 'apply', 'explain'], { template: 'templates/redact.json', artifacts: ['.jobforge-redacted/'], migrated: true }),
  helper('migrate', '@agent-pattern-labs/iso-migrate', ['plan', 'apply', 'check', 'explain'], { template: 'templates/migrations.json', migrated: true }),
];

const packageOnly = [
  { id: 'contract', pkg: '@agent-pattern-labs/iso-contract', template: 'templates/contracts.json', needles: ['templates/contracts.json', 'tracker-line'] },
  { id: 'orchestrator', pkg: '@agent-pattern-labs/iso-orchestrator', file: 'scripts/batch-orchestrator.mjs', needles: ['iso-orchestrator'] },
];

const errors = [];

for (const group of groups) {
  if (group.pkg) hasDependency(group.pkg, group.id);
  if (group.template) fileExists(group.template, group.id);
  fileExists(`scripts/${group.id}.mjs`, group.id);

  if (!bin.includes(`const ${group.id}Aliases`)) {
    errors.push(`${group.id}: missing ${group.id}Aliases in bin/job-forge.mjs`);
  }
  if (!bin.includes(`scripts/${group.id}.mjs`)) {
    errors.push(`${group.id}: bin/job-forge.mjs does not dispatch scripts/${group.id}.mjs`);
  }
  if (!reference.includes(`job-forge ${group.id}:*`)) {
    errors.push(`${group.id}: modes/reference-local-helpers.md does not mention job-forge ${group.id}:*`);
  }
  if (!architecture.includes(`scripts/${group.id}.mjs`)) {
    errors.push(`${group.id}: docs/ARCHITECTURE.md script table does not mention scripts/${group.id}.mjs`);
  }

  for (const alias of group.aliases) {
    if (!pkg.scripts?.[alias]) errors.push(`${group.id}: package.json missing script ${alias}`);
    if (!createIncludesScript(alias)) errors.push(`${group.id}: create-job-forge missing script ${alias}`);
    if (group.migrated && migrationScripts?.[alias] !== `job-forge ${alias}`) {
      errors.push(`${group.id}: migrations.json missing managed script ${alias}`);
    }
  }

  for (const artifact of group.artifacts) {
    if (!rootIgnore.includes(artifact)) errors.push(`${group.id}: .gitignore missing ${artifact}`);
    if (!create.includes(artifact)) errors.push(`${group.id}: create-job-forge .gitignore template missing ${artifact}`);
    if (group.migrated && !migrationIgnores.includes(artifact)) {
      errors.push(`${group.id}: migrations.json generated ignores missing ${artifact}`);
    }
  }
}

for (const item of packageOnly) {
  hasDependency(item.pkg, item.id);
  if (item.template) fileExists(item.template, item.id);
  if (item.file) fileExists(item.file, item.id);
  for (const needle of item.needles || []) {
    if (!reference.includes(needle) && !architecture.includes(needle)) {
      errors.push(`${item.id}: expected documentation needle "${needle}"`);
    }
  }
}

if (/\[D(?:9|1\d|2[0-9])\]/.test(readText('iso/instructions.md'))) {
  errors.push('iso/instructions.md still has detailed helper D-rules; keep helper details in modes/reference-local-helpers.md');
}

if (errors.length) {
  console.error('JobForge helper integration check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`JobForge helper integration passed (${groups.length + packageOnly.length} helpers).`);

function helper(id, pkg, commands, options = {}) {
  return {
    id,
    pkg,
    aliases: commands.map((command) => `${id}:${command}`),
    template: options.template || '',
    artifacts: options.artifacts || [],
    migrated: Boolean(options.migrated),
  };
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(root, path), 'utf8');
}

function fileExists(path, id) {
  if (!existsSync(join(root, path))) errors.push(`${id}: missing ${path}`);
}

function hasDependency(name, id) {
  if (!pkg.dependencies?.[name] && !pkg.devDependencies?.[name]) {
    errors.push(`${id}: package.json missing dependency ${name}`);
  }
}

function migrationValue(id, pointer = '') {
  const migration = migrations.migrations?.find((item) => item.id === id);
  const operation = migration?.operations?.find((item) => pointer ? item.pointer === pointer : item.type === 'ensure-lines');
  return pointer ? operation?.value : operation?.lines || [];
}

function createIncludesScript(alias) {
  return create.includes(`'${alias}': 'job-forge ${alias}'`) ||
    create.includes(`"${alias}": "job-forge ${alias}"`);
}
