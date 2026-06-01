## OTP Handling via Gmail MCP -- REQUIRED

When a form says "enter the code we sent to your email", you MUST retrieve the code from Gmail. NEVER ask the user to paste it. NEVER mark the application as failed without checking Gmail first.

**You have exactly two Gmail tools.** There is NO `gmail_search_messages` and NO `gmail_read_message`. Use only these:

| Tool | What it does | Key parameter |
|------|-------------|---------------|
| `gmail_list_messages` | Search emails. Returns message IDs + snippets. | `q` — Gmail search query string |
| `gmail_get_message` | Read one email by ID. Returns full headers + body. | `id` — message ID from step 1 |

**Step-by-step recipe (follow exactly):**

1. Reach the OTP step in the form. Do NOT close or abandon the session.
2. Wait ~5-10 seconds for the email to arrive.
3. Call `gmail_list_messages` with `q` set to the sender query from the Sender Lookup Table. Example:
   ```
   gmail_list_messages({ q: "from:greenhouse newer_than:10m", maxResults: 5 })
   ```
4. Take the `id` field from the first result. Call `gmail_get_message` with that `id`. Example:
   ```
   gmail_get_message({ id: "19d84d63a273c271" })
   ```
5. Find the code in the snippet or body. It is usually 6-8 characters near words like "security code" or "verification code".
6. Call `geometra_fill_otp` with the code. Example:
   ```
   geometra_fill_otp({ value: "ABC12345", sessionId: "..." })
   ```
7. Submit the form.

**Sender Lookup Table:**

| Portal | `q` value for `gmail_list_messages` |
|--------|-------------------------------------|
| Greenhouse | `from:greenhouse newer_than:10m` |
| Workday | `from:myworkday newer_than:10m` |
| Lever | `from:lever newer_than:10m` |
| Ashby | `from:ashby newer_than:10m` |
| SmartRecruiters | `from:smartrecruiters newer_than:10m` |
| Toast (via ClinchTalent) | `from:toast.mail.clinchtalent.com newer_than:15m` OR `subject:"verify your login at Toast" newer_than:15m` |
| Aggregator redirect (WeWorkRemotely / RemoteOK) | Detect the underlying ATS from the post-redirect URL, then use that row's sender query |
| Unknown | `newer_than:10m subject:(verify OR code OR confirm)` |

**Rules:**
- ALWAYS check Gmail before reporting a submission as failed.
- If "submit button did nothing", it usually means an OTP step appeared. Check Gmail.
- If no email after 10 seconds, retry `gmail_list_messages` once more with `newer_than:5m`.
- **Some Greenhouse tenants route OTP through third-party verification (Toast uses ClinchTalent).** If `from:greenhouse` returns empty after a Greenhouse submit, check the tenant-specific sender row above. Confirmed 2026-04-19: Toast Principal SWE #807 and Toast Senior FE #808.

---

## BYO Residential Proxy + Stealth Chromium

**Problem:** on 2026-04-19 cycle 4, 5/5 untested Ashby tenants and 100% of Dropbox-class Cloudflare-fronted portals fingerprint-blocked headless Chromium from datacenter IPs. `imeFriendly: true` fixes class A (React validation lag) but has zero effect on class B (environment fingerprint). There is no in-session software-only fix for class B: the server decided the session is a bot before the form response was rendered.

**Fix:** route the spawned Chromium through a residential or mobile proxy the candidate already pays for, and launch Geometra's headless CloakBrowser stealth Chromium with `headless: true` and `stealth: true`. Geometra MCP v1.59.0 added a `proxy: { server, username?, password?, bypass? }` parameter on `geometra_connect` and `geometra_prepare_browser`; v1.61.3 added `stealth: true` for CloakBrowser. The outbound IP becomes residential/mobile, the browser fingerprint moves off stock Playwright Chromium, and the class-B checks have fewer signals to trip.

**Proxy is opt-in; headless and stealth are default.** JobForge does NOT bundle or resell proxy bandwidth — the candidate brings their own provider (Bright Data, Oxylabs, SOAX, Smartproxy, mobile hotspot, self-hosted SOCKS). Without a configured proxy, JobForge still passes `headless: true` and `stealth: true`, but the outbound IP remains the machine or hosting environment running Chromium.

### Where the proxy config lives

`config/profile.yml` → top-level `proxy:` block:

```yaml
proxy:
  server: "http://residential.example.com:8080"   # http://, https://, or socks5://
  username: "your-proxy-username"                  # optional
  password: "your-proxy-password"                  # optional
  bypass: "*.internal,localhost"                   # optional
```

See `config/profile.example.yml` for the commented-out template.

### How the orchestrator threads it through

**Orchestrator responsibilities:**

