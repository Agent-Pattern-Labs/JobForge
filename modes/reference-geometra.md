## Geometra Form-Fill Patterns

### Validation State Lags Behind Actual Field State

**This is a known issue across Greenhouse, Ashby, and similar ATS portals.** The frontend validation does not always update synchronously with field input. A field can be correctly filled but still show `invalid: true` or "This field is required" in the schema for 3-10 seconds — or even permanently until the user interacts with another field.

**Common false-positive patterns:**
- `set_checked` / `geometra_set_checked` sets a checkbox to `checked: true`, but the schema still shows `invalid: true` with "This field is required." A known lag affects privacy policy / acknowledgment checkboxes.
- A dropdown/choice field is correctly picked, but the invalid flag persists.
- A text field is filled correctly, but validation error text remains until the user tabs or blurs the field.
- Combobox / autocomplete fields show stale "invalid" overlays after correct selection (Greenhouse, Ashby, Workday, Lever) but submit successfully.

**Rule: Do NOT get stuck in a fill loop.** If a field value looks correct (checked=true, value="No", "Yes") but `invalidCount` is unchanged:

1. **Try Submit anyway.** The major portals (Greenhouse, Workday, Lever, Ashby) allow submission with stale validation errors as long as the underlying value is correct.
2. **If Submit is disabled**, try interacting with a nearby field (Tab, click another input) to force validation recalculation.
3. **If a checkbox still shows invalid after `set_checked`**, try clicking it directly by coordinates (`geometra_click` with x,y) instead of the label-based toggle.
4. **For combobox fields**, pick the option via `geometra_pick_listbox_option` (preferred) rather than typing — typing into comboboxes often creates a stale autocomplete overlay that blocks confirmation.

**Decision tree for "field shows invalid after fill":**

```
Is the visible value correct?
├── YES → Try Submit (preferred action)
│         If Submit disabled → Tab away and back, then try Submit
│         Still blocked → try clicking a nearby field to force recalc
└── NO → Re-fill the field using the correct field id
```

**The `invalidCount` from schema is a heuristic, not ground truth.** Always prefer direct observation of field values over the invalid count. If Submit becomes enabled, ignore any remaining invalid fields — the portal accepted the data.

**Text-field specific fix — `imeFriendly: true`.** For text fills where the React-controlled input swallows programmatic value assignment (visible value correct, but `invalidCount` stays >0 and Submit is rejected with "flagged as possible spam" or "field required"), pass `imeFriendly: true` to `geometra_fill_fields`. This fires proper composition events (`compositionstart` / `input` / `compositionend`) that clear React's internal validity state. Confirmed fix on Ashby for Supabase (2026-04-19): first submit rejected despite clean fills; refill with `imeFriendly: true` succeeded on retry. Safe to use as default on all Ashby text fields — no cost if not needed.

### Ashby Anti-Bot Spam Filter — Two Failure Classes

**Symptom:** after a form is filled cleanly (`invalidCount: 0`, all values correct) and Submit is clicked, Ashby returns: *"We couldn't submit your application. Your application submission was flagged as possible spam."*

These blocks come from two distinct root causes and require different responses:

| Class | Root cause | Recoverable in-session? | Fix |
|---|---|---|---|
| **A. React-validation lag** | programmatic text input didn't fire composition events; React marks required fields internally missing even though values look correct | Yes | Refill with `imeFriendly: true` and resubmit once. |
| **B. Environment fingerprint** | datacenter IP / VPN / headless Chromium signatures / browser-extension tells detected server-side | No (in headless) | Mark `Failed` with note "Ashby env-fingerprint"; recommend manual submit from user's own browser. |

**How to tell them apart:** if you saw `invalidCount > 0` and the "required field" error BEFORE submit, class A is likely — retry with `imeFriendly: true`. If the form filled perfectly clean (`invalidCount: 0` on every step) and the spam flag fires only on submit, class B is likely — Ashby's "Learn more" dialog cites VPN/proxy, ad blockers, shared/public network, which `imeFriendly` cannot influence.

