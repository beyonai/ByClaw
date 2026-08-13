import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PublicMetadataCache, createCacheKey } from '../scripts/core/cache.mjs';
import { deduplicateCatalog, normalizeCatalogRecord } from '../scripts/core/dedupe.mjs';
import { expandQuery, normalizeQuery } from '../scripts/core/query.mjs';
import { rankCatalog } from '../scripts/core/rank.mjs';
import * as bycli from '../scripts/adapters/bycli.mjs';
import * as clawhub from '../scripts/adapters/clawhub.mjs';
import * as github from '../scripts/adapters/github.mjs';
import * as bycliSource from '../scripts/adapters/bycli.mjs';
import * as skillsSh from '../scripts/adapters/skills-sh.mjs';
import * as findskillsCn from '../scripts/adapters/findskills-cn.mjs';
import * as smithery from '../scripts/adapters/smithery.mjs';
import * as glama from '../scripts/adapters/glama.mjs';
import { searchCatalog } from '../scripts/catalog.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/catalog-overlap.json', import.meta.url), 'utf8'));
const bycliFixture = JSON.parse(await readFile(new URL('./fixtures/bycli-list.json', import.meta.url), 'utf8'));

function runnerFrom(responses, calls = []) {
  return async (command, args) => {
    calls.push([command, args]);
    const key = `${command} ${args.join(' ')}`;
    const response = responses[key] ?? responses[command] ?? { ok: false, stderr: 'not available' };
    return typeof response === 'function' ? response(command, args) : structuredClone(response);
  };
}

test('market adapters require bycli list JSON before selecting their route', async () => {
  const calls = [];
  const result = await clawhub.search({ queries: ['code review'], limit: 3, runner: runnerFrom({ bycli: { ok: false, stderr: 'missing' } }, calls), deadline: 8_000 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BROWSER_CONNECT');
  assert.deepEqual(calls, [['bycli', ['list', '-f', 'json']]]);
});

test('every adapter has the constrained source schema and contains no direct network client', async () => {
  const modules = [bycliSource, clawhub, skillsSh, findskillsCn, smithery, glama, github];
  for (const adapter of modules) {
    assert.deepEqual(Object.keys(adapter).sort(), ['normalize', 'search', 'source']);
    assert.equal(typeof adapter.source.id, 'string');
    assert.ok(Array.isArray(adapter.source.kinds));
    assert.ok(Array.isArray(adapter.source.domains));
    assert.equal(typeof adapter.search, 'function');
    assert.equal(typeof adapter.normalize, 'function');
    const sourcePath = new URL(`../scripts/adapters/${adapter.source.id}.mjs`, import.meta.url);
    const sourceText = await readFile(sourcePath, 'utf8');
    assert.doesNotMatch(sourceText, /\b(?:curl|wget|fetch)\b/i);
  }
});

test('adapter route order is dedicated, search engine, browser raw, then structured manual link', async () => {
  const calls = [];
  const dedicated = await skillsSh.search({
    queries: ['review'], limit: 2,
    runner: runnerFrom({
      bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'skills-sh', command: ['bycli', 'skills-sh', 'search'] }] }) },
      'bycli skills-sh search review -f json --limit 2': { ok: true, stdout: JSON.stringify([{ id: 'r', name: 'Review', description: 'x' }]) },
    }, calls), deadline: 8_000,
  });
  assert.equal(dedicated.ok, true);
  assert.deepEqual(calls.map((call) => call.join(' ')), ['bycli list,-f,json', 'bycli skills-sh,search,review,-f,json,--limit,2']);

  const manual = await skillsSh.search({
    queries: ['review'], limit: 2,
    runner: runnerFrom({ bycli: { ok: true, stdout: JSON.stringify({ capabilities: [] }) } }), deadline: 8_000,
  });
  assert.equal(manual.ok, true);
  assert.equal(manual.manualLink.route, 'manual-link');
  assert.equal(manual.manualLink.url, 'https://skills.sh/search?q=review');
});

test('clawhub uses openclaw JSON search only after bycli capability discovery', async () => {
  const calls = [];
  const result = await clawhub.search({
    queries: ['review'], limit: 1,
    runner: runnerFrom({
      bycli: { ok: true, stdout: JSON.stringify(bycliFixture) },
      'openclaw skills search review --json --limit 1': { ok: true, stdout: JSON.stringify([{ slug: 'review-pro', name: 'Review Pro' }]) },
    }, calls), deadline: 8_000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[1], ['openclaw', ['skills', 'search', 'review', '--json', '--limit', '1']]);
});

test('clawhub never selects a bycli clawhub route even when that capability is advertised', async () => {
  const calls = [];
  await clawhub.search({
    queries: ['review'], limit: 1,
    runner: runnerFrom({
      bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'clawhub' }] }) },
      'openclaw skills search review --json --limit 1': { ok: true, stdout: '[]' },
    }, calls), deadline: 8_000,
  });
  assert.deepEqual(calls, [['bycli', ['list', '-f', 'json']]]);
});

test('clawhub does not invoke openclaw until bycli advertises that capability', async () => {
  const calls = [];
  const result = await clawhub.search({
    queries: ['review'], limit: 1,
    runner: runnerFrom({ bycli: { ok: true, stdout: JSON.stringify({ capabilities: [] }) } }, calls), deadline: 8_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.manualLink.route, 'manual-link');
  assert.deepEqual(calls, [['bycli', ['list', '-f', 'json']]]);
});

test('JSON-valid but malformed capability and result payloads fail closed with PARSE_ERROR', async () => {
  const malformedList = await skillsSh.search({ queries: ['review'], limit: 1, runner: runnerFrom({ bycli: { ok: true, stdout: '{}' } }), deadline: 8_000 });
  assert.equal(malformedList.error.code, 'PARSE_ERROR');
  const malformedResult = await skillsSh.search({
    queries: ['review'], limit: 1,
    runner: runnerFrom({
      bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'skills-sh' }] }) },
      'bycli skills-sh search review -f json --limit 1': { ok: true, stdout: JSON.stringify({ data: {} }) },
    }), deadline: 8_000,
  });
  assert.equal(malformedResult.error.code, 'PARSE_ERROR');
});

test('browser STOP errors retain redacted session metadata and do not fall through', async () => {
  const calls = [];
  const result = await skillsSh.search({
    queries: ['review'], limit: 1,
    runner: runnerFrom({
      bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'browser' }] }) },
      'bycli web read https://skills.sh/search?q=review -f json': { ok: false, stderr: 'CAPTCHA', session: { sessionId: 'session-1', token: 'secret-token', status: 'connected' } },
    }, calls), deadline: 8_000,
  });
  assert.equal(result.error.code, 'BROWSER_CONNECT');
  assert.deepEqual(result.error.session, { sessionId: 'session-1', status: 'connected' });
  assert.equal(calls.length, 2);
});

test('embedded JSON diagnostics redact secret values', async () => {
  const result = await skillsSh.search({ queries: ['review'], limit: 1, runner: runnerFrom({
    bycli: { ok: false, stderr: 'provider error {"token":"top-secret-value"}' },
  }), deadline: 8_000 });
  assert.doesNotMatch(result.error.message, /top-secret-value/);
  assert.match(result.error.message, /REDACTED/);
});

