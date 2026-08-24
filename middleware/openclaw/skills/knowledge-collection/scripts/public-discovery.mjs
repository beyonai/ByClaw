import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mergeDocuments,
  normalizeUrl,
  parseDeclarations,
} from '../references/online-search/references/hot_discovery/scripts/hot_discovery.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const onlineSearchRoot = resolve(scriptDir, '../references/online-search');
const searxngScript = join(onlineSearchRoot, 'scripts/searxng_cli.py');
const hotDiscoveryScript = join(onlineSearchRoot, 'references/hot_discovery/scripts/hot_discovery.mjs');
const adaptersPath = join(onlineSearchRoot, 'references/hot_discovery/adapters.md');

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
    throw new Error('发现快照必须位于会话 .post-processing-inputs 目录内');
  }
  return target;
}

function defaultRunProcess({ executable, args }) {
  return new Promise((resolveRun) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => resolveRun({ code: 1, stdout, stderr }));
    child.on('close', (code) => resolveRun({ code: Number.isInteger(code) ? code : 1, stdout, stderr }));
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

function summarize(outcome, document) {
  return {
    status: document ? 'success' : 'failed',
    exitCode: Number.isInteger(outcome?.code) ? outcome.code : 1,
  };
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
  const query = requireText(args?.query, '--query');
  const category = typeof args?.category === 'string' && args.category.trim() ? args.category.trim() : 'general';
  const language = typeof args?.language === 'string' && args.language.trim() ? args.language.trim() : 'all';
  const pageno = String(args?.pageno || '1');
  const maxResults = String(args?.['max-results'] || '20');
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
  const pythonExecutable = options.pythonExecutable
    || process.env.ONLINE_SEARCH_PYTHON
    || join(onlineSearchRoot, 'scripts/.venv/bin/python');
  const runProcess = options.runProcess || defaultRunProcess;

  const [searxngOutcome, hotOutcome] = await Promise.all([
    runProcess({
      channel: 'searxng',
      executable: pythonExecutable,
      args: [searxngScript, query, '--category', category, '--language', language,
        '--pageno', pageno, '--max-results', maxResults, '--timeout', timeout,
        ...(timeRange ? ['--time-range', timeRange] : [])],
    }),
    runProcess({
      channel: 'hot-discovery',
      executable: process.execPath,
      args: [hotDiscoveryScript, 'search', '--query', query, '--tiers', tiers,
        '--limit', limit, '--dimensions', category],
    }),
  ]);

  const sxDoc = parseSuccess(searxngOutcome);
  const hotDoc = parseSuccess(hotOutcome);
  if (!sxDoc && !hotDoc) {
    throw new Error('SearXNG 与 hot-discovery 均未返回有效结果');
  }

  const warnings = [];
  if (!sxDoc) warnings.push(`SearXNG 发现失败（exit ${summarize(searxngOutcome, sxDoc).exitCode}）`);
  if (!hotDoc) warnings.push(`hot-discovery 发现失败（exit ${summarize(hotOutcome, hotDoc).exitCode}）`);
  if (sxDoc) await writeFile(searxngSnapshot, `${JSON.stringify(sxDoc, null, 2)}\n`, 'utf8');
  if (hotDoc) await writeFile(hotSnapshot, `${JSON.stringify(hotDoc, null, 2)}\n`, 'utf8');

  const merge = options.merge || defaultMerge;
  const merged = await merge({ hotDoc, sxDoc, warnings });
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
    channels: {
      searxng: summarize(searxngOutcome, sxDoc),
      hotDiscovery: summarize(hotOutcome, hotDoc),
    },
    snapshots: {
      searxng: sxDoc ? searxngSnapshot : null,
      hotDiscovery: hotDoc ? hotSnapshot : null,
      merged: mergedSnapshot,
    },
    merged,
    warnings,
  };
}
