import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mergeDocuments,
  normalizeUrl,
  parseDeclarations,
} from '../references/online-search/references/hot_discovery/scripts/hot_discovery.mjs';
import { runCli } from './enterprise/shared/cli-runner.mjs';
import { loadSession } from './session.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const onlineSearchRoot = resolve(scriptDir, '../references/online-search');
const searxngScript = join(onlineSearchRoot, 'scripts/searxng_cli.py');
const hotDiscoveryScript = join(onlineSearchRoot, 'references/hot_discovery/scripts/hot_discovery.mjs');
const adaptersPath = join(onlineSearchRoot, 'references/hot_discovery/adapters.md');
const MAX_DIAGNOSTIC_STDERR_CHARS = 2_000;

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} 必须是非空字符串`);
  }
  return value.trim();
}

function snapshotPath(inputDir, name) {
  const root = resolve(inputDir);
  const target = resolve(root, name);
  if (!target.startsWith(`${root}${sep}`)) {
    throw new Error('发现快照必须位于会话 .collection-inputs 目录内');
  }
  return target;
}

export function resolveSearxngPython(options = {}, environment = process.env, pathExists = existsSync) {
  if (options.pythonExecutable) return options.pythonExecutable;
  if (environment.ONLINE_SEARCH_PYTHON) return environment.ONLINE_SEARCH_PYTHON;

  const defaultPython = join(onlineSearchRoot, 'scripts/.venv/bin/python');
  if (!pathExists(defaultPython)) {
    const scriptsDir = join(onlineSearchRoot, 'scripts');
    throw new Error(
      `SearXNG Python 环境不存在：${defaultPython}\n`
      + `请执行：cd ${scriptsDir} && ./bootstrap-venv.sh\n`
      + '如由运维统一管理解释器，可显式设置 ONLINE_SEARCH_PYTHON。',
    );
  }
  return defaultPython;
}

export async function runBoundedProcess({ bin, executable, args }, options = {}) {
  const outcome = await runCli(bin || executable, args, options);
  return {
    code: Number.isInteger(outcome.exitCode) ? outcome.exitCode : 1,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  };
}

export async function runPublicProcess(spec, options = {}) {
  try {
    return await runBoundedProcess(spec, options);
  } catch (error) {
    const stderr = error instanceof Error ? error.message : String(error);
    return { code: 1, stdout: '', stderr, timedOut: /timeout after \d+ms/i.test(stderr) };
  }
}

export async function runUnboundedPublicProcess({ bin, executable, args }, options = {}) {
  return new Promise((resolveOutcome) => {
    const child = spawn(bin || executable, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      resolveOutcome({ code: 1, stdout: '', stderr: error instanceof Error ? error.message : String(error) });
    });
    child.once('close', (code) => {
      resolveOutcome({ code: Number.isInteger(code) ? code : 1, stdout, stderr });
    });
  });
}

function parseSuccess(outcome) {
  if (!outcome || outcome.code !== 0 || typeof outcome.stdout !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(outcome.stdout);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeDiagnosticStderr(stderr) {
  if (typeof stderr !== 'string' || !stderr.trim()) return '';
  return stderr
    .replace(/((?:authorization|cookie|credential|password|secret|token)\s*(?:=|:)\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, MAX_DIAGNOSTIC_STDERR_CHARS);
}

function summarize(outcome, document) {
  if (outcome?.skipped) return { status: 'skipped' };
  const summary = {
    status: document ? 'success' : 'failed',
    exitCode: Number.isInteger(outcome?.code) ? outcome.code : 1,
  };
  if (!document) {
    summary.timedOut = Boolean(outcome?.timedOut);
    const stderr = safeDiagnosticStderr(outcome?.stderr);
    if (stderr) summary.stderr = stderr;
  }
  return summary;
}

async function defaultMerge({ hotDoc, sxDoc, warnings }) {
  const declarations = parseDeclarations(await readFile(adaptersPath, 'utf8'));
  const normalizer = (url) => normalizeUrl(url, declarations);
  return mergeDocuments({
    hotDoc,
    sxDoc,
    arDoc: null,
    normalizer,
    identityNormalizer: normalizer,
    inputWarnings: warnings,
  });
}

export async function runPublicDiscover(paths, args, options = {}) {
  const { session } = loadSession(paths, { persistMigration: false });
  const sourceScope = Array.isArray(session.task?.sourceScope) ? session.task.sourceScope : [];
  if (!sourceScope.includes('public-internet')) {
    throw new Error('session task.sourceScope 必须包含 public-internet 才能执行公共发现');
  }
  const query = requireText(args?.query, '--query');
  const category = typeof args?.category === 'string' && args.category.trim() ? args.category.trim() : 'general';
  const language = typeof args?.language === 'string' && args.language.trim() ? args.language.trim() : 'all';
  const pageno = String(args?.pageno || '1');
  const maxResults = String(args?.['max-results'] || '20');
  const requestedCount = args?.['requested-count'] === undefined ? null : String(args['requested-count']);
  const effectiveMaxResults = requestedCount || maxResults;
  const timeout = String(args?.timeout || '15');
  const timeRange = typeof args?.['time-range'] === 'string' && args['time-range'].trim()
    ? args['time-range'].trim() : null;
  const tiers = typeof args?.tiers === 'string' && args.tiers.trim() ? args.tiers.trim() : '1,2,3';
  const limit = String(args?.limit || '20');
  const inputDir = requireText(paths?.inputDir, '会话 inputDir');
  const prefix = `public-discovery-${Date.now()}-${randomUUID()}`;
  const searxngSnapshot = snapshotPath(inputDir, `${prefix}-searxng.json`);
  const hotSnapshot = snapshotPath(inputDir, `${prefix}-hot-discovery.json`);
  const mergedSnapshot = snapshotPath(inputDir, `${prefix}-merged.json`);
  const pythonExecutable = resolveSearxngPython(options);
  const runSearxngProcess = options.runProcess || runPublicProcess;
  const runHotDiscoveryProcess = options.runProcess || runUnboundedPublicProcess;
  const searxngTimeoutMs = Math.max(1, Math.ceil(Number(timeout) * 1_000));

  const searxngSpec = {
    channel: 'searxng',
    executable: pythonExecutable,
    args: [searxngScript, query, '--category', category, '--language', language,
      '--pageno', pageno, '--max-results', effectiveMaxResults, '--timeout', timeout,
      ...(timeRange ? ['--time-range', timeRange] : [])],
  };
  const hotDiscoverySpec = {
    channel: 'hot-discovery',
    executable: process.execPath,
    args: [hotDiscoveryScript, 'search', '--query', query, '--tiers', tiers,
      '--limit', limit, '--dimensions', category],
  };
  const searxngPromise = runSearxngProcess(searxngSpec, { timeoutMs: searxngTimeoutMs });
  const hotPromise = requestedCount === null
    ? runHotDiscoveryProcess(hotDiscoverySpec)
    : Promise.resolve({ skipped: true });
  const [searxngOutcome, hotOutcome] = await Promise.all([searxngPromise, hotPromise]);

  const sxDoc = parseSuccess(searxngOutcome);
  const hotDoc = parseSuccess(hotOutcome);
  if (!sxDoc && !hotDoc) {
    if (hotOutcome?.skipped) throw new Error('SearXNG 未返回有效结果');
    throw new Error('SearXNG 与 hot-discovery 均未返回有效结果');
  }

  const channelDiagnostics = {
    searxng: summarize(searxngOutcome, sxDoc),
    hotDiscovery: summarize(hotOutcome, hotDoc),
  };
  const warnings = [];
  if (!sxDoc) warnings.push(`SearXNG 发现失败（exit ${channelDiagnostics.searxng.exitCode}）`);
  if (!hotDoc && !hotOutcome?.skipped) {
    warnings.push(`hot-discovery 发现失败（exit ${channelDiagnostics.hotDiscovery.exitCode}）`);
  }
  if (sxDoc) await writeFile(searxngSnapshot, `${JSON.stringify(sxDoc, null, 2)}\n`, 'utf8');
  if (hotDoc) await writeFile(hotSnapshot, `${JSON.stringify(hotDoc, null, 2)}\n`, 'utf8');

  const merge = options.merge || defaultMerge;
  const mergedDocument = await merge({ hotDoc, sxDoc, warnings });
  const merged = { ...mergedDocument, channelDiagnostics };
  await writeFile(mergedSnapshot, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'public-discover',
    query,
    category,
    requestedDimensions: [category],
    hotDiscovery: hotDoc ? {
      requestedDimensions: Array.isArray(hotDoc.dimensions) ? hotDoc.dimensions : [category],
      effectiveDimensions: Array.isArray(hotDoc.effectiveDimensions) ? hotDoc.effectiveDimensions : [category],
    } : null,
    channels: channelDiagnostics,
    snapshots: {
      searxng: sxDoc ? searxngSnapshot : null,
      hotDiscovery: hotDoc ? hotSnapshot : null,
      merged: mergedSnapshot,
    },
    merged,
    warnings,
  };
}
