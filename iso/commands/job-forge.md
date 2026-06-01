---
description: AI job search command center -- evaluate offers, generate CVs, scan portals, track applications
user_invocable: true
args: mode
targets:
  claude: skip
  cursor: skip
  codex: skip
---

# job-forge -- Router

## Mode Routing

Determine the mode from `{{mode}}`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `offer` | `offer` |
| `compare` | `compare` |
| `contact` | `contact` |
| `deep` | `deep` |
| `pdf` | `pdf` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `batch` | `batch` |
| `followup` | `followup` |
| `rejection` | `rejection` |
| `negotiation` | `negotiation` |

**Auto-pipeline detection:** If `{{mode}}` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `{{mode}}` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Run Discovery Mode (no arguments)

Show this menu:

```
job-forge -- Command Center

Available commands:
  /job-forge {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /job-forge pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /job-forge offer     → Evaluation only A-F (no auto PDF)
  /job-forge compare   → Compare and rank multiple offers
  /job-forge contact   → LinkedIn power move: find contacts + draft message
  /job-forge deep      → Deep research prompt about company
  /job-forge pdf       → PDF only, ATS-optimized CV
  /job-forge training  → Evaluate course/cert against North Star
  /job-forge project   → Evaluate portfolio project idea
  /job-forge tracker   → Application status overview
  /job-forge followup  → Follow-up timing and nudges from the tracker
  /job-forge apply     → Live application assistant (reads form + generates answers)
  /job-forge scan      → Scan portals and discover new offers
  /job-forge batch     → Batch processing with parallel workers
  /job-forge negotiation → Negotiate a received offer (comp and terms)
  /job-forge rejection → Log a rejection or review rejection patterns

Inbox: add URLs to data/pipeline.md → /job-forge pipeline
Or paste a JD directly to run the full pipeline.

Token usage check (terminal, outside opencode):
  npx job-forge tokens --days 1        # today's sessions with input/cache breakdown
  npx job-forge tokens --session <id>  # drill into one session for cache-bust hunting

Local workflow ledger (terminal, outside opencode):
  npx job-forge ledger:status          # .jobforge-ledger/events.jsonl summary
  npx job-forge ledger:has --company "Acme" --role "Staff Engineer" --status Applied

Local artifact index (terminal, outside opencode):
  npx job-forge index:status           # .jobforge-index.json summary
  npx job-forge index:has --key "company-role:acme:staff-engineer"
  npx job-forge index:query "acme"

Identity keys (terminal, outside opencode):
  npx job-forge canon:key company-role --company "Acme" --role "Staff Engineer"
  npx job-forge canon:compare company "OpenAI, Inc." "Open AI"

Preflight dispatch plans (terminal, outside opencode):
  npx job-forge preflight:plan --candidates batch/preflight-candidates.json
  npx job-forge preflight:check --candidates batch/preflight-candidates.json

Postflight dispatch settlement (terminal, outside opencode):
  npx job-forge postflight:status --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
  npx job-forge postflight:check --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json

Follow-up timeline (terminal, outside opencode):
  npx job-forge timeline:due
  npx job-forge timeline:check --fail-on overdue

Consumer migrations (terminal, outside opencode):
  npx job-forge migrate:plan           # preview package.json/.gitignore drift
  npx job-forge migrate:apply          # apply safe harness upgrade migrations
  npx job-forge migrate:check          # fail if migrations are pending

Artifact contracts (terminal, outside opencode):
  npx iso-contract explain jobforge.tracker-row --contracts templates/contracts.json
  npx job-forge tracker-line ... --write   # renders + validates tracker TSV locally

Score policy (terminal, outside opencode):
  npx job-forge score:check --input /tmp/score.json
  npx job-forge score:gate --input /tmp/score.json --gate apply
  npx job-forge score:explain

Role capabilities (terminal, outside opencode):
  npx job-forge capabilities:explain general-free
  npx job-forge capabilities:check general-free --tool browser --mcp geometra --filesystem write

Context bundles (terminal, outside opencode):
  npx job-forge context:plan apply
  npx job-forge context:check apply --budget 23000
```

---

## Load Context by Mode

**IMPORTANT: Only load files needed for the active mode.** Do NOT pre-load all data or mode files. This keeps token usage low.

After determining the mode, Read the necessary files before executing:

### Read `_shared.md` Plus Mode File For These Modes
Read `modes/_shared.md` + `modes/{mode}.md`