1. On session start, read `config/profile.yml` once. If a `proxy:` block is present, remember that a proxy is configured, but do not paste username/password values into task prompts or user-visible status.
2. When dispatching any subagent whose work involves a `geometra_connect` call or a Geometra auto-connect call with `pageUrl` / `url`, tell it to read `config/profile.yml` and pass the top-level `proxy:` block plus `headless: true` and `stealth: true` to every connect. Example dispatch prompt line: "Proxy is configured; read `config/profile.yml` and pass its top-level `proxy:` object plus `headless: true` and `stealth: true` to every Geometra connect or auto-connect call."
3. When the orchestrator itself opens a Chromium session (single-application interactive flow), include the same `proxy` object from `config/profile.yml`, `headless: true`, and `stealth: true` in its own `geometra_connect` call.
4. If `proxy:` is absent from `profile.yml`, skip the param entirely. Do NOT invent a proxy URL or leave a stale placeholder.

**Subagent responsibilities:**

1. If the task prompt says proxy is configured, read `config/profile.yml` and pass the top-level `proxy:` object plus `headless: true` and `stealth: true` through to `geometra_connect`, any Geometra auto-connect call with `pageUrl` / `url`, and any `geometra_prepare_browser` calls unchanged.
2. If the task prompt includes a legacy inline `proxy` object, pass it through unchanged and still set `headless: true` and `stealth: true`, but never print the credentials back in status text.
3. If the task prompt does NOT mention a proxy and `config/profile.yml` has no `proxy:` block, run with `headless: true`, `stealth: true`, and no proxy.
4. Never second-guess the proxy field — if it comes from `profile.yml`, it's authoritative.

### When proxy use is load-bearing

Apply these rules when deciding whether the proxy is worth waiting for:

- **Required** for known-block Ashby tenants (see the class-B list in the Ashby section above), for `happydance.website` / Cloudflare-fronted ATSes, and for any Lever tenant that previously failed in the class-B pattern.
- **Recommended** for any Ashby tenant NOT on the class-A-compatible list (base rate prior: ~80-90% block headless).
- **Optional** for Greenhouse, Workday, Lever-clean tenants — these accept datacenter IPs today; using the proxy adds ~100ms per frame but no material downside.
- **Not useful** for Typeform (Geometra-unsupported), Avature native-select lag (not a fingerprint issue), JazzHR+reCAPTCHA (reCAPTCHA scores unrelated to IP), Breezy (tenant-configured per-IP throttle — proxy may help or may hit a fresh throttle).

### Pool partitioning — why mixed runs are safe

The Geometra MCP partitions its reusable-proxy pool by proxy identity and browser flavor — proxy partitioning landed in `@geometra/mcp@1.59.0`, and stealth partitioning is available in `@geometra/mcp@1.61.3`. A direct session and a proxied session NEVER share a Chromium instance, and stock and stealth sessions do not pool together. Practical consequence: flipping `proxy:` on or off in `profile.yml` mid-session is safe — the next `geometra_connect` just opens a fresh Chromium in its own pool partition.

### Direct helper for one-shot reads

Use `npx job-forge portal:snapshot --url "{url}" --json` or `npx job-forge portal:form-schema --url "{url}" --json` when you only need a rendered page model, compact snapshot, or form schema. These commands import Geometra's session module directly instead of going through MCP, enforce `headless: true`, `stealth: true`, and `isolated: true`, pass the `config/profile.yml` proxy block if configured, and close Chromium before exit. Keep MCP for interactive multi-step browser automation where a live `sessionId` must be driven across actions.

### Troubleshooting

| Symptom | Diagnosis |
|---|---|
| `Error: Failed to connect to proxy` immediately after `geometra_connect` | Proxy URL is wrong / unreachable. Verify the `server:` field hits the right host:port. |
| `407 Proxy Authentication Required` | `username` or `password` is wrong or missing. Many residential providers require both. |
| Class-B submit failure persists even with proxy set | (a) proxy is a datacenter proxy, not residential; (b) same tenant IP-banned your specific proxy's IP pool; (c) tenant uses TLS fingerprint / canvas fingerprint, not IP — switch to a fresh Chromium (isolated: true) and retry once, else mark Failed. |
| Every `geometra_connect` is 3-5s slower than before | Expected — residential proxies add latency. Trade-off for higher submit-success rate. Do NOT revert unless the acceptance-rate lift is < 5%. |

---

## MCP Configuration

- Node.js (mjs modules), Geometra MCP (PDF + scraping + form filling), Gmail MCP (email), YAML (config), HTML/CSS (template), Markdown (data)

**Current MCP servers** (configured in `opencode.json`):

| MCP | Package | Purpose |
|-----|---------|---------|
| `geometra` | `@geometra/mcp` | PDF generation, web scraping, form filling |
| `gmail` | `@razroo/gmail-mcp` | Email integration (drafts, send, labels, threads) |

```json
{
  "mcp": {
    "geometra": {
      "type": "stdio",
      "command": "npx",
      "args": ["--no-install", "job-forge", "mcp:geometra"]
    },
    "gmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@razroo/gmail-mcp"]
    }
  }
}
```

`job-forge mcp:geometra` resolves Geometra in this order: `JOB_FORGE_GEOMETRA_MCP_PATH`, then `package.json -> jobForge.geometraMcpPath`, then `opencode.json -> mcp.geometra.environment.JOB_FORGE_GEOMETRA_MCP_PATH`, then a sibling local `../geometra/mcp/dist/index.js` checkout for maintainers working across both repos, then the pinned npm fallback.

To check or modify MCP settings, edit `opencode.json` in the project root.