**Evidence (2026-04-19 session):**
- Class A confirmed: Supabase #793 (rejected → refilled with `imeFriendly` → applied).
- Class B confirmed: Unstructured #786 + ClickUp #787 — both filled cleanly with per-field `imeFriendly: true`, both still spam-flagged on submit with identical "VPN / ad blockers / shared network" messaging.

**Rule — do NOT loop retrying a class B block.** One retry with `imeFriendly: true` is the correct test for class A. If the same spam message fires after a clean `imeFriendly` refill, stop, mark Failed, move on. Repeated retries waste subagent time and do not change the outcome.

**Class B fix — BYO residential proxy + headless stealth Chromium.** When the candidate has configured `proxy:` in `config/profile.yml`, every `geometra_connect` call threads that proxy through to Chromium, which flips the outbound IP from datacenter to residential/mobile. JobForge also passes `headless: true` and `stealth: true` so Geometra MCP runs without opening a visible browser and Geometra MCP >=1.61.3 launches CloakBrowser's patched Chromium instead of stock Playwright Chromium. See the "BYO Residential Proxy" reference section below. Without a configured proxy, stealth still helps browser fingerprinting, but the outbound IP remains datacenter.

**Known-block Ashby tenants (2026-04-19 empirical observations).** These tenants fired class B on every attempted submit from a headless datacenter-IP proxy. Orchestrators planning apply dispatches should assume these tenants will Fail in headless — prioritize other portals, or skip same-tenant siblings after a confirmed class B to avoid burning subagent slots:

- Vellum, Linear, Vanta, River Financial, Higharc, Trace Labs, Solace Health, Unstructured, ClickUp, Zapier, Deepgram, Ramp, WorkOS, Ashby (self-tenant), Perplexity, **Goody**, **Starbridge**, **Graphite**, **Prompt Health**, **Vantage**

**Known class-A-compatible Ashby tenants (same observations).** These tenants accepted headless submits cleanly, often with `imeFriendly: true` making the difference on the text-field subset:

- Supabase, LangChain, Poolside, Runway Financial, Sentry, Cognition

**Base rate for untested Ashby tenants (5/5 tested 2026-04-19 cycle 4 = class B).** The prior today is ~80-90% of untested Ashby tenants fingerprint-block headless submits. Orchestrators should treat any tenant not on the class-A-compatible list as likely class B — still dispatch to collect the data point, but don't burn multiple sibling-role slots on the same Ashby tenant.

The pattern is tenant configuration, not role or company size. Lists drift as tenants tune their anti-bot — treat as probabilistic priors, not hard rules.

**Ashby choice-group with `optionCount: 1` and no labels (Sentry pattern).** Some Ashby tenants render Yes/No work-authorization questions as `role="button" name="Application"` pill toggles where the accessibility tree exposes neither `Yes` nor `No` labels. `fill_fields` with `choiceType: "group"` silently no-ops; `geometra_click` by `id` also fails to toggle. Fix: fall back to `geometra_click` with RAW x,y coordinates at the button centers (Yes is typically the left button, No is the right). Confirmed on Sentry Staff Platform #845, 2026-04-19.

### Other Portal Failure Classes

**Typeform applications are Geometra-unsupported.** Some companies (Better Stack confirmed, 2026-04-19) route the Apply link to a Typeform wizard (`*.typeform.com/apply-*`). Typeform renders questions via a custom React/canvas layer that does NOT expose input fields to the accessibility tree — `geometra_form_schema` returns "No forms found", `geometra_query role=textbox` returns empty, blind `geometra_type` produces no semantic change. Mark `Failed` with reason "Typeform portal — Geometra unsupported" on detection; do not burn the 9-minute budget attempting blind input.

**Avature multi-step wizards have a native-`<select>` validation lag (Bloomberg pattern).** Bloomberg's careers site redirects to `bloomberg.avature.net` with a 4-step wizard. On Step 2, native `<select>` elements ("Is Current Position? / No") accept the value but keep `invalid: true` persistently — neither Tab, re-submit, nor re-pick clears it. `imeFriendly` has no effect because the field is a native `<select>`, not React-controlled text. There is no documented recovery. Mark `Failed` with reason "Avature native-select validation lag"; account creation up to that point is preserved for any future manual path. Confirmed on Bloomberg Sr SWE Auth #828, 2026-04-19.

