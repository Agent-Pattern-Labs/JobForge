# Mode: batch — Bulk Offer Processing

Two usage modes: **conductor** (navigates portals in real time via Geometra MCP) or **standalone** (script for already-collected URLs).

## Apply The Session-Length Rule

**Never run `batch` as one long interactive session.** Each offer gets its own `opencode run` worker via `batch-runner.sh` — that's the whole point of the architecture. Workers have clean ~200K-token contexts and exit after producing one report + PDF + tracker line, so prompt caching stays healthy.

If you find yourself doing `geometra_fill_form` or `geometra_page_model` for the Nth time in the *same* session, stop and delegate. See "Session Hygiene" in `.opencode/skills/job-forge.md` for the full rationale (cache-bust behavior with repeated Geometra tool calls).

## Use This Architecture

```
opencode Conductor (opencode --dangerously-skip-permissions)
  │
  │  Geometra MCP: navigates portals (logged-in sessions)
  │  Reads structured page model — the user sees everything in real time
  │
  ├─ Offer 1: reads JD from DOM + URL
  │    └─► opencode run worker → report .md + PDF + tracker-line
  │
  ├─ Offer 2: click next, reads JD + URL
  │    └─► opencode run worker → report .md + PDF + tracker-line
  │
  └─ End: merge tracker-additions → data/applications/ + summary
```

Each worker is a child `opencode run` with a clean 200K token context. The conductor only orchestrates.

## Read These Files

```
.jobforge-runs/                  # Durable iso-orchestrator records (gitignored)
batch/
  batch-input.tsv               # URLs (from conductor or manual)
  batch-state.tsv               # Progress (auto-generated, gitignored)
  batch-runner.sh               # Standalone orchestrator script
  batch-prompt.md               # Prompt template for workers
  logs/                         # One log per offer (gitignored)
  tracker-additions/            # Tracker lines (gitignored)
```

## Run Mode A Conductor --chrome

1. **Read state**: `batch/batch-state.tsv` → know what has already been processed
2. **Navigate portal**: Chrome → search URL
3. **Extract URLs**: Read results DOM → extract URL list → append to `batch-input.tsv`
4. **For each pending URL**:
   a. Chrome: click on the offer → read JD text from DOM
   b. Save JD to `/tmp/batch-jd-{id}.txt`
   c. Calculate next sequential REPORT_NUM
d. Execute via Bash:
       ```bash
       opencode run --dangerously-skip-permissions \
         --file batch/batch-prompt.md \
         "Process this offer. URL: {url}. JD: /tmp/batch-jd-{id}.txt. Report: {num}. ID: {id}"
       ```
   e. Update `batch-state.tsv` (completed/failed + score + report_num)
   f. Log to `logs/{report_num}-{id}.log`
   g. Chrome: go back → next offer
5. **Pagination**: If no more offers → click "Next" → repeat
6. **End**: Merge `tracker-additions/` → `data/applications/` (via `merge-tracker.mjs`) + summary

## Run Mode B Standalone Script

```bash
batch/batch-runner.sh [OPTIONS]
```

`batch-runner.sh` delegates to `scripts/batch-orchestrator.mjs` by default.
That Node runner uses `@agent-pattern-labs/iso-orchestrator` to persist workflow records in
`.jobforge-runs/`, cap bundle fan-out with `workflow.forEach`, and serialize
report-number/state writes while workers run in parallel. If a regression
requires the old shell loop, run with `JOBFORGE_LEGACY_BATCH_RUNNER=1`.

Options:
- `--dry-run` — list pending without executing
- `--retry-failed` — only retry failed ones
- `--start-from N` — start from ID N
- `--parallel N` — N workers in parallel
- `--max-retries N` — attempts per offer (default: 2)
- `--workflow-id ID` — durable workflow id (default: `jobforge-batch`)

## Read batch-state.tsv Format

```
id	url	status	started_at	completed_at	report_num	score	error	retries
1	https://...	completed	2026-...	2026-...	002	4.2	-	0
2	https://...	failed	2026-...	2026-...	-	-	Error msg	1
3	https://...	pending	-	-	-	-	-	0
```

## Use Resumability

- If it dies → re-run → reads `batch-state.tsv` → skips completed
- `.jobforge-runs/` keeps the durable run record, step outcomes, and bundle events
- Lock file (`batch-runner.pid`) prevents double execution
- Each worker is independent: failure on offer #47 does not affect the rest

## Run Workers (opencode run)

Each worker receives `batch-prompt.md` as system prompt. It is self-contained.

The worker produces:
1. Report `.md` in `reports/`
2. PDF in `output/`
3. Tracker line in `batch/tracker-additions/{id}.tsv`
4. JSON result via stdout

## Apply Error Handling

| Error | Recovery |
|-------|----------|
| URL inaccessible | Worker fails → conductor marks `failed`, moves on |
| JD behind login | Conductor tries to read DOM. If it fails → `failed` |
| Portal changes layout | Conductor reasons about HTML, adapts |
| Worker crashes | Conductor marks `failed`, moves on. Retry with `--retry-failed` |
| Conductor dies | Re-run → reads state → skips completed |
| PDF fails | Report .md is saved. PDF remains pending |
