#!/usr/bin/env node
/**
 * job-forge — CLI dispatcher for the job-forge harness.
 *
 * Runs the .mjs scripts shipped in this package against the consumer's cwd.
 * All scripts resolve the project dir via `process.env.JOB_FORGE_PROJECT ||
 * process.cwd()`, so running this bin from a consumer project Just Works.
 *
 * Usage:
 *   job-forge <command> [args...]
 *
 * Commands:
 *   merge          Run merge-tracker.mjs
 *   dedup          Run dedup-tracker.mjs
 *   verify         Run verify-pipeline.mjs
 *   normalize      Run normalize-statuses.mjs
 *   pdf            Run generate-pdf.mjs
 *   sync-check     Run cv-sync-check.mjs
 *   mcp:geometra   Launch Geometra MCP via JobForge's local/npm resolver
 *   portal:*       One-shot direct-Geometra browser snapshots/form schemas
 *   tokens         Run scripts/token-usage-report.mjs
 *   trace:*        Inspect local agent transcripts via iso-trace
 *   telemetry:*    Summarize JobForge pipeline status from traces + tracker files
 *   guard:*        Audit JobForge trace policy with iso-guard
 *   ledger:*       Query local deterministic workflow state via iso-ledger
 *   capabilities:* Query role capability policy via iso-capabilities
 *   context:*      Query/render deterministic context bundles via iso-context
 *   cache:*        Reuse local deterministic artifacts via iso-cache
 *   index:*        Query local artifacts via iso-index
 *   facts:*        Materialize source-backed local facts via iso-facts
 *   score:*        Compute/check deterministic offer scores via iso-score
 *   canon:*        Compute deterministic identity keys via iso-canon
 *   preflight:*    Plan safe dispatch rounds via iso-preflight
 *   postflight:*   Settle dispatch outcomes via iso-postflight
 *   timeline:*     Plan follow-up/next-action windows via iso-timeline
 *   prioritize:*   Rank local next-action queues via iso-prioritize
 *   lineage:*      Record artifact lineage and stale outputs via iso-lineage
 *   redact:*       Sanitize local exports via iso-redact
 *   receipts:*     Create/verify/redact portable JobForge evidence receipts
 *   migrate:*      Apply deterministic consumer-project migrations via iso-migrate
 *   sync           Re-run the harness symlink sync (bin/sync.mjs)
 *   help, --help   Show this message
 */

import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const PROJECT_DIR = process.env.JOB_FORGE_PROJECT || process.cwd();

const commands = {
  merge:        'merge-tracker.mjs',
  dedup:        'dedup-tracker.mjs',
  verify:       'verify-pipeline.mjs',
  normalize:    'normalize-statuses.mjs',
  pdf:          'generate-pdf.mjs',
  'sync-check': 'cv-sync-check.mjs',
  'mcp:geometra': 'bin/geometra-mcp-launcher.mjs',
  tokens:       'scripts/token-usage-report.mjs',
  sync:         'bin/sync.mjs',
  // Deterministic helpers — agents call these instead of deriving values
  // themselves, which saves thinking + Bash + verify tokens per invocation.
  'next-num':       'scripts/next-num.mjs',
  slugify:          'scripts/slugify.mjs',
  today:            'scripts/today.mjs',
  'tracker-line':   'scripts/tracker-line.mjs',
  // Auto-visibility into cost: run at end of session or batch to log usage
  // and warn on >$budget sessions. No opencode lifecycle hook exists, so
  // this is the closest to a SessionEnd trigger — wire it into your
  // shell wrapper around `opencode`, or into batch-runner.sh (already done).
  'session-report':       'scripts/session-report.mjs',
  'render-report-header': 'scripts/render-report-header.mjs',
};

const traceAliases = {
  'trace:list': 'list',
  'trace:stats': 'stats',
  'trace:show': 'show',
};

const telemetryAliases = {
  'telemetry:list': 'list',
  'telemetry:status': 'status',
  'telemetry:show': 'show',
  'telemetry:watch': 'watch',
};

const guardAliases = {
  'guard:audit': 'audit',
  'guard:explain': 'explain',
};

const portalAliases = {
  'portal:snapshot': 'snapshot',
  'portal:form-schema': 'form-schema',
  'portal:explain': 'explain',
};

const ledgerAliases = {
  'ledger:status': 'status',
  'ledger:rebuild': 'rebuild',
  'ledger:verify': 'verify',
  'ledger:has': 'has',
  'ledger:query': 'query',
  'ledger:path': 'path',
};