**Cloudflare / ATS-vendor blocks on Dropbox-class portals.** Dropbox's real apply flow lives behind `happydance.website` (ATS vendor), which Cloudflare-fingerprints headless Chromium + datacenter IPs and returns "Sorry, you have been blocked". `job-boards.greenhouse.io/dropbox` does not mirror — there is no public Greenhouse fallback. Symptom-wise indistinguishable from Ashby class B but at a different layer. Mark `Failed` with reason "ATS vendor Cloudflare block (happydance.website or equivalent)". Confirmed on Dropbox Sr FS Product #831, 2026-04-19.

**Greenhouse OTP-on-fill variant (Instacart pattern).** Most Greenhouse OTP flows fire on Submit. A minority (Instacart Staff FoodStorm #827, 2026-04-19) fire the 8-cell security-code gate mid-fill, BEFORE the user clicks Submit. Detection: watch for an 8-cell OTP input surfacing after resume upload or the first listbox commit. Fetch from Gmail (`from:greenhouse newer_than:10m`) immediately when it appears — do not wait for Submit.

**`geometra_fill_otp` char-drop on first fill.** Occasionally `fill_otp` lands only the first character of an 8-char code (seen on Instacart, 2026-04-19). Recovery: click the first cell to focus, then re-issue `fill_otp` with `perCharDelayMs: 120`. The form usually auto-submits once all 8 cells are populated.

**Breezy portal — tenant-dependent, native `<select>`, resume-auto-parse is primary.** A subset of companies (Avantos AI, Courted, Instinct Science confirmed 2026-04-19) host applications on `*.breezy.hr` or `applytojob.com`. Empirical rules:

- **Class is per-tenant, not uniform.** Avantos (Failed 2026-04-19 #854) returned Breezy's own "It looks like maybe you've already applied to this job?" banner from IP fingerprinting, even on a first submit — distinct failure mode from Ashby's "flagged as possible spam". Courted (Applied 2026-04-19 #855) went through cleanly on the same session. Don't pre-skip Breezy; the outcome is tenant-specific.
- **Native `<select>` elements, not React comboboxes.** `geometra_pick_listbox_option` sets the visible display but NOT the underlying form state — submit will fail with "A response is required" on every combobox. Use `geometra_select_option` with x,y + label value for every choice field on Breezy.
- **Resume-auto-parse carries the signal.** After resume upload, Breezy auto-parses work history and education into structured rows. Do NOT Add/Delete position rows via Geometra — row mutations reshuffle fieldIds mid-flow, sequential `fill_fields` calls land in wrong rows, and upstream pollution corrupts earlier positions. Trust the parsed resume and fill only Personal Details + salary.

**Mailto-apply portals — direct email via gmail-mcp `attachments`.** A subset of HN-listed companies (CoPlane, Gambit Robotics, Rinse, Digital Health Strategies confirmed 2026-04-19) don't host an ATS form — their careers page instructs sending resume by email to `founders@...` / `jobs@...` / `contact@...`. Detection: WebFetch the careers URL; if the Apply link resolves to `mailto:` or the copy reads "email your resume to …", skip Geometra entirely.

Use `gmail_send_message` with the `attachments` parameter (available from `@razroo/gmail-mcp@1.8.0`):

```
gmail_send_message({
  to: ["founders@example.com"],
  subject: "Application — Forward Deployed AI Engineer — Charlie Greenman (Austin)",
  body: "<Section G pitch, 4-8 short paragraphs>",
  attachments: [{ path: "/abs/path/to/Charlie-Greenman-CV.pdf" }]
})
```

The MCP reads the file from disk and builds multipart/mixed MIME server-side — do NOT manually base64-encode a PDF into the `raw` parameter (the inline blob exceeds tool-call argument limits for any real attachment). Subject is auto MIME-encoded for non-ASCII (em-dash, smart quotes) by the same version. For older gmail-mcp versions (< 1.8.0) the only path was a direct Gmail API POST with the stored OAuth token at `~/.gmail-mcp/credentials.json` — upgrade if you can.

Mark Applied with note `mailto portal — sent via gmail_send_message; Gmail msgId {id}`. Verify via `gmail_get_message` that the attachment intact-size matches what was on disk before writing the TSV.

### Greenhouse Bot-Detection Honeypots

Some Greenhouse tenants (Grafana Labs confirmed, 2026-04-19) inject a honeypot-style single-pick question on the application form, rendered as a listbox labeled something like "Which of the following best describes you?" with options resembling "I am a human being / I am a bot / I am a robot".

**Rule:** pick the "I am a human being" option (or whichever option is the obvious human-authentic choice). Bots that pick other options are filtered before submit. This is NOT a validation check — the field will always read back clean — but the submit will be silently discarded if the wrong option is selected.

If the honeypot question is absent, skip. If present, always pick the human option.

### Nested Scroll Containers (Greenhouse / Ashby)

The major ATS portals (Greenhouse, Workday, Lever, Ashby) use nested scrollable regions. A field's `visibleBounds` may show it as off-screen even when it is actually visible within a child scroll container. Geometra's `scroll_to` operates on the outermost page scroll, so it cannot reach fields in inner scroll regions.

**Signs you are dealing with nested scroll:**
- `scroll_to` reports `revealed: false` with `maxSteps` exhausted, but you can see the field in the page model
- A field's `y` coordinate in `bounds` is far outside the viewport, yet it is visible on screen
- Wheel events at one `y` coordinate scroll a different region than expected

**Workaround:**
1. Use `geometra_wheel` at a low `y` value (e.g., 360, near the top of the viewport) to scroll the outer container
2. Alternatively, click directly on the element using `geometra_click` with x,y coordinates derived from the element's `visibleBounds` center
3. Once in the correct scroll region, `scroll_to` within that region works correctly

### Corrupted Fields (Text Typed Into Listbox)

Sometimes text typed into the wrong field (e.g., an essay pasted into a listbox search field) corrupts the field state. The listbox shows the typed text as a search query and refuses to clear.

**Recovery:**
1. Find and click the "Clear selections" button (`role: "button"`, `name: "Clear selections"`) — this usually resets the field
2. After clearing, use `geometra_pick_listbox_option` to select the correct value
3. If "Clear selections" is not available, try pressing `Escape` multiple times or clicking outside the dropdown

### Parallel Form Submissions — Isolated Sessions Required

When running multiple application forms in parallel, each `geometra_connect` MUST use `isolated: true`. Without this flag, sessions share the Chromium browser pool and contaminate each other's localStorage, cookies, and autocomplete state — one job's email address can leak into another job's form.

**Correct parallel pattern:**
```javascript
geometra_connect({ pageUrl: "https://...", isolated: true, headless: true, slowMo: 350, stealth: true })
```

**Wrong:** running `geometra_connect` without `isolated: true` when submitting multiple forms concurrently. The forms may share state and produce incorrect submissions.

**With a configured proxy,** add `proxy: { server, username?, password?, bypass? }` to the same call — see "BYO Residential Proxy" below. The reusable-proxy pool is partitioned by proxy identity, so mixing direct and proxied sessions across parallel rounds is safe. Keep `headless: true` and `stealth: true` either way so JobForge uses Geometra's CloakBrowser Chromium path for portal sessions without opening visible windows.

### Session Reuse — When Subagents Cannot Reach Existing Sessions

Subagents launched via the `task` tool start with a fresh context and cannot automatically attach to Chromium sessions spawned by a previous orchestrator session. If you dispatch a subagent to fill a form in session `s16`, but `s16` was created by a previous opencode session, the subagent's MCP calls will silently fail (returning empty results) because the subagent's MCP server has no knowledge of `s16`.

**Rule:** When resuming work on forms that were opened in a previous opencode session, drive them from the current orchestrator session directly — do not delegate to a subagent.

**Session IDs persist** across the same opencode session. Within one orchestrator session, `geometra_list_sessions` correctly shows all active sessions (s16, s17, s18, and any other s-prefixed IDs from this session) and `geometra_fill_form`, `geometra_page_model`, and other tools work against those sessions. Subagents are only reliable for NEW form-fill sessions they open themselves.

### Stale Session Cleanup — MANDATORY

**Problem in one sentence:** if any previous subagent aborted (ran out of context, timed out, hit tool error), the Chromium session it opened is STUCK in the Geometra MCP pool, and the NEXT `geometra_connect` will fail with `Not connected`.

**Fix in one sentence:** ALWAYS run `geometra_list_sessions` + `geometra_disconnect` BEFORE `geometra_connect`. Every time. No exceptions except the one explicit exception below.

If Geometra MCP itself disappears or becomes unresponsive, inspect `.jobforge-mcp/geometra-mcp.jsonl` before escalating. `signal_received` means the MCP host or parent process sent a catchable signal, `child_exit` means the Geometra child exited, `child_stderr` preserves stderr that may not show in the agent transcript, and a final stale `heartbeat` with no later event usually means SIGKILL / host reap / OS kill. Report the final event type and timestamp rather than saying only "MCP crashed."

---

#### Rule 1 — Orchestrator pre-dispatch cleanup (DO THIS EVERY TIME)

Before dispatching ANY batch of subagents that will use Geometra (apply, scan, pipeline, batch, auto-pipeline), run these TWO tool calls IN ORDER, with these EXACT arguments:

```
Step 1:  geometra_list_sessions()
Step 2:  geometra_disconnect({ closeBrowser: true })
```

**DO NOT** think about whether cleanup is needed. **DO NOT** check if sessions look "fine". **DO NOT** skip Step 2 if Step 1 returns an empty list. Just run both, every time, before `task` dispatch. It costs ~100 tokens and prevents cascade failures.

**Then** dispatch your subagents.

**Single exception:** if you (the orchestrator) opened a session earlier in THIS SAME conversation and want a subagent to attach to it, skip cleanup and pass the exact `sessionId` to the subagent. This applies to interactive single-application flows only.

---

#### Rule 2 — Subagent pre-flight cleanup (DO THIS EVERY TIME)

Every subagent that uses Geometra must run these THREE tool calls as its FIRST three tool calls, in this order, with these EXACT arguments:

```
Step 1:  geometra_list_sessions()
Step 2:  geometra_disconnect({ closeBrowser: true })
Step 3:  geometra_connect({ pageUrl: "<the URL the orchestrator gave you>", isolated: true, headless: true, slowMo: 350, stealth: true })
```

**If the orchestrator says proxy is configured,** read the top-level
`proxy:` block from `config/profile.yml` and add it to Step 3:

```
Step 3:  geometra_connect({
           pageUrl: "<URL>", isolated: true, headless: true, slowMo: 350, stealth: true,
           proxy: { server: "...", username: "...", password: "...", bypass: "..." }
         })
```

Pass the proxy object through unchanged. Do NOT paraphrase or drop fields — `username`/`password`/`bypass` are optional, so only include what exists in `config/profile.yml`. Do not echo proxy credentials in status text. See the "BYO Residential Proxy" reference section for the why.

**DO NOT** skip Step 1 or Step 2. **DO NOT** think about whether it's needed. **DO NOT** look at `geometra_list_sessions` output and reason about it — just always call `geometra_disconnect({ closeBrowser: true })` next. The disconnect is a no-op if the pool is empty, and a poison-cure if it isn't.

**Single exception:** if the orchestrator's task prompt says literally "attach to sessionId X" or "use existing session X", skip Steps 1-3 and call `geometra_page_model({ sessionId: "X" })` directly.

---

#### Rule 3 — Routing high-value applications

When the orchestrator dispatches an `apply` (form-fill + submit), pick the subagent based on this table:

| Offer score | Subagent |
|-------------|----------|
| 3.0-3.9/5 | `@general-free` |
| 4.0+/5 | `@general-paid` |
| User said "top-tier", "dream job", "high-stakes" | `@general-paid` |
| Late-stage pipeline (already passed screens) | `@general-paid` |

**Why:** form-fill flows are 6+ steps. Free-tier models have smaller context windows and sometimes abort mid-flow when the form schema is large (Greenhouse, Workday). Paid tier has more headroom. Evaluation and procedural non-apply work stay on `@general-free` — only the `apply` step gets upgraded.
