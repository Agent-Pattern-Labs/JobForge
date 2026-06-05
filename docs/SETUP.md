# Setup Guide

## Prerequisites

- [opencode](https://opencode.ai) installed and configured
- Node.js 20.6+ (for the CLI, PDF generation, tracker scripts, and durable batch orchestration)
- [`uv`](https://docs.astral.sh/uv/) installed (`brew install uv` on macOS, or `pipx install uv`). Used by the state-trace MCP to spawn its Python entry point on demand via `uvx`. Without `uv`, the state-trace MCP fails to start; the rest of JobForge keeps working.
- (Optional) Go (for the dashboard TUI) — use a toolchain that satisfies the `go` directive in [`dashboard/go.mod`](../dashboard/go.mod)

## Quick Start (two paths)

### Path A — Scaffold a personal project (recommended)

JobForge is published on npm as [`job-forge`](https://www.npmjs.com/package/job-forge). Use the scaffolder to create a new project that keeps only your personal data (CV, profile, portals, tracker) while the harness (modes, skills, scripts, per-harness configs) lives in `node_modules/job-forge` and updates with one command.

```bash
# 1. Scaffold
npx --package=job-forge create-job-forge my-job-search
cd my-job-search

# 2. Install the harness. `npm install` fetches job-forge@^2.0.0 from npm;
#    its postinstall hook creates symlinks into your project root for:
#      .opencode/{skills/job-forge.md, agents/}
#      .cursor/mcp.json, .cursor/rules/main.mdc
#      .mcp.json                       (Claude Code MCP config)
#      .codex/config.toml              (Codex MCP config)
#      AGENTS.harness.md, CLAUDE.harness.md
#      modes/, templates/
#      batch/{batch-prompt.md, batch-runner.sh, README.md}
npm install

# 3. Fill in personal files
#    - cv.md (your CV in markdown)
#    - config/profile.yml (copied from profile.example.yml — edit with your
#      name, email, target roles, narrative, proof points)
#    - portals.yml (copied from templates/portals.example.yml — edit keywords
#      and tracked companies)
#    - article-digest.md (optional; proof points with metrics)

# 4. Launch opencode
opencode
```

The scaffolded `opencode.json` already registers the Geometra MCP (browser automation + PDF generation) and Gmail MCP (reading interview/offer replies), so they launch automatically the first time opencode starts — no `opencode mcp add` step required.

Paste a job URL or run `/job-forge` to see the command menu.

To **upgrade the harness** later:

```bash
npm update job-forge       # pulls latest job-forge from the npm registry
npx job-forge sync         # refresh symlinks if anything drifted
```

Or simpler, via the scaffolded script: `npm run update-harness` (also refreshes the fallback plugin + pinned MCPs, reprints the resolved version).

### Path B — Clone the harness directly

Use this if you want to hack on the harness itself (edit `iso/`, tune the scoring model, add modes, contribute back). Personal files are gitignored.

```bash
git clone https://github.com/Agent-Pattern-Labs/JobForge.git
cd JobForge
npm install
npm run build:config   # regenerate per-harness trees from iso/ (CLAUDE.md,
                       # AGENTS.md, .mcp.json, .codex/, .cursor/, .opencode/,
                       # opencode.json) — these are gitignored but materialized
                       # locally so OpenCode/Cursor/Claude Code/Codex can read
                       # them while you develop

# Add personal files the same way as Path A
cp config/profile.example.yml config/profile.yml
cp templates/portals.example.yml portals.yml
# Create cv.md in the project root
```

When you're inside this repo, the `postinstall` symlink step is a no-op (detected and skipped). All npm scripts run the harness code directly. The repo's generated `opencode.json` at the project root registers the same Geometra + Gmail MCPs as the scaffolder ships to consumers. Re-run `npm run build:config` any time you edit something under `iso/`; `prepack` runs the same build automatically at publish time so tarballs always match `iso/`.

## Personalization

For structure and section ideas, see the fictional samples in [`examples/`](../examples/) (for example `cv-example.md`, `cv-example-backend-engineer.md`, `cv-example-fullstack-engineer.md`, `cv-example-data-engineer.md`, `cv-example-frontend-engineer.md`, `cv-example-mobile-engineer.md`, `cv-example-devops-engineer.md`, `cv-example-engineering-manager.md`, `cv-example-security-engineer.md`, `cv-example-qa-engineer.md`, `cv-example-solutions-architect.md`, and `cv-example-product-manager.md`).

> **The system is designed to be customized by opencode itself.** Modes, archetypes, scoring weights, negotiation scripts — just ask opencode to change them. See [Customization](CUSTOMIZATION.md).

## Application tracker (optional until first evaluation)

New rows go to **`data/applications/YYYY-MM-DD.md`** day files when the `data/applications/` directory exists. If it does not exist, utilities and the dashboard fall back to **`data/applications.md`** or the repo root **`applications.md`** (same column layout). A fresh setup often has neither the directory nor the file yet; that is normal, and `npx job-forge verify` still exits successfully.

To start with an empty tracker (for example before you paste your first URL), create the directory:

```bash
mkdir -p data/applications
```

The first evaluation will create a day file like `data/applications/2026-04-13.md` with this header:

```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

Status values MUST match [templates/states.yml](../templates/states.yml); see the **States** section in [Customization](CUSTOMIZATION.md). After batch evaluations, run `npx job-forge merge` to pull in `batch/tracker-additions/*.tsv` when your workflow uses those files. For the parallel batch runner that produces those additions, see [batch/README.md](../batch/README.md). If the status column has typos, old labels, or bold markers, run `npx job-forge normalize` to rewrite rows toward the canonical set (use `npx job-forge normalize --dry-run` first to preview changes).

## Available commands (opencode)

Use these inside an opencode session in your project (see the skill at `.opencode/skills/job-forge.md` for the full routing logic):

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/job-forge scan` |
| Process pending URLs | `/job-forge pipeline` |
| Generate a PDF | `/job-forge pdf` |
| Batch evaluate | `/job-forge batch` |
| Check tracker status | `/job-forge tracker` |
| Fill application form | `/job-forge apply` |

## Tracker and scripts (terminal)

From your project root, these commands maintain the tracker and pipeline checks. They do not require opencode. `merge`, `normalize`, and `dedup` exit successfully when the tracker file is missing (same as a fresh setup).

| Action | Command | npm alias |
|--------|---------|-----------|
| Pipeline health check | `npx job-forge verify` | `npm run verify` |
| Merge `batch/tracker-additions/*.tsv` into the tracker | `npx job-forge merge` | `npm run merge` |
| Inspect tracker row contract | `npx iso-contract explain jobforge.tracker-row --contracts templates/contracts.json` | _(none)_ |
| Validate emitted score JSON | `npx job-forge score:check --input /tmp/score.json` | `npm run score:check -- --input /tmp/score.json` |
| Check application score gate | `npx job-forge score:gate --input /tmp/score.json --gate apply` | `npm run score:gate -- --input /tmp/score.json --gate apply` |
| Derive canonical company/role key | `npx job-forge canon:key company-role --company "Acme" --role "Staff Engineer"` | `npm run canon:key -- company-role --company ...` |
| Compare identity values | `npx job-forge canon:compare company "OpenAI, Inc." "Open AI"` | `npm run canon:compare -- company ...` |
| Inspect role capabilities | `npx job-forge capabilities:explain general-free` | `npm run capabilities:explain -- general-free` |
| Inspect context bundle budget | `npx job-forge context:plan apply` | `npm run context:plan -- apply` |
| Inspect local JD/artifact cache | `npx job-forge cache:status` | `npm run cache:status` |
| Inspect local artifact index | `npx job-forge index:status` | `npm run index:status` |
| Inspect local materialized facts | `npx job-forge facts:status` | `npm run facts:status` |
| Show due follow-up actions | `npx job-forge timeline:due` | `npm run timeline:due` |
| Fail on stale follow-up actions | `npx job-forge timeline:check --fail-on overdue` | `npm run timeline:check -- --fail-on overdue` |
| Rank next actions from facts and timeline | `npx job-forge prioritize:build` / `npx job-forge prioritize:select --limit 3` | `npm run prioritize:build` |
| Check report/PDF lineage for stale inputs | `npx job-forge lineage:check` | `npm run lineage:check` |
| Plan safe application dispatch rounds | `npx job-forge preflight:plan --candidates batch/preflight-candidates.json` | `npm run preflight:plan -- --candidates ...` |
| Fail on blocked preflight candidates | `npx job-forge preflight:check --candidates batch/preflight-candidates.json` | `npm run preflight:check -- --candidates ...` |
| Settle dispatch outcomes after a round | `npx job-forge postflight:status --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json` | `npm run postflight:status -- --plan ... --outcomes ...` |
| Fail unless dispatch outcomes and post-steps are complete | `npx job-forge postflight:check --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json` | `npm run postflight:check -- --plan ... --outcomes ...` |
| Sanitize local text before exporting it | `npx job-forge redact:apply --input raw-session.jsonl --output .jobforge-redacted/session.jsonl` | `npm run redact:apply -- --input ... --output ...` |
| Verify local text is safe to export | `npx job-forge redact:verify --input .jobforge-redacted/session.jsonl` | `npm run redact:verify -- --input ...` |
| Create a verifiable work receipt | `npx job-forge receipts:create --company "Acme" --role "Staff Engineer" --artifact batch/tracker-additions/example.tsv --include-ledger` | `npm run receipts:create -- --company ... --role ... --artifact ... --include-ledger` |
| Verify or redact a receipt | `npx job-forge receipts:verify .jobforge-receipts/example.agent.zip` | `npm run receipts:verify -- .jobforge-receipts/example.agent.zip` |
| Inspect pending consumer migrations | `npx job-forge migrate:plan` | `npm run migrate:plan` |
| Map status column to canonical labels | `npx job-forge normalize` | `npm run normalize` |
| Merge duplicate company/role rows | `npx job-forge dedup` | `npm run dedup` |
| Generate ATS-optimized CV PDF | `npx job-forge pdf` | `npm run pdf` |
| Setup lint (cv.md + profile.yml) | `npx job-forge sync-check` | `npm run sync-check` |
| Token usage report (from opencode SQLite DB) | `npx job-forge tokens` | `npm run tokens` |
| List recent OpenCode traces for this project | `npx job-forge trace:list` | `npm run trace:list` |
| Summarize trace tool/file/token usage | `npx job-forge trace:stats` | `npm run trace:stats` |
| Show one trace by session id/prefix | `npx job-forge trace:show <id>` | `npm run trace:show -- <id>` |
| List recent JobForge runs with outcomes/issues | `npx job-forge telemetry:list` | `npm run telemetry:list` |
| Show latest run status + pending TSVs | `npx job-forge telemetry:status` | `npm run telemetry:status` |
| Show one JobForge run by session id/prefix | `npx job-forge telemetry:show <id>` | `npm run telemetry:show -- <id>` |
| Audit latest JobForge trace policy | `npx job-forge guard:audit` | `npm run guard:audit` |
| Show the active guard policy | `npx job-forge guard:explain` | `npm run guard:explain` |
| Show local workflow ledger status | `npx job-forge ledger:status` | `npm run ledger:status` |
| Rebuild local workflow ledger from tracker/pipeline files | `npx job-forge ledger:rebuild` | `npm run ledger:rebuild` |
| Check duplicate/status event without loading tracker files | `npx job-forge ledger:has --company "Acme" --role "Staff Engineer" --status Applied` | `npm run ledger:has -- --company ...` |
| Check/reuse cached JD content | `npx job-forge cache:has --url <url>` / `npx job-forge cache:get --url <url>` | `npm run cache:has -- --url ...` |
| Query local artifact pointers | `npx job-forge index:query "Acme"` / `npx job-forge index:has --key company-role:acme:staff-engineer` | `npm run index:query -- Acme` |
| Query local source-backed facts | `npx job-forge facts:query --fact job.url` / `npx job-forge facts:has --fact application.status --key company-role:acme:staff-engineer` | `npm run facts:query -- --fact job.url` |
| Materialize follow-up timeline | `npx job-forge timeline:build` | `npm run timeline:build` |
| Materialize next-action priority queue | `npx job-forge prioritize:build` | `npm run prioritize:build` |
| Record artifact lineage | `npx job-forge lineage:record --artifact reports/123-acme.md --input cv.md --input config/profile.yml` | `npm run lineage:record -- --artifact ...` |
| Apply safe consumer migrations | `npx job-forge migrate:apply` | `npm run migrate:apply` |
| Re-create harness symlinks | `npx job-forge sync` | `npm run sync` |
| Build optional dashboard TUI (Go on `PATH`) | `(cd node_modules/job-forge/dashboard && go build .)` | `npm run build:dashboard` (harness repo only) |

Path B users (cloning the harness) can keep using the shorter `npm run <script>` aliases since the scripts live at the repo root.

## Verify setup

```bash
npx job-forge verify           # Pipeline integrity. OK if the tracker file does not exist yet; still warns on unmerged batch/tracker-additions/*.tsv — run npx job-forge merge when you intend to fold those rows into the tracker (see batch/README.md)
npx job-forge sync-check       # Requires cv.md and config/profile.yml
```

## Build dashboard (optional, Path B only)

The TUI reads the tracker at the JobForge repo root (day files in `data/applications/`, or `data/applications.md`, or root `applications.md`). If you build inside `dashboard/`, point `-path` at the parent directory:

```bash
cd dashboard
go build -o job-forge-dashboard .
./job-forge-dashboard -path ..   # repo root is one level up
```

From the repo root, `npm run build:dashboard` runs `go build .` inside `dashboard/`.

Path A users who want the dashboard can either clone the harness separately or run the binary from `node_modules/job-forge/dashboard/` after `go build`.

## Token usage tracking

The harness ships a per-session token/cost report that queries opencode's SQLite database:

```bash
npx job-forge tokens                  # last 7 days
npx job-forge tokens --days 1         # today only
npx job-forge tokens --days 1 --append  # append to data/token-usage.tsv
npx job-forge tokens --session <id>   # drill into one session
```

Use it to identify which sessions or models are consuming the most tokens. The `opencode.json` shipped with the scaffolder loads only `templates/states.yml` into every session and lets the skill router load mode/data files on demand, which typically keeps per-call input tokens at ~20-40K instead of ~130-170K.

## Troubleshooting

**`npx job-forge verify` succeeds, but `npx job-forge sync-check` fails**  
`sync-check` requires `cv.md` and `config/profile.yml` with the fields checked in `cv-sync-check.mjs`. Until you finish the profile and CV steps, that is normal.

**PDF generation fails**  
The scaffolded `opencode.json` already registers Geometra MCP; if it's not running, check `opencode mcp list` and verify the scaffolded config under the `mcp.geometra` key — its `command` MUST be `["npx", "--no-install", "job-forge", "mcp:geometra"]`, `enabled: true`, and its `environment` should include `GEOMETRA_STEALTH=0` plus `GEOMETRA_BROWSER=stock`. `job-forge mcp:geometra` resolves Geometra in this order: `JOB_FORGE_GEOMETRA_MCP_PATH`, then a consumer-project override from `package.json -> jobForge.geometraMcpPath`, then `opencode.json -> mcp.geometra.environment.JOB_FORGE_GEOMETRA_MCP_PATH`, then a sibling `../geometra/mcp/dist/index.js` checkout for local JobForge development, and finally the pinned npm package. Geometra manages Chromium via its built-in proxy. JobForge passes `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `blockedSitePolicy: "manual-handoff"` for portal sessions explicitly, keeping browser windows hidden while surfacing structured blocked-site metadata. For standalone CLI usage (outside opencode), `generate-pdf.mjs` also works with standalone Playwright/Chromium — install with `npx playwright install chromium`.

`job-forge mcp:geometra` writes MCP launcher diagnostics to `.jobforge-mcp/geometra-mcp.jsonl`. If the server silently vanishes with empty stderr, run `tail -40 .jobforge-mcp/geometra-mcp.jsonl`. A final `signal_received` event means the host sent a catchable signal, a final `child_exit` means Geometra exited, and an old final `heartbeat` with no exit/signal usually means SIGKILL or external process death. Set `JOB_FORGE_GEOMETRA_MCP_LOG_PATH` to move the log, `JOB_FORGE_GEOMETRA_MCP_LOG=0` to disable it, or `JOB_FORGE_GEOMETRA_MCP_HEARTBEAT_MS` to tune the heartbeat interval.

For consumer projects that should always use a local Geometra checkout across Opencode, Codex, Cursor, and Claude, prefer a local `package.json` override instead of editing symlinked MCP configs:

```json
{
  "jobForge": {
    "geometraMcpPath": "/absolute/path/to/geometra/mcp/dist/index.js"
  }
}
```

**Symlinks are missing or pointing to a stale path**  
Run `npx job-forge sync` (or `npm run sync`) to recreate them. This happens if you move the project directory after installing, or if `postinstall` didn't run (rare — check `npm install` output for errors).

**`npx job-forge sync` says "X already exists as a real file/dir — leaving alone"**  
You or the scaffolder created a real file where the harness wants to put a symlink. If you want to customize that file locally, keep it as-is — the sync script preserves real files. If you want the harness version, delete your local copy and rerun `npx job-forge sync`.

**Dashboard is empty or points at the wrong data**  
The `-path` argument must be the project root (where `data/applications/` or `data/applications.md` lives), not the `dashboard/` directory.

**`go build` reports `go: command not found` or a version error**  
Install Go and put it on your `PATH`, or omit the dashboard; everything else runs with Node.js.

**`npx job-forge merge` says there is nothing to merge, but you have TSV files**  
Only files directly under `batch/tracker-additions/` with a `.tsv` extension are picked up. After a successful merge, rows are merged into the tracker and those files move to `batch/tracker-additions/merged/`, so a second run correctly finds nothing left. If you created TSVs elsewhere or only have files under `merged/`, move or regenerate them in the top-level `tracker-additions` folder (see [batch/README.md](../batch/README.md)).

**A `local:jds/...` line in the pipeline does not resolve**  
Paths are relative to the project root: create the markdown file under `jds/` and list it in `data/pipeline.md` as `local:jds/{filename}.md` (same spelling as the file name). See [jds/README.md](../jds/README.md) and [`modes/pipeline.md`](../modes/pipeline.md).

## Contributing

Pull requests and issue reports are welcome on `Agent-Pattern-Labs/JobForge`. See [CONTRIBUTING.md](../CONTRIBUTING.md) for branch workflow, ideas (documentation, `examples/`, `templates/portals.example.yml`, dashboard features, utility scripts), and the checks maintainers expect before a PR (`npm run verify` and `npm run build:dashboard`). Contributors work against Path B (clone the harness directly).
