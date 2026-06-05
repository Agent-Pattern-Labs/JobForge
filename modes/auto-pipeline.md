# Mode: auto-pipeline — Full Automatic Pipeline

When the user pastes a JD (text or URL) without an explicit sub-command, execute the ENTIRE pipeline in sequence:

## Step 0 — Extract JD

Fetch the JD content once. If the input is a **URL** (not pasted JD text), fetch the content **once** using exactly ONE of the methods below. **Do NOT chain methods as redundant fallbacks** — each method re-pulls the same 3-5K tokens into context.

**Pick exactly one method, in this priority order:**

1. **Greenhouse JSON API (first try, if the URL is Greenhouse-backed):** If the pipeline.md entry carries `| gh={slug}/{id}` OR the URL host matches `*.greenhouse.io` / a known Greenhouse customer front-end (`*.pinterestcareers.com`, `okta.com/company/careers/opportunity/*`, `samsara.com/company/careers/roles/*`, `zoominfo.com/careers?gh_jid=*`, `collibra.com/.../?gh_jid=*`, `careers.toasttab.com/jobs?gh_jid=*`, `careers.airbnb.com/positions/*?gh_jid=*`, `coinbase.com/careers/positions/*?gh_jid=*`, `instacart.careers/job/?gh_jid=*`), extract `slug` and `id` and WebFetch `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}`. 200 + JSON with `content` is the authoritative JD. 404 = genuinely closed (mark CLOSED and stop). **OpenCode WebFetch compatibility:** do not pass `format: "json"`; omit `format` or use `format: "text"` and parse the returned JSON text. **If 200, STOP — do not fall back to Geometra or WebFetch of the front-end.** The API is faster, cheaper (no Geometra session), and never returns a bot-shell.
2. **Direct Geometra helper:** Most non-Greenhouse job portals (Lever, Ashby, Workday) are SPAs. Use `npx job-forge portal:snapshot --url "{url}" --json` to render and read the page model/snapshot. This helper enforces `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `isolated: true` in code, reads `config/profile.yml` proxy config, returns `blockedSite` metadata when detected, and closes Chromium before exit. **If this returns non-empty JD text, STOP — do not WebFetch the same URL.**
3. **WebFetch (only if Geometra is unavailable OR returned only a shell with no JD text):** For static pages (ZipRecruiter, WeLoveProduct, company career pages).
4. **WebSearch (only if methods 1–3 all failed):** Search for the role title + company on secondary portals that index the JD in static HTML.

**Do NOT mark a Greenhouse-sourced offer CLOSED based on a WebFetch shell or a 403 from a customer-skinned careers domain.** Pinterest, Okta, Samsara, ZoomInfo, Collibra, Toast, Airbnb, Coinbase, Instacart all serve bot-hostile fronts. The Greenhouse JSON API (step 1) is the ground truth for their offer state. A previous scan run fed 60 live Greenhouse URLs through WebFetch-only verification and 100% of them were wrongly marked CLOSED; if you see a high stale rate, you are skipping step 1.

**Rule:** Each URL gets fetched at most once per session. If you already have the JD text in context — from Geometra, a previous WebFetch, or pasted by the candidate — do not fetch again.

**If no method works:** Ask the candidate to paste the JD manually or share a screenshot.

**If the input is JD text** (not a URL): use it directly, no fetching needed.

**Local artifacts before Step 0 methods:** Grep `reports/` for the URL or stable company+role slug; if a report already embeds the full JD, Read it and skip network fetch entirely. If the pipeline row or `jds/` references `local:jds/{file}`, Read that file first. For URL inputs, run `npx job-forge cache:has --url "{url}"` and then `npx job-forge cache:get --url "{url}"` on a hit; cached JD text is authoritative local content and avoids a browser/network fetch. This stacks with the rule above: one fetch per URL per session, and **zero** if the JD is already on disk or in `.jobforge-cache/`.

**Cache after a successful fetch:** If the JD text is written to `jds/` or embedded in a report, store that exact text with `npx job-forge cache:put --url "{url}" --ttl 14d --input @path/to/jd.md`. Do not refetch just to populate the cache.

## Step 1 — Run Evaluation A-F
Execute exactly as in the `offer` mode (read `modes/offer.md` for all blocks A-F).

## Step 2 — Save Report .md
Save the complete evaluation to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` (see format in `modes/offer.md`).

## Step 3 — Generate PDF
Execute the full `pdf` pipeline (read `modes/pdf.md`).

## Step 4 — Generate Application Answers When Score >= 3.5

Generate draft answers for the application form when the final score is >= 3.5. If the final score is >= 3.5 (per Canonical Scoring Model thresholds in `_shared.md`), generate draft answers for the application form:

1. **Extract form questions**: Prefer `npx job-forge portal:form-schema --url "{apply_url}" --json` to discover all form fields without leaving a browser open. Use Geometra MCP only when a live multi-step browser session already exists and must be reused. If questions cannot be extracted, use the generic questions.
2. **Generate answers** following the tone guidelines (see below).
3. **Save in the report** as a `## G) Draft Application Answers` section.

### Use Generic Questions When Form Extraction Fails

- Why are you interested in this role?
- Why do you want to work at [Company]?
- Tell us about a relevant project or achievement.
- What makes you a strong fit for this position?
- How did you hear about this role?

### Apply This Tone For Form Answers

**Position: "I'm choosing you."** The candidate has options and is choosing this company for concrete reasons.

**Tone rules:**

- **Confident without arrogance**: "I've spent the past year building production AI agent systems — your role is where I want to apply that experience next".
- **Selective without overstatement**: "I've been intentional about finding a team where I can contribute meaningfully from day one".
- **Specific and concrete**: Always reference something REAL from the JD or the company, and something REAL from the candidate's experience.
- **Direct, no fluff**: 2-4 sentences per answer. No "I'm passionate about..." or "I would love the opportunity to...".
- **The hook is the proof, not the claim**: Instead of "I'm great at X", say "I built X that does Y".

**Framework per question:**
- **Why this role?** → "Your [specific thing] maps directly to [specific thing I built]."
- **Why this company?** → Mention something concrete about the company. "I've been using [product] for [time/purpose]."
- **Relevant experience?** → A quantified proof point. "Built [X] that [metric]. Sold the company in 2025."
- **Strong fit?** → "I sit at the intersection of [A] and [B], which is exactly where this role lives."
- **How did you hear?** → Honest: "Found through [portal/scan], evaluated against my criteria, and it scored highest."

**Language**: Always in the language of the JD (EN default). Apply `/tech-translate`.

## Step 5 — Update Tracker
Update the current day file `data/applications/YYYY-MM-DD.md` with all columns including Report and PDF marked as ✅.

**If any step fails**, continue with the remaining steps and mark the failed step as pending in the tracker.