test('catalog isolates malformed source records and retains valid sources', async () => {
  const result = await searchCatalog({ queries: ['review'], limit: 2, sourceIds: ['skills-sh', 'smithery'], runner: runnerFrom({
    bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'skills-sh' }, { id: 'smithery' }] }) },
    'bycli skills-sh search review -f json --limit 2': { ok: true, stdout: JSON.stringify([{ id: 4 }]) },
    'bycli smithery search review -f json --limit 2': { ok: true, stdout: JSON.stringify([{ id: 'ok', name: 'valid', kind: 'mcp' }]) },
  }) });
  assert.deepEqual(result.data.map((record) => record.name), ['valid']);
  assert.deepEqual(result.complete.sourcesSucceeded, ['smithery']);
  assert.deepEqual(result.complete.sourcesFailed, ['skills-sh']);
  assert.equal(result.warnings[0].code, 'PARSE_ERROR');
});

test('catalog global deadline keeps settled results and marks every unsettled source as timeout', async () => {
  const runner = async (command, args) => {
    if (command === 'bycli' && args[0] === 'list') return { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'browser' }] }) };
    if (command === 'openclaw') return { ok: true, stdout: '[]' };
    return new Promise(() => {});
  };
  const result = await searchCatalog({ queries: ['review'], limit: 1, sourceIds: ['clawhub', 'skills-sh'], runner, sourceTimeoutMs: 100, totalTimeoutMs: 5 });
  assert.deepEqual(result.complete.sourcesSucceeded, ['clawhub']);
  assert.deepEqual(result.complete.sourcesFailed, ['skills-sh']);
  assert.equal(result.warnings[0].code, 'SOURCE_TIMEOUT');
});

test('catalog filters normalized candidates by requested kind', async () => {
  const result = await searchCatalog({
    queries: ['review'], limit: 2, sourceIds: ['smithery'], type: 'mcp',
    runner: runnerFrom({
      bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'smithery' }] }) },
      'bycli smithery search review -f json --limit 2': { ok: true, stdout: JSON.stringify([{ id: 'a', name: 'skill', kind: 'skill' }, { id: 'b', name: 'mcp', kind: 'mcp' }]) },
    }),
  });
  assert.deepEqual(result.data.map((record) => record.kind), ['mcp']);
});

test('query aliases execute deterministic bounded source routes', async () => {
  const calls = [];
  await skillsSh.search({ queries: ['code review', 'PR review'], limit: 1, runner: runnerFrom({
    bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'skills-sh' }] }) },
    'bycli skills-sh search code review -f json --limit 1': { ok: true, stdout: '[]' },
    'bycli skills-sh search PR review -f json --limit 1': { ok: true, stdout: '[]' },
  }, calls), deadline: 8_000 });
  assert.deepEqual(calls.map(([command, args]) => `${command} ${args.join(' ')}`), [
    'bycli list -f json', 'bycli skills-sh search code review -f json --limit 1',
    'bycli list -f json', 'bycli skills-sh search PR review -f json --limit 1',
  ]);
});

test('multi-query manual fallbacks preserve usable links without fake candidates', async () => {
  const result = await skillsSh.search({ queries: ['one', 'two'], limit: 1, runner: runnerFrom({
    bycli: { ok: true, stdout: JSON.stringify({ capabilities: [] }) },
  }), deadline: 8_000 });
  assert.deepEqual(result.data, []);
  assert.deepEqual(result.manualLinks.map((link) => link.url), [
    'https://skills.sh/search?q=one', 'https://skills.sh/search?q=two',
  ]);
});

test('per-source abort prevents a delayed discovery from starting a late route', async () => {
  const calls = [];
  const runner = async (command, args, { signal }) => {
    calls.push([command, args]);
    if (command === 'bycli' && args[0] === 'list') return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, timedOut: true, stderr: 'aborted' }), { once: true }));
    return { ok: true, stdout: '[]' };
  };
  const result = await searchCatalog({ queries: ['review'], limit: 1, sourceIds: ['skills-sh'], runner, sourceTimeoutMs: 5, totalTimeoutMs: 100 });
  assert.deepEqual(result.complete.sourcesFailed, ['skills-sh']);
  assert.deepEqual(calls, [['bycli', ['list', '-f', 'json']]]);
});

test('github only uses bycli gh and adapter normalizers return shared records', async () => {
  const calls = [];
  const result = await github.search({
    queries: ['review'], limit: 1,
    runner: runnerFrom({
      bycli: { ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'gh' }] }) },
      'bycli gh search review -f json --limit 1': { ok: true, stdout: JSON.stringify([{ id: 'a', name: 'Review', repository: 'github.com/a/review' }]) },
    }, calls), deadline: 8_000,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[1], ['bycli', ['gh', 'search', 'review', '-f', 'json', '--limit', '1']]);
  const normalized = github.normalize(result.data[0]);
  assert.equal(normalized.kind, 'skill');
  assert.equal(normalized.provenance.provider, 'github');
});

test('adapters surface parse, auth, timeout, and browser stop errors structurally', async () => {
  const cases = [
    [{ ok: true, stdout: '{' }, 'PARSE_ERROR'],
    [{ ok: false, stderr: 'authentication required' }, 'AUTH_REQUIRED'],
    [{ ok: false, timedOut: true, stderr: 'timed out' }, 'SOURCE_TIMEOUT'],
    [{ ok: true, stdout: JSON.stringify({ capabilities: [{ id: 'browser' }] }) }, { ok: false, stderr: 'CAPTCHA' }, 'BROWSER_CONNECT'],
  ];
  for (const entry of cases) {
    const responses = entry.length === 2 ? { bycli: entry[0] } : { bycli: entry[0], 'bycli web read https://skills.sh/search?q=review -f json': entry[1] };
    const code = entry.at(-1);
    const result = await (await import('../scripts/adapters/skills-sh.mjs')).search({
      queries: ['review'], limit: 1, runner: runnerFrom(responses), deadline: 8_000,
    });
    assert.equal(result.error?.code, code);
  }
});

