import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withAdvisoryCache } from './advisory-cache.mjs';
import { withJevRun } from './run-context.mjs';
import { safeCallJev } from './safe-call.mjs';

test('optional advisory callback failure returns the original items', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'jev-advisory-cache-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const items = [{ title: 'first' }, { title: 'second' }];
  const result = await withAdvisoryCache({ root }, 'test', { task: { query: 'query' } }, items,
    { callJev: async () => null }, async () => { throw new Error('advisory failed'); });
  assert.strictEqual(result.items, items);
  assert.equal(result.diagnostic.status, 'fallback');
});

test('symlinked session root never reads, writes, or clears the target sidecar', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'jev-advisory-root-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const target = join(parent, 'external');
  const alias = join(parent, 'session-link');
  mkdirSync(target);
  symlinkSync(target, alias, 'dir');
  const sentinel = join(target, 'sentinel.txt');
  const sidecar = join(target, '.jev-advisory-cache.json');
  writeFileSync(sentinel, 'unrelated data');
  const session = { task: { query: 'query' } };
  const items = [{ title: 'first' }, { title: 'second' }];
  const callJev = async () => null;
  const options = { callJev };
  const used = () => ({ items: [items[1], items[0]], diagnostic: { status: 'used' } });

  const first = await withAdvisoryCache({ root: alias }, 'test', session, items, options, used);
  assert.deepEqual(first.items, [items[1], items[0]]);
  assert.equal(existsSync(sidecar), false);

  await withAdvisoryCache({ root: target }, 'test', session, items, options, used);
  const persisted = readFileSync(sidecar, 'utf8');
  const fallback = () => ({ items, diagnostic: { status: 'fallback', code: 'MODEL_FAILED' } });
  const second = await withAdvisoryCache({ root: alias }, 'test', session, items, options, fallback);
  assert.strictEqual(second.items, items);
  await withAdvisoryCache({ root: alias }, 'test', session, items, {
    callJev, privateData: true, environment: { TYPESAFE_ENTERPRISE_ENABLED: 'false' },
  }, fallback);
  assert.equal(readFileSync(sidecar, 'utf8'), persisted);
  assert.equal(readFileSync(sentinel, 'utf8'), 'unrelated data');
});

test('default production transport keeps its sidecar identity across processes', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'jev-advisory-default-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const items = [{ title: 'first' }, { title: 'second' }];
  const session = { task: { query: 'query' } };
  const options = { environment: { TYPESAFE_API_KEY: 'test-only-key' } };
  const first = await withAdvisoryCache({ root }, 'test', session, items, options,
    () => ({ items: [items[1], items[0]], diagnostic: { status: 'used' } }));
  assert.equal(first.diagnostic.status, 'used');
  const code = `import { withAdvisoryCache } from ${JSON.stringify(new URL('./advisory-cache.mjs', import.meta.url).href)};
    const items = [{ title: 'first' }, { title: 'second' }];
    const result = await withAdvisoryCache({ root: process.argv[1] }, 'test', { task: { query: 'query' } }, items,
      { environment: { TYPESAFE_API_KEY: 'test-only-key' } },
      () => ({ items, diagnostic: { status: 'fallback' } }));
    process.stdout.write(JSON.stringify({ titles: result.items.map((item) => item.title), code: result.diagnostic.code }));`;
  const second = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code, root], { encoding: 'utf8' }));
  assert.deepEqual(second, { titles: ['second', 'first'], code: 'JEV_ADVISORY_CACHE_HIT' });
});

for (const transport of ['callJev', 'fetchImpl']) {
  test(`sidecar wrapper returns original items when changed ${transport} gives invalid advice`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'jev-advisory-transport-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const items = [{ title: 'first' }, { title: 'second' }];
    const session = { task: { query: 'query' } };
    const payload = { state: { query: 'query' }, questions: { order: { type: 'choice', criteria: { reverse: 'reverse' } } } };
    let invalidCalls = 0;
    const good = async () => ({ ok: true, document: { answers: { order: { type: 'choice', choice: 'reverse', confidence: 0.95 } } } });
    const invalid = async () => { invalidCalls += 1; return null; };
    const options = { environment: {}, callJev: (_payload, details) => details.fetchImpl(), fetchImpl: good };
    const compute = async (currentOptions) => {
      const answer = await safeCallJev(payload, currentOptions);
      return answer.ok ? { items: [items[1], items[0]], diagnostic: { status: 'used' } }
        : { items, diagnostic: { status: 'fallback', code: answer.diagnostic.code } };
    };
    await withJevRun(async () => {
      const first = await withAdvisoryCache({ root }, 'test', session, items, options, () => compute(options));
      assert.deepEqual(first.items, [items[1], items[0]]);
      const changed = { ...options, [transport]: invalid };
      const second = await withAdvisoryCache({ root }, 'test', session, items, changed, () => compute(changed));
      assert.strictEqual(second.items, items);
      assert.equal(second.diagnostic.status, 'fallback');
      assert.equal(invalidCalls, 1);
    });
  });
}
