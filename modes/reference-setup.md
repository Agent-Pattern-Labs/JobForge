## What is JobForge

AI-powered job search automation built on opencode: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing.

**It will work out of the box, but it's designed to be made yours.** Ask if the archetypes don't match your career. Ask if the modes are in the wrong language. Ask if the scoring doesn't fit your priorities. You (opencode) can edit any file in this system. The user says "change the archetypes to data engineering roles" and you do it. Customization is the whole point.

### Main Files

| File | Function |
|------|----------|
| `data/applications/` | Application tracker (day-based: `YYYY-MM-DD.md`) |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `portals.yml` | Query and company config |
| `templates/cv-template.html` | HTML template for CVs |
| `generate-pdf.mjs` | Geometra MCP (`geometra_generate_pdf`): HTML to PDF |
| `article-digest.md` | Compact proof points from portfolio (optional) |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`) |

### First Run — Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** Run these checks silently every time a session starts:

1. Does `cv.md` exist?
2. Does `config/profile.yml` exist (not just profile.example.yml)?
3. Does `portals.yml` exist (not just templates/portals.example.yml)?

**If ANY of these is missing, enter onboarding mode.** Do NOT proceed with evaluations, scans, or any other mode until the basics are in place. Guide the user step by step:

#### Step 1: CV (required)
If `cv.md` is missing, ask:
> "I don't have your CV yet. You can either:
> 1. Paste your CV here and I'll convert it to markdown
> 2. Paste your LinkedIn URL and I'll extract the key info
> 3. Tell me about your experience and I'll draft a CV for you
>
> Which do you prefer?"

Create `cv.md` from whatever they provide. Make it clean markdown with standard sections (Summary, Experience, Projects, Education, Skills).

#### Step 2: Profile (required)
If `config/profile.yml` is missing, copy from `config/profile.example.yml` and then ask:
> "I need a few details to personalize the system:
> - Your full name and email
> - Your location and timezone
> - What roles are you targeting? (e.g., 'Senior Backend Engineer', 'AI Product Manager')
> - Your salary target range
>
> I'll set everything up for you."

Fill in `config/profile.yml` with their answers. For archetypes, map their target roles to the closest matches and update `modes/_shared.md` when the existing archetypes do not cover their target roles.

#### Step 3: Portals (recommended)
If `portals.yml` is missing:
> "I'll set up the job scanner with 45+ pre-configured companies. Want me to customize the search keywords for your target roles?"

Copy `templates/portals.example.yml` → `portals.yml`. If they gave target roles in Step 2, update `title_filter.positive` to match.

#### Step 4: Tracker
If `data/applications/` directory doesn't exist, create it:
```bash
mkdir -p data/applications
```
The tracker stores entries in day-based files like `data/applications/2026-04-13.md`. Each file has the same table format:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run `/job-forge scan` to search portals
> - Run `/job-forge` to see all commands
>
> Everything is customizable — just ask me to change anything.
>
"

Then suggest automation:
> "Want me to scan for new offers automatically? I can set up a recurring scan every few days so you don't miss anything. Just say 'scan every 3 days' and I'll configure it."

If the user accepts, use the `/loop` or `/schedule` skill (if available) to set up a recurring `/job-forge scan`. If those aren't available, suggest adding a cron job or remind them to run `/job-forge scan` periodically.

### Personalization

JobForge is designed to be customized by YOU (opencode). When the user asks you to change archetypes, translate modes, adjust scoring, add companies, or modify negotiation scripts -- do it directly. You read the same files you use, so you know exactly what to edit.

**Common customization requests:**
- "Change the archetypes to [backend/frontend/data/devops] roles" → edit `modes/_shared.md`
- "Translate the modes to English" → edit all files in `modes/`
- "Add these companies to my portals" → edit `portals.yml`
- "Update my profile" → edit `config/profile.yml`
- "Change the CV template design" → edit `templates/cv-template.html`
- "Adjust the scoring weights" → edit `modes/_shared.md` and `batch/batch-prompt.md`

### Skill Modes

Mode routing is specified in the top-level **## Routing** section. Each mode is implemented in `modes/{mode}.md` — consult those files for per-mode prompts, state, and expected outputs.

### CV Source of Truth

- `cv.md` in project root is the canonical CV
- `article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** -- read them from these files at evaluation time

---

## TSV Format for Tracker Additions

Prefer the deterministic helper:

```bash
npx job-forge tracker-line --num 521 --date 2026-04-15 --company "Anthropic" --role "Manager, FDE" --status Evaluated --score 4.2 --pdf no --slug anthropic-manager-fde --notes "Strong fit" --write
```

The helper renders and validates the row against `templates/contracts.json` via `@agent-pattern-labs/iso-contract`. To inspect the contract directly:

```bash
npx iso-contract explain jobforge.tracker-row --contracts templates/contracts.json
```

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- sequential number (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- `✅` or `❌`
8. `report` -- markdown link `[num](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically and validates both shapes with the tracker-row contract.

- Scripts in `.mjs`, configuration in YAML
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `batch/` (gitignored except scripts and prompt)
- Report numbering: sequential 3-digit zero-padded. **Always use `npx job-forge next-num` to get the next number** — do NOT derive it yourself from `ls reports/`. The CLI scans all sources: `reports/*.md`, the `#` column of every `data/applications/*.md` day file, and pending + merged `batch/tracker-additions/*.tsv`. Deriving from `reports/` alone misses numbers assigned by prior-day tracker additions that were never written as report files (e.g., `SKIP` entries), which causes ID collisions downstream.
- **RULE: After each batch of evaluations, run `npx job-forge merge`** to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.
- **RULE: NEVER attribute commits to opencode (no `Co-Authored-By: opencode` or similar).** All commits must be attributed solely to the person making the commit (e.g., CharlieGreenman).

### Pipeline Integrity

1. **NEVER edit day files in `data/applications/` to ADD new entries** -- Write TSV in `batch/tracker-additions/` and `npx job-forge merge` handles the merge.
2. **YES you can edit day files in `data/applications/` to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Tracker rows MUST satisfy `templates/contracts.json`.
6. Health check: `npx job-forge verify`
7. Normalize statuses: `npx job-forge normalize`
8. Dedup: `npx job-forge dedup`

### Canonical States (applications day files)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded |
| `Contacted` | Candidate proactively reached out (LinkedIn, email) — awaiting response |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded by candidate or offer closed |
| `Failed` | Submission attempted but blocked by portal (spam-filter, anti-bot, broken form). May be recoverable via manual retry. |
| `SKIP` | Doesn't fit, don't apply |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)
