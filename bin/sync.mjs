#!/usr/bin/env node
/**
 * sync.mjs — Create/refresh harness symlinks in the consumer's project.
 *
 * When job-forge is installed as an npm dependency, opencode / cursor /
 * claude code / codex need to see certain files at the *consumer project
 * root* (not inside node_modules). All of these are generated at publish
 * time by iso-harness from the harness's iso/ source; this script mirrors
 * them into the consumer's layout via symlinks.
 *
 * This script creates symlinks to the harness copies. Idempotent:
 *   - If the symlink already points to the harness, skip.
 *   - If a real file/dir exists at the target (user customized), warn and skip.
 *   - Otherwise create the symlink.
 *
 * Invoked automatically by `postinstall` in the package, or manually via
 * `npx job-forge sync`.
 *
 * Skipped when running inside the harness repo itself (detected by checking
 * whether the cwd contains the harness's own package.json with name=job-forge).
 */

import { existsSync, lstatSync, readlinkSync, symlinkSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import {
  loadMigrationConfig,
  parseJson,
  runMigrations,
} from '@razroo/iso-migrate';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

// Resolve the consumer's project root. During npm install, INIT_CWD is the
// directory from which npm install was run (the consumer project).
// Fallback to cwd.
const PROJECT_DIR = process.env.INIT_CWD || process.env.JOB_FORGE_PROJECT || process.cwd();

// Skip if we're inside the harness itself (avoid self-symlinking during dev).
const pkgJsonPath = join(PROJECT_DIR, 'package.json');
if (existsSync(pkgJsonPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    if (pkg.name === 'job-forge' && PROJECT_DIR === PKG_ROOT) {
      console.log('job-forge sync: skipping (running inside harness repo).');
      process.exit(0);
    }
  } catch { /* ignore */ }
}

if (PROJECT_DIR === PKG_ROOT) {
  console.log('job-forge sync: skipping (PROJECT_DIR == PKG_ROOT).');
  process.exit(0);
}

// ---------- Symlink plan ----------

// Each entry: { source (inside harness), target (inside consumer project) }
const links = [
  // Cursor: MCP servers, harness-level always-apply rule, per-agent
  // @-referenceable rules, and an iso-route advisory README.
  { src: '.cursor/mcp.json',               dst: '.cursor/mcp.json' },
  { src: '.cursor/rules/main.mdc',         dst: '.cursor/rules/main.mdc' },
  { src: '.cursor/rules/agent-general-free.mdc',  dst: '.cursor/rules/agent-general-free.mdc' },
  { src: '.cursor/rules/agent-general-paid.mdc',  dst: '.cursor/rules/agent-general-paid.mdc' },
  { src: '.cursor/rules/agent-glm-minimal.mdc',   dst: '.cursor/rules/agent-glm-minimal.mdc' },
  { src: '.cursor/iso-route.md',           dst: '.cursor/iso-route.md' },

  // Claude Code: MCP + per-agent subagent definitions + default-model
  // settings + iso-route resolved role map.
  { src: '.mcp.json',                      dst: '.mcp.json' },
  { src: '.claude/agents',                 dst: '.claude/agents' },
  { src: '.claude/settings.json',          dst: '.claude/settings.json' },
  { src: '.claude/iso-route.resolved.json', dst: '.claude/iso-route.resolved.json' },

  // Codex: config.toml contains MCP + model + [profiles.<role>] + provider
  // blocks (merged by iso-harness >=0.5.0 after iso-route writes first).
  { src: '.codex/config.toml',             dst: '.codex/config.toml' },

  // OpenCode: skill router + subagent definitions. Users can override any
  // single subagent by replacing its symlink with a local file.
  { src: '.opencode/instructions.md',      dst: '.opencode/instructions.md' },
  { src: '.opencode/skills/job-forge.md',  dst: '.opencode/skills/job-forge.md' },
  { src: '.opencode/agents',               dst: '.opencode/agents' },

  // Model policy (source of truth for iso-route). Consumers can edit and
  // re-run `npm run build:config` in their project to swap model picks.
  { src: 'models.yaml',                    dst: 'models.yaml' },

  // Shared content directories referenced by opencode.json instructions +
  // skill router (Read's modes/{mode}.md, etc).
  { src: 'modes',                          dst: 'modes' },
  { src: 'templates',                      dst: 'templates' },
  { src: 'batch/batch-prompt.md',          dst: 'batch/batch-prompt.md' },
  { src: 'batch/batch-runner.sh',          dst: 'batch/batch-runner.sh' },
  { src: 'batch/README.md',                dst: 'batch/README.md' },

  // Top-level instructions surfaced at project root with a `.harness`
  // suffix so the consumer's own AGENTS.md / CLAUDE.md stay fully personal.
  // The consumer's opencode.json / CLAUDE.md / AGENTS.md references the
  // .harness.md variants to pull in shared context.
  { src: 'AGENTS.md',                      dst: 'AGENTS.harness.md' },
  { src: 'CLAUDE.md',                      dst: 'CLAUDE.harness.md' },
];

let created = 0, skipped = 0, warned = 0;

for (const { src, dst } of links) {
  const absSrc = join(PKG_ROOT, src);
  const absDst = join(PROJECT_DIR, dst);

  if (!existsSync(absSrc)) {
    console.warn(`  skip: ${src} not found in harness`);
    continue;
  }

  // Ensure parent dir exists
  const parent = dirname(absDst);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

  // Check current state of target
  let stat = null;
  try { stat = lstatSync(absDst); } catch {}

  if (stat) {
    if (stat.isSymbolicLink()) {
      const current = readlinkSync(absDst);
      const expected = relative(dirname(absDst), absSrc);
      if (current === expected || resolve(dirname(absDst), current) === absSrc) {
        skipped++;
        continue;
      }
      // Points elsewhere — user may have pinned to a different version
      console.warn(`  warn: ${dst} is a symlink pointing elsewhere (${current}) — leaving alone`);
      warned++;
      continue;
    }
    // Real file/dir exists
    console.warn(`  warn: ${dst} already exists as a real file/dir — leaving alone`);
    warned++;
    continue;
  }

  // Create symlink (relative, so the project remains portable)
  const relSrc = relative(dirname(absDst), absSrc);
  const type = lstatSync(absSrc).isDirectory() ? 'dir' : 'file';
  try {
    symlinkSync(relSrc, absDst, type);
    console.log(`  linked: ${dst} → ${relSrc}`);
    created++;
  } catch (e) {
    console.error(`  error: failed to symlink ${dst}: ${e.message}`);
    warned++;
  }
}

try {
  if (ensureOpencodeInstructionRef()) {
    created++;
  }
} catch (error) {
  console.warn(`  warn: failed to patch opencode.json instructions: ${error instanceof Error ? error.message : String(error)}`);
  warned++;
}

try {
  const migrationResult = applyConsumerMigrations();
  if (migrationResult?.changeCount > 0) {
    console.log(`\njob-forge migrate: applied ${migrationResult.changeCount} change(s)`);
  }
} catch (error) {
  console.warn(`\n  warn: job-forge migrations skipped: ${error instanceof Error ? error.message : String(error)}`);
  warned++;
}

console.log(`\njob-forge sync: ${created} created, ${skipped} up-to-date, ${warned} warnings (project: ${PROJECT_DIR})`);

function ensureOpencodeInstructionRef() {
  const configPath = join(PROJECT_DIR, 'opencode.json');
  if (!existsSync(configPath)) return false;

  const raw = readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  const current = Array.isArray(config.instructions)
    ? config.instructions.slice()
    : config.instructions
      ? [config.instructions]
      : [];
  const required = '.opencode/instructions.md';
  if (current.includes(required)) return false;

  const next = current.slice();
  const anchor = next.indexOf('AGENTS.harness.md');
  if (anchor === -1) next.unshift(required);
  else next.splice(anchor + 1, 0, required);
  config.instructions = [...new Set(next)];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  updated: opencode.json instructions += ${required}`);
  return true;
}

function applyConsumerMigrations() {
  const skip = process.env.JOB_FORGE_SKIP_MIGRATIONS;
  if (skip === '1' || skip === 'true') return null;
  if (!existsSync(join(PROJECT_DIR, 'package.json'))) return null;

  const configPath = process.env.JOB_FORGE_MIGRATIONS_CONFIG || join(PKG_ROOT, 'templates', 'migrations.json');
  if (!existsSync(configPath)) return null;

  const config = loadMigrationConfig(parseJson(readFileSync(configPath, 'utf8'), configPath));
  return runMigrations(config, {
    root: PROJECT_DIR,
    dryRun: false,
  });
}
