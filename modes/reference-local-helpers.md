# Reference: Local Helpers

JobForge's architectural helpers are local CLIs and JSON policies, not MCPs. They add no always-on prompt or tool-schema tokens. Use them when they can answer a question or validate an artifact more deterministically than prose.

## Selection Rule

Prefer a local helper when the workflow needs:

- Identity, duplicate, or status truth.
- Machine-readable artifact validation.
- Context, capability, or migration policy.
- Dispatch planning or settlement.
- One-shot rendered browser snapshots or form schemas.
- Scoring, timing, priority, or lineage decisions.
- Safe export checks.

Do not paste whole helper outputs into prompts unless the downstream agent needs that exact file-backed result. Prefer passing paths, ids, keys, and short summaries.

## Helper Map

| Need | Source / state | Command |
|---|---|---|
| Trace inspection | Local OpenCode transcripts | `npx job-forge trace:*` |
| Run telemetry | Local traces + tracker TSV state | `npx job-forge telemetry:*` |
| Guard audits | `templates/guards/jobforge-baseline.yaml` | `npx job-forge guard:*` |
| Workflow state | `.jobforge-ledger/events.jsonl` | `npx job-forge ledger:*` |
| Artifact contracts | `templates/contracts.json` | `npx job-forge tracker-line ... --write`; `npx job-forge verify` |
| Role capability policy | `templates/capabilities.json` | `npx job-forge capabilities:*` |
| Context bundle policy | `templates/context.json` | `npx job-forge context:*` |
| Browser snapshots / form schemas | Direct `@geometra/mcp` session module | `npx job-forge portal:*` |
| JD/artifact reuse | `.jobforge-cache/` | `npx job-forge cache:*` |
| Artifact lookup | `.jobforge-index.json` from `templates/index.json` | `npx job-forge index:*` |
| Source-backed facts | `.jobforge-facts.json` from `templates/facts.json` | `npx job-forge facts:*` |
| Consumer upgrades | `templates/migrations.json` | `npx job-forge migrate:*` |
| Identity keys | `templates/canon.json` | `npx job-forge canon:*` |
| Apply dispatch safety | `templates/preflight.json` | `npx job-forge preflight:*` |
| Dispatch settlement | `templates/postflight.json` | `npx job-forge postflight:*` |
| Safe export | `templates/redact.json` | `npx job-forge redact:*` |
| Offer scoring | `templates/score.json` | `npx job-forge score:*` |
| Follow-up timing | `templates/timeline.json` | `npx job-forge timeline:*` |
| Next-action ranking | `templates/prioritize.json` | `npx job-forge prioritize:*` |
| Artifact lineage | `.jobforge-lineage.json` | `npx job-forge lineage:*` |

## Mandatory Uses

- Before duplicate-sensitive apply dispatches, use `canon:key`, `index:has`, `facts:has`, or `ledger:has` as cheap prefilters when useful, then still apply the H2 four-source grep unless the candidate JSON already materializes those sources.
- For tracker additions, prefer `tracker-line --write`; if TSV is emitted manually, `merge` and `verify` must validate it through `templates/contracts.json`.
- For score-driven apply/PDF decisions, run `score:check --input <file>` and `score:gate --input <file> --gate apply`.
- For follow-up triage, run `timeline:due`; use `timeline:check --fail-on overdue` when stale follow-ups should fail the workflow.
- For next-action or replacement-candidate selection, run `prioritize:build` or `prioritize:select --limit N`.
- For generated reports or PDFs reused after input changes, run `lineage:check --artifact <file>` if lineage exists; after creating derived artifacts, record them with `lineage:record --artifact <file> --input <source>...`.
- Before exporting traces, prompts, reports, or fixtures outside the project, run `redact:scan`, `redact:apply`, or `redact:verify`.
- When diagnosing consumer harness drift, run `migrate:plan` or `migrate:check`; `job-forge sync` applies safe migrations automatically unless `JOB_FORGE_SKIP_MIGRATIONS=1` is set.
- When you only need a rendered page model, compact snapshot, or form schema from one URL, prefer `portal:snapshot` / `portal:form-schema` over Geometra MCP tool calls. Use MCP for interactive multi-step browser sessions.

## Enforcement

The integration surface is checked by `npm run lint:helpers`. That check verifies helper dependencies, package scripts, scaffolder scripts, migration scripts, generated ignores, templates, and this reference stay aligned.
