# Mode: scan — Portal Scanner (Offer Discovery)

Scans configured job portals, filters by title relevance, and adds new offers to the pipeline for later evaluation.

## Recommended Execution

Run as a subagent to avoid consuming main context:

```
Agent(
    subagent_type="general-purpose",
    prompt="[contents of this file + specific data]",
    run_in_background=True
)
```

## Read This Configuration

Read `portals.yml` which contains:
- `search_queries`: List of WebSearch queries with `site:` filters per portal (broad discovery)
- `tracked_companies`: Specific companies with `careers_url` for direct navigation
- `title_filter`: Positive/negative/seniority_boost keywords for title filtering

## Apply This Discovery Strategy (3 levels)

### Use Level 1 — Direct Geometra (PRIMARY)

**For each company in `tracked_companies`:** Connect to its `careers_url` with Geometra MCP (`geometra_connect({ ..., headless: true, stealth: true })` + `geometra_page_model` / `geometra_list_items`), read ALL visible job listings, and extract the title + URL of each one. Direct Geometra is the most reliable method because:

- It sees the page in real time (not cached Google results).
- It works with SPAs (Ashby, Lever, Workday).
- It detects new offers instantly.
- It doesn't depend on Google indexing.

**Every company MUST have a `careers_url` in portals.yml.** If it doesn't, search for it once, save it, and use it in future scans.

### Use Level 2 — ATS / Aggregator APIs (COMPLEMENTARY)

For companies using an ATS or aggregator that exposes a public JSON/RSS API, fetch structured data directly. APIs are faster than Geometra and harder to hallucinate (the response is load-bearing — record IDs verbatim from the response, never reconstruct them). Use as a complement to Level 1.

**OpenCode WebFetch compatibility:** when fetching JSON/RSS API endpoints, do not pass `format: "json"`. OpenCode accepts `text`, `markdown`, or `html`; omit `format` or use `format: "text"` and parse JSON/RSS from the returned body.

Supported API shapes:

#### Greenhouse (JSON, per-company board)

- **Endpoint**: `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs`
- **Method**: `GET` (plain, no auth)
- **Shape**: `{ jobs: [{ id, title, absolute_url, updated_at, location: { name } }, ...] }`
- **Canonical URL to record**: `https://job-boards.greenhouse.io/{slug}/jobs/{id}` — do NOT use `absolute_url` when it points to a customer-skinned front-end (see **Verify Before Marking CLOSED** below).
- **ats**: `greenhouse`

#### Ashby (JSON, per-company board)

- **Endpoint**: `https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`
- **Method**: `GET`
- **Shape**: `{ jobs: [{ id, title, jobUrl, publishedDate, locationName, employmentType, department, team, compensation }] }`
- **Canonical URL to record**: use the returned `jobUrl` (format `https://jobs.ashbyhq.com/{slug}/{uuid}`).
- **ats**: `ashby`

#### Lever (JSON, per-company board)

- **Endpoint**: `https://api.lever.co/v0/postings/{slug}?mode=json`
- **Method**: `GET`
- **Shape**: array of postings `[{ id, text, hostedUrl, createdAt, categories: { commitment, department, location, team } }, ...]`
- **Canonical URL to record**: `hostedUrl` (format `https://jobs.lever.co/{slug}/{uuid}`).
- **ats**: `lever`

#### Workday (JSON, per-tenant + site — FINICKY)

- **Endpoint**: `https://{subdomain}.{pod}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs`
  - `subdomain` = the Workday tenant hostname prefix (e.g. `nvidia`, `salesforce`, `adobe`, `shopify`).
  - `pod` = the Workday data-center pod segment (varies: `wd1`, `wd3`, `wd5`). The hostname in `careers_url` reveals which.
  - `tenant` = repeats the company slug in the path (usually equal to `subdomain`, but not always).
  - `site` = the public site name exposed by the tenant (e.g. `NVIDIAExternalCareerSite`, `External`, `ShopifyCareerSite`). Read it from the tenant's HTML landing page if unknown.
- **Method**: `POST` with JSON body:
  ```json
  {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}
  ```
