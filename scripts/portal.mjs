#!/usr/bin/env node

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROJECT_DIR } from '../tracker-lib.mjs';

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 768;
const DEFAULT_SLOW_MO = 350;
const DEFAULT_MAX_NODES = 120;

const USAGE = `job-forge portal - deterministic direct-Geometra browser helpers

Usage:
  job-forge portal:snapshot --url <url> [--json] [--forms] [--max-nodes N]
  job-forge portal:form-schema --url <url> [--json] [--include-options]
  job-forge portal:explain [--json]

Defaults are enforced in code for every browser launch:
  isolated: true
  headless: true
  browserMode: stock
  blockDetection: true
  slowMo: 350

The helper imports Geometra's session module directly. It does not call the
MCP tool protocol, does not leave a reusable browser pool behind, and closes
its isolated Chromium before exit. If config/profile.yml contains a top-level
proxy: block with server/username/password/bypass, it is threaded into the
browser unless --no-profile-proxy is passed.`;

const [cmd = 'help', ...rawArgs] = process.argv.slice(2);
const opts = parseArgs(rawArgs);

if (opts.help || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(0);
}

try {
  if (cmd === 'snapshot') {
    await snapshot(opts);
  } else if (cmd === 'form-schema') {
    await formSchema(opts);
  } else if (cmd === 'explain') {
    await explain(opts);
  } else {
    console.error(`unknown portal command "${cmd}"\n`);
    console.error(USAGE);
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function snapshot(opts) {
  if (!opts.url) throw new Error('portal:snapshot requires --url <url>');
  const geometra = await loadGeometraSessionModule();
  const proxy = opts.profileProxy ? readProfileProxy(PROJECT_DIR) : null;
  const session = await connect(geometra, opts, proxy);

  try {
    const root = buildRoot(geometra, session);
    const pageModel = geometra.buildPageModel(root, {
      maxPrimaryActions: opts.maxPrimaryActions,
      maxSectionsPerKind: opts.maxSectionsPerKind,
      blockDetection: true,
    });
    const compact = geometra.buildCompactUiIndex(root, {
      maxNodes: opts.maxNodes,
      viewportWidth: opts.width,
      viewportHeight: opts.height,
    });
    const result = {
      url: opts.url,
      session: connectionSummary(session, proxy),
      defaults: launchDefaults(opts, proxy),
      blockedSite: pageModel.blockedSite ?? { detected: false },
      pageModel,
      compact,
      ...(opts.forms ? { forms: geometra.buildFormSchemas(root, formOptions(opts)) } : {}),
    };
    output(result, opts, () => {
      console.log(`url: ${opts.url}`);
      console.log(`session: ${session.id}`);
      console.log(`defaults: ${formatDefaults(opts, proxy)}`);
      if (proxy) console.log(`proxy: ${redactProxy(proxy)}`);
      printBlockedSite(pageModel);
      console.log(geometra.summarizePageModel(pageModel, 12));
      console.log(geometra.summarizeCompactIndex(compact.nodes, 24));
      if (opts.forms) {
        console.log(`forms: ${result.forms.length}`);
      }
    });
  } finally {
    geometra.disconnect({ sessionId: session.id, closeProxy: true });
  }
}

async function formSchema(opts) {
  if (!opts.url) throw new Error('portal:form-schema requires --url <url>');
  const geometra = await loadGeometraSessionModule();
  const proxy = opts.profileProxy ? readProfileProxy(PROJECT_DIR) : null;
  const session = await connect(geometra, opts, proxy);

  try {
    const root = buildRoot(geometra, session);
    const pageModel = geometra.buildPageModel(root, {
      maxPrimaryActions: opts.maxPrimaryActions,
      maxSectionsPerKind: opts.maxSectionsPerKind,
      blockDetection: true,
    });
    const forms = geometra.buildFormSchemas(root, formOptions(opts));
    const result = {
      url: opts.url,
      session: connectionSummary(session, proxy),
      defaults: launchDefaults(opts, proxy),
      blockedSite: pageModel.blockedSite ?? { detected: false },
      forms,
    };
    output(result, opts, () => {
      console.log(`url: ${opts.url}`);
      console.log(`session: ${session.id}`);
      console.log(`defaults: ${formatDefaults(opts, proxy)}`);
      if (proxy) console.log(`proxy: ${redactProxy(proxy)}`);
      printBlockedSite(pageModel);
      for (const form of forms) {
        const name = form.name ? ` "${form.name}"` : '';
        console.log(`${form.formId}${name}: ${form.fieldCount} fields, ${form.requiredCount} required, ${form.invalidCount} invalid`);
        for (const field of form.fields.slice(0, opts.maxFields)) {
          const required = field.required ? ' required' : '';
          const invalid = field.invalid ? ' invalid' : '';
          const label = field.label || field.name || field.id;
          console.log(`  - ${field.kind}: ${label}${required}${invalid}`);
        }
      }
    });
  } finally {
    geometra.disconnect({ sessionId: session.id, closeProxy: true });
  }
}

async function explain(opts) {
  const moduleTarget = resolveGeometraSessionModule();
  const proxy = opts.profileProxy ? readProfileProxy(PROJECT_DIR) : null;
  const result = {
    projectDir: PROJECT_DIR,
    module: moduleTarget,
    defaults: launchDefaults(opts, proxy),
    profileProxy: proxy ? redactProxy(proxy) : null,
  };
  output(result, opts, () => {
    console.log(`project: ${PROJECT_DIR}`);
    console.log(`module: ${moduleTarget.source} ${moduleTarget.path}`);
    console.log(`defaults: ${formatDefaults(opts, proxy)}`);
    console.log(`profile proxy: ${proxy ? redactProxy(proxy) : 'none'}`);
  });
}

async function connect(geometra, opts, proxy) {
  return await geometra.connectThroughProxy({
    pageUrl: opts.url,
    isolated: true,
    headless: true,
    stealth: false,
    slowMo: opts.slowMo,
    width: opts.width,
    height: opts.height,
    awaitInitialFrame: true,
    eagerInitialExtract: true,
    ...(proxy ? { proxy } : {}),
  });
}

function buildRoot(geometra, session) {
  if (!session.tree || !session.layout) {
    throw new Error(`Geometra session ${session.id} did not return an accessibility tree`);
  }
  return geometra.buildA11yTree(session.tree, session.layout);
}

async function loadGeometraSessionModule() {
  const target = resolveGeometraSessionModule();
  try {
    return await import(pathToFileURL(target.path).href);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load Geometra session module from ${target.path}: ${detail}`);
  }
}

function resolveGeometraSessionModule() {
  const explicit = normalizeEnv(process.env.JOB_FORGE_GEOMETRA_SESSION_MODULE);
  if (explicit) return existingModulePath('env', resolve(explicit));

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const siblingPath = resolve(scriptDir, '../../geometra/mcp/dist/session.js');
  if (existsSync(siblingPath)) return { source: 'sibling-repo', path: siblingPath };

  const require = createRequire(import.meta.url);
  try {
    return {
      source: 'package',
      path: require.resolve('@geometra/mcp/dist/session.js'),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not resolve @geometra/mcp/dist/session.js. Install dependencies with npm install. Resolution error: ${detail}`);
  }
}

function existingModulePath(source, path) {
  if (!existsSync(path)) throw new Error(`${source} Geometra session module not found: ${path}`);
  return { source, path };
}

function parseArgs(args) {
  const opts = {
    help: false,
    json: false,
    forms: false,
    includeOptions: false,
    profileProxy: true,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    slowMo: DEFAULT_SLOW_MO,
    maxNodes: DEFAULT_MAX_NODES,
    maxFields: 80,
    maxPrimaryActions: 6,
    maxSectionsPerKind: 8,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' || arg === '-u') {
      opts.url = valueAfter(args, ++i, arg);
    } else if (arg.startsWith('--url=')) {
      opts.url = arg.slice('--url='.length);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--forms') {
      opts.forms = true;
    } else if (arg === '--include-options') {
      opts.includeOptions = true;
    } else if (arg === '--no-profile-proxy') {
      opts.profileProxy = false;
    } else if (arg === '--width') {
      opts.width = parsePositiveInt(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith('--width=')) {
      opts.width = parsePositiveInt(arg.slice('--width='.length), '--width');
    } else if (arg === '--height') {
      opts.height = parsePositiveInt(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith('--height=')) {
      opts.height = parsePositiveInt(arg.slice('--height='.length), '--height');
    } else if (arg === '--slow-mo') {
      opts.slowMo = parseNonNegativeInt(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith('--slow-mo=')) {
      opts.slowMo = parseNonNegativeInt(arg.slice('--slow-mo='.length), '--slow-mo');
    } else if (arg === '--max-nodes') {
      opts.maxNodes = parsePositiveInt(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith('--max-nodes=')) {
      opts.maxNodes = parsePositiveInt(arg.slice('--max-nodes='.length), '--max-nodes');
    } else if (arg === '--max-fields') {
      opts.maxFields = parsePositiveInt(valueAfter(args, ++i, arg), arg);
    } else if (arg.startsWith('--max-fields=')) {
      opts.maxFields = parsePositiveInt(arg.slice('--max-fields='.length), '--max-fields');
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`unknown flag "${arg}"`);
    }
  }

  return opts;
}

function formOptions(opts) {
  return {
    includeOptions: opts.includeOptions,
    maxFields: opts.maxFields,
  };
}

function readProfileProxy(projectDir) {
  const profilePath = join(projectDir, 'config', 'profile.yml');
  if (!existsSync(profilePath)) return null;
  const proxy = parseTopLevelProxy(readFileSync(profilePath, 'utf8'));
  return proxy?.server ? proxy : null;
}

function parseTopLevelProxy(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^proxy:\s*(?:#.*)?$/.test(line));
  if (start === -1) return null;
  const proxy = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line) && line.trim() !== '') break;
    const match = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!['server', 'username', 'password', 'bypass'].includes(key)) continue;
    const value = parseYamlScalar(match[2]);
    if (value !== '') proxy[key] = value;
  }
  return Object.keys(proxy).length > 0 ? proxy : null;
}