test('catalog orchestration settles partial results with source summaries and deadlines', async () => {
  const result = await searchCatalog({
    queries: ['review'], limit: 2, sourceIds: ['clawhub', 'github'], runner: async (command, args) => {
      if (command === 'bycli' && args[0] === 'list') return { ok: true, stdout: JSON.stringify({ capabilities: [] }) };
      if (command === 'openclaw') return { ok: true, stdout: '[]' };
      return { ok: false, timedOut: true, stderr: 'timeout' };
    }, sourceTimeoutMs: 1, totalTimeoutMs: 20,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.complete.sourcesAttempted.sort(), ['clawhub', 'github']);
  assert.equal(result.complete.sourcesSucceeded.length, 1);
  assert.equal(result.complete.sourcesFailed.length, 1);
});

function candidate(overrides = {}) {
  return {
    kind: 'skill',
    name: 'candidate',
    description: null,
    author: null,
    repository: 'github.com/acme/candidate',
    path: 'skills/candidate',
    version: null,
    sources: [{ source: 'clawhub' }],
    metrics: { clawhub: { popularityPercentile: 0.5, installs: 10 } },
    updatedAt: '2026-07-20T00:00:00.000Z',
    installCommands: {},
    security: { status: 'pass', reasons: [] },
    provenance: { provider: 'clawhub', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'id' },
    relevance: 0.5,
    sourceTrustClass: 'curated',
    ...overrides,
  };
}

test('query normalization and bounded bilingual expansion preserve the original query', () => {
  assert.equal(normalizeQuery('  代码\t审查  '), '代码 审查');
  assert.deepEqual(expandQuery('代码审查'), ['代码审查', 'code review', 'PR review']);
  assert.ok(expandQuery('代码审查').length <= 3);
  assert.deepEqual(expandQuery('自定义', { aliases: { 自定义: ['custom skill', 'bespoke skill', 'ignored'] } }), [
    '自定义', 'custom skill', 'bespoke skill',
  ]);
  assert.deepEqual(expandQuery(' CODE   REVIEW '), ['CODE REVIEW', '代码审查', 'PR review']);
});

test('query expansion rejects malformed aliases and remains deterministic and immutable', () => {
  const aliases = { hello: ['world', 'WORLD', '', 3] };
  const snapshot = structuredClone(aliases);
  assert.deepEqual(expandQuery('hello', { aliases }), ['hello', 'world']);
  assert.deepEqual(expandQuery('hello', { aliases }), ['hello', 'world']);
  assert.deepEqual(aliases, snapshot);
  assert.throws(() => normalizeQuery(null), /query/i);
  assert.throws(() => expandQuery('   '), /query/i);
  assert.throws(() => expandQuery('x', { aliases: [] }), /aliases/i);
});

test('normalization supplies the stable schema without mutating source data', () => {
  const input = { kind: 'skill', name: ' demo ', provenance: { provider: 'x', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: '1', unexpected: 'drop' } };
  const snapshot = structuredClone(input);
  const result = normalizeCatalogRecord(input);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(Object.keys(result), [
    'kind', 'name', 'description', 'author', 'repository', 'path', 'version', 'sources', 'metrics', 'updatedAt',
    'installCommands', 'security', 'provenance', 'relevance', 'sourceTrustClass', 'sourceEvidence', 'deduplicationConfidence',
  ]);
  assert.equal(result.name, 'demo');
  assert.equal(result.description, null);
  assert.deepEqual(result.metrics, {});
  assert.deepEqual(result.provenance, { provider: 'x', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: '1' });
  assert.equal(result.deduplicationConfidence, 'low');
  for (const malformed of [null, [], {}, { kind: 'widget', name: 'x' }, { kind: 'skill', name: '' }]) {
    assert.throws(() => normalizeCatalogRecord(malformed), /record|kind|name/i);
  }
});

test('dedupe merges canonical repository and path while retaining source evidence and local metrics', () => {
  const snapshot = structuredClone(fixture);
  const result = deduplicateCatalog(fixture);
  assert.deepEqual(fixture, snapshot);
  assert.equal(result.length, 2);
  const merged = result.find((item) => item.repository === 'github.com/acme/review-pro');
  assert.equal(merged.deduplicationConfidence, 'high');
  assert.deepEqual(merged.sources.map((source) => source.source), ['findskills-cn', 'skills-sh']);
  assert.deepEqual(Object.keys(merged.metrics), ['findskills-cn', 'skills-sh']);
  assert.equal(merged.metrics['skills-sh'].installs, 1200);
  assert.equal(merged.metrics['findskills-cn'].installs, 700);
  assert.equal(merged.metrics.installs, undefined);
  assert.deepEqual(merged.sourceEvidence.map((item) => item.provider), ['findskills-cn', 'skills-sh']);
});

test('dedupe separates same-name repositories, MCP from Skill, and ambiguous records', () => {
  const records = [
    candidate({ name: 'same', kind: 'skill', repository: 'github.com/a/r', path: '.' }),
    candidate({ name: 'same', kind: 'skill', repository: 'github.com/b/r', path: '.' }),
    candidate({ name: 'same', kind: 'mcp', repository: 'github.com/a/r', path: '.' }),
    candidate({ name: 'same', kind: 'skill', repository: null, path: null, provenance: { provider: 'x', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'a' } }),
    candidate({ name: 'same', kind: 'skill', repository: null, path: null, provenance: { provider: 'y', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'b' } }),
  ];
  const result = deduplicateCatalog(records);
  assert.equal(result.length, 5);
  assert.equal(result.filter((item) => item.deduplicationConfidence === 'high').length, 3);
  assert.equal(result.filter((item) => item.deduplicationConfidence === 'low').length, 2);
  assert.equal(result.filter((item) => item.kind === 'skill' && item.repository === 'github.com/a/r').length, 1);
  assert.equal(result.filter((item) => item.kind === 'mcp' && item.repository === 'github.com/a/r').length, 1);
});

test('normalization rejects malformed provenance instead of silently weakening evidence', () => {
  for (const provenance of [undefined, {}, { provider: 'x', retrievedAt: 'yesterday', rawId: '1' }, { provider: 'x', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: '' }]) {
    assert.throws(() => normalizeCatalogRecord({ kind: 'skill', name: 'x', provenance }), /provenance/i);
  }
});

test('normalization canonicalizes security, safe POSIX paths, and empty evidence', () => {
  const base = candidate({
    security: { status: 'MALICIOUS', reasons: ['confirmed'] }, path: './skills//nested/../review', sourceEvidence: [],
  });
  const normalized = normalizeCatalogRecord(base);
  assert.equal(normalized.security.status, 'malicious');
  assert.equal(normalized.path, 'skills/review');
  assert.equal(normalized.sourceEvidence.length, 1);
  assert.equal(normalized.sourceEvidence[0].rawId, base.provenance.rawId);
  assert.equal(normalizeCatalogRecord(candidate({ security: { status: 'unsafe', reasons: [] } })).security.status, 'unknown');
  assert.deepEqual(rankCatalog([base]).excluded.map((record) => record.name), ['candidate']);
  for (const unsafePath of ['/absolute', '../escape', 'a/../../escape', 'C:\\absolute', `bad\u0000path`]) {
    assert.throws(() => normalizeCatalogRecord(candidate({ path: unsafePath })), /path/i);
  }
  const deduped = deduplicateCatalog([
    candidate({ path: './skills//nested/../review', provenance: { ...base.provenance, rawId: 'a' } }),
    candidate({ path: 'skills/review', provenance: { ...base.provenance, rawId: 'b' } }),
  ]);
  assert.equal(deduped.length, 1);
});

test('same-provider merge keeps selected provenance, relevance, evidence, and metrics coherent', () => {
  const old = candidate({
    repository: 'github.com/acme/coherent', path: 'skill', relevance: 0.1, updatedAt: '2025-01-01T00:00:00.000Z',
    metrics: { clawhub: { weeklyDownloads: 1 } },
    provenance: { provider: 'clawhub', retrievedAt: '2025-01-01T00:00:00.000Z', rawId: 'old' },
  });
  const fresh = candidate({
    repository: 'github.com/acme/coherent', path: 'skill', relevance: 0.9, updatedAt: '2026-08-01T00:00:00.000Z',
    metrics: { clawhub: { weeklyDownloads: 99 } },
    provenance: { provider: 'clawhub', retrievedAt: '2026-08-01T00:00:00.000Z', rawId: 'fresh' },
  });
  const merged = deduplicateCatalog([old, fresh])[0];
  assert.equal(merged.provenance.rawId, 'fresh');
  assert.equal(merged.relevance, 0.9);
  assert.equal(merged.metrics.clawhub.weeklyDownloads, 99);
  assert.equal(merged.sourceEvidence.find((evidence) => evidence.rawId === 'fresh').metrics.weeklyDownloads, 99);
});

test('dedupe preserves adapter-local ranking evidence for the real normalization-to-ranking pipeline', () => {
  const records = [
    candidate({
      name: 'z-high-official', repository: 'github.com/acme/z', path: 'skill', relevance: 0.8, sourceTrustClass: 'official',
      metrics: { official: { popularityPercentile: 0.7, installs: 100 } }, sources: [{ source: 'official' }],
      provenance: { provider: 'official', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'official:z' },
    }),
    candidate({
      name: 'z-high-community-alias', repository: 'https://github.com/acme/z.git', path: './skill/', relevance: 0.99,
      sourceTrustClass: 'community', metrics: { community: { popularityPercentile: 0.99, installs: 900 } },
      sources: [{ source: 'community' }],
      provenance: { provider: 'community', retrievedAt: '2026-08-11T00:01:00.000Z', rawId: 'community:z' },
    }),
    candidate({
      name: 'm-low-official', repository: 'github.com/acme/m', path: 'skill', relevance: 0.2, sourceTrustClass: 'official',
      metrics: { official: { popularityPercentile: 0.2, installs: 10 } }, sources: [{ source: 'official' }],
      provenance: { provider: 'official', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'official:m' },
    }),
    candidate({
      name: 'a-high-community', repository: 'github.com/acme/a', path: 'skill', relevance: 0.99, sourceTrustClass: 'community',
      metrics: { community: { popularityPercentile: 0.99, installs: 1000 } }, sources: [{ source: 'community' }],
      provenance: { provider: 'community', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'community:a' },
    }),
  ];
  const normalized = normalizeCatalogRecord(records[0]);
  assert.equal(normalized.relevance, 0.8);
  assert.equal(normalized.sourceTrustClass, 'official');

  const deduped = deduplicateCatalog(records);
  const merged = deduped.find((record) => record.repository === 'github.com/acme/z');
  assert.equal(merged.relevance, 0.8);
  assert.equal(merged.sourceTrustClass, 'official');
  assert.deepEqual(merged.sourceEvidence.map((evidence) => [evidence.provider, evidence.relevance, evidence.sourceTrustClass]), [
    ['community', 0.99, 'community'],
    ['official', 0.8, 'official'],
  ]);
  assert.deepEqual(Object.keys(merged.metrics), ['official', 'community']);
  assert.equal(merged.relevance > 1, false, 'adapter-local relevance must not be summed');
  const rededuped = deduplicateCatalog(deduped).find((record) => record.repository === 'github.com/acme/z');
  assert.equal(rededuped.sourceEvidence.find((evidence) => evidence.provider === 'official').metrics.installs, 100);

  assert.deepEqual(rankCatalog(deduped).top.map((record) => record.name), [
    'z-high-official', 'm-low-official', 'a-high-community',
  ]);
});

test('ranking applies strict lexicographic tiers and emits reasons without a universal score', () => {
  const records = [
    candidate({ name: 'unknown', security: { status: 'unknown', reasons: [] }, relevance: 1 }),
    candidate({ name: 'caution', security: { status: 'caution', reasons: [] }, relevance: 1 }),
    candidate({ name: 'pass-low', relevance: 0.1 }),
    candidate({ name: 'pass-high', relevance: 0.9 }),
    candidate({ name: 'malware', security: { status: 'malicious', reasons: ['confirmed malicious'] }, relevance: 1 }),
  ];
  const { top, unverifiedCandidates, excluded } = rankCatalog(records, { now: '2026-08-11T00:00:00.000Z' });
  assert.deepEqual(top.map((item) => item.name), ['pass-high', 'pass-low', 'caution', 'unknown']);
  assert.deepEqual(excluded.map((item) => item.name), ['malware']);
  assert.deepEqual(unverifiedCandidates, []);
  for (const item of top) {
    assert.ok(item.rankingReasons.length >= 6);
    assert.equal('score' in item, false);
    assert.equal('universalScore' in item, false);
  }
});

test('relevance is compared only inside one adapter scope, then trust and later tiers apply', () => {
  const records = [
    candidate({ name: 'trusted-low', relevance: 0.1, provenance: { provider: 'clawhub', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'a' }, sourceTrustClass: 'curated' }),
    candidate({ name: 'community-high', relevance: 0.99, provenance: { provider: 'skills-sh', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'b' }, sourceTrustClass: 'community' }),
    candidate({ name: 'same-adapter-high', relevance: 0.8, provenance: { provider: 'clawhub', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'c' }, sourceTrustClass: 'curated' }),
  ];
  assert.deepEqual(rankCatalog(records).top.map((item) => item.name), ['same-adapter-high', 'trusted-low', 'community-high']);
});

test('ranking uses recency bucket, independent observations, local percentile, then stable identity', () => {
  const base = { relevance: 0.5, sourceTrustClass: 'curated' };
  const records = [
    candidate({ ...base, name: 'z-old', updatedAt: '2024-01-01T00:00:00.000Z' }),
    candidate({ ...base, name: 'few', updatedAt: '2026-07-01T00:00:00.000Z', sources: [{ source: 'clawhub' }], metrics: { clawhub: { popularityPercentile: 0.99 } } }),
    candidate({ ...base, name: 'many-low', updatedAt: '2026-07-01T00:00:00.000Z', sources: [{ source: 'clawhub' }, { source: 'skills-sh' }], metrics: { clawhub: { popularityPercentile: 0.2 }, 'skills-sh': { popularityPercentile: 0.3 } } }),
    candidate({ ...base, name: 'many-high', updatedAt: '2026-07-01T00:00:00.000Z', sources: [{ source: 'clawhub' }, { source: 'skills-sh' }], metrics: { clawhub: { popularityPercentile: 0.8 }, 'skills-sh': { popularityPercentile: 0.7 } } }),
    candidate({ ...base, name: 'a-tie', updatedAt: '2026-07-01T00:00:00.000Z' }),
  ];
  const first = rankCatalog(records, { now: '2026-08-11T00:00:00.000Z' }).top.map((item) => item.name);
  const second = rankCatalog([...records].reverse(), { now: '2026-08-11T00:00:00.000Z' }).top.map((item) => item.name);
  assert.deepEqual(first, ['many-high', 'many-low', 'few', 'a-tie', 'z-old']);
  assert.deepEqual(second, first);
});

test('ranking stays deterministic when adapter-local relevance and cross-adapter trust form a partial order', () => {
  const records = [
    candidate({ name: 'official-low', relevance: 0.1, sourceTrustClass: 'official', provenance: { provider: 'one', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'a' } }),
    candidate({ name: 'community-mid', relevance: 0.5, sourceTrustClass: 'community', provenance: { provider: 'two', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'b' } }),
    candidate({ name: 'unverified-high', relevance: 0.9, sourceTrustClass: 'unverified', provenance: { provider: 'one', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'c' } }),
  ];
  const expected = rankCatalog(records).top.map((item) => item.name);
  for (const permutation of [
    [...records].reverse(), [records[1], records[2], records[0]], [records[2], records[0], records[1]],
  ]) assert.deepEqual(rankCatalog(permutation).top.map((item) => item.name), expected);
});

test('ranking uses complete stable bytewise serialization after identity ties', () => {
  const first = candidate({ name: 'same', description: 'zeta' });
  const second = candidate({ name: 'same', description: 'alpha' });
  const forward = rankCatalog([first, second]).top.map((record) => record.description);
  const reverse = rankCatalog([second, first]).top.map((record) => record.description);
  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward, ['alpha', 'zeta']);
});