Applies to: `auto-pipeline`, `offer`, `compare`, `pdf`, `contact`, `apply`, `pipeline`, `scan`, `batch`

### Read Only Mode File For Standalone Modes
Read `modes/{mode}.md`

Applies to: `tracker`, `deep`, `training`, `project`, `followup`, `rejection`, `negotiation`

### Load Data Files Only When Mode Needs Them

| File | Load when mode is... |
|------|---------------------|
| `data/applications.md` (or `data/applications/*.md` if day-based) | `tracker`, `followup`, `rejection`, `compare`, `auto-pipeline` (for dedup check), `batch` (for next number) |
| `data/pipeline.md` | `pipeline`, `scan` (to append new finds) |
| `data/scan-history.tsv` | `scan` only |
| `portals.yml` | `scan` only |
| `batch/batch-prompt.md` | `batch` only |
| `batch/batch-state.tsv` | `batch` only (for resume) |
| `config/profile.yml` | When `_shared.md` is loaded (it references profile) |
| `cv.md` | `pdf`, `auto-pipeline`, `apply` (when tailoring CV) |

**Do NOT read `data/scan-history.tsv` (70KB+), `portals.yml` (100KB+), or `data/applications.md` (grows over time) unless the mode explicitly needs them.**

### Delegate These Modes To Subagent
For `scan`, `apply` (with Geometra MCP), and `pipeline` (3+ URLs): launch as Agent with the content of `_shared.md` + `modes/{mode}.md` injected into the subagent prompt.

```
Agent(
  subagent_type="general-purpose",
  prompt="[content of modes/_shared.md]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="job-forge {mode}"
)
```

Execute the instructions from the loaded mode file.

---

## Apply Session Hygiene To Keep Token Usage Low

**Rule: multi-job workflows MUST delegate each job to its own subagent.**

Long interactive sessions (>100 messages) — especially with Geometra MCP doing repeated `geometra_fill_form` / `geometra_page_model` calls — accumulate conversation history that the model has to re-read on every turn. Tool results from Geometra disrupt prompt caching, so the full history is re-processed as *fresh* input tokens instead of cache reads. Observed symptom: `cache_read` drops to ~2K while `input_tokens` climbs to 100K+ per message.

The session-hygiene rule applies to:

