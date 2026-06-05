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

## BYO Proxy + Block Detection

**Problem:** Some portals return CAPTCHA, challenge, access-denied, unsupported-browser, rate-limit, or similar blocked states before a form can be read or submitted. `imeFriendly: true` fixes React validation lag, but it cannot change a server-side portal decision.

**Default response:** JobForge keeps the browser hidden and predictable: pass `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `blockedSitePolicy: "manual-handoff"` on Geometra connects. Geometra MCP >=1.62.3 returns structured `blockedSite` and `manualHandoff` metadata so the orchestrator can record the block, stop retries, and ask for a manual path when needed.

**Proxy is opt-in.** JobForge does NOT bundle or resell proxy bandwidth. If the candidate has their own proxy for legitimate network routing, JobForge can pass the top-level `proxy:` object through to Geometra without printing credentials. Without a configured proxy, JobForge omits the proxy parameter.

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
2. When dispatching any subagent whose work involves a `geometra_connect` call or a Geometra auto-connect call with `pageUrl` / `url`, tell it to read `config/profile.yml` and pass the top-level `proxy:` block plus `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `blockedSitePolicy: "manual-handoff"` to every connect. Example dispatch prompt line: "Proxy is configured; read `config/profile.yml` and pass its top-level `proxy:` object plus `headless: true`, `browserMode: \"stock\"`, `blockDetection: true`, and `blockedSitePolicy: \"manual-handoff\"` to every Geometra connect or auto-connect call."
3. When the orchestrator itself opens a Chromium session (single-application interactive flow), include the same `proxy` object from `config/profile.yml`, `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `blockedSitePolicy: "manual-handoff"` in its own `geometra_connect` call.
4. If `proxy:` is absent from `profile.yml`, skip the param entirely. Do NOT invent a proxy URL or leave a stale placeholder.

**Subagent responsibilities:**

1. If the task prompt says proxy is configured, read `config/profile.yml` and pass the top-level `proxy:` object plus `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `blockedSitePolicy: "manual-handoff"` through to `geometra_connect` and any Geometra auto-connect call with `pageUrl` / `url`. For `geometra_prepare_browser`, pass only the supported launch fields: `proxy`, `headless: true`, and `browserMode: "stock"`.
2. If the task prompt includes a legacy inline `proxy` object, pass it through unchanged and still set the same headless/browser/block-detection options, but never print the credentials back in status text.
3. If the task prompt does NOT mention a proxy and `config/profile.yml` has no `proxy:` block, run with `headless: true`, `browserMode: "stock"`, `blockDetection: true`, `blockedSitePolicy: "manual-handoff"`, and no proxy.
4. Never second-guess the proxy field — if it comes from `profile.yml`, it's authoritative.

### When blocked-site metadata is load-bearing

Apply these rules when deciding whether to stop automation and hand off:

- **Stop immediately** when Geometra returns `blockedSite.detected: true` with `blockedSitePolicy: "manual-handoff"` and the page is a CAPTCHA, Cloudflare challenge, access-denied page, unsupported-browser page, or rate-limit notice.
- **Retry once only** for Ashby text-field rejection when `invalidCount` suggested React validation lag; the retry must use `imeFriendly: true`. If the same spam/block message repeats after clean fills, stop.
- **Do not spend time on Geometra-unsupported portals** such as Typeform or known native-select validation dead ends such as Avature. Mark Failed with the specific reason.
- **Use a configured proxy only when it is already present in `profile.yml`.** Never invent a proxy, ask subagents to paste credentials, or print the configured values.

### Pool partitioning — why mixed runs are safe

The Geometra MCP partitions its reusable-proxy pool by proxy identity and browser mode. A direct session and a proxied session NEVER share a Chromium instance, and stock and explicitly requested alternate browser modes do not pool together. Practical consequence: flipping `proxy:` on or off in `profile.yml` mid-session is safe — the next `geometra_connect` just opens a fresh Chromium in its own pool partition.

### Direct helper for one-shot reads

Use `npx job-forge portal:snapshot --url "{url}" --json` or `npx job-forge portal:form-schema --url "{url}" --json` when you only need a rendered page model, compact snapshot, form schema, or `blockedSite` metadata from one URL. These commands import Geometra's session module directly instead of going through MCP, enforce `headless: true`, `browserMode: "stock"`, `blockDetection: true`, and `isolated: true`, pass the `config/profile.yml` proxy block if configured, and close Chromium before exit. Keep MCP for interactive multi-step browser automation where a live `sessionId` must be driven across actions.

### Troubleshooting

| Symptom | Diagnosis |
|---|---|
| `Error: Failed to connect to proxy` immediately after `geometra_connect` | Proxy URL is wrong / unreachable. Verify the `server:` field hits the right host:port. |
| `407 Proxy Authentication Required` | `username` or `password` is wrong or missing. Many residential providers require both. |
| `blockedSite.detected: true` on connect or page model | Stop automation for that URL, preserve the `blockedSite` payload, and route to manual handoff or mark Failed with the specific block type. |
| Proxy is configured but pages fail immediately | Proxy URL/auth may be wrong, or the target site may reject the route. Verify the `server:` field locally; do not paste credentials into prompts. |
| Every `geometra_connect` is 3-5s slower than before | Expected when a configured proxy adds network latency. Remove or adjust `proxy:` in `profile.yml` only if the candidate no longer wants that routing. |

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

JobForge's Geometra launcher writes a durable lifecycle log at `.jobforge-mcp/geometra-mcp.jsonl` in the consumer project. The log is JSONL and does not use stdout, so it does not interfere with the MCP stdio protocol. Expected events include `launcher_start`, `child_spawn`, periodic `heartbeat`, `child_stderr`, `signal_received`, `child_error`, and `child_exit`. Override the location with `JOB_FORGE_GEOMETRA_MCP_LOG_PATH`, disable it with `JOB_FORGE_GEOMETRA_MCP_LOG=0`, or tune the heartbeat with `JOB_FORGE_GEOMETRA_MCP_HEARTBEAT_MS`.

To check or modify MCP settings, edit `opencode.json` in the project root.

## Silent MCP Death Diagnostics

If Geometra MCP vanishes with no stderr, no crash log, and subsequent calls return `Not connected`, inspect the lifecycle log before making a claim:

```bash
tail -40 .jobforge-mcp/geometra-mcp.jsonl
```

- Last event is `signal_received`: the MCP host or parent process sent a catchable signal such as `SIGTERM`.
- Last event is `child_exit`: the Geometra child process exited and the log should show its code or signal.
- Last event is `child_stderr`: preserve the stderr text; it is the best upstream bug report payload.
- Last event is an old `heartbeat` with no later `signal_received` or `child_exit`: likely host `SIGKILL`, OS kill, or wrapper process death. No process can log after `SIGKILL`, so report the heartbeat timestamp and the missing exit event.
- No `launcher_start`: OpenCode never started JobForge's Geometra launcher, or it used a different MCP command/config.
