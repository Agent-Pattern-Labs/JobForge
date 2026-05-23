# JobForge documentation

Guides for installing JobForge, understanding how pieces fit together, and tailoring the system to your search. Use this file as the entry point when browsing the `docs/` folder on GitHub or locally.

## Install paths

JobForge ships on npm as [`job-forge`](https://www.npmjs.com/package/job-forge) (v2.0.0+). Pick the path that matches your goal:

| Path | Who it's for | How |
|------|--------------|-----|
| **A — Scaffold a personal project** | Most users. You want a job search project with the harness in `node_modules`, updatable via `npm update job-forge`. | `npx --package=job-forge create-job-forge my-search && cd my-search && npm install` |
| **B — Clone the harness directly** | Contributors and hackers working on `iso/`, modes, scripts, or the scoring model. Personal files are gitignored. | `git clone https://github.com/Agent-Pattern-Labs/JobForge.git && cd JobForge && npm install && npm run build:config` |

See [SETUP.md](SETUP.md) for both paths.

## Guides

| Guide | What it covers |
|-------|----------------|
| [SETUP.md](SETUP.md) | Prerequisites, both install paths, profile and CV, portals, `npx job-forge verify`, optional Go dashboard, token usage tracking, [troubleshooting](SETUP.md#troubleshooting) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | [Package architecture](ARCHITECTURE.md#package-architecture-v200) (consumer vs harness split), modes under `modes/`, single-offer flow, batch runner, tracker and scripts, [contributor touchpoints](ARCHITECTURE.md#contributing-touchpoints) |
| [CUSTOMIZATION.md](CUSTOMIZATION.md) | Profile, archetypes in `_shared.md`, `portals.yml`, CV template, canonical states, optional story bank and opencode hooks. Also: how to customize a symlinked mode file locally |
| [MODEL-ROUTING.md](MODEL-ROUTING.md) | Why the harness uses three cost-tiered subagents (`@general-free`, `@general-paid`, `@glm-minimal`), how routing is enforced (permission + tool-surface trim + reasoningEffort), and how to swap models or add agents |
| [examples/README.md](../examples/README.md) | Fictional CV samples (per-role markdown), optional digest, fictional [`sample-jd.md`](../examples/sample-jd.md) for `local:jds/…` shape, and sample report — starting point for new `cv.md`, JD-on-disk layout, or contributor archetypes (cloud infrastructure, agent platform) |
| [batch/README.md](../batch/README.md) | Batch TSV format, `batch-runner.sh`, `tracker-additions/` merge flow with `npx job-forge merge` |
| [jds/README.md](../jds/README.md) | Markdown JDs on disk; `local:jds/{file}.md` lines in `data/pipeline.md` |

## Commands and automation

The harness exposes a single CLI (`job-forge`) installed as a `bin` entry. In a consumer project, `npx job-forge <cmd>` invokes any of the scripts; npm script aliases (`npm run verify`, `npm run merge`, `npm run dedup`, `npm run normalize`) are wired up in the scaffolded `package.json`. In the harness repo (Path B), scripts run directly via `node <script>.mjs` or their npm aliases.

| What you need | Where to read |
|---------------|---------------|
| Full command list (`verify`, `merge`, `dedup`, `normalize`, `pdf`, `sync-check`, `tokens`, `trace`, `telemetry`, `guard`, `ledger`, `capabilities`, `context`, `cache`, `index`, `facts`, `score`, `canon`, `timeline`, `prioritize`, `lineage`, `preflight`, `postflight`, `redact`, `migrate`, `sync`). | [SETUP.md — Tracker and scripts (terminal)](SETUP.md#tracker-and-scripts-terminal). |
| What each harness `.mjs` script does. | [ARCHITECTURE.md — Pipeline integrity](ARCHITECTURE.md#pipeline-integrity) and the scripts table underneath. |
| Batch runner, TSV layout, and `batch/tracker-additions/` merge flow. | [batch/README.md](../batch/README.md). |
| PR gate for harness contributions (`npm run verify` + `npm run smoke:iso` + `npm run build:dashboard`). | [CONTRIBUTING.md — Development](../CONTRIBUTING.md#development). |
| Optional scripted iterations (harness repo only). | [scripts/cursor-agent-loop.sh](../scripts/cursor-agent-loop.sh). Usage and env vars live in the script header and in [CONTRIBUTING.md — Optional: scripted agent iterations](../CONTRIBUTING.md#optional-scripted-agent-iterations). Verbose JSON output is formatted by [cursor-agent-stream-format.py](../scripts/cursor-agent-stream-format.py). |
| Work-marker search (`T`ODO, `F`IXME, `H`ACK strings in the source) before picking work. | [CONTRIBUTING.md — Optional: scripted agent iterations](../CONTRIBUTING.md#optional-scripted-agent-iterations) — `rg` one-liner from the harness repo root. |

## Related material (harness repo root)

- [modes/README.md](../modes/README.md) — per-command prompts used with the skill router (archetypes and shared scoring live in `_shared.md`; see **Modes** in [ARCHITECTURE.md](ARCHITECTURE.md)).
- [.opencode/skills/job-forge.md](../.opencode/skills/job-forge.md) — the skill router that routes `/job-forge <mode>` to the right prompt and loads only the data files that mode needs.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — branch workflow, quality gate, contribution ideas.
- [templates/states.yml](../templates/states.yml) — canonical tracker status ids and labels (used by verify, merge, and normalize).
- [templates/portals.example.yml](../templates/portals.example.yml) — starter portal and scanner config (copied into consumer projects as `portals.yml`).
- [templates/cv-template.html](../templates/cv-template.html) — HTML layout for ATS-style PDFs from `generate-pdf.mjs`.
- [config/profile.example.yml](../config/profile.example.yml) — template copied into consumer projects as `config/profile.yml`.
- [examples/README.md](../examples/README.md) — fictional CV samples and illustrative report layout.
- [interview-prep/story-bank.md](../interview-prep/story-bank.md) — optional STAR+R story bank (grows as you run evaluations).
- [batch/README.md](../batch/README.md) — batch TSV input, merge step, and runner prerequisites.
- [`data/pipeline.md`](../data/) — inbox of pending offer URLs and `local:jds/…` lines (create when you first queue a URL; see [`modes/pipeline.md`](../modes/pipeline.md)).
- [jds/README.md](../jds/README.md) — markdown job descriptions on disk; the pipeline references them as `local:jds/{filename}.md` from the project root.
