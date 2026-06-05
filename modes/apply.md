# Agent: mode-apply

Live application assistant. Reads the active application form in Chrome (via Geometra MCP), loads prior context from the offer evaluation, generates personalized answers, and submits the form in one atomic transaction. When the user is applying to more than one job, this mode is invoked by the orchestrator as a dispatched subagent — never driven from an interactive session directly.

## Hard limits

- [H1] Submit the form with one stable `geometra_run_actions` action array that chains upload + fill + pick + submit. Set `softTimeoutMs: 45000`, `output: "final"`, and `includeSteps: false`; if Geometra returns `paused: true` with `resumeFromIndex`, immediately continue with the exact same `actions` array and that `resumeFromIndex`. Never split upload / fill / submit across separate direct tools or rebuilt action arrays.
  why: Greenhouse-style forms regenerate internal field IDs after any DOM-mutating action (especially file uploads); multi-call sequences see stale IDs, enter a retry loop, and burn tens of thousands of tokens. The soft-timeout continuation keeps the MCP call under host timeout without changing the action array or restarting the application

- [H2] Never auto-retry a failed submit. On recovery failure, report the error to the orchestrator and stop. The orchestrator decides whether to re-dispatch.
  why: duplicate applications are worse than a missed retry — ATS portals often accept a submit whose response was dropped mid-flight, so a retry double-submits. A human must decide.

- [H3] Outcomes MUST be written as TSV to `batch/tracker-additions/{num}-{slug}.tsv` — never append APPLIED / FAILED / SKIP to `data/pipeline.md`.
  why: `pipeline.md` is the URL inbox (`[ ]` → `[x]`); TSVs are the bridge to day files via `npx job-forge merge` (see root `[H6]` in iso/instructions.md)

- [H4] Before dispatching the first subagent in a multi-job run, the orchestrator MUST call `geometra_list_sessions` then `geometra_disconnect({closeBrowser: true})`. Every dispatch-round, no exceptions.
  why: prior aborted subagents leave Chromium sessions stuck in the pool; next `geometra_connect` fails with "Not connected" (see root `[H3]`)

- [H5] Max 2 parallel `task` dispatches per round. For N jobs, run `ceil(N/2)` sequential rounds of 2. Never emit 3+ dispatches in a single message. Do not start the next round until both current-round subagents return final outcomes (`APPLIED`, `APPLY FAILED`, `SKIP`, `Discarded`, or a written TSV path); task/session ids are only launch receipts.
  why: subagent post-cleanup cost and portal state make racing more than 2 unreliable (see root `[H1]`). A 2026-04-25 OpenCode trace launched round 2 while round 1 was still running, then lost two provider recoveries

## Defaults

- [D1] Prefer the structured `location_constraints` block in `config/profile.yml` over the prose `location.*` / `compensation.location_flexibility` fields. Fall back to prose only when `location_constraints` is absent.
  why: structured is O(1) field lookup; prose requires LLM interpretation per dispatch. 2026-04-18 empirical: prose path reached the right call but burned interpretation cycles on every candidate.

- [D2] When Geometra MCP is unavailable, ask the candidate to share a screenshot, paste form questions as text, or provide company + role for lookup.
  why: Geometra is the expected primary path; gracefully degrade without refusing to help.

- [D3] On a detected role change (role on screen ≠ evaluated role in the report), warn the candidate and ask whether to adapt answers or re-evaluate. Do not silently proceed.
  why: adapting answers to the wrong role produces mis-targeted cover letters and the candidate won't catch it until the recruiter does

- [D4] Always pass `imeFriendly: true` on `fill_fields` — safe default everywhere, load-bearing for Ashby.
  why: Ashby's React form swallows programmatic text input silently; `imeFriendly: true` fires composition events that clear React's internal validity state. Zero cost on other portals. Confirmed fix: Supabase #793 (2026-04-19).