const capabilitiesAliases = {
  'capabilities:list': 'list',
  'capabilities:explain': 'explain',
  'capabilities:check': 'check',
  'capabilities:render': 'render',
  'capabilities:path': 'path',
};

const contextAliases = {
  'context:list': 'list',
  'context:explain': 'explain',
  'context:plan': 'plan',
  'context:check': 'check',
  'context:render': 'render',
  'context:path': 'path',
};

const cacheAliases = {
  'cache:key': 'key',
  'cache:status': 'status',
  'cache:has': 'has',
  'cache:get': 'get',
  'cache:put': 'put',
  'cache:list': 'list',
  'cache:verify': 'verify',
  'cache:prune': 'prune',
  'cache:path': 'path',
};

const indexAliases = {
  'index:build': 'build',
  'index:status': 'status',
  'index:query': 'query',
  'index:has': 'has',
  'index:verify': 'verify',
  'index:explain': 'explain',
  'index:path': 'path',
};

const factsAliases = {
  'facts:build': 'build',
  'facts:status': 'status',
  'facts:query': 'query',
  'facts:has': 'has',
  'facts:verify': 'verify',
  'facts:check': 'check',
  'facts:explain': 'explain',
  'facts:path': 'path',
};

const scoreAliases = {
  'score:compute': 'compute',
  'score:verify': 'verify',
  'score:check': 'check',
  'score:gate': 'gate',
  'score:compare': 'compare',
  'score:explain': 'explain',
  'score:path': 'path',
};

const canonAliases = {
  'canon:normalize': 'normalize',
  'canon:key': 'key',
  'canon:compare': 'compare',
  'canon:explain': 'explain',
  'canon:path': 'path',
};

const preflightAliases = {
  'preflight:plan': 'plan',
  'preflight:check': 'check',
  'preflight:explain': 'explain',
  'preflight:path': 'path',
};

const postflightAliases = {
  'postflight:status': 'status',
  'postflight:check': 'check',
  'postflight:explain': 'explain',
  'postflight:path': 'path',
};

const timelineAliases = {
  'timeline:status': 'status',
  'timeline:build': 'build',
  'timeline:plan': 'plan',
  'timeline:due': 'due',
  'timeline:check': 'check',
  'timeline:verify': 'verify',
  'timeline:explain': 'explain',
  'timeline:path': 'path',
};

const prioritizeAliases = {
  'prioritize:status': 'status',
  'prioritize:items': 'items',
  'prioritize:build': 'build',
  'prioritize:rank': 'rank',
  'prioritize:select': 'select',
  'prioritize:check': 'check',
  'prioritize:verify': 'verify',
  'prioritize:explain': 'explain',
  'prioritize:path': 'path',
};

const lineageAliases = {
  'lineage:status': 'status',
  'lineage:record': 'record',
  'lineage:check': 'check',
  'lineage:stale': 'stale',
  'lineage:verify': 'verify',
  'lineage:explain': 'explain',
  'lineage:path': 'path',
};

const redactAliases = {
  'redact:scan': 'scan',
  'redact:verify': 'verify',
  'redact:apply': 'apply',
  'redact:explain': 'explain',
  'redact:path': 'path',
};

const receiptsAliases = {
  'receipts:create': 'create',
  'receipts:capture': 'capture',
  'receipts:verify': 'verify',
  'receipts:inspect': 'inspect',
  'receipts:redact': 'redact',
  'receipts:path': 'path',
};

const migrateAliases = {
  'migrate:plan': 'plan',
  'migrate:apply': 'apply',
  'migrate:check': 'check',
  'migrate:explain': 'explain',
  'migrate:path': 'path',
};

const [, , cmd, ...rest] = process.argv;

