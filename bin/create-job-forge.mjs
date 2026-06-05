#!/usr/bin/env node
/**
 * create-job-forge — Scaffold a new job-forge personal project.
 *
 * Usage:
 *   npx create-job-forge <dir>            # scaffold into <dir>
 *   npx create-job-forge .                # scaffold into cwd
 *   npx create-job-forge <dir> --force    # overwrite existing files
 *
 * Creates the minimum a consumer needs:
 *   package.json           with job-forge as a dependency
 *   opencode.json          thin config enabling MCPs + states.yml instruction
 *   config/profile.yml     copied from profile.example.yml
 *   cv.md                  stub for the user to fill in
 *   portals.yml            copied from templates/portals.example.yml
 *   data/                  empty dir for tracker/pipeline/scan history
 *   reports/               empty dir for generated reports
 *   .gitignore             excludes personal data from sharing
 *   README.md              setup instructions
 *
 * After scaffold, prompts the user to run `npm install`, which triggers the
 * postinstall symlink sync.
 */

import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'fs';
import { dirname, join, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const HELP = args.includes('--help') || args.includes('-h');
const positional = args.filter(a => !a.startsWith('--'));

if (HELP || positional.length === 0) {
  console.log(`create-job-forge — scaffold a new job-forge personal project

Usage:
  npx create-job-forge <dir> [--force]

Examples:
  npx create-job-forge my-job-search
  npx create-job-forge .
  npx create-job-forge existing-project --force

Flags:
  --force   Overwrite files that already exist
  --help    Show this message

After scaffolding, cd into the directory and run:
  npm install                # pulls the harness and creates symlinks
  # Edit cv.md, config/profile.yml, portals.yml with your personal data
  opencode                   # start the TUI
`);
  process.exit(HELP ? 0 : 1);
}

const targetDir = resolve(positional[0]);
const name = basename(targetDir);

console.log(`\nScaffolding job-forge project in ${targetDir}\n`);

if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

function write(rel, content, { overwrite = FORCE } = {}) {
  const abs = join(targetDir, rel);
  if (existsSync(abs) && !overwrite) {
    console.log(`  skip: ${rel} (exists)`);
    return;
  }
  const parent = dirname(abs);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  console.log(`  create: ${rel}`);
}

function copy(srcRel, dstRel, { overwrite = FORCE } = {}) {
  const abs = join(targetDir, dstRel);
  const src = join(PKG_ROOT, srcRel);
  if (!existsSync(src)) {
    console.log(`  skip: ${dstRel} (template ${srcRel} not found)`);
    return;
  }
  if (existsSync(abs) && !overwrite) {
    console.log(`  skip: ${dstRel} (exists)`);
    return;
  }
  const parent = dirname(abs);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  copyFileSync(src, abs);
  console.log(`  create: ${dstRel}`);
}

// ---------- package.json ----------

const consumerPkg = {
  name,
  version: '0.1.0',
  private: true,
  scripts: {
    sync: 'job-forge sync',
    merge: 'job-forge merge',
    verify: 'job-forge verify',
    dedup: 'job-forge dedup',
    normalize: 'job-forge normalize',
    pdf: 'job-forge pdf',
    'sync-check': 'job-forge sync-check',
    tokens: 'job-forge tokens',
    'tokens:today': 'job-forge tokens --days 1',
    'tokens:log': 'job-forge tokens --days 1 --append',
    'portal:snapshot': 'job-forge portal:snapshot',
    'portal:form-schema': 'job-forge portal:form-schema',
    'portal:explain': 'job-forge portal:explain',
    'trace:list': 'job-forge trace:list',
    'trace:stats': 'job-forge trace:stats',
    'trace:show': 'job-forge trace:show',
    'telemetry:list': 'job-forge telemetry:list',
    'telemetry:status': 'job-forge telemetry:status',
    'telemetry:show': 'job-forge telemetry:show',
    'telemetry:watch': 'job-forge telemetry:watch',
    'guard:audit': 'job-forge guard:audit',
    'guard:explain': 'job-forge guard:explain',
    'ledger:status': 'job-forge ledger:status',
    'ledger:rebuild': 'job-forge ledger:rebuild',
    'ledger:verify': 'job-forge ledger:verify',
    'ledger:has': 'job-forge ledger:has',
    'ledger:query': 'job-forge ledger:query',
    'capabilities:list': 'job-forge capabilities:list',
    'capabilities:explain': 'job-forge capabilities:explain',
    'capabilities:check': 'job-forge capabilities:check',
    'capabilities:render': 'job-forge capabilities:render',
    'context:list': 'job-forge context:list',
    'context:explain': 'job-forge context:explain',
    'context:plan': 'job-forge context:plan',
    'context:check': 'job-forge context:check',
    'context:render': 'job-forge context:render',
    'cache:key': 'job-forge cache:key',
    'cache:has': 'job-forge cache:has',
    'cache:get': 'job-forge cache:get',
    'cache:put': 'job-forge cache:put',
    'cache:status': 'job-forge cache:status',
    'cache:list': 'job-forge cache:list',
    'cache:verify': 'job-forge cache:verify',
    'cache:prune': 'job-forge cache:prune',
    'index:build': 'job-forge index:build',
    'index:status': 'job-forge index:status',
    'index:verify': 'job-forge index:verify',
    'index:has': 'job-forge index:has',
    'index:query': 'job-forge index:query',
    'index:explain': 'job-forge index:explain',
    'facts:build': 'job-forge facts:build',
    'facts:status': 'job-forge facts:status',
    'facts:verify': 'job-forge facts:verify',
    'facts:check': 'job-forge facts:check',
    'facts:has': 'job-forge facts:has',
    'facts:query': 'job-forge facts:query',
    'facts:explain': 'job-forge facts:explain',
    'score:compute': 'job-forge score:compute',
    'score:verify': 'job-forge score:verify',
    'score:check': 'job-forge score:check',
    'score:gate': 'job-forge score:gate',
    'score:compare': 'job-forge score:compare',
    'score:explain': 'job-forge score:explain',
    'canon:normalize': 'job-forge canon:normalize',
    'canon:key': 'job-forge canon:key',
    'canon:compare': 'job-forge canon:compare',
    'canon:explain': 'job-forge canon:explain',
    'preflight:plan': 'job-forge preflight:plan',
    'preflight:check': 'job-forge preflight:check',
    'preflight:explain': 'job-forge preflight:explain',
    'postflight:status': 'job-forge postflight:status',
    'postflight:check': 'job-forge postflight:check',
    'postflight:explain': 'job-forge postflight:explain',
    'timeline:status': 'job-forge timeline:status',
    'timeline:build': 'job-forge timeline:build',
    'timeline:plan': 'job-forge timeline:plan',
    'timeline:due': 'job-forge timeline:due',
    'timeline:check': 'job-forge timeline:check',
    'timeline:verify': 'job-forge timeline:verify',
    'timeline:explain': 'job-forge timeline:explain',
    'prioritize:status': 'job-forge prioritize:status',
    'prioritize:items': 'job-forge prioritize:items',
    'prioritize:build': 'job-forge prioritize:build',
    'prioritize:rank': 'job-forge prioritize:rank',
    'prioritize:select': 'job-forge prioritize:select',
    'prioritize:check': 'job-forge prioritize:check',
    'prioritize:verify': 'job-forge prioritize:verify',
    'prioritize:explain': 'job-forge prioritize:explain',
    'lineage:status': 'job-forge lineage:status',
    'lineage:record': 'job-forge lineage:record',
    'lineage:check': 'job-forge lineage:check',
    'lineage:stale': 'job-forge lineage:stale',
    'lineage:verify': 'job-forge lineage:verify',
    'lineage:explain': 'job-forge lineage:explain',
    'redact:scan': 'job-forge redact:scan',
    'redact:verify': 'job-forge redact:verify',
    'redact:apply': 'job-forge redact:apply',
    'redact:explain': 'job-forge redact:explain',
    'receipts:create': 'job-forge receipts:create',
    'receipts:capture': 'job-forge receipts:capture',
    'receipts:verify': 'job-forge receipts:verify',
    'receipts:inspect': 'job-forge receipts:inspect',
    'receipts:redact': 'job-forge receipts:redact',
    'receipts:path': 'job-forge receipts:path',
    'migrate:plan': 'job-forge migrate:plan',
    'migrate:apply': 'job-forge migrate:apply',
    'migrate:check': 'job-forge migrate:check',
    'migrate:explain': 'job-forge migrate:explain',
    // One command to pull the latest harness and any locally-pinned MCP
    // packages. npm update is a no-op on packages not in package.json, so
    // listing @razroo/gmail-mcp + @geometra/mcp is safe for consumers that
    // invoke them via npx without local package pins.
    'update-harness': 'npm update job-forge @razroo/gmail-mcp @geometra/mcp && job-forge sync && node -e "console.log(\'✅ harness at\', require(\'./package-lock.json\').packages[\'node_modules/job-forge\'].resolved)"',
  },
  dependencies: {
    'job-forge': '^2.0.0',
  },
  engines: { node: '>=20.6.0' },
};
write('package.json', JSON.stringify(consumerPkg, null, 2) + '\n');

// ---------- opencode.json ----------

const opencodeCfg = {
  $schema: 'https://opencode.ai/config.json',
  // Keep the top-level orchestrator on JobForge's low-cost paid OpenCode
  // route. Subagents pin the same route in .opencode/agents/*.md so job
  // applications do not fall through overloaded free OpenRouter pools.
  model: 'opencode-go/deepseek-v4-flash',
  small_model: 'opencode-go/deepseek-v4-flash',
  // Files listed here load into every session's cached prefix, so they're
  // cached once (on Anthropic) instead of Read-as-tool-call on every session.
  //   AGENTS.harness.md → symlink to node_modules/job-forge/AGENTS.md (harness rules)
  //   .opencode/instructions.md → symlink to node_modules/job-forge/.opencode/instructions.md
  //                              (OpenCode-only harness addendum)
  //   modes/_shared.md  → symlink into node_modules; canonical scoring model
  //   cv.md             → candidate's CV (personal, created during onboarding)
  //   templates/states.yml → canonical application states (validated by merge-tracker.mjs)
  // Ordering matters for cache prefix stability: put most-stable files first.
  instructions: [
    'AGENTS.harness.md',
    '.opencode/instructions.md',
    'templates/states.yml',
    'modes/_shared.md',
    'cv.md',
  ],
  mcp: {
    geometra: {
      type: 'local',
      command: ['npx', '--no-install', 'job-forge', 'mcp:geometra'],
      environment: {
        GEOMETRA_STEALTH: '0',
        GEOMETRA_BROWSER: 'stock',
      },
      enabled: true,
    },
    gmail: {
      type: 'local',
      command: ['npx', '-y', '@razroo/gmail-mcp'],
      enabled: true,
      // @razroo/gmail-mcp >=1.7.9 honors DISABLE_HTTP=true to skip its
      // Streamable HTTP listener. Opencode uses stdio transport, so
      // the HTTP server is unused and its port (default 3000) only
      // causes EADDRINUSE conflicts with other local processes.
      environment: { DISABLE_HTTP: 'true' },
    },
  },
  // Restrict the primary orchestrator to dispatching only the three harness
  // subagents. Prevents accidental self-calls or unregistered agents.
  // Override locally in opencode.json if you add project-specific agents.
  permission: {
    task: {
      'general-free': 'allow',
      'general-paid': 'allow',
      'glm-minimal': 'allow',
    },
  },
  // Tool-surface trimming — opencode ships every MCP tool's schema in every
  // request unless disabled. The harness uses ~10 of Geometra's ~30 tools
  // and ~4 of Gmail's. Disable all at the root level and re-enable the
  // specific ones needed per agent in .opencode/agents/<name>.md. Saves
  // ~2-3K tokens per request in the orchestrator's context window.
  tools: {
    'geometra_*': false,
    'gmail_*': false,
  },
};
write('opencode.json', JSON.stringify(opencodeCfg, null, 2) + '\n');

// ---------- AGENTS.md (auto-loaded by opencode on every session) ----------
//
// This file is intentionally thin. The harness's operational rules (Session
// Hygiene, OTP handling, batch best practices, scoring) live in
// node_modules/job-forge/AGENTS.md and load via opencode.json:instructions →
// AGENTS.harness.md (symlink created by sync.mjs). Keep *this* file for
// personal overrides.

write('AGENTS.md', `# AGENTS — ${name}

Personal job search project using the [job-forge](https://github.com/Agent-Pattern-Labs/JobForge) harness. The harness lives in \`node_modules/job-forge/\`; most files you need are accessible through symlinks at the project root.

**How context loads in this project:** opencode auto-loads *this* file as the project-root AGENTS.md, then loads \`AGENTS.harness.md\` plus \`.opencode/instructions.md\` via \`opencode.json:instructions\`. \`AGENTS.harness.md\` is the shared cross-harness contract; \`.opencode/instructions.md\` is reserved for OpenCode-only addenda. Keep *this* file for personal overrides — anything you want to diverge from or add on top.

---

## Project Layout — start here

Before doing any work, remember where things live in *this* project:

| What | Where | Notes |
|------|-------|-------|
| Application tracker | \`data/applications/YYYY-MM-DD.md\` | **Day-based**. One markdown table per day. **There is NO \`applications.md\` — do not look for it.** |
| Inbox of pending URLs | \`data/pipeline.md\` | The queue for \`/job-forge pipeline\` |
| Scanner dedup history | \`data/scan-history.tsv\` | Only touch in \`/job-forge scan\` |
| Local workflow ledger | \`.jobforge-ledger/events.jsonl\` | Deterministic append-only state; use \`job-forge ledger:*\` |
| Local artifact index | \`.jobforge-index.json\` | Deterministic file/line lookup; use \`job-forge index:*\` |
| Local fact set | \`.jobforge-facts.json\` | Deterministic source-backed facts; use \`job-forge facts:*\` |
| Local priority queue | \`.jobforge-prioritize.json\` | Deterministic next-action ranking; use \`job-forge prioritize:*\` |
| Artifact lineage | \`.jobforge-lineage.json\` | Stale report/PDF detection; use \`job-forge lineage:*\` |
| Identity canonicalization | \`templates/canon.json\` | Stable URL/company/role keys; use \`job-forge canon:*\` |
| Dispatch preflight policy | \`templates/preflight.json\` | Safe apply rounds/gates; use \`job-forge preflight:*\` |
| Dispatch postflight policy | \`templates/postflight.json\` | Safe apply settlement; use \`job-forge postflight:*\` |
| Consumer migrations | \`templates/migrations.json\` | Safe script/gitignore upgrades; use \`job-forge migrate:*\` |
| Evidence receipts | \`.jobforge-receipts/\` | Portable verifiable work receipts; use \`job-forge receipts:*\` |
| Scanner config | \`portals.yml\` (project root) | Company configs |
| Profile / identity | \`config/profile.yml\` | Candidate name, email, target roles |
| CV | \`cv.md\` (project root) | Markdown, source of truth |
| Proof points | \`article-digest.md\` | Optional, at project root |
| Skill modes | \`modes/\` (symlink) | \`.md\` files, one per skill. Read \`modes/_shared.md\` for scoring and \`modes/{mode}.md\` for the mode. |
| Skill router | \`.opencode/skills/job-forge.md\` (symlink) | How \`/job-forge <mode>\` dispatches |
| Batch prompt template | \`batch/batch-prompt.md\` (symlink) | Used by \`batch/batch-runner.sh\` |
| Batch runner | \`batch/batch-runner.sh\` (symlink) | Parallel \`opencode run\` orchestrator |
| Batch input / state | \`batch/batch-input.tsv\`, \`batch/batch-state.tsv\` | Personal data |
| Generated reports | \`reports/{###}-{company-slug}-{YYYY-MM-DD}.md\` | Gitignored |
| Generated PDFs | \`output/\` | Gitignored |
| Templates | \`templates/\` (symlink) | \`cv-template.html\`, \`portals.example.yml\`, \`states.yml\`, runtime policies |
| Harness rules | \`AGENTS.harness.md\` (symlink) | Shared operational guide, loaded via \`opencode.json:instructions\` |
| Harness source | \`node_modules/job-forge/\` | Read this for harness internals |

**\`modes/\`, \`templates/\`, \`.opencode/skills/job-forge.md\`, \`batch/batch-prompt.md\`, \`batch/batch-runner.sh\`, \`batch/README.md\`, and \`AGENTS.harness.md\` are all symlinks into \`node_modules/job-forge/\`.** Symlinks behave like real files for Read/Glob/Grep — no need to chase them into \`node_modules\` unless you want to see their real path.

When the user says something like "apply to N jobs", the candidates to apply to are either:
1. Entries in \`data/applications/*.md\` with status **Evaluated** (already scored, ready to submit)
2. URLs in \`data/pipeline.md\` that haven't been evaluated yet

Check both. Read today's day file (\`data/applications/$(date +%Y-%m-%d).md\`) plus the latest few day files for recent Evaluated entries.

---

## Personal additions

(Add project-specific rules below — model preferences, Geometra quirks, overrides to harness defaults, etc. Shared operational rules live in \`AGENTS.harness.md\`.)
`);

// ---------- Personal files (from templates) ----------

copy('config/profile.example.yml', 'config/profile.yml');
copy('templates/portals.example.yml', 'portals.yml');

// ---------- CV stub ----------

write('cv.md', `# Your Name

your.email@example.com · +1 (XXX) XXX-XXXX · City, Country
[LinkedIn](https://linkedin.com/in/you) · [GitHub](https://github.com/you)

## Summary

(One-paragraph pitch about who you are, what you've built, and what you're looking for.)

## Experience

### Current Company — Title
*Dates*

- Bullet describing impact with a metric.
- Bullet describing impact with a metric.

## Skills

(Comma-separated list grouped by category.)

## Education

Degree, Institution, Year
`);

// ---------- Empty personal dirs ----------

for (const dir of ['data', 'data/applications', 'reports', 'batch/tracker-additions']) {
  const abs = join(targetDir, dir);
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true });
    writeFileSync(join(abs, '.gitkeep'), '', 'utf-8');
    console.log(`  create: ${dir}/`);
  }
}