test('GitHub-only candidates are kept outside the default top ten', () => {
  const github = candidate({ name: 'github', sources: [{ source: 'github' }], provenance: { provider: 'github', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'g' } });
  const regular = Array.from({ length: 12 }, (_, index) => candidate({ name: `regular-${String(index).padStart(2, '0')}`, provenance: { provider: 'clawhub', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: String(index) } }));
  const result = rankCatalog([github, ...regular]);
  assert.equal(result.top.length, 10);
  assert.deepEqual(result.unverifiedCandidates.map((item) => item.name), ['github']);
});

test('cache keys are deterministic, ordered, and include query filters and adapter version', () => {
  const first = createCacheKey({
    query: ' 代码  审查 ',
    filters: {
      type: 'skill', sources: ['b', 'a', 'b'], kinds: ['skill', 'mcp'], security: ['unknown', 'pass'],
      nested: { status: ['pass', 'caution'], tags: ['中文', 'alpha'] },
    },
    adapterVersion: '2',
  });
  const second = createCacheKey({
    adapterVersion: '2',
    filters: {
      nested: { tags: ['alpha', '中文', 'alpha'], status: ['caution', 'pass'] }, security: ['pass', 'unknown'],
      kinds: ['mcp', 'skill'], sources: ['a', 'b'], type: 'skill',
    },
    query: '代码 审查',
  });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, createCacheKey({ query: '代码 审查', filters: { type: 'mcp' }, adapterVersion: '2' }));
  assert.notEqual(first, createCacheKey({ query: '代码 审查', filters: {}, adapterVersion: '3' }));
  assert.notEqual(
    createCacheKey({ query: 'x', filters: { preferredOrder: ['a', 'b'] }, adapterVersion: '1' }),
    createCacheKey({ query: 'x', filters: { preferredOrder: ['b', 'a'] }, adapterVersion: '1' }),
  );
});