- **Required headers**: `Content-Type: application/json`, `Accept: application/json`. If the response is 403, set a realistic `User-Agent` header and retry — Workday tenants selectively block data-center UAs.
- **Shape**: `{ jobPostings: [{ title, externalPath, postedOn, locationsText, bulletFields }, ...], total }`
- **Canonical URL to record**: `https://{subdomain}.{pod}.myworkdayjobs.com/{site}{externalPath}` (note: `externalPath` already starts with `/job/...` — do NOT prepend an extra `/`).
- **Pagination**: increment `offset` by `limit` (20) until `jobPostings.length < limit` or `offset >= total`.
- **ats**: `workday`
- **Fallback**: Workday APIs are brittle — tenants occasionally block POST from data-center IPs, change `site` names silently, or return empty `jobPostings` while the HTML page shows listings. If the POST fails or returns 0 jobs on a tenant that Level 1 confirmed has listings, fall back to Level 1 (Geometra scraping the `careers_url`). Treat Workday as Level 2 with a guaranteed Level 1 fallback.

#### SmartRecruiters (JSON, per-company postings)

- **Endpoint**: `https://api.smartrecruiters.com/v1/companies/{company}/postings`
- **Method**: `GET` (plain, no auth)
- **Shape**: `{ content: [{ id, name, refNumber, jobAdUrl, releasedDate, location: { city, country, remote }, company: { identifier, name }, department }], totalFound, offset, limit }`
- **Canonical URL to record**: use `jobAdUrl` when present, otherwise `https://jobs.smartrecruiters.com/{company}/{id}`.
- **Pagination**: pass `?offset=N&limit=100` (max 100). Loop until `offset + content.length >= totalFound`.
- **ats**: `smartrecruiters`

#### WeWorkRemotely (RSS, cross-company aggregator)

- **Endpoints** (one per category — enable the ones matching your target roles):
  - `https://weworkremotely.com/categories/remote-programming-jobs.rss`
  - `https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss`
  - `https://weworkremotely.com/categories/remote-product-jobs.rss`
  - `https://weworkremotely.com/categories/remote-design-jobs.rss`
  - `https://weworkremotely.com/categories/all-other-remote-jobs.rss`
- **Method**: `GET` — returns RSS 2.0 XML.
- **Shape**: `<rss><channel><item><title>{company}: {role}</title><link>https://weworkremotely.com/remote-jobs/{slug}</link><pubDate>...</pubDate><region>...</region></item></channel></rss>`
- **Company/role extraction**: split `<title>` on the first `: ` — left side is company, right side is role. Fallback to the whole title as role if there is no `: `.
- **Canonical URL to record**: the `<link>` verbatim (format `https://weworkremotely.com/remote-jobs/{slug}`).
- **Cross-company note**: WeWorkRemotely is NOT per-company — it aggregates postings from hundreds of companies. Scan it via the `cross_company_feeds` section in `portals.yml`, not `tracked_companies`.
- **ats**: `wwr` (aggregator). The underlying company's ATS is unknown at scan time — downstream evaluators follow the link and re-detect.

#### RemoteOK (JSON, cross-company aggregator)

- **Endpoint**: `https://remoteok.com/api`
- **Method**: `GET` — returns a JSON array. The **first element is a legal/disclaimer object** (no `id`, has `legal`) — skip it. The remaining 100 entries are postings.
- **Required headers**: `User-Agent: Mozilla/5.0 ...` — RemoteOK returns 403 without a browser-like UA.
- **Shape** (per posting after skip): `{ id, slug, company, company_logo, position, description, tags: [string], date, epoch, url, apply_url, location, salary_min, salary_max }`
- **Canonical URL to record**: `url` (format `https://remoteok.com/remote-jobs/{id}-{slug}`).
- **Filtering**: RemoteOK feeds are broad — use `tags` for pre-filter (e.g. `tags` contains `"engineer"` or `"ai"`) before passing through `title_filter`.
- **Cross-company note**: same as WeWorkRemotely — configure via `cross_company_feeds`, not `tracked_companies`.
- **ats**: `remoteok` (aggregator).

### Use Level 3 — WebSearch Queries (BROAD DISCOVERY)

The `search_queries` with `site:` filters cover portals broadly (all Ashby boards, all Greenhouse boards, all Lever boards, all Workday boards). Useful for discovering NEW companies not yet in `tracked_companies`, but results may be outdated.

**Execution priority:**
1. Level 1: Geometra → all `tracked_companies` with `careers_url`
2. Level 2: API → all `tracked_companies` with `api:` (Greenhouse / Ashby / Lever / Workday / SmartRecruiters) AND all `cross_company_feeds` with `enabled: true` (WeWorkRemotely / RemoteOK)
3. Level 3: WebSearch → all `search_queries` with `enabled: true`

