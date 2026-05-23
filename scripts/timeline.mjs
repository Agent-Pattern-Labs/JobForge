#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import {
  formatCheckResult,
  formatConfigSummary,
  formatTimelineResult,
  formatVerifyResult,
} from '@agent-pattern-labs/iso-timeline';
import { PROJECT_DIR } from '../tracker-lib.mjs';
import {
  buildJobForgeTimeline,
  buildJobForgeTimelineEvents,
  checkJobForgeTimeline,
  dueJobForgeTimeline,
  jobForgeTimelineConfigPath,
  jobForgeTimelineEventsPath,
  jobForgeTimelinePath,
  jobForgeTimelineSummary,
  planJobForgeTimeline,
  readJobForgeTimelineConfig,
  timelineExists,
  verifyJobForgeTimeline,
} from '../lib/jobforge-timeline.mjs';

const USAGE = `job-forge timeline - deterministic follow-up and next-action planning

Usage:
  job-forge timeline:status [--json]
  job-forge timeline:build [--now <iso>] [--json]
  job-forge timeline:plan [--now <iso>] [--out <file>] [--json]
  job-forge timeline:due [--now <iso>] [--json]
  job-forge timeline:check [--now <iso>] [--fail-on overdue|due|none] [--json]
  job-forge timeline:verify [--json]
  job-forge timeline:explain [--json]
  job-forge timeline:path [--config|--events]

Default policy is templates/timeline.json. Tracker day files and dated pipeline
items are converted into .jobforge-timeline-events.jsonl; the plan is written
to .jobforge-timeline.json by timeline:build. This is local project state, not
an MCP and not prompt context.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'path') {
    path(opts);
  } else if (cmd === 'status') {
    status(opts);
  } else if (cmd === 'build') {
    build(opts);
  } else if (cmd === 'plan') {
    plan(opts);
  } else if (cmd === 'due') {
    due(opts);
  } else if (cmd === 'check') {
    check(opts);
  } else if (cmd === 'verify') {
    verify(opts);
  } else if (cmd === 'explain') {
    explain(opts);
  } else {
    console.error(`unknown timeline command "${cmd}"\n`);
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const opts = {
    json: false,
    help: false,
    failOn: undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--now') {
      opts.now = valueAfter(args, ++i, '--now');
    } else if (arg.startsWith('--now=')) {
      opts.now = arg.slice('--now='.length);
    } else if (arg === '--fail-on') {
      opts.failOn = valueAfter(args, ++i, '--fail-on');
    } else if (arg.startsWith('--fail-on=')) {
      opts.failOn = arg.slice('--fail-on='.length);
    } else if (arg === '--out') {
      opts.out = valueAfter(args, ++i, '--out');
    } else if (arg.startsWith('--out=')) {
      opts.out = arg.slice('--out='.length);
    } else if (arg === '--config') {
      opts.configPath = true;
    } else if (arg === '--events') {
      opts.eventsPath = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`unknown flag "${arg}"`);
    }
  }

  return opts;
}

function valueAfter(values, index, flag) {
  const value = values[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function path(opts) {
  if (opts.configPath) {
    console.log(jobForgeTimelineConfigPath(PROJECT_DIR));
  } else if (opts.eventsPath) {
    console.log(jobForgeTimelineEventsPath(PROJECT_DIR));
  } else {
    console.log(jobForgeTimelinePath(PROJECT_DIR));
  }
}

function status(opts) {
  const summary = jobForgeTimelineSummary(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (!summary.exists) {
    console.log(`timeline: missing (${relativePath(summary.path)})`);
    console.log('run: job-forge timeline:build');
    return;
  }
  const verifyResult = verifyJobForgeTimeline({}, PROJECT_DIR);
  console.log(`timeline: ${relativePath(summary.path)}`);
  console.log(`events:   ${relativePath(summary.eventsPath)} (${summary.eventsExists ? 'present' : 'missing'})`);
  console.log(`items:    ${summary.items}`);
  console.log(`due:      ${summary.due}`);
  console.log(`overdue:  ${summary.overdue}`);
  console.log(`verify:   ${verifyResult.ok ? 'PASS' : 'FAIL'} (${verifyResult.errors} errors, ${verifyResult.warnings} warnings)`);
}

function build(opts) {
  const result = buildJobForgeTimeline({ now: opts.now }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify({
      out: result.out,
      eventsOut: result.eventsOut,
      events: result.events.length,
      stats: result.result.stats,
    }, null, 2));
    return;
  }
  console.log(`timeline: wrote ${relativePath(result.out)}`);
  console.log(`events:   wrote ${relativePath(result.eventsOut)} (${result.events.length} event(s))`);
  console.log(formatTimelineResult(result.result));
}

function plan(opts) {
  const result = planJobForgeTimeline({ now: opts.now }, PROJECT_DIR);
  if (opts.out) writePlan(resolveInputPath(opts.out), result);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(formatTimelineResult(result));
}

function due(opts) {
  const result = dueJobForgeTimeline({ now: opts.now }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTimelineResult(result));
  }
}

function check(opts) {
  const result = checkJobForgeTimeline({ now: opts.now, failOn: opts.failOn }, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatCheckResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function verify(opts) {
  if (!timelineExists(PROJECT_DIR)) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, missing: true, path: jobForgeTimelinePath(PROJECT_DIR) }, null, 2));
    } else {
      console.log(`timeline: missing (${relativePath(jobForgeTimelinePath(PROJECT_DIR))})`);
    }
    return;
  }
  const result = verifyJobForgeTimeline({}, PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatVerifyResult(result));
  }
  process.exit(result.ok ? 0 : 1);
}

function explain(opts) {
  const config = readJobForgeTimelineConfig(PROJECT_DIR);
  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }
  console.log(`config: ${relativePath(jobForgeTimelineConfigPath(PROJECT_DIR))}`);
  console.log(formatConfigSummary(config));
  const events = buildJobForgeTimelineEvents(PROJECT_DIR);
  console.log(`events available now: ${events.length}`);
}

function resolveInputPath(path) {
  return isAbsolute(path) ? path : resolve(PROJECT_DIR, path);
}

function relativePath(path) {
  return relative(PROJECT_DIR, path) || '.';
}

function writePlan(path, result) {
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