test('public metadata cache expires at 30 minutes and honors no-cache and refresh', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  let now = 1_000_000;
  let calls = 0;
  const cache = new PublicMetadataCache({ cacheRoot: directory, now: () => now });
  const request = { query: 'code review', filters: {}, adapterVersion: '1' };
  const load = async () => ({ results: [{ kind: 'skill', name: `call-${++calls}` }] });
  try {
    assert.deepEqual(await cache.getOrLoad(request, load), { results: [{ kind: 'skill', name: 'call-1' }] });
    assert.deepEqual(await cache.getOrLoad(request, load), { results: [{ kind: 'skill', name: 'call-1' }] });
    now += 30 * 60 * 1000;
    assert.deepEqual(await cache.getOrLoad(request, load), { results: [{ kind: 'skill', name: 'call-2' }] });
    assert.deepEqual(await cache.getOrLoad(request, load, { refresh: true }), { results: [{ kind: 'skill', name: 'call-3' }] });
    assert.deepEqual(await cache.getOrLoad(request, load, { noCache: true }), { results: [{ kind: 'skill', name: 'call-4' }] });
    assert.deepEqual(await cache.getOrLoad(request, load), { results: [{ kind: 'skill', name: 'call-3' }] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache clones values, rejects sensitive material, and writes deterministic public envelopes', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  let now = 42;
  const cache = new PublicMetadataCache({ cacheRoot: directory, now: () => now });
  const request = { query: 'x', filters: {}, adapterVersion: '1' };
  try {
    const loaded = { rows: [{ kind: 'skill', name: 'x' }] };
    const first = await cache.getOrLoad(request, async () => loaded);
    loaded.rows[0].name = 'mutated'; first.rows[0].name = 'also-mutated';
    assert.deepEqual(await cache.getOrLoad(request, async () => null), { rows: [{ kind: 'skill', name: 'x' }] });
    for (const sensitive of [
      { env: { API_KEY: 'x' } }, { authHeaders: { authorization: 'Bearer x' } }, { cookies: ['x'] },
      { browserPayload: {} }, { authenticated: true, rawResponse: { ok: true } },
    ]) await assert.rejects(cache.set(request, sensitive), /sensitive|public metadata/i);
    const cyclic = [];
    cyclic.push(cyclic);
    await assert.rejects(cache.set(request, cyclic), /acyclic JSON/i);
    const key = createCacheKey(request);
    const text = await readFile(path.join(directory, `${key}.json`), 'utf8');
    assert.equal(text, `${JSON.stringify({ schemaVersion: 1, cachedAt: 42, value: { rows: [{ kind: 'skill', name: 'x' }] } })}\n`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache recursively rejects credential and browser-session variants while allowing public catalog evidence', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const request = { query: 'x', filters: {}, adapterVersion: '1' };
  try {
    const sensitiveValues = [
      { rows: [{ API_KEY: 'x' }] },
      { evidence: [{ accessToken: 'x' }] },
      { metrics: { nested: { Client_Secret: 'x' } } },
      { sources: [{ AUTHORIZATION: 'Basic abc' }] },
      { response: { 'Set-Cookie': 'sid=x' } },
      { rawBrowserPayload: { page: 'x' } },
      { Raw_Browser_Response: { ok: true } },
      { rawAuthenticatedResponse: { ok: true } },
      { browser: { sessionPayload: { state: 'x' } } },
      { pageHtml: '<html>private session</html>' },
      { value: 'Bearer abcdefghijklmnop' },
    ];
    for (const [index, value] of sensitiveValues.entries()) {
      await assert.rejects(cache.set(request, value), /sensitive|credential|public metadata/i, `sensitive value ${index}`);
    }

    const publicCatalog = {
      rows: [{
        kind: 'skill', name: 'review',
        sources: [{ source: 'skills-sh', url: 'https://skills.sh/review' }],
        metrics: { 'skills-sh': { installs: 12, popularityPercentile: 0.8 } },
        sourceEvidence: [{ provider: 'skills-sh', rawId: 'public:1', relevance: 0.8 }],
      }],
    };
    assert.deepEqual(await cache.set(request, publicCatalog), publicCatalog);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache public metadata schema rejects unknown fields and permits only normalized catalog structures', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const request = { query: 'review', filters: { sources: ['skills-sh'] }, adapterVersion: '1' };
  const publicResult = {
    schemaVersion: 1,
    query: 'review',
    filters: { sources: ['skills-sh'] },
    adapterVersion: '1',
    results: [{
      kind: 'skill', name: 'review', description: 'Public review skill', author: 'acme',
      repository: 'github.com/acme/review', path: 'skills/review', url: 'https://skills.sh/review', version: '1.0.0',
      sources: [{ source: 'skills-sh', url: 'https://skills.sh/review', verified: true }],
      metrics: { 'skills-sh': { installs: 12, popularityPercentile: 0.8, stars: 3 } },
      updatedAt: '2026-08-11T00:00:00.000Z',
      security: { status: 'pass', reasons: ['public scan'] },
      provenance: { provider: 'skills-sh', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'public:1' },
      relevance: 0.8, sourceTrustClass: 'curated', maintenance: { status: 'active', recencyBucket: 4 },
      sourceEvidence: [{
        provider: 'skills-sh', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'public:1', relevance: 0.8,
        sourceTrustClass: 'curated', updatedAt: '2026-08-11T00:00:00.000Z',
        metrics: { installs: 12, popularityPercentile: 0.8 },
      }],
      rankingReasons: ['security:pass'], deduplicationConfidence: 'high',
    }],
  };
  try {
    assert.deepEqual(await cache.set(request, publicResult), publicResult);
    const rejected = [
      { results: [{ kind: 'skill', name: 'x', privateKey: 'x' }] },
      { results: [{ kind: 'skill', name: 'x', sshKey: 'x' }] },
      { results: [{ kind: 'skill', name: 'x', browserContext: {} }] },
      { results: [{ kind: 'skill', name: 'x', storageState: {} }] },
      { results: [{ kind: 'skill', name: 'x', rawBrowserDOM: '<div />' }] },
      { results: [{ kind: 'skill', name: 'x', payload: { arbitrary: true } }] },
      { results: [{ kind: 'skill', name: 'x', metrics: { source: { installs: 1, payload: {} } } }] },
      { results: [{ kind: 'skill', name: 'x', sourceEvidence: [{ provider: 'x', payload: {} }] }] },
      { results: [{ kind: 'skill', name: 'x', unknownPublicLookingField: 'x' }] },
    ];
    for (const [index, value] of rejected.entries()) {
      await assert.rejects(cache.set(request, value), /schema|unknown|allowed|sensitive/i, `schema rejection ${index}`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache validates install commands, record kinds, coverage, and context-sensitive public metrics', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const request = { query: 'x', filters: {}, adapterVersion: '1' };
  const safe = {
    coverage: { skills: { ok: true, source: 'skills', resultCount: 2, elapsedMs: 5, status: 'success' } },
    results: [{
      kind: 'skill', name: 'x', metrics: { skills: { tokenCount: 12 } },
      installCommands: {
        npm: 'npm install x --tokenCount 12',
        curl: 'curl -H "Accept: application/json" https://example.test/public',
      },
    }],
  };
  try {
    assert.deepEqual(await cache.set(request, safe), safe);
    for (const command of [
      'npm config set //registry.example/:_authToken=actual-secret',
      'tool install --token actual-secret',
      'tool install --password=actual-secret',
      'curl -H "Authorization: Bearer abcdefghijklmnop" https://example.test',
    ]) {
      await assert.rejects(cache.set(request, {
        results: [{ kind: 'skill', name: 'x', installCommands: { nested: command } }],
      }), /credential|install command|sensitive/i);
    }
    await assert.rejects(cache.set(request, { results: [{ kind: 'widget', name: 'x' }] }), /kind|schema/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('install command assignments and flags reject credential identifiers and unsafe values', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const safeRequest = { query: 'safe-install', filters: {}, adapterVersion: '1' };
  const safe = {
    results: [{
      kind: 'skill', name: 'safe-install', installCommands: {
        leading: 'PACKAGE_NAME=example npm install example',
        equals: 'tool install --tokenCount=12',
        separate: 'tool install --weekly-downloads 42',
      },
    }],
  };
  try {
    assert.deepEqual(await cache.set(safeRequest, safe), safe);
    const rejected = [
      'NPM_TOKEN=actual-secret npm install example',
      'tool install --access_token=actual-secret',
      'tool install --client_secret actual-secret',
      'tool install --password=actual-secret',
      'tool install --jwt actual-secret',
      'tool install --access-key actual-secret',
      'tool install --token=${TOKEN}suffix',
      'tool install --token=$(read-secret)',
      'TOKEN=$TOKEN-suffix tool install example',
      'NPM_TOKEN=$NPM_TOKEN npm install example',
      'tool install --access_token=${ACCESS_TOKEN}',
    ];
    for (const [index, command] of rejected.entries()) {
      const request = { query: `unsafe-install-${index}`, filters: {}, adapterVersion: '1' };
      await assert.rejects(cache.set(request, {
        results: [{ kind: 'skill', name: 'unsafe-install', installCommands: { shell: command } }],
      }), /credential|install command|sensitive|shell/i, command);
      assert.equal((await readdir(directory)).includes(`${createCacheKey(request)}.json`), false);
    }
    const disk = await Promise.all((await readdir(directory)).map((entry) => readFile(path.join(directory, entry), 'utf8')));
    assert.doesNotMatch(disk.join('\n'), /actual-secret|read-secret|TOKEN-suffix/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('install commands conservatively tokenize shell syntax and reject transport credentials without persistence', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const safeRequest = { query: 'safe-shell-install', filters: {}, adapterVersion: '1' };
  const safe = {
    results: [{
      kind: 'skill', name: 'safe-shell-install', installCommands: {
        npm: 'npm install public-package',
        npx: 'npx public-package --tokenCount 12',
        openclaw: 'openclaw skills install public-package',
        git: 'git clone ssh://git@github.com/acme/public.git',
      },
    }],
  };
  try {
    assert.deepEqual(await cache.set(safeRequest, safe), safe);
    const rejected = [
      'tool install;NPM_TOKEN=actual-secret npm install private-package',
      'tool install && NPM_TOKEN=actual-secret npm install private-package',
      'tool install || NPM_TOKEN=actual-secret npm install private-package',
      'tool install\nNPM_TOKEN=actual-secret npm install private-package',
      'tool install | NPM_TOKEN=actual-secret npm install private-package',
      '$env:NPM_TOKEN=actual-secret',
      'curl -u user:actual-secret https://example.test/install',
      "curl --user='user:actual-secret' https://example.test/install",
      'wget --password actual-secret https://example.test/install',
      'curl -H "Authorization: Bearer actual-secret" https://example.test/install',
      "curl --header='Cookie: session=actual-secret' https://example.test/install",
      'curl --header "X-Api-Key: actual-secret" https://example.test/install',
      'curl -HToken:actual-secret https://example.test/install',
      'curl -H Authorization:\\ Bearer\\ actual-secret https://example.test/install',
      'tool install "--access_token=actual-secret"',
      'tool install --token "unterminated',
      'tool install --token=$(read-secret)',
      'tool install `read-secret`',
    ];
    for (const [index, command] of rejected.entries()) {
      const request = { query: `unsafe-shell-install-${index}`, filters: {}, adapterVersion: '1' };
      await assert.rejects(cache.set(request, {
        results: [{ kind: 'skill', name: 'unsafe-shell-install', installCommands: { shell: command } }],
      }), /credential|install command|sensitive|shell|quote|control/i, command);
      assert.equal((await readdir(directory)).includes(`${createCacheKey(request)}.json`), false);
    }
    const disk = await Promise.all((await readdir(directory)).map((entry) => readFile(path.join(directory, entry), 'utf8')));
    assert.doesNotMatch(disk.join('\n'), /actual-secret|read-secret|private-package|user:/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('install command tokens fail closed on sensitive identifiers, PowerShell environment mutation, and grouping', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const safeRequest = { query: 'safe-token-install', filters: {}, adapterVersion: '1' };
  const safe = {
    results: [{
      kind: 'skill', name: 'safe-token-install', installCommands: {
        metric: 'tool install --tokenCount 12',
        placeholder: 'tool install "$NPM_TOKEN"',
      },
    }],
  };
  try {
    assert.deepEqual(await cache.set(safeRequest, safe), safe);
    const rejected = [
      'NPM_TOKEN = actual-secret',
      'API_KEY : actual-secret',
      'CLIENT_SECRET actual-secret',
      '$env:NPM_TOKEN = actual-secret',
      '$EnV:PATH = actual-secret',
      'Set-Item Env:PATH actual-secret',
      'sEt-CoNtEnT eNv:Path actual-secret',
      'NEW-ITEM ENV:PATH actual-secret',
      '(tool install public-package)',
      'tool install {public-package}',
    ];
    for (const [index, command] of rejected.entries()) {
      const request = { query: `unsafe-token-install-${index}`, filters: {}, adapterVersion: '1' };
      await assert.rejects(cache.set(request, {
        results: [{ kind: 'skill', name: 'unsafe-token-install', installCommands: { shell: command } }],
      }), /credential|install command|sensitive|shell|control|environment/i, command);
      assert.equal((await readdir(directory)).includes(`${createCacheKey(request)}.json`), false);
    }
    const disk = await Promise.all((await readdir(directory)).map((entry) => readFile(path.join(directory, entry), 'utf8')));
    assert.doesNotMatch(disk.join('\n'), /actual-secret|CLIENT_SECRET|API_KEY|Set-Item|sEt-CoNtEnT|NEW-ITEM/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('install command URLs reject userinfo and sensitive query or fragment parameters without persistence', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const safeRequest = { query: 'safe-url-install', filters: {}, adapterVersion: '1' };
  const safe = {
    results: [{
      kind: 'skill', name: 'safe-url-install', installCommands: {
        public: 'curl -o archive.tgz "https://example.test/releases/archive.tgz?version=1&platform=darwin#install"',
        ssh: 'git clone ssh://git@github.com/acme/public.git',
        gitSsh: 'git clone git+ssh://git@github.com/acme/public.git',
      },
    }],
  };
  try {
    assert.deepEqual(await cache.set(safeRequest, safe), safe);
    const rejected = [
      'curl https://example.test/install?token=actual-secret',
      'curl "https://example.test/install?access_token=actual-secret"',
      'curl https://user:actual-secret@example.test/install',
      'curl "https://example.test/install?channel=stable#section=install&client_secret=actual-secret"',
      'curl "https://example.test/install?first=public&password=actual-secret&last=public"',
      'curl https://example.test/install?api%5Fkey=actual%2Dsecret',
      'curl "https://example.test/install#jwt=actual%2Dsecret&mode=fast"',
      'curl https://example.test/install?access-key=${ACCESS_KEY}',
      'curl https://example.test/install?sig=actual-secret',
      'curl https://example.test/install?x-amz-signature=${SIGNATURE}',
      'curl https://example.test/install?signed%5Ftoken=actual%2Dsecret',
      'git clone ssh://user@github.com/acme/private.git',
      'git clone ssh://git:actual-secret@github.com/acme/private.git',
      'git clone git+ssh://user@github.com/acme/private.git',
    ];
    for (const [index, command] of rejected.entries()) {
      const request = { query: `unsafe-url-install-${index}`, filters: {}, adapterVersion: '1' };
      await assert.rejects(cache.set(request, {
        results: [{ kind: 'skill', name: 'unsafe-url-install', installCommands: { shell: command } }],
      }), /credential|install command|sensitive|url|shell|control/i, command);
      assert.equal((await readdir(directory)).includes(`${createCacheKey(request)}.json`), false);
    }
    const disk = await Promise.all((await readdir(directory)).map((entry) => readFile(path.join(directory, entry), 'utf8')));
    assert.doesNotMatch(disk.join('\n'), /actual-secret|actual%2Dsecret|user:|ACCESS_KEY/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache round-trips real normalized and deduplicated records with public discovery and platform metrics', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory, now: () => 100 });
  const request = { query: 'review', filters: { sources: ['skills-sh'] }, adapterVersion: '1' };
  const input = [{
    kind: 'skill', name: 'review', repository: 'github.com/acme/review', path: 'skills/review', relevance: 0.8,
    sourceTrustClass: 'curated', updatedAt: '2026-08-11T00:00:00.000Z',
    sources: [{
      source: 'skills-sh', provider: 'skills-sh', id: 'skill:review', url: 'https://skills.sh/review',
      homepage: 'https://example.test/review', repository: 'github.com/acme/review', path: 'skills/review', ref: 'main',
      version: '1.0.0', label: 'Review', kind: 'skill', tags: ['review', 'quality'],
    }],
    metrics: { 'skills-sh': { weeklyDownloads: 42, popularityPercentile: 0.8, trend: 'rising', verified: true } },
    security: { status: 'pass', reasons: [] },
    provenance: { provider: 'skills-sh', retrievedAt: '2026-08-11T00:00:00.000Z', rawId: 'skill:review' },
  }];
  try {
    const results = deduplicateCatalog(input.map(normalizeCatalogRecord));
    const value = { results };
    assert.deepEqual(await cache.set(request, value), value);
    assert.deepEqual(await cache.get(request), value);
    assert.equal(value.results[0].sources[0].homepage, 'https://example.test/review');
    assert.equal(value.results[0].metrics['skills-sh'].weeklyDownloads, 42);
    assert.equal(value.results[0].sourceEvidence[0].metrics.weeklyDownloads, 42);

    for (const metrics of [
      { payload: { arbitrary: true } }, { weeklyDownloads: [42] }, { weeklyDownloads: { value: 42 } },
      { privateKey: 'x' }, { rawBrowserDOM: 'x' },
    ]) {
      await assert.rejects(cache.set(request, { results: [{ name: 'x', metrics: { source: metrics } }] }), /schema|sensitive/i);
      await assert.rejects(cache.set(request, {
        results: [{ name: 'x', sourceEvidence: [{ provider: 'source', metrics }] }],
      }), /schema|sensitive/i);
    }
    await assert.rejects(cache.set(request, {
      results: [{ name: 'x', sources: [{ source: 'source', payload: 'unknown' }] }],
    }), /schema|unknown/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('dynamic public metric names use semantic word boundaries for credential rejection', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const request = { query: 'metrics', filters: {}, adapterVersion: '1' };
  try {
    const allowed = { tokenCount: 12, token_usage: 3, 'token-limit': 100, weeklyDownloads: 42 };
    assert.deepEqual(await cache.set(request, {
      results: [{
        kind: 'skill', name: 'metrics', metrics: { source: allowed },
        sourceEvidence: [{ provider: 'source', metrics: allowed }],
      }],
    }), {
      results: [{
        kind: 'skill', name: 'metrics', metrics: { source: allowed },
        sourceEvidence: [{ provider: 'source', metrics: allowed }],
      }],
    });

    for (const key of [
      'apiKeyValue', 'api_key_value', 'api-key-value', 'passwordHash', 'privateKeyPem', 'clientCredentials',
      'accessTokenAge', 'refresh_token_age', 'auth-token-usage', 'jwt', 'jwtValue', 'accessKeyId', 'access_key_secret',
      'clientSecret', 'refreshToken', 'idToken',
    ]) {
      for (const record of [
        { kind: 'skill', name: 'x', metrics: { source: { [key]: 1 } } },
        { kind: 'skill', name: 'x', sourceEvidence: [{ provider: 'source', metrics: { [key]: 1 } }] },
      ]) await assert.rejects(cache.set(request, { results: [record] }), /sensitive|credential|metric/i, key);
    }
    await assert.rejects(cache.set(request, {
      results: [{ kind: 'skill', name: 'x', metrics: { source: { tokenCount: 'sk-proj-abcdefghijklmnop' } } }],
    }), /sensitive|credential/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache uses contained atomic files, rejects symlink roots, and tolerates concurrent writers', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cacheRoot = path.join(directory, 'cache');
  const cache = new PublicMetadataCache({ cacheRoot, now: () => 10 });
  const request = { query: 'x', filters: {}, adapterVersion: '1' };
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => cache.set(request, { results: [{ kind: 'skill', name: `candidate-${index}` }] })));
    const value = await cache.get(request);
    assert.match(value.results[0].name, /^candidate-[0-7]$/u);
    assert.deepEqual(await readdir(cacheRoot), [`${createCacheKey(request)}.json`]);
    const target = path.join(directory, 'target');
    const linked = path.join(directory, 'linked-cache');
    await mkdir(target);
    await symlink(target, linked);
    await assert.rejects(new PublicMetadataCache({ cacheRoot: linked }).set(request, {}), /symlink|containment/i);
    await writeFile(path.join(cacheRoot, `${createCacheKey(request)}.tmp`), 'partial');
    assert.deepEqual(await cache.get(request), value);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('cache rejects symlink ancestors and single-flights same-key loads across instances', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const actualParent = path.join(directory, 'actual-parent');
  const linkedParent = path.join(directory, 'linked-parent');
  const request = { query: 'same', filters: {}, adapterVersion: '1' };
  try {
    await mkdir(actualParent);
    await symlink(actualParent, linkedParent);
    await assert.rejects(
      new PublicMetadataCache({ cacheRoot: path.join(linkedParent, 'cache') }).set(request, { results: [] }),
      /symlink|containment/i,
    );

    const cacheRoot = path.join(directory, 'single-flight');
    const first = new PublicMetadataCache({ cacheRoot });
    const second = new PublicMetadataCache({ cacheRoot });
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await Promise.resolve();
      return { results: [{ kind: 'skill', name: 'shared' }] };
    };
    const values = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      (index % 2 === 0 ? first : second).getOrLoad(request, loader)));
    assert.equal(calls, 1);
    for (const value of values) assert.deepEqual(value, { results: [{ kind: 'skill', name: 'shared' }] });

    const failureRequest = { ...request, query: 'failure' };
    let failures = 0;
    const failing = async () => { failures += 1; throw new Error('loader failed'); };
    await assert.rejects(Promise.all([first.getOrLoad(failureRequest, failing), second.getOrLoad(failureRequest, failing)]), /loader failed/);
    assert.equal(failures, 1);
    assert.deepEqual(await first.getOrLoad(failureRequest, async () => {
      failures += 1;
      return { results: [{ kind: 'skill', name: 'recovered' }] };
    }), { results: [{ kind: 'skill', name: 'recovered' }] });
    assert.equal(failures, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('single-flight separates refresh semantics and no-cache bypasses cache and flights', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const request = { query: 'refresh-flight', filters: {}, adapterVersion: '1' };
  let releaseNormal;
  let normalCalls = 0;
  let refreshCalls = 0;
  try {
    const normal = cache.getOrLoad(request, async () => {
      normalCalls += 1;
      await new Promise((resolve) => { releaseNormal = resolve; });
      return { results: [{ kind: 'skill', name: 'normal' }] };
    });
    while (normalCalls === 0) await new Promise((resolve) => setImmediate(resolve));
    const refreshLoader = async () => {
      refreshCalls += 1;
      return { results: [{ kind: 'skill', name: 'fresh' }] };
    };
    const refreshes = [
      cache.getOrLoad(request, refreshLoader, { refresh: true }),
      cache.getOrLoad(request, refreshLoader, { refresh: true }),
    ];
    releaseNormal();
    assert.deepEqual(await normal, { results: [{ kind: 'skill', name: 'normal' }] });
    for (const refreshed of await Promise.all(refreshes)) {
      assert.deepEqual(refreshed, { results: [{ kind: 'skill', name: 'fresh' }] });
    }
    assert.equal(normalCalls, 1);
    assert.equal(refreshCalls, 1);

    let noCacheCalls = 0;
    const noCacheValues = await Promise.all(Array.from({ length: 2 }, () => cache.getOrLoad(request, async () => ({
      results: [{ kind: 'skill', name: `no-cache-${++noCacheCalls}` }],
    }), { noCache: true })));
    assert.equal(noCacheCalls, 2);
    assert.notDeepEqual(noCacheValues[0], noCacheValues[1]);
    assert.notEqual((await cache.get(request)).results[0].name.startsWith('no-cache-'), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refresh generations prevent stale default overwrite and remain fail-safe after refresh failure', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const request = { query: 'generation', filters: {}, adapterVersion: '1' };
  let defaultStarted = false;
  let releaseDefault;
  try {
    const staleDefault = cache.getOrLoad(request, async () => {
      defaultStarted = true;
      await new Promise((resolve) => { releaseDefault = resolve; });
      return { results: [{ kind: 'skill', name: 'stale-default' }] };
    });
    while (!defaultStarted) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(await cache.getOrLoad(request, async () => ({
      results: [{ kind: 'skill', name: 'fresh-refresh' }],
    }), { refresh: true }), { results: [{ kind: 'skill', name: 'fresh-refresh' }] });
    releaseDefault();
    assert.deepEqual(await staleDefault, { results: [{ kind: 'skill', name: 'stale-default' }] });
    assert.deepEqual(await cache.get(request), { results: [{ kind: 'skill', name: 'fresh-refresh' }] });

    const failedRequest = { ...request, query: 'failed-generation' };
    let failedDefaultStarted = false;
    let releaseFailedDefault;
    const invalidatedDefault = cache.getOrLoad(failedRequest, async () => {
      failedDefaultStarted = true;
      await new Promise((resolve) => { releaseFailedDefault = resolve; });
      return { results: [{ kind: 'skill', name: 'invalidated-default' }] };
    });
    while (!failedDefaultStarted) await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(cache.getOrLoad(failedRequest, async () => { throw new Error('refresh failed'); }, {
      refresh: true,
    }), /refresh failed/);
    releaseFailedDefault();
    assert.deepEqual(await invalidatedDefault, { results: [{ kind: 'skill', name: 'invalidated-default' }] });
    assert.equal(await cache.get(failedRequest), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('generation validation and cache commit are serialized against a completing refresh', async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'super-skill-cache-')));
  const cache = new PublicMetadataCache({ cacheRoot: directory });
  const request = { query: 'generation-write-race', filters: {}, adapterVersion: '1' };
  const set = cache.set.bind(cache);
  let enterDefaultSet;
  let releaseDefaultSet;
  const defaultEnteredSet = new Promise((resolve) => { enterDefaultSet = resolve; });
  const defaultSetGate = new Promise((resolve) => { releaseDefaultSet = resolve; });
  cache.set = async (setRequest, value, options) => {
    if (value.results?.[0]?.name === 'stale-after-check') {
      enterDefaultSet();
      await defaultSetGate;
    }
    return set(setRequest, value, options);
  };
  try {
    const staleDefault = cache.getOrLoad(request, async () => ({
      results: [{ kind: 'skill', name: 'stale-after-check' }],
    }));
    await defaultEnteredSet;
    assert.deepEqual(await cache.getOrLoad(request, async () => ({
      results: [{ kind: 'skill', name: 'fresh-after-race' }],
    }), { refresh: true }), { results: [{ kind: 'skill', name: 'fresh-after-race' }] });
    releaseDefaultSet();
    assert.deepEqual(await staleDefault, { results: [{ kind: 'skill', name: 'stale-after-check' }] });
    assert.deepEqual(await cache.get(request), { results: [{ kind: 'skill', name: 'fresh-after-race' }] });
  } finally {
    releaseDefaultSet();
    await rm(directory, { recursive: true, force: true });
  }
});