- **`apply` mode with >1 job URL** → launch one subagent per URL, **max 2 in parallel** (Hard Limit #1 in `AGENTS.md`). For 10 jobs, run 5 sequential rounds of 2. Never run applications directly in this session.
- **`batch` mode** → already uses `batch-runner.sh`'s parallel `opencode run` workers. Do not wrap `batch` in an interactive session that also does the form filling.
- **`pipeline` mode with 3+ URLs** → split into per-URL subagents, **max 2 in parallel** (Hard Limit #1).
- **Anything that calls `geometra_fill_form` more than twice in a row** MUST be split into subagents.

### Apply-to-N-jobs runbook (follow literally)

When the user says "apply to N jobs", "process the pipeline", or similar, execute this exact sequence. Do not improvise.

```
Step 1  — Enumerate candidates
  - Grep data/applications/*.md for status "Evaluated" without loading every file into context
  - Also read data/pipeline.md for unprocessed URLs
  - Build ordered list: candidates = [job_1, job_2, ..., job_N]

Step 2  — Dedup against already-applied
  - Derive the stable key with npx job-forge canon:key company-role --company
    "<company>" --role "<role>" when company+role is known.
  - Run npx job-forge index:has --key "<canon-key>" as a fast local artifact
    prefilter. It rebuilds .jobforge-index.json on demand from
    templates/index.json and canonicalizes indexed company/role records through
    templates/canon.json. A hit means the role has already appeared in tracker
    files or tracker TSVs and can be dropped before dispatch.
  - If .jobforge-ledger/events.jsonl exists, use npx job-forge ledger:has as a
    fast prefilter for obvious company+role Applied duplicates. A ledger match
    can be dropped before dispatch without loading tracker files into context.
  - For each candidate, grep all four sources for URL and company+role:
    data/pipeline.md, data/applications/*.md, batch/tracker-additions/*.tsv,
    batch/tracker-additions/merged/*.tsv
  - Drop any APPLIED / Applied match before counting toward N. Never re-apply.
  - If a subagent later returns SKIP because it found a duplicate, treat that as
    a missed preflight check; finish the current round, re-run dedupe, then pick
    a replacement from the remaining candidates.

Step 3  — Pre-flight cleanup (once, before the loop)
  - geometra_list_sessions()
  - geometra_disconnect({ closeBrowser: true })

Step 4  — Materialize and check the dispatch plan
  - Write file-backed candidate facts/gates to batch/preflight-candidates.json
    (or another explicit JSON file). Include source paths for company, role,
    companyRoleKey, URL, score, duplicate/location gates, and any skip/block
    decision.
  - If the candidate came from a fresh evaluation score JSON, run npx job-forge
    score:check --input <score.json> and npx job-forge score:gate --input
    <score.json> --gate apply before using that score as an apply gate.
  - Run npx job-forge preflight:check --candidates <file> to fail on missing
    sources or blocked gates, then npx job-forge preflight:plan --candidates
    <file> --json > batch/preflight-plan.json to get the bounded round list.
  - Follow the emitted rounds. Do not dispatch blocked candidates, and do not
    replace H2's four-source grep with preflight unless those grep results are
    present in the candidate JSON.

Step 5  — Loop in rounds of 2 (Hard Limit #1)
  for round in ceil(len(candidates) / 2):
    pair = candidates[round*2 : round*2 + 2]
    # If proxy is configured, do not paste proxy values into prompts.
    # Say: "Proxy is configured; read config/profile.yml and pass its
    # top-level proxy object plus headless: true and stealth: true to every
    # Geometra connect or auto-connect call."
    # Dispatch 1 or 2 task() calls in ONE message (never 3+)
    task(subagent_type=<tier per AGENTS.md routing>, prompt=<apply prompt for pair[0]>)
    task(subagent_type=<tier>, prompt=<apply prompt for pair[1]>)  # only if pair has 2
    # WAIT for both subagents to return final APPLIED / APPLY FAILED / SKIP /
    # Discarded outcomes or TSV paths before proceeding.
    # A returned task/session id is only a launch receipt, not completion.
    # Do not create a "check task status" task; inspect tracker files or
    # iso-trace if the user asks for status later.
    # Read their return values, log outcomes in batch/postflight-outcomes.json
    # with candidateId, status, and a tracker-tsv artifact path for every
    # terminal outcome.
    npx job-forge postflight:status --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
    # Follow the emitted next action before dispatching the next round.

Step 6  — Between rounds: clean sessions again
  - geometra_list_sessions()
  - geometra_disconnect({ closeBrowser: true })

Step 7  — After all rounds: reconcile outcomes (Hard Limit #6)
  - bash: npx job-forge merge      # consumes batch/tracker-additions/*.tsv into the day file
  - bash: npx job-forge verify     # validates URL/status consistency
  - Add merge/verify step observations to batch/postflight-outcomes.json
  - bash: npx job-forge postflight:check --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
  - Review output; if verify-pipeline reports issues, fix them before ending.

Step 8  — Aggregate and report
  - Summarize: applied, skipped, failed
  - Do NOT re-dispatch failed jobs automatically. Report them to the user.
```

**Hard rules for this runbook:**
- Never emit 3+ `task` calls in one message. Two is the max (Hard Limit #1).
- Never re-dispatch a company whose previous subagent hasn't returned yet (Hard Limit #5).
- Never call `geometra_fill_form` from this session (Hard Limit #4). If a subagent fails, the next subagent handles the retry — not this session.
- **Never append APPLIED / FAILED / SKIP lines to `data/pipeline.md`** (Hard Limit #6). Those outcomes live in `batch/tracker-additions/*.tsv` and flow to the day file via `merge-tracker.mjs`. `pipeline.md` only holds URL inbox state: `[ ]` pending or `[x]` processed.

**Rationale:** A 300-message "apply to 20 jobs" session burns roughly 100K tokens of *fresh* input per message (history re-processed, cache busted). Twenty 30-message per-job subagents do the same work with each sub-session short enough that the cache actually holds — typically 5-10× lower effective token usage.

**Verify after running:** `npx job-forge tokens --session <id>` shows per-message input/cache. Messages with `cache_read < 5K` and `input > 50K` are cache-bust offenders — investigate what's disrupting the cache prefix (usually a mid-session tool schema change or a compact rerun).

**Also:** when the current session has only evaluation or tracker work (no Geometra / no long form flows), you can proceed in a single session. The rule targets tool-heavy multi-step work, not lightweight reads.