- [D5] Fetch `geometra_form_schema` at most once per application, right after the initial `geometra_connect`. Operate on labels thereafter.
  why: schema re-fetches return hundreds of nested field IDs and pollute context; labels don't change mid-flow, so the second fetch is just paying for the same payload twice

- [D5b] Reuse the same Geometra `sessionId` for every tool call on that job URL until the atomic submit transaction completes (or recovery sequence finishes). Do not `geometra_disconnect` mid-flow between schema and submit unless [H1] recovery forces it.
  why: disconnecting between schema and fill invalidates the SPA session and matches real traces where redundant disconnects outnumbered connects; orchestrator pool cleanup [H3]/[H4] is a separate concern between dispatch rounds, not inside one apply subagent

- [D6] Use `fieldLabel` over `fieldId` everywhere it works.
  why: labels are stable across DOM refreshes; IDs are regenerated

- [D7] If the orchestrator says a proxy is configured, read the top-level `proxy:` block from `config/profile.yml` and pass that object plus `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `blockedSitePolicy: "manual-handoff"` into every `geometra_connect` call — including Call 3 of the recovery sequence — and every Geometra auto-connect call that passes `pageUrl` or `url`. If the task prompt includes a legacy inline `proxy` object, pass it through and still set the same headless/browser/block-detection options, but do not echo credentials in status text. If absent, run with `headless: true`, `browserMode: "stock"`, `blockDetection: true`, `blockedSitePolicy: "manual-handoff"`, and no proxy; never invent a proxy URL.
  why: Geometra MCP >=1.62.3 keeps stock Chromium as the default browser mode, preserves headless operation when `headless: true` is explicit, and returns structured `blockedSite` / `manualHandoff` metadata for challenge, CAPTCHA, access-denied, and unsupported-browser states. JobForge should surface those states instead of silently looping on blocked portals. See "BYO Proxy + Block Detection" in modes/reference-portals.md.

- [D8] Upgrade application routing to `@general-paid` when the offer score is ≥ 4.0/5, the user flags "top-tier", "dream job", or "high-stakes", or the candidate is late-stage/post-screen.
  why: high-stakes applications need the quality-sensitive prompt and medium reasoning budget even though OpenCode now routes both application tiers through DeepSeek V4 Flash by default

- [D9] If a subagent fails with provider-side errors, do not auto-downgrade or re-dispatch the same URL. Report the provider failure, leave any TSV untouched unless there is a confirmed outcome, and inspect telemetry before retrying.
  why: OpenCode now pins all JobForge application tiers to DeepSeek V4 Flash; switching `@general-paid` → `@general-free` changes the prompt/tool budget but not the provider route, so automatic duplicate dispatches add risk without fixing provider availability

## Procedure

1. `geometra_connect`: `headless: true`, `browserMode: "stock"`, `isolated: true`, `blockDetection: true`, `blockedSitePolicy: "manual-handoff"` [D7].
2. Run `geometra_page_model`; do not WebFetch the URL [D5].
3. If Geometra is unavailable, ask for screenshot or pasted text [D2].
4. Extract company + role; Grep `reports/` for a matching evaluation.
5. Load full report + Section G if present.
6. Compare role on screen vs evaluated role [D3].
7. If different, pause for the candidate's decision [D3].
8. Before dispatch, run Geometra cleanup [H4] and location filter [D1].
9. Route high-stakes applications through `@general-paid` [D8].
10. Extract form questions; classify each Section-G vs new.
11. Generate answers from Block B + Block F + Section G + JD.
12. Submit via one stable `run_actions` action array [H1] using labels [D6], `imeFriendly: true` [D4], `softTimeoutMs: 45000`, `output: "final"`, and `includeSteps: false`.
13. On session error, run the 4-step recovery; only one retry [H2].
14. On provider failure, stop and inspect telemetry before any retry [D9].
15. On OTP prompt, fetch the code from Gmail via `gmail_get_message`.
16. Submit the OTP with `geometra_fill_otp` and click Submit.
17. Write outcome as `batch/tracker-additions/*.tsv` [H3].
18. Cap parallelism at 2 per round [H5]; one in-flight per company.

## Routing

| If the role on screen... | Action |
|---|---|
| Matches the evaluated report exactly | Proceed with Section G answers |
| Is a closely related variant (same archetype) | Warn, offer to adapt [D3] |
| Is materially different (different archetype) | Warn, offer to re-evaluate [D3] |
| Has no evaluation report | Offer to run auto-pipeline first |
| Location conflicts with profile.yml constraints | Mark `Discarded`, do not dispatch [D1] |
| otherwise | Ask the candidate what they want |

## Output format

The apply subagent returns a short structured message to the orchestrator (not prose to the user):

```
APPLIED <url> — report #NNN, score X.X/5, tenant <ats>
  tracker TSV: batch/tracker-additions/<num>-<slug>.tsv
  notes: <one-line observation>
```

Or, on failure:

```
APPLY FAILED AFTER RECOVERY: <url>
  Error 1: <first error>
  Error 2: <post-recovery error>
  Recommend: inspect telemetry before retrying this URL
```

---

# Reference

Sections below are the detailed runbooks, decision tables, and portal-specific empirical notes for the rules above. The contract is the `## Hard limits` / `## Defaults` / `## Procedure` / `## Routing` block above; this material is what the subagent consults during execution.

## Apply the session-length rule — REQUIRED

## Apply the session-length rule — REQUIRED

**If the candidate wants to apply to more than one job**, this mode MUST delegate each application to its own subagent with **max 2 in parallel** (Hard Limit #1 in `AGENTS.md`). For N jobs, run `ceil(N/2)` sequential rounds of 2. Never drive multi-job applications from a single interactive session: the accumulating Geometra tool results invalidate prompt caching and each message ends up re-processing 100K+ tokens of fresh history — see "Session Hygiene" in `.opencode/skills/job-forge.md`.

**DO NOT dispatch 3+ `task` calls in one message.** Two is the absolute ceiling. This is non-negotiable, even when the user asks for "apply to 10 jobs" — that becomes 5 rounds of 2, not one message with 10 dispatches.

**A task/session id is not a result.** If OpenCode gives you a `ses_...`
id or title after dispatch, do not treat that as the subagent return.
Do not create another `task` to check it. Stop the round, report the
in-flight ids, and resume only after a real outcome is visible in the
subagent return or in an authoritative file (`batch/tracker-additions/`,
`batch/tracker-additions/merged/`, or the day file).

For a single application interactively, carry on in the current session — the rule targets multi-job loops.

## Apply Preflight — Location Filter (orchestrator runs before dispatch)

Before dispatching any batch of apply subagents, cross-check each candidate's location against `config/profile.yml`. **Prefer the structured `location_constraints` block** (deterministic match). Fall back to the prose `location.*` / `compensation.location_flexibility` fields only when `location_constraints` is absent (legacy profiles).

### Preferred path — structured `location_constraints` (deterministic)

1. Read `config/profile.yml → location_constraints`. If present, use the structured fields:

   ```yaml
   location_constraints:
     remote_us: true | false
     remote_global: true | false
     hybrid_cities: [san-francisco, ...]
     blocked_cities: [new-york, ...]
     authorized_countries: [US, ...]       # ISO-3166 alpha-2
     requires_visa_sponsorship: true | false
   ```

2. For each candidate, open its evaluation report (`reports/{num}-*.md`) and read the Location / Block A content. Extract: `mode ∈ {remote, hybrid, onsite}`, `city` (lowercase hyphenated), `country` (ISO-3166 alpha-2 when derivable).

3. Apply the filter (decision table):

   | Role shape | Rule | Outcome |
   |---|---|---|
   | Remote, country ∈ authorized_countries (typically US) | `remote_us == true` → COMPATIBLE | dispatch |
   | Remote, country ∉ authorized_countries | `remote_global == true` AND (`requires_visa_sponsorship == false` OR JD mentions sponsorship) → COMPATIBLE | dispatch / else skip |
   | Hybrid, `city ∈ hybrid_cities` | COMPATIBLE | dispatch |
   | Hybrid or Onsite, `city ∈ blocked_cities` | INCOMPATIBLE | mark `Discarded`, note `location mismatch: blocked_city=X` |
   | Hybrid or Onsite, `city` not in `hybrid_cities` and not in `blocked_cities` | INCOMPATIBLE by default (hybrid is opt-in per city) | mark `Discarded`, note `location mismatch: city=X not in hybrid_cities` |
   | Location unclear / ambiguous | dispatch with a prompt flag instructing the apply subagent to verify the JD location first and Discard early if confirmed incompatible | dispatch-with-flag |

4. Country/visa: if `requires_visa_sponsorship == false` AND `country ∉ authorized_countries` AND the JD does NOT explicitly offer sponsorship → INCOMPATIBLE, do NOT dispatch.

### Fallback path — prose fields (legacy profiles with no `location_constraints`)

When `location_constraints` is absent, use the prose fields:

1. Read `config/profile.yml` for `location` (country, city), `compensation.location_flexibility`, and `visa_status`.
2. For each candidate, open its evaluation report (`reports/{num}-*.md`) and read the Location / Block A content.
3. Apply the filter:
   - If the report says "Remote (US)" / "Remote" / "fully remote" — COMPATIBLE, dispatch.
   - If the report says "Hybrid N days in {city}" AND {city} matches `location.city` OR `location_flexibility` says "open to hybrid in {city}" — COMPATIBLE, dispatch.
   - If the report says "Hybrid" or "Onsite" at a city NOT in the profile's location set AND `location_flexibility` says Remote-preferred — INCOMPATIBLE, do NOT dispatch. Mark the tracker entry `Discarded` directly with note `location mismatch: profile=X, role=Y`.
   - If unclear or ambiguous — dispatch with a prompt flag telling the apply subagent to verify the JD location first and Discard early if confirmed incompatible.
4. Country/visa: if `visa_status: "No sponsorship needed"` and the role is outside the authorized country — INCOMPATIBLE, do NOT dispatch.

**Why**: on 2026-04-18, 5 of 7 candidates dispatched for apply turned out location-incompatible. Each burned an apply-subagent round. The prose-field path reached the right call but cost interpretation cycles per dispatch; the structured path is O(1) field lookup and removes LLM-interpretation risk.

### Run this multi-job apply runbook literally when N > 1

```
Step 1  — Build the job list (N items)
Step 2  — Dedup: for each candidate, grep all four sources for the URL and for company+role:
          data/pipeline.md, all data/applications/*.md day files,
          batch/tracker-additions/*.tsv, batch/tracker-additions/merged/*.tsv.
          Drop any already APPLIED before counting toward N; pick replacements from the remaining list.
Step 3  — geometra_list_sessions() + geometra_disconnect({closeBrowser: true})  [once, before loop]
Step 4  — For round in ceil(N/2):
            pair = jobs[round*2 : round*2 + 2]
            # ONE message, 1 or 2 task() calls. Never 3.
            task(apply to pair[0])
            task(apply to pair[1])  # only if pair has 2
            # WAIT for both final outcomes. A session id is not completion.
            # Do not dispatch round N+1 while round N is still in flight.
Step 5  — After each round:
            write/update batch/postflight-outcomes.json with candidateId, status,
            and tracker-tsv artifact path for every terminal outcome.
            bash: npx job-forge postflight:status --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
            follow the emitted next action before the next dispatch.
Step 6  — Between rounds: geometra_list_sessions() + geometra_disconnect({closeBrowser: true})
Step 7  — Reconcile outcomes (Hard Limit #6):
            bash: npx job-forge merge       # TSVs → day file
            bash: npx job-forge verify      # validate
            add merge/verify step observations to batch/postflight-outcomes.json
            bash: npx job-forge postflight:check --plan batch/preflight-plan.json --outcomes batch/postflight-outcomes.json
Step 8  — Summarize outcomes; do NOT auto-retry failures.
```

If a subagent fails, report it in the summary and let the user decide whether to retry. Never auto-retry — re-running a submit step risks duplicate applications. If a subagent returns SKIP because it discovered a duplicate, treat that as a missed preflight check: finish the current round, then choose a replacement candidate only after re-running dedupe against all four sources.

**Outcome routing (Hard Limit #6 in `AGENTS.md`):**
- Subagents write `batch/tracker-additions/{num}-{slug}.tsv` — one TSV per job.
- Orchestrator runs `npx job-forge merge` once at the end to consume TSVs into the right day file.
- **Do NOT** append APPLIED / FAILED / SKIP lines to `data/pipeline.md` — that file is the URL inbox only.

## Verify these requirements

- **Best with Geometra MCP**: In headless proxy mode, opencode can interact with the page via `geometra_connect`, `geometra_form_schema`, and `geometra_fill_form` without opening a visible browser window.
- **Without Geometra**: the candidate shares a screenshot or pastes the questions manually.

## Run this workflow

```
1. DETECT     → Read active Chrome tab (screenshot/URL/title)
2. IDENTIFY   → Extract company + role from the page
3. SEARCH     → Match against existing reports in reports/
4. LOAD       → Read full report + Section G (if it exists)
5. COMPARE    → Does the role on screen match the evaluated one? If changed → warn
6. ANALYZE    → Identify ALL visible form questions
7. GENERATE   → For each question, generate a personalized answer
8. PRESENT    → Show formatted answers for copy-paste
```

## Step 1 — Detect the offer

Run `geometra_connect` against the active page (with Geometra MCP), then `geometra_page_model` to read the title, URL, and visible content. **Do NOT also WebFetch the same URL** — Geometra's page model already contains the JD text. Each additional fetch re-pulls the same content into conversation history at full input cost.

**Without Geometra:** Ask the candidate to do one of these:

- Share a screenshot of the form (Read tool reads images).
- Paste the form questions as text.
- Provide company + role so we can look it up.

## Step 2 — Extract context and search reports

- Extract the company name and role title from the page.
- Search in `reports/` by company name (Grep case-insensitive).
- If there's a match → load the full report.
- If there's a Section G → load the previous draft answers as a base.
- If there's NO match → notify and offer to run a quick auto-pipeline.

## Step 3 — Detect role changes

Compare the role on screen against the evaluated one. When they differ, do the following.

- **Warn the candidate**: "The role has changed from [X] to [Y]. Do you want me to re-evaluate or adapt the answers to the new title?"
- **If adapt**: Adjust the answers to the new role without re-evaluating.
- **If re-evaluate**: Run a full A-F evaluation, update the report, regenerate Section G.
- **Update tracker**: Change the role title in the day file under `data/applications/` when the row already exists.

## Step 4 — Scan form questions

Extract ALL visible questions across these field types.

- Free text fields (cover letter, why this role, additional info).
- Dropdowns (how did you hear, work authorization, source).
- Yes/No (relocation, visa sponsorship, current employment).
- Salary fields (range, expectation).
- Upload fields (resume, cover letter PDF).

Classify each question:
- **Already answered in Section G** → adapt the existing answer
- **New question** → generate an answer from the report + cv.md

## Step 5 — Generate answers

Generate the answer for each question using these inputs in order.

<!-- isolint-disable-next-line undefined-step-reference -->
1. **Report context**: Use proof points from Block B, STAR stories from Block F.
2. **Previous Section G**: If a draft answer exists, use it as a base and refine
3. **"I'm choosing you" tone**: Same framework as the auto-pipeline
4. **Specificity**: Reference something concrete from the JD visible on screen
5. **job-forge proof point**: Include in "Additional info" if there's a field for it

**Output format:**

```
## Answers for [Company] — [Role]

Based on: Report #NNN | Score: X.X/5 | Archetype: [type]

---

### 1. [Exact form question]
> [Answer ready for copy-paste]

### 2. [Next question]
> [Answer]

...

---

Notes:
- [Any observations about the role, changes, etc.]
- [Personalization suggestions the candidate should review]
```

## Dispatch the form atomically (Step 5.5 — REQUIRED)

When the candidate asks you to actually submit (or when running in auto-pipeline mode at score ≥ 3.0), follow these rules **strictly**. Greenhouse-style forms regenerate internal field IDs after any DOM-mutating action, especially file uploads. That breaks multi-call fill sequences and forces the model into a retry loop that burns tens of thousands of tokens.

### Use one stable `run_actions` action array (Rule A — never split)

Do the entire submission with one stable `geometra_run_actions` `actions` array that chains all steps. Never split upload / fill / submit across separate direct tools, and never rebuild the action array between continuations.

```
geometra_run_actions({
  sessionId: "...",
  softTimeoutMs: 45000,
  output: "final",
  includeSteps: false,
  actions: [
    { type: "upload_files",  fieldLabel: "Resume/CV", paths: ["/abs/path/cv.pdf"] },
    { type: "fill_fields",   imeFriendly: true,
                             valuesByLabel: { "First Name": "...", "Last Name": "...", ... } },
    { type: "pick_listbox_option", fieldLabel: "Country", value: "United States" },
    ... (one entry per choice/listbox) ...
    { type: "click",         labelOrText: "Submit application" }
  ]
})
```

If the response contains `paused: true`, `pauseReason: "soft-timeout"`, and `resumeFromIndex`, call `geometra_run_actions` again immediately with the same `sessionId`, the exact same `actions` array, `softTimeoutMs: 45000`, `output: "final"`, `includeSteps: false`, and `resumeFromIndex` set to the returned value. This is a continuation, not a retry, and it is the host-safe path for long Samsara/Greenhouse-style embeds. Stop only if the continued call fails, not merely because it paused.

**Always pass `imeFriendly: true` on `fill_fields` for Ashby** (and safe as a default everywhere). Ashby's React form swallows programmatic text input silently — visible value looks correct, `invalidCount` stays >0, and Submit fails with "field required" or "flagged as possible spam." `imeFriendly: true` fires proper composition events that clear React's internal validity state. Confirmed fix: Supabase #793 (2026-04-19). Zero cost on other portals; no reason to leave it off.

### Use `fieldLabel` over `fieldId` (Rule B)

Labels are stable across DOM refreshes; IDs are not. If `fieldLabel` works, use it everywhere. Only fall back to `fieldId` when two fields share the same label (rare — add a qualifier via sibling text instead).

### Run recovery ONCE on ANY session error (Rule C)

**Trigger:** you see ANY of these error strings from a Geometra call:
- `Not connected`
- `session expired`
- `unknown session`
- `Failed to connect`
- `WebSocket` + `closed` / `error`

**Recovery sequence — run these FOUR calls in this EXACT order:**

```
Call 1:  geometra_list_sessions()
Call 2:  geometra_disconnect({ closeBrowser: true })
Call 3:  geometra_connect({
           pageUrl: "<the same URL as before>",
           isolated: true,
           headless: true,
           slowMo: 350,
           browserMode: "stock",
           blockDetection: true,
           blockedSitePolicy: "manual-handoff",
           proxy: <pass through from task prompt if present; omit otherwise>
         })
Call 4:  geometra_run_actions({
           sessionId: "<new sessionId from Call 3>",
           softTimeoutMs: 45000,
           output: "final",
           includeSteps: false,
           actions: [... the EXACT same actions array you used before ...]
         })
```

### Apply these recovery rules

1. **Always run all 4 calls.** Do not skip Call 1 or Call 2 even if Call 1 shows an empty pool.
2. **Do not re-fetch the form schema.** Do not call `geometra_form_schema` between Call 3 and Call 4. Your labels haven't changed, so the same `actions` array still works.
3. **Do not edit the actions array.** Copy it verbatim from your first attempt. Do not re-pick fieldIds. Do not add or remove actions. Same array in, same array out.
4. **Soft-timeout pause is not failure.** If Call 4 returns `paused: true`, continue with the returned `resumeFromIndex` and the exact same action array. Do not count this as the one retry.
5. **Only ONE retry.** If Call 4 ALSO fails, STOP. Return this exact message to the orchestrator:

   ```
   APPLY FAILED AFTER RECOVERY: <URL>
   Error 1: <first error message>
   Error 2: <error after recovery>
   Recommend: inspect telemetry before retrying this URL
   ```

   Do NOT try a third time. Do NOT try a different approach. The orchestrator will decide whether to retry after inspecting telemetry.

### Skip schema re-fetches mid-flow (Rule D)

`geometra_form_schema` returns hundreds of nested field IDs and pollutes context. Fetch it **at most once** per application, right after the initial `geometra_connect`, to discover the list of labels. After that, operate on labels only. Do not call `geometra_form_schema` again "to verify" — you're just paying for the same payload twice.

### Skip mixed upload + separate fill (Rule E)

If you've uploaded a file with a dedicated `geometra_run_actions` call (e.g., the resume), and THEN try a separate `geometra_fill_form` or `geometra_fill_fields` call, the field IDs from the pre-upload schema are already stale. This was the primary failure mode on the Anthropic FDE apply trace — 4 retries, ~10K wasted tokens. The fix is Rule A: do everything in one shot.

### Use two phases when the form has a post-upload conditional section (Exception)

Specific portals — Workday "parse my resume", iCIMS multi-step, SAP SuccessFactors — reveal additional fields ONLY after a file upload. In that case, use exactly two `run_actions` calls: (1) upload + wait_for, (2) fill+submit. After the first call, call `geometra_form_schema` **once** to discover the newly-revealed labels, then run the second call using labels. Never more than two phases.

### Resume-upload silent-fail → chooser-strategy fallback (Greenhouse)

Some Greenhouse tenants (Grafana Labs confirmed, 2026-04-19) render the resume upload as a file input where the default `upload_files` action readback succeeds but the field stays empty — Submit returns "Resume/CV is required." only after submit is clicked.

**Fix:** if the resume field shows empty after an `upload_files` action (either by explicit readback or by a "Resume/CV is required" error post-submit), re-upload using `strategy: chooser` with x,y coordinates pulled from the upload button's `visibleBounds` center. Example:

```
{ type: "upload_files",
  fieldLabel: "Resume/CV",
  paths: ["/abs/path/cv.pdf"],
  strategy: "chooser",
  x: 314, y: 474 }
```

The `chooser` strategy triggers the native file picker via click-at-coordinates, which bypasses the React-controlled input that silently drops programmatic assignments on some Greenhouse tenants. One retry is enough; if it still fails, mark Failed.

## Step 6 — Resolve OTP verification (if prompted)

Check for an OTP gate after the candidate (or Geometra) submits — the major portals (Greenhouse, Workday, Lever, Ashby) gate submission behind an email verification code. When an OTP step appears, do this.

1. **Do NOT stop and ask the candidate to paste the code manually.** Use the Gmail MCP.
2. **Pick the Gmail sender query from the ATS recorded at scan time.** The scan subagent records the ATS type in `batch/scan-output-{YYYY-MM-DD}.md` (`ats` column) and in `data/pipeline.md` (`| ats={type}` suffix). Read that value first — do NOT re-infer the ATS from the URL host when it's already recorded.
3. Map the `ats` value to the Gmail sender query (table below). Wait ~5-10 seconds for the email, then call `gmail_list_messages` with the matching query.
4. `gmail_get_message` on the most recent match, extract the code from the body.
5. `geometra_fill_otp` to enter it, then submit.

**ATS → Gmail sender query lookup** (use the `ats` value recorded at scan time):

| `ats` value | `q` for `gmail_list_messages` |
|-------------|-------------------------------|
| `greenhouse` | `from:greenhouse newer_than:10m` |
| `workday`    | `from:myworkday newer_than:10m` |
| `lever`      | `from:lever newer_than:10m` |
| `ashby`      | `from:ashby newer_than:10m` |
| `workable`   | `from:workable newer_than:10m` |
| `smartrecruiters` | `from:smartrecruiters newer_than:10m` |
| `wwr` / `remoteok` | Follow the apply redirect to the underlying ATS, re-detect the host, then use that row's query. Aggregators do not send OTP emails themselves. |
| `builtin`    | `from:builtin newer_than:10m` |
| Toast (via Greenhouse + ClinchTalent) | `from:toast.mail.clinchtalent.com newer_than:15m` OR `subject:"verify your login at Toast" newer_than:15m`. Default `from:greenhouse` returns null — Toast routes OTP through ClinchTalent. |
| `custom` / `unknown` / missing | `newer_than:10m subject:(verify OR code OR confirm)` |

**Fallback when `ats` is missing** (legacy pipeline entries with no `| ats=` suffix, or scan-output without an `ats` column): infer from the URL host — `*.greenhouse.io` → `greenhouse`; `jobs.ashbyhq.com` → `ashby`; `jobs.lever.co` → `lever`; `*.myworkdayjobs.com` → `workday`; `apply.workable.com` / `jobs.workable.com` → `workable`; `api.smartrecruiters.com` / `jobs.smartrecruiters.com` → `smartrecruiters`; `weworkremotely.com` → `wwr`; `remoteok.com` → `remoteok`; `builtin.com` → `builtin`; otherwise use the generic `verify OR code OR confirm` subject query.

**Before reporting the submission as failed, always check Gmail.** A "submit did nothing" outcome usually means a silent OTP step — not a real failure.

Full OTP recipe and fallback patterns: see "OTP Handling via Gmail MCP" in `AGENTS.md`.

## Step 7 — Update outcomes after submission

Select the matching case below — two cases, two different flows. Do NOT mix them.

### Update the existing row (Case A — prior `Evaluated` status)

The row exists. You are UPDATING an existing entry, which is allowed (Pipeline Integrity rule #2 in `AGENTS.md`):

1. Find the existing row in `data/applications/YYYY-MM-DD.md` (or an older day file — use `rg` to locate it)
2. Edit the `Status` column from `Evaluated` to `Applied` (or `FAILED` / `SKIP`)
3. Append a confirmation note to the `Notes` column (e.g. OTP code, confirmation URL)
4. Do NOT write a TSV. The row is already there.

### Write a TSV addition (Case B — no prior evaluation row)

The row does NOT exist yet. You MUST go through the TSV pathway (Hard Limit #6 + Pipeline Integrity rule #1):

1. Write `batch/tracker-additions/{num}-{slug}.tsv` with the canonical 9-column format (see "TSV Format for Tracker Additions" in `AGENTS.md`)
2. At the end of the apply run, the orchestrator calls `npx job-forge merge`, which inserts the row into today's day file
3. Do NOT manually add a row to the day file. Do NOT append an `APPLIED` line to `data/pipeline.md`.

### Apply to both cases

- Update Section G of the report with the final answers
<!-- isolint-disable-next-line undefined-step-reference -->
- Suggest next step: `/job-forge contact` for LinkedIn outreach — contact will automatically load this evaluation report and use the top proof points from Block B to craft targeted messages

## Resolve long forms by scrolling

If the form has more questions than are visible:
- Ask the candidate to scroll and share another screenshot
- Or paste the remaining questions
- Process in iterations until the entire form is covered