// ---------- .gitignore ----------

write('.gitignore', `# Personal data (your job search — don't share)
cv.md
article-digest.md
portals.yml
config/profile.yml
data/applications/
!data/applications/.gitkeep
data/applications.md
data/pipeline.md
data/scan-history.tsv
data/token-usage.tsv
data/timeline-events.jsonl
.jobforge-ledger/
.jobforge-cache/
.jobforge-index.json
.jobforge-facts.json
.jobforge-timeline.json
.jobforge-timeline-events.jsonl
.jobforge-prioritize.json
.jobforge-prioritize-items.json
.jobforge-lineage.json
.jobforge-mcp/
.jobforge-runs/
.jobforge-redacted/
.jobforge-receipts/
reports/
!reports/.gitkeep
batch/batch-state.tsv
batch/batch-state.tsv.bak
batch/batch-input.tsv
batch/preflight-candidates.json
batch/preflight-plan.json
batch/postflight-outcomes.json
batch/tracker-additions/
!batch/tracker-additions/.gitkeep
batch/logs/

# Harness symlinks (regenerated by npm install)
/modes
/templates
/.cursor/mcp.json
/.opencode/skills/job-forge.md
/.opencode/agents
/batch/batch-prompt.md
/batch/batch-runner.sh
/batch/README.md
/AGENTS.harness.md

# Standard
node_modules/
.DS_Store
*.log
`);