function printHelp() {
  console.log(`job-forge — CLI for the job-forge harness

Usage:
  job-forge <command> [args...]

Commands:
  merge          Merge batch/tracker-additions/*.tsv into the tracker
  dedup          Remove duplicate entries from the tracker
  verify         Verify pipeline integrity (reports, URLs, dedup)
  normalize      Normalize status values across the tracker
  pdf            Generate ATS-optimized CV PDF from cv.md
  sync-check     Lint: verify cv.md and profile.yml are filled in
  mcp:geometra   Launch Geometra MCP, preferring local JobForge/Geometra dev wiring
  portal:snapshot      Render a URL with direct Geometra and print page model/snapshot
  portal:form-schema   Render a URL with direct Geometra and print form schema
  portal:explain       Show direct Geometra module/defaults
  tokens         Show opencode token usage and cost by session/day
  trace          Pass through to iso-trace (e.g. job-forge trace sources)
  trace:list     List recent local agent sessions (defaults: --since 7d --cwd project)
  trace:stats    Show trace stats (defaults: --since 7d --cwd project)
  trace:show ID  Show one trace by id or prefix
  telemetry:list    List recent JobForge runs with tasks/outcomes/issues
  telemetry:status  Show latest JobForge run + pending tracker state
  telemetry:show ID Show one run with child sessions, provider errors, next actions
  telemetry:watch   Watch latest run status
  guard:audit        Audit latest/local trace policy with iso-guard
  guard:explain      Show the active iso-guard policy
  ledger:status      Show local workflow ledger status
  ledger:rebuild     Rebuild .jobforge-ledger/events.jsonl from tracker/pipeline files
  ledger:has         Check URL or company+role state without loading tracker files
  ledger:verify      Validate the local workflow ledger
  capabilities:list       List JobForge role capability policies
  capabilities:explain    Explain one role capability policy
  capabilities:check      Validate requested tool/MCP/command/fs/network access
  capabilities:render     Render compact role guidance for an agent harness
  context:list            List JobForge context bundles
  context:explain         Explain one context bundle
  context:plan            Estimate files/tokens for one context bundle
  context:check           Fail if a context bundle exceeds its budget
  context:render          Render context bundle content as markdown/json
  cache:status            Show local artifact cache status
  cache:key               Print deterministic cache key for a job URL
  cache:has               Check whether a job URL or cache key is cached
  cache:get               Read cached JD/artifact content
  cache:put               Store JD/artifact content
  cache:verify            Validate local artifact cache integrity
  index:status            Show local artifact index status
  index:build             Rebuild .jobforge-index.json from templates/index.json
  index:has               Check indexed URL/company-role/report facts without loading source files
  index:query             Query indexed reports, tracker rows, TSVs, scan history, pipeline, and ledger
  index:verify            Validate local artifact index integrity
  facts:status            Show local materialized fact set status
  facts:build             Rebuild .jobforge-facts.json from templates/facts.json
  facts:has               Check source-backed job/application/candidate facts
  facts:query             Query materialized facts with source path/line provenance
  facts:verify            Validate local fact set integrity
  facts:check             Check configured fact requirements
  score:compute           Compute canonical weighted score from report score JSON
  score:check             Validate score math, thresholds, rationales, and dimensions
  score:gate              Evaluate one score gate (apply, pdf, draft_answers, strong)
  score:compare           Compare two score JSON files deterministically
  score:explain           Show the active scoring rubric from templates/score.json
  canon:key               Print stable URL/company/role/company-role keys
  canon:compare           Compare two identifiers as same/possible/different
  canon:explain           Show the active identity canonicalization policy
  preflight:plan          Build bounded dispatch plan from candidate JSON
  preflight:check         Fail if preflight candidates are blocked
  preflight:explain       Show the active preflight workflow policy
  postflight:status       Reconcile dispatch plan, outcomes, artifacts, and post-steps
  postflight:check        Fail unless a dispatched workflow is fully settled
  postflight:explain      Show the active postflight workflow policy
  timeline:status         Show local follow-up/next-action timeline status
  timeline:build          Build .jobforge-timeline.json from tracker/pipeline sources
  timeline:due            Show currently due/overdue follow-up actions
  timeline:check          Fail on due/overdue timeline actions per policy
  timeline:explain        Show the active timeline policy
  prioritize:status       Show local next-action priority queue status
  prioritize:build        Build .jobforge-prioritize.json from facts/timeline sources
  prioritize:rank         Rank apply/follow-up candidates deterministically
  prioritize:select       Print selected next actions only
  prioritize:check        Fail when selected queue requirements are not met
  prioritize:explain      Show the active priority policy
  lineage:status          Show local artifact lineage status
  lineage:record          Record a report/PDF/derived artifact and its inputs
  lineage:check           Fail if recorded artifacts are stale or missing
  lineage:stale           List stale or missing recorded artifacts
  lineage:explain         Show recorded artifact inputs
  redact:scan             Scan local text for sensitive values before export
  redact:verify           Fail if local text still contains sensitive values
  redact:apply            Write a sanitized copy of local text
  redact:explain          Show the active redaction policy
  receipts:create         Create a portable receipt from JobForge artifacts
  receipts:capture        Capture a command's stdout/stderr into a receipt
  receipts:verify         Verify a receipt manifest and artifact hashes
  receipts:inspect        Summarize a receipt without unpacking it
  receipts:redact         Redact a receipt with templates/redact.json
  migrate:plan            Preview deterministic consumer-project migrations
  migrate:apply           Apply deterministic consumer-project migrations
  migrate:check           Fail if migrations are pending
  migrate:explain         Show the active migration policy
  sync           Re-create harness symlinks in the current project

Deterministic helpers (prefer these over LLM-derived values):
  next-num       Print next sequential report number (e.g. 521)
  slugify NAME   Convert a company/role name to a filename-safe slug
  today          Print today's date in YYYY-MM-DD
  tracker-line   Render and validate a tracker TSV row for batch/tracker-additions/

Cost visibility:
  session-report        Summarize recent session costs, warn on >budget sessions
                        (e.g. job-forge session-report --since-minutes 60 --log)

Report assembly:
  render-report-header  Given a score JSON on stdin, print the canonical
                        report header + "## Score" section. Agents append
                        Blocks A-F after this instead of re-emitting the
                        standard boilerplate every evaluation.

Pass --help after a command to see its own flags, e.g.:
  job-forge merge --help
  job-forge tokens --days 1
  job-forge slugify "Anthropic, PBC"
  job-forge trace:list --since 24h
  job-forge trace:show ses_...
  job-forge telemetry:status
  job-forge telemetry:show ses_...
  job-forge guard:audit
  job-forge guard:explain
  job-forge portal:snapshot --url https://example.test/jobs/123 --json
  job-forge portal:form-schema --url https://example.test/apply --json
  job-forge ledger:has --company "Acme" --role "Staff Engineer" --status Applied
  job-forge capabilities:explain general-free
  job-forge capabilities:check general-free --tool browser --mcp geometra --command "npx job-forge merge" --filesystem write
  job-forge context:plan apply
  job-forge context:check apply --budget 23000
  job-forge cache:has --url https://example.test/jobs/123
  job-forge cache:get --url https://example.test/jobs/123
  job-forge cache:put --url https://example.test/jobs/123 --input @jds/example.md
  job-forge index:has --key "company-role:acme:staff-engineer"
  job-forge index:query "acme"
  job-forge facts:has --fact application.status --key "company-role:acme:staff-engineer"
  job-forge facts:query --fact job.url --tag report
  job-forge score:check --input /tmp/score.json
  job-forge score:gate --input /tmp/score.json --gate apply
  job-forge canon:key company-role --company "Acme, Inc." --role "Senior SWE - Remote US"
  job-forge canon:compare company "OpenAI, Inc." "Open AI"
  job-forge preflight:plan --candidates batch/preflight-candidates.json
  job-forge preflight:check --candidates batch/preflight-candidates.json
  job-forge postflight:status --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
  job-forge postflight:check --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
  job-forge timeline:due
  job-forge timeline:check --fail-on overdue
  job-forge prioritize:build
  job-forge prioritize:select --limit 3
  job-forge lineage:record --artifact reports/123-acme-2026-04-27.md --input cv.md --input config/profile.yml --kind report
  job-forge lineage:check --artifact reports/123-acme-2026-04-27.md
  job-forge redact:scan --input raw-session.jsonl
  job-forge redact:apply --input raw-session.jsonl --output .jobforge-redacted/session.jsonl
  job-forge receipts:create --company "Acme" --role "Staff Engineer" --artifact batch/tracker-additions/123-acme.tsv --include-ledger
  job-forge receipts:verify .jobforge-receipts/receipt.agent.zip
  job-forge migrate:check
  job-forge migrate:apply

Project directory resolves to $JOB_FORGE_PROJECT or cwd.`);
}

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(0);
}