function parseYamlScalar(raw) {
  const withoutComment = raw.replace(/\s+#.*$/, '').trim();
  if ((withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
      (withoutComment.startsWith("'") && withoutComment.endsWith("'"))) {
    return withoutComment.slice(1, -1);
  }
  return withoutComment;
}

function output(result, opts, textPrinter) {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    textPrinter();
  }
}

function launchDefaults(opts, proxy) {
  return {
    isolated: true,
    headless: true,
    browserMode: 'stock',
    blockDetection: true,
    slowMo: opts.slowMo,
    width: opts.width,
    height: opts.height,
    profileProxy: Boolean(proxy),
  };
}

function formatDefaults(opts, proxy) {
  const defaults = launchDefaults(opts, proxy);
  return [
    `isolated=${defaults.isolated}`,
    `headless=${defaults.headless}`,
    `browserMode=${defaults.browserMode}`,
    `blockDetection=${defaults.blockDetection}`,
    `slowMo=${defaults.slowMo}`,
  ].join(' ');
}

function printBlockedSite(pageModel) {
  if (!pageModel.blockedSite?.detected) return;
  const type = pageModel.blockedSite.type ?? 'unknown';
  const hint = pageModel.blockedSite.hint ? ` - ${pageModel.blockedSite.hint}` : '';
  console.log(`blocked: ${type}${hint}`);
}

function connectionSummary(session, proxy) {
  return {
    id: session.id,
    url: session.url,
    proxy: Boolean(proxy),
  };
}

function redactProxy(proxy) {
  try {
    const url = new URL(proxy.server);
    const auth = proxy.username || proxy.password || url.username || url.password ? ' auth=present' : '';
    return `${url.protocol}//${url.host}${auth}${proxy.bypass ? ' bypass=present' : ''}`;
  } catch {
    return 'configured';
  }
}

function normalizeEnv(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function valueAfter(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function parseNonNegativeInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}
