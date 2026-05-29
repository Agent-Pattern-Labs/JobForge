# JobForge

> AI-powered job search pipeline for opencode: evaluate roles, generate tailored CV PDFs, scan portals, apply to good-fit jobs, and track the whole search locally.

![opencode](https://img.shields.io/badge/opencode-000?style=flat&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![Geometra](https://img.shields.io/badge/Geometra_MCP-4A90D9?style=flat&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

<p align="center">
  <img src="demo/demo.gif" alt="JobForge demo" width="800">
</p>

<p align="center"><em>Paste a job URL. Get a scored evaluation, tailored CV, and tracker entry.</em></p>

## Start Here

Most users should scaffold a personal job-search project instead of cloning this harness repo directly.

### Prerequisites

- [opencode](https://opencode.ai) installed and configured
- Node.js 20.6 or newer
- Optional: Go, only if you want to build the dashboard TUI

### Create Your Project

```bash
npx --package=job-forge create-job-forge my-job-search
cd my-job-search
npm install
```

Then edit the three personal files the scaffolder creates:

| File | What to put there |
|------|-------------------|
| `cv.md` | Your CV in markdown. This is the source for matching and PDF generation. |
| `config/profile.yml` | Your identity, target roles, location constraints, compensation, and proof points. |
| `portals.yml` | Companies, search queries, and title filters for portal scanning. |

Optional: add `article-digest.md` with portfolio links, case studies, or extra proof points.

### First Run

```bash
npx job-forge sync-check
opencode
```

Inside opencode, paste a job URL or job description. JobForge routes it through the auto-pipeline: evaluation, score, tailored report, PDF, and tracker update.

To see the command menu:

```text
/job-forge
```

## What It Does

JobForge is built for selective, high-fit applications. It is not intended for spray-and-pray submission.

- Scores opportunities with a consistent weighted rubric.
- Generates tailored ATS-friendly CV PDFs.
- Scans configured company portals and job boards.
- Tracks applications, follow-ups, rejections, offers, reports, and PDFs.
- Supports batch evaluation and application work through bounded subagents.
- Uses local helper CLIs for dedupe, scoring, lineage, preflight, postflight, and tracker integrity.

## Common Commands

Run these from your personal project root after `npm install`.

| Need | Command |
|------|---------|
| Verify setup after editing profile and CV | `npx job-forge sync-check` |
| Check tracker and pipeline health | `npx job-forge verify` |
| Merge batch tracker additions | `npx job-forge merge` |
| Generate a CV PDF from the current project | `npx job-forge pdf` |
| Show token usage | `npx job-forge tokens --days 1` |
| Rebuild harness symlinks | `npx job-forge sync` |
| Upgrade the harness | `npm run update-harness` |

Useful opencode commands:

| Need | Command |
|------|---------|
| Evaluate a pasted URL or JD | Paste it directly, or use `/job-forge` |
| Scan configured portals | `/job-forge scan` |
| Process queued URLs | `/job-forge pipeline` |
| Batch evaluate roles | `/job-forge batch` |
| Fill an application form | `/job-forge apply` |
| Check application status | `/job-forge tracker` |
| Check due follow-ups | `/job-forge followup` |
| Draft LinkedIn outreach | `/job-forge contact` |
| Research a company | `/job-forge deep` |
| Handle rejection or offer workflows | `/job-forge rejection` or `/job-forge negotiation` |

## How The Flow Works

```text
Paste a job URL or JD
        |
        v
Extract role details and classify fit
        |
        v
Score against profile, CV, location, comp, and role goals
        |
        v
Create report + tailored PDF + tracker entry
        |
        v
Apply, follow up, research, or negotiate from the tracked state
```

## Project Layout

A scaffolded personal project looks like this:

```text
my-job-search/
├── package.json                 # depends on job-forge from npm
├── opencode.json                # MCP and opencode configuration
├── cv.md                        # personal, gitignored
├── article-digest.md            # optional personal proof points, gitignored
├── config/profile.yml           # personal, gitignored
├── portals.yml                  # personal scanner config, gitignored
├── data/                        # pipeline, applications, scan history
├── reports/                     # generated evaluations
├── output/                      # generated PDFs
├── batch/tracker-additions/     # batch apply/eval results before merge
├── AGENTS.md                    # personal overrides
├── AGENTS.harness.md            # symlink into node_modules/job-forge
├── modes/                       # symlinked JobForge modes
├── templates/                   # symlinked policies and templates
└── node_modules/job-forge/       # the harness package
```

Your personal files and generated job-search state are gitignored by the scaffolded project.

## MCPs And Automation

The scaffolded opencode project wires up the browser and mail automation JobForge needs:

- Geometra MCP for browser automation and PDF generation.
- Gmail MCP for recruiter replies, interview callbacks, offer responses, and status emails.

The harness also ships config for Cursor, Claude Code, and Codex through generated symlinks. `npm install` and `npx job-forge sync` refresh those links.

## Contributor Setup

Clone this repo directly only when you want to work on the harness itself: modes, scripts, templates, generated agent configs, or release packaging.

```bash
git clone https://github.com/Agent-Pattern-Labs/JobForge.git
cd JobForge
npm install
npm run build:config
npm run verify
```

The source of truth for generated harness configuration is under `iso/`. Run `npm run build:config` after changing `iso/` files.

## Documentation

- [Setup](docs/SETUP.md) - full install paths, personalization, tracker setup, token tracking, troubleshooting.
- [Architecture](docs/ARCHITECTURE.md) - consumer vs harness split, modes, scripts, batch flow, generated config.
- [Customization](docs/CUSTOMIZATION.md) - profile, archetypes, scanner keywords, states, templates, local overrides.
- [Model Routing](docs/MODEL-ROUTING.md) - subagent tiers and how to change model routing.
- [Examples](examples/README.md) - fictional CVs, sample JD, and sample report.
- [Batch Runner](batch/README.md) - TSV format, durable batch runner, merge flow.
- [Contributing](CONTRIBUTING.md) - branch workflow and quality checks.

## Troubleshooting

`sync-check` fails before your CV/profile are complete. That is expected until `cv.md` and `config/profile.yml` are filled in.

If symlinks look stale after moving a project, run:

```bash
npx job-forge sync
```

If PDF or browser automation fails, start with:

```bash
opencode mcp list
```

Then see [docs/SETUP.md](docs/SETUP.md#troubleshooting) for Geometra, Gmail, dashboard, tracker, and merge troubleshooting.

## License

MIT
