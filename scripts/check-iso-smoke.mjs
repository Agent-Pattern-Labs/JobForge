#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".");
const files = {
  instructions: readFileSync(resolve(root, "iso/instructions.md"), "utf8"),
  instructionsOpencode: readFileSync(resolve(root, "iso/instructions.opencode.md"), "utf8"),
  helpers: readFileSync(resolve(root, "modes/reference-local-helpers.md"), "utf8"),
  apply: readFileSync(resolve(root, "modes/apply.md"), "utf8"),
  models: readFileSync(resolve(root, "models.yaml"), "utf8"),
  config: readFileSync(resolve(root, "iso/config.json"), "utf8"),
};

const checks = [
  ["root defines H1-H7", () => every(files.instructions, ["[H1]", "[H2]", "[H3]", "[H4]", "[H5]", "[H6]", "[H7]"])],
  ["H1 caps dispatches at 2", () => /Max 2 parallel `task` dispatches/.test(files.instructions)],
  ["H2 checks all duplicate sources", () => every(files.instructions, ["data/pipeline.md", "data/applications/*.md", "batch/tracker-additions/*.tsv", "batch/tracker-additions/merged/*.tsv"])],
  ["H3 names Geometra cleanup calls", () => every(files.instructions, ["geometra_list_sessions", "geometra_disconnect({closeBrowser: true})"])],
  ["H4 blocks orchestrator form filling", () => every(files.instructions, ["MUST NOT call `geometra_fill_form`", "`geometra_run_actions`", "`geometra_fill_otp`"])],
  ["H5 blocks same-company concurrent retry", () => every(files.instructions, ["Re-dispatch the same company only AFTER", "previous subagent returns"])],
  ["H6 requires merge and verify", () => every(files.instructions, ["batch/tracker-additions/*.tsv", "npx job-forge merge", "npx job-forge verify"])],
  ["H7 distrusts subagent prose", () => every(files.instructions, ["must originate from a file", "not from prior subagent prose"])],
  ["H8 keeps proxy secret and requires headless stealth", () => every(files.instructions, ["[H8]", "Do not transcribe `server`, `username`, `password`, or `bypass`", "`headless: true`", "`stealth: true`"])],
  ["H9 points to Geometra MCP lifecycle logs", () => every(files.instructions, ["[H9]", ".jobforge-mcp/geometra-mcp.jsonl", "launcher_start", "heartbeat", "child_exit"])],
  ["OpenCode addendum exists for task semantics", () => every(files.instructionsOpencode, ["OpenCode", "`task`", "launch acknowledgement", "Do not use `task` to poll status"])],
  ["root points to consolidated helper reference", () => every(files.instructions, ["[D8]", "modes/reference-local-helpers.md", "deterministic local helpers"])],
  ["helper reference covers score/timeline/prioritize/lineage", () => every(files.helpers, ["templates/score.json", "npx job-forge score:*", "templates/timeline.json", "npx job-forge timeline:*", "templates/prioritize.json", "npx job-forge prioritize:*", ".jobforge-lineage.json", "npx job-forge lineage:*"])],
  ["root helper defaults are consolidated", () => !/\[D(?:9|1\d|2[0-9])\]/.test(files.instructions)],
  ["shared prompt points to on-demand references", () => every(files.instructions, ["modes/{mode}.md", "modes/reference-setup.md", "modes/reference-portals.md", "modes/reference-geometra.md"])],
  ["apply mode requires headless stealth Geometra", () => every(files.apply, ["`headless: true`", "`stealth: true`", "`isolated: true`", "every Geometra auto-connect call"])],
  ["apply mode uses host-safe run_actions continuations", () => every(files.apply, ["softTimeoutMs: 45000", "resumeFromIndex", "pauseReason: \"soft-timeout\"", "This is a continuation, not a retry"])],
  ["apply mode owns high-stakes upgrade", () => every(files.apply, ["[D8]", "@general-paid", "4.0/5", "high-stakes"])],
  ["apply mode blocks provider auto-downgrade", () => every(files.apply, ["[D9]", "do not auto-downgrade", "inspect telemetry before retrying"])],
  ["models policy pins OpenCode to DeepSeek V4 Flash", () => /extends:\s*standard/.test(files.models) && count(files.models, "opencode-go/deepseek-v4-flash") >= 4],
  ["OpenCode fallback plugin is not configured", () => !every(files.config, ["opencodeModelFallback", "@razroo/opencode-model-fallback"])],
];

const failures = checks
  .filter(([, check]) => !check())
  .map(([name]) => name);

if (failures.length > 0) {
  console.error("JobForge iso smoke failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`JobForge iso smoke passed (${checks.length} checks).`);

function every(source, needles) {
  return needles.every((needle) => source.includes(needle));
}

function count(source, needle) {
  return source.split(needle).length - 1;
}