// ---------- README ----------

write('README.md', `# ${name}

Personal job search project using the [job-forge](https://github.com/Agent-Pattern-Labs/JobForge) harness.

## Setup

\`\`\`bash
npm install           # pulls the harness and creates symlinks to modes/, templates/, etc.
\`\`\`

Then fill in:

- \`cv.md\` — your CV in markdown
- \`config/profile.yml\` — your identity and target roles
- \`portals.yml\` — companies you want to scan

## Updating the harness

\`\`\`bash
npm update job-forge       # pulls the latest from Agent-Pattern-Labs/JobForge
job-forge sync             # re-run if symlinks drift
\`\`\`

## Common commands

\`\`\`bash
job-forge merge            # merge batch/tracker-additions/*.tsv into the tracker
job-forge verify           # verify pipeline integrity
job-forge ledger:status    # local deterministic workflow ledger status
job-forge index:status     # local artifact index status
job-forge facts:status     # local source-backed fact status
job-forge prioritize:status # local next-action priority queue status
job-forge lineage:status   # local artifact lineage status
job-forge canon:key company-role --company "Acme, Inc." --role "Senior SWE"
job-forge preflight:plan --candidates batch/preflight-candidates.json
job-forge postflight:status --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
job-forge migrate:check    # verify consumer package scripts/gitignore are current
job-forge pdf cv.md out.pdf
job-forge tokens --days 1  # per-session opencode token usage
\`\`\`
`);

console.log(`
Done. Next steps:

  cd ${targetDir}
  npm install
  # edit cv.md, config/profile.yml, portals.yml
  opencode
`);
