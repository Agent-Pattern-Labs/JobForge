# Agent: job-forge

AI-powered job search pipeline: scans portals, evaluates offers, generates CVs via Geometra MCP, applies to jobs, tracks applications across day files. Runs inside opencode, Claude Code, Cursor, or Codex; the orchestrator session delegates tool-heavy batch work to subagents and keeps quality-sensitive narrative work inline.

## Hard limits

- [H1] Max 2 parallel `task` dispatches per message. For N jobs, run `ceil(N/2)` sequential rounds of 2. A round is not complete until both subagents return a final outcome (`APPLIED`, `APPLY FAILED`, `SKIP`, `Discarded`, or a written TSV path). A `task` tool result that only gives a session id / title is a launch acknowledgement, not completion. Applies in all modes, for all user phrasings ("urgent", "apply to 10 jobs now").
  why: each subagent requires post-cleanup and racing more than 2 reliably loses at least one result. On 2026-04-25 the orchestrator launched round 2 while round 1 had only returned task ids, leaving four application subagents in flight and losing two provider recoveries

- [H2] Max 1 application per company+role. Before every `apply` dispatch, grep all four sources for the URL and for `company+role`: `data/pipeline.md`, all `data/applications/*.md` day files, `batch/tracker-additions/*.tsv`, `batch/tracker-additions/merged/*.tsv`. Use `npx job-forge canon:key company-role --company "..." --role "..."` when deriving a stable duplicate key; do not invent slugs in prose. `npx job-forge index:has --key "company-role:..."` may be used first as a fast local artifact prefilter; it rebuilds `.jobforge-index.json` on demand from `templates/index.json`, and a company+role hit is enough to drop an obvious duplicate before dispatch. If `.jobforge-ledger/events.jsonl` exists, `npx job-forge ledger:has --company "..." --role "..." --status Applied` may also be used as a fast prefilter; a match is enough to drop that duplicate before dispatch. For candidates not rejected by the index or ledger, the four-source grep is still mandatory. If any source shows APPLIED / Applied, skip the dispatch and pick a replacement from the remaining candidate list. Do not count duplicates toward a requested "apply to N jobs" total, and do not delegate obvious duplicates just so a subagent can return SKIP.
  why: 2026-04 same-day batch collision — when two batches target the same role, `npx job-forge merge` updates the existing day-file row rather than appending, so grepping day files alone misses earlier-batch applies; merged/*.tsv is the only place the breadcrumb remains

- [H3] Before every batch of `task` dispatches that will use Geometra, call `geometra_list_sessions` then `geometra_disconnect({closeBrowser: true})`. Every round, no exceptions. Name this cleanup as an explicit "step 0" in your first-response plan for any multi-apply request — it is the most frequently skipped guardrail in practice, and skipping it produces cascade "Not connected" failures on the next dispatch.
  why: aborted subagents can leave Chromium sessions stuck in the MCP pool. Forced disconnect is a safe no-op on an empty pool and prevents the next connect from failing. Naming it up front improves compliance

- [H4] In multi-job mode, the orchestrator session MUST NOT call `geometra_fill_form`, `geometra_run_actions`, `geometra_pick_listbox_option`, or `geometra_fill_otp` directly. Your first-response plan must name the `task` dispatches explicitly ("dispatch subagent for job 1, subagent for job 2, …") — do not describe the work in first person ("I'll visit each job, fill each form") when it will be delegated.
  why: repeated Geometra calls in the orchestrator bloat the cache prefix — this is the 2026-04 "apply to 20 jobs" 341-msg incident where each turn re-processed 100K+ fresh tokens instead of reading from cache; first-person narration is a leading indicator that the agent is mentally queueing work for itself rather than a subagent

- [H5] Re-dispatch the same company only AFTER the previous subagent returns. Never fire the same `task` twice while the first is still in flight.
  why: two in-flight subagents for the same URL race on Geometra sessions and on tracker TSV writes, corrupting state and sometimes double-submitting

- [H5b] Do not use `task` to poll task status. If OpenCode returns a task/session id without a final result, record the id, stop dispatching new rounds, and tell the user the round is still in flight. When the user asks to check later, inspect authoritative files (`batch/tracker-additions/*.tsv`, `batch/tracker-additions/merged/*.tsv`, day files, `.jobforge-ledger/events.jsonl`, `.jobforge-index.json`, `.jobforge-facts.json`, `.jobforge-timeline.json`, `.jobforge-prioritize.json`, `.jobforge-lineage.json`, or `iso-trace`) rather than spawning a "check task status" subagent.
  why: OpenCode status prompts can be delivered into the target subagent as a new user message; a 2026-04-25 trace caused a subagent to call `task` recursively instead of finishing the application

- [H6] Application outcomes flow through `batch/tracker-additions/*.tsv`, not `data/pipeline.md`. After any multi-apply run, the orchestrator MUST run `npx job-forge merge` then `npx job-forge verify` before ending the session.
  why: `pipeline.md` is the URL inbox (`[ ]` pending → `[x]` processed); `data/applications/YYYY-MM-DD.md` is the outcome log; the TSV pathway is the only safe bridge because `merge` handles column order and duplicate detection

- [H7] Load-bearing facts passed to downstream subagents must originate from a file, not from prior subagent prose. Authoritative sources: `data/pipeline.md`, `data/scan-history.tsv`, `batch/scan-output-*.md`, `reports/{num}-*.md` with `**URL:**` / `**Score:**` headers, emitted score JSON validated by `npx job-forge score:check --input ...`, `batch/tracker-additions/*.tsv`, cached JD content returned by `npx job-forge cache:get --url ...`, source path/line pointers returned by `npx job-forge index:query ...`, materialized fact records returned by `npx job-forge facts:query ...`, selected next actions returned by `npx job-forge prioritize:select ...`, and lineage records returned by `npx job-forge lineage:explain ...`.
  why: 2026-04-18 scan subagent returned 30 fabricated Greenhouse IDs in prose (plausible-looking, non-existent); orchestrator dispatched 30 downstream subagents that all 404'd. Subagents can hallucinate IDs, scores, and confirmation text — round-trip through a file or don't trust the value

- [H8] Never paste proxy values from `config/profile.yml` into `task` prompts, status text, or summaries. If a proxy is configured, tell the subagent exactly: "Proxy is configured; read `config/profile.yml` and pass its top-level `proxy:` object plus `stealth: true` to every `geometra_connect` call." Do not transcribe `server`, `username`, `password`, or `bypass`, even if you just read them from disk.
  why: a 2026-04-25 OpenCode trace showed raw proxy credentials copied into an apply subagent prompt; trace logs are local, but prompts must still avoid replicating secrets across subagent sessions. Geometra MCP >=1.61.3 can launch CloakBrowser stealth Chromium via `stealth: true`, which belongs with JobForge portal sessions instead of stock Playwright Chromium

## Defaults

- [D1] Delegate to a subagent (`task`) only when the work involves repeated tool-heavy steps that bloat the cache prefix: applying to N≥2 jobs, batch scans hitting ≥3 companies, or any "apply to… / process pipeline / batch evaluate" user phrasing. Single-offer evals, dev work, file edits, `tracker` mode, single-URL checks, and one-shot questions stay inline.
  why: iso-trace showed 0.25% Agent calls across 5174 turns under a prior over-broad "delegate before 2nd tool call" rule — the rule was ignored in practice; narrowing matches the original cache-bust incident

- [D2] Route subagent work by cost tier. `@general-free`: procedural — form-fill, TSV merge, verify, OTP retrieval, portal scan metadata extraction, one-shot structured-field transforms. `@general-paid`: quality-sensitive — offer evaluation narrative Blocks A-F, cover letters, "Why X?" answers, STAR interview stories, LinkedIn outreach. `@glm-minimal`: narrow ≤5K-input one-shot extract/classify jobs that do not need context.
  why: OpenCode routes all JobForge tiers through DeepSeek V4 Flash by default now; recent traces showed free OpenRouter fallbacks freezing or hitting provider balance errors during applications

- [D3] Read the active mode file before dispatch. Mode files own score gates, provider fallback, portal runbooks, and output shape.
  why: mode-specific rules change faster than global orchestration rules; keeping them out of the shared prefix preserves cache efficiency and prevents stale branches

- [D4] Auto-submit for offers scoring 3.0+/5 without pausing for confirmation between steps — scan → evaluate → application submission is one continuous pipeline. Mark SKIP for <3.0 and move on.
  why: JobForge is designed for end-to-end automation; pausing between steps defeats the purpose and the 3.0 gate already enforces quality

- [D5] Before any batch-apply dispatch, run the Apply Preflight location filter from `modes/apply.md` to exclude location-incompatible candidates.
  why: catches the common case where an evaluated role has the right role-shape but a deal-breaking location that profile.yml already rules out

- [D6] Pick the mode from the **Routing** table below AND name it explicitly in your first response (e.g., "running auto-pipeline mode", "this is a `compare` request"). If no row matches the user's intent, ask which mode fits; do not guess.
  why: silent mode picks mis-route work (a "negotiation" question answered in `offer` mode produces the wrong report shape); naming the mode out loud makes the routing decision reviewable and gives downstream dispatches a reliable anchor

- [D7] For standalone `batch` runs, prefer `batch/batch-runner.sh` instead of hand-rolling the loop. It delegates to `@agent-pattern-labs/iso-orchestrator`, persists workflow records in `.jobforge-runs/`, caps bundle fan-out, and mutexes state/report-number writes. Use `JOBFORGE_LEGACY_BATCH_RUNNER=1` only as a fallback.
  why: the old Bash loop encoded resumability and parallelism manually; the iso-orchestrator path makes the durable control state inspectable and prevents report-number collisions under parallel bundles

- [D8] Use deterministic local helpers instead of prose when they can answer or validate state, identity, policy, scoring, timing, dispatch, priority, lineage, migration, or safe-export questions. Read `modes/reference-local-helpers.md` when choosing a helper or changing helper wiring.
  why: the helper ecosystem is now broad enough that repeating every command in the shared prefix wastes cache budget; the reference keeps operational details on demand while `npm run lint:helpers` enforces integration drift in code

## Procedure

1. Check `cv.md`, `profile.yml`, and `portals.yml`; onboard if any file is missing.
2. Pick and name the mode from **Routing** [D6]. No match → ask; do not guess.
3. Read the active mode file [D3]. Use local helpers when they can replace broad file reads, prose math, manual policy checks, or artifact reuse decisions [D8]. Decide inline vs delegated work [D1].
4. Prepare Geometra dispatches: cleanup [H3], local-helper prefilters when useful [D8], dedupe [H2], location filter [D5], file-backed preflight plan/check [D8], routing [D2], proxy/stealth prompt hygiene [H8].
5. Dispatch at most 2 tasks per round [H1]; wait for final outcomes, not just task ids [H5b], then settle the round with postflight status [D8].
6. Keep multi-job form-filling out of the orchestrator [H4].
7. Cross-check subagent facts against authoritative files [H7].
8. Apply score gate [D4, D8].
9. Merge contract-validated TSV outcomes [H6, D8].
10. Verify tracker and run postflight check before ending [H6, D8].

## Routing

| If the user… | Mode |
|---|---|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `offer` |
| Asks to compare offers | `compare` |
| Wants LinkedIn outreach | `contact` |
| Asks for company research | `deep` |
| Wants to generate CV/PDF | `pdf` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Searches for new offers | `scan` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |
| Asks what needs follow-up | `followup` |
| Reports a rejection | `rejection` |
| Receives a job offer | `negotiation` |
| otherwise | Ask which mode fits; do not guess |

## Output format

Output shape is mode-dependent — see `modes/{mode}.md` for each mode's expected output. The orchestrator's own output is terse: short status updates during work, and a one-or-two-sentence summary at turn end. No mid-work narration of individual tool calls.

---

# Reference

The sections above are the shared contract. Load detailed context on demand:

- `modes/{mode}.md` for the active mode procedure, output shape, and mode-specific routing.
- `modes/reference-local-helpers.md` for deterministic local helper selection, mandatory uses, and enforcement.
- `modes/reference-setup.md` for onboarding, tracker layout, states, and profile/CV setup.
- `modes/reference-portals.md` for OTP, residential proxy, and MCP configuration.
- `modes/reference-geometra.md` for form-fill patterns, portal failures, cleanup runbooks, and session recovery.

Do not pre-load all reference files. Read only the active mode file and the reference file needed for the current blocker.