The levels are additive — all are executed, results are merged and deduplicated.

## Run This Workflow

1. **Read configuration**: `portals.yml`
2. **Read history**: `data/scan-history.tsv` → previously seen URLs
3. **Read dedup sources**: all day files in `data/applications/` + `data/pipeline.md`

4. **Level 1 — Geometra scan** (sequential, or ≤2 parallel via `task` subagents per Hard Limit #1 in `AGENTS.md`):
   For each company in `tracked_companies` with `enabled: true` and `careers_url` defined:
   a. `geometra_connect` to the `careers_url` with `headless: true` and `stealth: true`
   b. `geometra_page_model` or `geometra_list_items` to read all job listings
   c. If the page has filters/departments, navigate the relevant sections
   d. For each job listing extract: `{title, url, company}`
   e. If the page paginates results, navigate additional pages
   f. Accumulate in candidates list
   g. If `careers_url` fails (404, redirect), try `scan_query` as fallback and note for URL update

5. **Level 2 — ATS / Aggregator APIs** (WebFetch can batch freely — it's cheap and doesn't use Geometra sessions):

   **5a. Per-company APIs** — for each company in `tracked_companies` with `api:` defined and `enabled: true`:
   a. WebFetch (or `fetch` for Workday, which needs POST) the API URL per the endpoint shape documented above.
   b. Extract per-posting `{title, url, company, updated_at, ats}` plus ATS-specific IDs:
      - **Greenhouse** → also record `gh_slug`, `gh_id`. URL MUST be canonical `https://job-boards.greenhouse.io/{gh_slug}/jobs/{gh_id}` — do **NOT** use `absolute_url` when it points to a customer-skinned front-end (e.g. `pinterestcareers.com/jobs/?gh_jid=N`, `okta.com/company/careers/opportunity/N`, `samsara.com/company/careers/roles/N`, `zoominfo.com/careers?gh_jid=N`, `collibra.com/.../?gh_jid=N`, `careers.toasttab.com/jobs?gh_jid=N`, `careers.airbnb.com/positions/N`, `coinbase.com/careers/positions/N`, `instacart.careers/job/?gh_jid=N`). These customer front-ends return shells or 403 to bots and cause downstream WebFetch-based verification to wrongly mark the role CLOSED.
      - **Ashby** → record the returned `jobUrl`.
      - **Lever** → record the returned `hostedUrl`.
      - **Workday** → build URL as `https://{subdomain}.{pod}.myworkdayjobs.com/{site}{externalPath}`. If the POST fails, DROP that tenant's API attempt and fall back to Level 1 for that company — do NOT fabricate postings.
      - **SmartRecruiters** → record `jobAdUrl` (fallback: `https://jobs.smartrecruiters.com/{company}/{id}`).
      - **`updated_at`**: use `updated_at` (Greenhouse) / `publishedDate` (Ashby) / `createdAt` (Lever) / `postedOn` (Workday) / `releasedDate` (SmartRecruiters) — record for staleness detection (skip if older than 90 days, flag if older than 30).
   c. Accumulate in candidates list (dedup with Level 1). The pipeline.md entry MUST carry `| ats={type}` at the end, and for Greenhouse ALSO `| gh={gh_slug}/{gh_id}` so downstream evaluators can fall back to `https://boards-api.greenhouse.io/v1/boards/{gh_slug}/jobs/{gh_id}` when the canonical URL renders as a shell.

   **5b. Cross-company aggregator feeds** — for each feed in `cross_company_feeds` with `enabled: true`:
   a. WebFetch the RSS (WeWorkRemotely) or JSON (RemoteOK) endpoint per the shape documented above.
   b. Parse each entry to `{title, url, company, ats, updated_at}`:
      - **WeWorkRemotely** → split `<title>` on the first `: ` to separate company from role; `<link>` → url; `<pubDate>` → updated_at.
      - **RemoteOK** → skip the first element (legal disclaimer); from each remaining entry take `company`, `position`, `url`, `date`.
   c. Apply the feed's `tag_filter` / `category_filter` before the global `title_filter` — aggregators have much higher volume than per-company APIs.
   d. Accumulate in candidates list (dedup with Level 1 + 5a).

6. **Level 3 — WebSearch queries** (WebSearch is parallel-safe; batch freely):
   For each query in `search_queries` with `enabled: true`:
   a. Execute WebSearch with the defined `query`
   b. From each result extract: `{title, url, company}`
      - **title**: from the result title (before " @ " or " | ")
      - **url**: result URL
      - **company**: after " @ " in the title, or extract from domain/path
   c. Accumulate in candidates list (dedup with Level 1+2)

6. **Filter by title** using `title_filter` from `portals.yml`:
   - At least 1 keyword from `positive` must appear in the title (case-insensitive)
   - 0 keywords from `negative` must appear
   - `seniority_boost` keywords give priority but are not required

7. **Deduplicate** against 3 sources (URL-exact + fuzzy company+role):

   **Layer 1 — URL-exact:**
   - `scan-history.tsv` → exact URL already seen
   - `pipeline.md` → exact URL already in pending or processed

   **Layer 2 — Company + role fuzzy match (catches reposts with new URLs):**
   - all day files in `data/applications/` → normalize company name (lowercase, strip non-alphanumeric) + fuzzy role match (2+ significant words in common, words > 3 chars). This is the same logic used in `dedup-tracker.mjs` and `merge-tracker.mjs`.
   - `scan-history.tsv` → same fuzzy match against company + title columns (not just URL). A role reposted on a new URL but with the same company and similar title is a duplicate.
   - `pipeline.md` → same fuzzy match against company + title in pending items that include metadata (format: `- [ ] {url} | {company} | {title}`)

   **Fuzzy match rules:**
   - Normalize company: `company.toLowerCase().replace(/[^a-z0-9]/g, '')`
   - Fuzzy role match: split both titles into words > 3 chars, match if 2+ words overlap (substring match, case-insensitive). E.g., "Senior AI Engineer" and "Staff AI Engineer" share "engineer" — only 1 overlap, not a match. But "AI Platform Engineer" and "AI Platform Eng" share "platform" + partial "engineer" — match.
   - When a fuzzy match is found but the URL is new, log it as `skipped_repost` (not `skipped_dup`) with a note referencing the original entry number.

8. **For each new offer that passes filters**:
   a. Add to `pipeline.md` section "Pending": `- [ ] {url} | {company} | {title} | ats={ats}` — the `| ats={type}` suffix is REQUIRED for every entry (values: `greenhouse`, `ashby`, `workable`, `lever`, `workday`, `smartrecruiters`, `wwr`, `remoteok`, `builtin`, `custom`, `unknown`). When the offer came from the Greenhouse API (Level 2), ALSO append `| gh={gh_slug}/{gh_id}` so downstream verification can hit the JSON endpoint. Example entries:
      - `- [ ] https://job-boards.greenhouse.io/webflow/jobs/7689676 | Webflow | Lead AI Engineer | ats=greenhouse | gh=webflow/7689676`
      - `- [ ] https://jobs.ashbyhq.com/everai/abc-123 | EverAI | Senior AI PM | ats=ashby`
      - `- [ ] https://jobs.lever.co/temporal/xyz | Temporal | Product Manager - AI | ats=lever`
      - `- [ ] https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-AI-Engineer_JR123456 | NVIDIA | Senior AI Engineer | ats=workday`
      - `- [ ] https://jobs.smartrecruiters.com/Visa1/744000012345678 | Visa | Staff ML Engineer | ats=smartrecruiters`
      - `- [ ] https://weworkremotely.com/remote-jobs/acme-senior-platform-engineer | Acme | Senior Platform Engineer | ats=wwr`
      - `- [ ] https://remoteok.com/remote-jobs/12345-senior-ai-engineer-acme | Acme | Senior AI Engineer | ats=remoteok`
   b. Record in `scan-history.tsv`: `{url}\t{date}\t{query_name}\t{title}\t{company}\tadded`

9. **Offers filtered by title**: record in `scan-history.tsv` with status `skipped_title`
10. **Duplicate offers (URL-exact)**: record with status `skipped_dup`
11. **Duplicate offers (fuzzy repost)**: record with status `skipped_repost` and note `repost of #{original_entry_num}`

## Extract Title And Company From WebSearch Results

WebSearch results come in the format: `"Job Title @ Company"` or `"Job Title | Company"` or `"Job Title — Company"`.

Extraction patterns by portal:
- **Ashby**: `"Senior AI PM (Remote) @ EverAI"` → title: `Senior AI PM`, company: `EverAI`
- **Greenhouse**: `"AI Engineer at Anthropic"` → title: `AI Engineer`, company: `Anthropic`
- **Lever**: `"Product Manager - AI @ Temporal"` → title: `Product Manager - AI`, company: `Temporal`

Generic regex: `(.+?)(?:\s*[@|—–-]\s*|\s+at\s+)(.+?)$`

## Resolve Private URLs

If a publicly inaccessible URL is found:
1. Save the JD to `jds/{company}-{role-slug}.md`
2. Add to pipeline.md as: `- [ ] local:jds/{company}-{role-slug}.md | {company} | {title}`

## Scan History

`data/scan-history.tsv` tracks ALL seen URLs:

```
url	first_seen	portal	title	company	status
https://...	2026-02-10	Ashby — AI PM	PM AI	Acme	added
https://...	2026-02-10	Greenhouse — SA	Junior Dev	BigCo	skipped_title
https://...	2026-02-10	Ashby — AI PM	SA AI	OldCo	skipped_dup
```

## Structured Output — Required for Downstream Dispatch

Scan mode MUST write its ranked candidate list to a file, not just return it in prose. Downstream subagents (evaluators, applyers) must read URLs from this file, not from the scan subagent's return message. This prevents any hallucinated URL or ID from propagating.

**File location**: `batch/scan-output-{YYYY-MM-DD}.md`

**Format**: one markdown table per scan run, ordered by archetype-fit rank:

| rank | company | ats | role | gh_slug | gh_id | url | updated_at |
|------|---------|-----|------|---------|-------|-----|------------|
| 1    | Webflow | greenhouse | Lead AI Engineer | webflow | 7689676 | https://job-boards.greenhouse.io/webflow/jobs/7689676 | 2026-04-14 |
| 2    | EverAI  | ashby      | Senior AI PM     | -       | -       | https://jobs.ashbyhq.com/everai/abc-123 | 2026-04-15 |
| ... | ... | ... | ... | ... | ... | ... | ... |

**`ats` values** (one of): `greenhouse`, `ashby`, `workable`, `lever`, `workday`, `smartrecruiters`, `wwr`, `remoteok`, `builtin`, `custom`, `unknown`. Every row MUST populate this column — it's what the apply subagent uses to pick the correct Gmail OTP sender query. The `wwr` and `remoteok` values identify aggregator postings whose real underlying ATS is only known after the redirect is followed — downstream evaluators re-detect and may rewrite to the underlying ATS.

Every row MUST have:
- `ats` — the ATS platform hosting the posting. Inferred from the canonical URL host (e.g. `boards-api.greenhouse.io` / `job-boards.greenhouse.io` → `greenhouse`; `jobs.ashbyhq.com` → `ashby`; `jobs.lever.co` → `lever`; `*.myworkdayjobs.com` (any `wd1`/`wd3`/`wd5` pod) → `workday`; `apply.workable.com` / `jobs.workable.com` → `workable`; `api.smartrecruiters.com` / `jobs.smartrecruiters.com` → `smartrecruiters`; `weworkremotely.com` → `wwr`; `remoteok.com` → `remoteok`; `builtin.com/jobs/` → `builtin`; company-own domains → `custom`; anything indeterminate → `unknown`).
- `url` in canonical form. For Greenhouse use `https://job-boards.greenhouse.io/{gh_slug}/jobs/{gh_id}` (matching the suffix in `data/pipeline.md`). For other ATSes use the platform's native URL (do not rewrite).
- `updated_at` in `YYYY-MM-DD` form (the most recent `updated_at` in the API response, or scan date when the source has no such field).

Additional columns — REQUIRED when available, `-` (dash) when not applicable:
- `gh_slug`, `gh_id` — Greenhouse-only. Copied verbatim from the Greenhouse API response (not reconstructed). For non-Greenhouse rows, emit `-` in both columns; `ats` + `url` are sufficient.

The scan subagent's return message MUST:
- Reference the file path (so orchestrators know where to read)
- Omit the ranked URL list from prose entirely (summary counts only)

**Rationale**: in a prior run, a scan subagent returned correct IDs in `scan-history.tsv` but hallucinated plausible-looking fake IDs in its prose-form top-30 list. The orchestrator trusted prose and dispatched 30 downstream subagents against fake URLs. File-based handoff prevents this class of error. Recording `ats` at scan time (rather than having the apply subagent infer it from the URL host) saves downstream re-parsing and keeps the OTP sender lookup deterministic.

## Output Summary

```
Portal Scan — {YYYY-MM-DD}
━━━━━━━━━━━━━━━━━━━━━━━━━━
Queries executed: N
Offers found: N total
Filtered by title: N relevant
Duplicates: N (already evaluated or in pipeline)
New added to pipeline.md: N

NEXT STEP RECOMMENDATION:
- Structured candidate list written to: batch/scan-output-{YYYY-MM-DD}.md
- Downstream subagents MUST read URLs from that file, not from this return message
- Run /job-forge pipeline to evaluate the new offers.
```

## Verify Before Marking CLOSED (downstream rule)

**DO NOT mark a Greenhouse offer CLOSED based on a WebFetch/Geometra result alone.** Customer-skinned careers pages serve bot-hostile shells — a 403, a navbar-only response, or a client-side-only render — and WebFetch sees "no JD" and mis-classifies as CLOSED. Known customer-skinned hosts: `pinterestcareers.com`, `okta.com`, `samsara.com`, `zoominfo.com`, `collibra.com`, `careers.toasttab.com`, `careers.airbnb.com`, `coinbase.com`, `instacart.careers`. Treat any host that is NOT `greenhouse.io` / `job-boards.greenhouse.io` / `boards-api.greenhouse.io` as customer-skinned.

**Correct verification order for any Greenhouse-sourced URL** (identified by a `| gh={slug}/{id}` suffix in `pipeline.md` or a `boards-api.greenhouse.io` / `job-boards.greenhouse.io` / `boards.greenhouse.io` host):

1. Try `https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}`. This is the authoritative source.
   - **200 + JSON with `title` and `content`** → offer is LIVE. Use the JSON content as the JD. Do not mark CLOSED.
   - **404** → offer is genuinely closed. Mark CLOSED.
   - **Other non-2xx** → treat as transient (network/rate-limit); retry once. If still failing, mark `**Verification: unconfirmed**` and continue evaluation from whatever text is available. Do NOT mark CLOSED.
2. Only then fall back to WebFetch of the canonical `job-boards.greenhouse.io/{slug}/jobs/{id}` URL.
3. Only then fall back to Geometra on the same canonical URL.

**Rule:** Greenhouse postings with valid `gh_slug`/`gh_id` MUST be verified via the API first. A WebFetch failure on a customer-skinned domain is NOT evidence the role is closed.

## Update careers_url

Each company in `tracked_companies` MUST have a `careers_url` — the direct URL to its job listings page. The stored URL avoids searching for it every time.

**Known patterns by platform:**
- **Ashby:** `https://jobs.ashbyhq.com/{slug}`
- **Greenhouse:** `https://job-boards.greenhouse.io/{slug}` or `https://job-boards.eu.greenhouse.io/{slug}`
- **Lever:** `https://jobs.lever.co/{slug}`
- **Workday:** `https://{subdomain}.{pod}.myworkdayjobs.com/{site}` (pod = `wd1`/`wd3`/`wd5`/..., varies by tenant data center; site is tenant-defined, e.g. `External`, `NVIDIAExternalCareerSite`)
- **SmartRecruiters:** `https://careers.smartrecruiters.com/{company}` (human-facing) / `https://api.smartrecruiters.com/v1/companies/{company}/postings` (API)
- **Custom:** The company's own URL (e.g., `https://openai.com/careers`)

**If `careers_url` doesn't exist** for a company:
1. Try the pattern for its known platform
2. If that fails, do a quick WebSearch: `"{company}" careers jobs`
3. Navigate with Geometra (`geometra_connect` with `headless: true` and `stealth: true`) to confirm it works
4. **Save the found URL in portals.yml** for future scans

**If `careers_url` returns 404 or redirect:**
1. Note in the output summary
2. Try scan_query as fallback
3. Flag for manual update

## Update portals.yml

- **ALWAYS save `careers_url`** when adding a new company
- Add new queries as interesting portals or roles are discovered
- Disable queries with `enabled: false` if they generate too much noise
- Adjust filtering keywords as target roles evolve
- Add companies to `tracked_companies` when you want to follow them closely
- Verify `careers_url` periodically — companies change ATS platforms