if (cmd === 'trace' || traceAliases[cmd]) {
  const traceArgs = cmd === 'trace'
    ? (rest.length === 0 ? ['help'] : rest)
    : [traceAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/trace.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...traceArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'telemetry' || telemetryAliases[cmd]) {
  const telemetryArgs = cmd === 'telemetry'
    ? (rest.length === 0 ? ['help'] : rest)
    : [telemetryAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/telemetry.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...telemetryArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'guard' || guardAliases[cmd]) {
  const guardArgs = cmd === 'guard'
    ? (rest.length === 0 ? ['help'] : rest)
    : [guardAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/guard.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...guardArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'portal' || portalAliases[cmd]) {
  const portalArgs = cmd === 'portal'
    ? (rest.length === 0 ? ['help'] : rest)
    : [portalAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/portal.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...portalArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'ledger' || ledgerAliases[cmd]) {
  const ledgerArgs = cmd === 'ledger'
    ? (rest.length === 0 ? ['help'] : rest)
    : [ledgerAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/ledger.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...ledgerArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'capabilities' || capabilitiesAliases[cmd]) {
  const capabilitiesArgs = cmd === 'capabilities'
    ? (rest.length === 0 ? ['help'] : rest)
    : [capabilitiesAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/capabilities.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...capabilitiesArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'context' || contextAliases[cmd]) {
  const contextArgs = cmd === 'context'
    ? (rest.length === 0 ? ['help'] : rest)
    : [contextAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/context.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...contextArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'cache' || cacheAliases[cmd]) {
  const cacheArgs = cmd === 'cache'
    ? (rest.length === 0 ? ['help'] : rest)
    : [cacheAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/cache.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...cacheArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'index' || indexAliases[cmd]) {
  const indexArgs = cmd === 'index'
    ? (rest.length === 0 ? ['help'] : rest)
    : [indexAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/index.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...indexArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'facts' || factsAliases[cmd]) {
  const factsArgs = cmd === 'facts'
    ? (rest.length === 0 ? ['help'] : rest)
    : [factsAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/facts.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...factsArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'score' || scoreAliases[cmd]) {
  const scoreArgs = cmd === 'score'
    ? (rest.length === 0 ? ['help'] : rest)
    : [scoreAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/score.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...scoreArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'canon' || canonAliases[cmd]) {
  const canonArgs = cmd === 'canon'
    ? (rest.length === 0 ? ['help'] : rest)
    : [canonAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/canon.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...canonArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'preflight' || preflightAliases[cmd]) {
  const preflightArgs = cmd === 'preflight'
    ? (rest.length === 0 ? ['help'] : rest)
    : [preflightAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/preflight.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...preflightArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'postflight' || postflightAliases[cmd]) {
  const postflightArgs = cmd === 'postflight'
    ? (rest.length === 0 ? ['help'] : rest)
    : [postflightAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/postflight.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...postflightArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'timeline' || timelineAliases[cmd]) {
  const timelineArgs = cmd === 'timeline'
    ? (rest.length === 0 ? ['help'] : rest)
    : [timelineAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/timeline.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...timelineArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'prioritize' || prioritizeAliases[cmd]) {
  const prioritizeArgs = cmd === 'prioritize'
    ? (rest.length === 0 ? ['help'] : rest)
    : [prioritizeAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/prioritize.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...prioritizeArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'lineage' || lineageAliases[cmd]) {
  const lineageArgs = cmd === 'lineage'
    ? (rest.length === 0 ? ['help'] : rest)
    : [lineageAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/lineage.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...lineageArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'redact' || redactAliases[cmd]) {
  const redactArgs = cmd === 'redact'
    ? (rest.length === 0 ? ['help'] : rest)
    : [redactAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/redact.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...redactArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'receipts' || receiptsAliases[cmd]) {
  const receiptsArgs = cmd === 'receipts'
    ? (rest.length === 0 ? ['help'] : rest)
    : [receiptsAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/receipts.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...receiptsArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

if (cmd === 'migrate' || migrateAliases[cmd]) {
  const migrateArgs = cmd === 'migrate'
    ? (rest.length === 0 ? ['help'] : rest)
    : [migrateAliases[cmd], ...rest];

  const scriptPath = join(PKG_ROOT, 'scripts/migrate.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...migrateArgs], {
    stdio: 'inherit',
    cwd: PROJECT_DIR,
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

const rel = commands[cmd];
if (!rel) {
  console.error(`Unknown command: ${cmd}\n`);
  printHelp();
  process.exit(2);
}

const scriptPath = join(PKG_ROOT, rel);
if (!existsSync(scriptPath)) {
  console.error(`Internal error: script ${rel} not found at ${scriptPath}`);
  process.exit(2);
}

const result = spawnSync(process.execPath, [scriptPath, ...rest], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
