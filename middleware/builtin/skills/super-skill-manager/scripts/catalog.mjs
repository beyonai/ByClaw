import { readFile } from 'node:fs/promises';

import * as clawhub from './adapters/clawhub.mjs';
import * as skillsSh from './adapters/skills-sh.mjs';
import * as findskillsCn from './adapters/findskills-cn.mjs';
import * as smithery from './adapters/smithery.mjs';
import * as glama from './adapters/glama.mjs';
import * as github from './adapters/github.mjs';
import { deduplicateCatalog, normalizeCatalogRecord } from './core/dedupe.mjs';
import { successEnvelope } from './core/envelope.mjs';
import { rankCatalog } from './core/rank.mjs';

const adapters = new Map([clawhub, skillsSh, findskillsCn, smithery, glama, github].map((adapter) => [adapter.source.id, adapter]));
const MAX_LIMIT = 10;
const configUrl = new URL('./sources.json', import.meta.url);
function timeout(adapter, timeoutMs) { return { adapter, response: { ok: false, source: adapter.source.id, data: [], error: { code: 'SOURCE_TIMEOUT', message: `${adapter.source.id} exceeded ${timeoutMs} ms` }, elapsedMs: timeoutMs } }; }
async function config() { return JSON.parse(await readFile(configUrl, 'utf8')); }

export async function searchCatalog({ queries, limit = 10, type = 'all', sourceIds, runner, sourceTimeoutMs, totalTimeoutMs, signal } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new TypeError(`limit must be between 1 and ${MAX_LIMIT}`);
  if (!['all', 'skill', 'mcp'].includes(type)) throw new TypeError('type must be skill, mcp, or all');
  const settings = await config();
  const enabled = settings.sources.filter((source) => source.enabled).map((source) => source.id);
  const ids = sourceIds?.length ? sourceIds : enabled;
  if (ids.some((id) => !enabled.includes(id) || !adapters.has(id))) throw new TypeError('source must be enabled and known');
  const selected = ids.map((id) => adapters.get(id));
  const sourceMs = sourceTimeoutMs ?? settings.sourceTimeoutMs;
  const totalMs = totalTimeoutMs ?? settings.totalTimeoutMs;
  const controller = new AbortController();
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  const completed = new Map();
  const tasks = selected.map(async (adapter) => {
    const sourceController = new AbortController();
    const abortSource = () => sourceController.abort();
    controller.signal.addEventListener('abort', abortSource, { once: true });
    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(() => { sourceController.abort(); resolve('timeout'); }, sourceMs); });
    let response;
    try { response = await Promise.race([adapter.search({ queries, limit, runner, deadline: sourceMs, signal: sourceController.signal }), deadline]); }
    catch (error) { response = { ok: false, source: adapter.source.id, data: [], error: { code: 'PARSE_ERROR', message: error instanceof Error ? error.message : 'adapter failed' }, elapsedMs: 0 }; }
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', abortSource);
    const entry = response === 'timeout' ? timeout(adapter, sourceMs) : { adapter, response };
    completed.set(adapter.source.id, entry); return entry;
  });
  let totalTimer;
  const all = Promise.all(tasks);
  const total = new Promise((resolve) => { totalTimer = setTimeout(resolve, totalMs, 'timeout'); });
  const outcome = await Promise.race([all, total]);
  clearTimeout(totalTimer);
  if (outcome === 'timeout') controller.abort();
  const results = outcome === 'timeout' ? selected.map((adapter) => completed.get(adapter.source.id) ?? timeout(adapter, totalMs)) : outcome;
  // Every task owns its timer and catches its own errors; settle in background after abort.
  if (outcome === 'timeout') void all.catch(() => {});
  const sourceStops = [];
  const normalized = [];
  for (const entry of results) {
    const { adapter, response } = entry;
    if (!response.ok) continue;
    try { normalized.push(...response.data.map((record) => normalizeCatalogRecord(adapter.normalize(record)))); }
    catch {
      entry.response = { ok: false, source: adapter.source.id, data: [], error: { code: 'PARSE_ERROR', message: 'Source result does not match the public record schema.' }, elapsedMs: response.elapsedMs };
    }
  }
  for (const { adapter, response } of results) {
    if (response.error?.code === 'BROWSER_CONNECT') {
      const stop = { source: adapter.source.id, code: response.error.code, message: response.error.message };
      if (response.error.session) stop.session = response.error.session;
      sourceStops.push(stop);
    }
  }
  const sourceSucceeded = results.filter(({ response }) => response.ok).map(({ adapter }) => adapter.source.id);
  const sourceFailed = results.filter(({ response }) => !response.ok).map(({ adapter }) => adapter.source.id);
  const ranked = rankCatalog(deduplicateCatalog(normalized.filter((record) => type === 'all' || record.kind === type)), { limit });
  const warnings = results.filter(({ response }) => !response.ok).map(({ response }) => {
    const { session, ...warning } = response.error; return warning;
  });
  const manualLinks = results.flatMap(({ response }) => [response.manualLink, ...(response.manualLinks ?? [])]
    .filter(Boolean).map((link) => ({ source: response.source, ...link })));
  return { ...successEnvelope({ source: 'catalog', data: ranked.top, warnings, elapsedMs: 0 }), top: ranked.top, unverifiedCandidates: ranked.unverifiedCandidates, excluded: ranked.excluded, manualLinks, sourceStops, complete: { sourcesAttempted: ids, sourcesSucceeded: sourceSucceeded, sourcesFailed: sourceFailed } };
}
