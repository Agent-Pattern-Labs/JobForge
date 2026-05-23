# Contributing to JobForge

Thanks for your interest in contributing! JobForge is built with opencode, and you can use it for development too.

Contributor workflows operate against a direct clone of the harness repo (Path B in [docs/SETUP.md](docs/SETUP.md)). Consumer-project users (Path A — scaffolded with `npx create-job-forge`) typically don't need to clone the harness at all.

## Quick Start

1. Fork `Agent-Pattern-Labs/JobForge`
2. Clone your fork and run `npm install` inside it (the `postinstall` symlink step is a no-op inside the harness repo)
3. Create a branch (`git checkout -b feature/my-feature`)
4. Make your changes
5. Verify with `npm run verify`, `npm run smoke:iso`, and `npm run build:dashboard` (see [Development](#development) below)
6. Commit and push
7. Open a Pull Request against `Agent-Pattern-Labs/JobForge`

## What to Contribute

**Suggested first contributions:**
- Add companies to `templates/portals.example.yml`
- Improve documentation (start from the [documentation index](docs/README.md) so new pages land in the right place)
- Add example CVs for different roles (in `examples/` — see `examples/README.md`)
- Report bugs via [Issues](https://github.com/Agent-Pattern-Labs/JobForge/issues)

**Bigger contributions:**
- New evaluation dimensions or scoring logic
- Dashboard TUI features (in `dashboard/`)
- New skill modes (in `modes/`)
- Script improvements (`.mjs` utilities)

## Guidelines

- Scripts MUST handle missing files gracefully (check `existsSync` before `readFileSync`)
- Dashboard changes require `go build` — test with real data before submitting
- Don't commit personal data (cv.md, profile.yml, applications.md, reports/)

## Development

Before opening a PR, from the harness repo root:

```bash
npm run verify
npm run smoke:iso
npm run build:dashboard
```

(`npm run build:dashboard` is the same as `(cd dashboard && go build .)` — requires Go on PATH.)

`npm run verify` runs `verify-pipeline.mjs`. It exits successfully when no tracker exists (fresh clone).

> **Contributor note:** Inside the harness repo, scripts resolve PROJECT_DIR via `process.cwd()`, so running `npm run verify` from the repo root operates on your local `data/` directory (gitignored). If you have a personal project that you want to test changes against, use `JOB_FORGE_PROJECT=/path/to/personal/project npm run verify`.

Other npm scripts:

| Script | Runs | Notes |
|--------|------|--------|
| `npm run smoke:iso` | ISO source, route, harness, helper integration, and eval smoke checks | Required before PRs that touch `iso/`, `modes/`, helper scripts, templates, or package wiring |
| `npm run lint:helpers` | `scripts/check-helper-integration.mjs` | Verifies local helper deps, CLI aliases, scaffolder scripts, migrations, generated ignores, templates, docs, and helper reference stay aligned |
| `npm run build:dashboard` | `go build` in `dashboard/` | Optional TUI; same check as manual `cd dashboard && go build .` |
| `npm run sync-check` | `cv-sync-check.mjs` | Optional setup lint: `cv.md`, `config/profile.yml`, hardcoded-metric scan; fails if those files are missing |
| `npm run normalize` | `normalize-statuses.mjs` | Maps non-canonical statuses in tracker files; no-op if no tracker exists |
| `npm run dedup` | `dedup-tracker.mjs` | Merges duplicate company/role rows; no-op if no tracker exists |
| `npm run merge` | `merge-tracker.mjs` | Merges `batch/tracker-additions/*.tsv` into the tracker (day-based or single-file); no-op if no TSVs exist; creates tracker when no tracker file exists yet |
| `npm run pdf` | `generate-pdf.mjs` | Pass HTML and PDF paths after `--`, e.g. `npm run pdf -- output/cv.html output/cv.pdf`; missing parent dirs for the PDF path are created |

Utility scripts `verify`, `merge`, `normalize`, `dedup`, `sync-check`, and `pdf` accept `--help` / `-h` (e.g. `npm run verify -- --help`, `npm run sync-check -- --help`, `npm run pdf -- --help`).

You can run the same `.mjs` files with `node <script>.mjs` from the repo root if you prefer.

Dashboard (optional TUI). The `-path` flag must be the JobForge repo root (where `data/applications.md` or `applications.md` lives), not the `dashboard/` folder:

```bash
cd dashboard && go build -o job-forge-dashboard .
./job-forge-dashboard -path ..
```

### Optional: scripted agent iterations

For repeated non-interactive passes that follow the same checks above (explore → small change → `npm run verify` → `cd dashboard && go build .` → commit), see [`scripts/cursor-agent-loop.sh`](scripts/cursor-agent-loop.sh). It expects the Cursor Agent CLI (`agent` on PATH; see [cursor.com/install](https://cursor.com/install)). Environment variables and usage are documented in the script header — same quality gate as a manual PR, without replacing human review of diffs.

To scan for in-repo markers before picking a task (repo root; `.` includes utility scripts at the root and respects `.gitignore`):

```bash
rg 'TODO|FIXME|HACK' . --glob '*.mjs' --glob '*.go' --glob '*.md' --glob '*.sh'
```

Paths such as `modes/`, `batch/`, `dashboard/`, `docs/`, and `scripts/` are included automatically when you search from the repo root (`.`).

## Need Help?

- [Documentation index](docs/README.md) — map of all guides and related repo paths
- [Setup guide](docs/SETUP.md) — install, profile, CV, portals, verify
- [Architecture](docs/ARCHITECTURE.md) — how evaluation, batch, and scripts fit together
- [Customization](docs/CUSTOMIZATION.md) — profile, archetypes, portals, template, states
- [Open an issue](https://github.com/Agent-Pattern-Labs/JobForge/issues)
