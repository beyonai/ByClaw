import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cmdCollect, collectionStatus, recordPendingCollectionItem } from './collection-state.mjs';
import { cmdInit } from './research-state.mjs';
import { sessionPaths } from './session.mjs';
import { analyzeWebMarkdown } from './web-content-analysis.mjs';
import { runWebMaterialize } from './web-materializer.mjs';

const SOURCE_URL = 'https://example.com/news/1234567';

function completeArticle() {
  return [
    '第一部分介绍 Example 公司的业务发展和市场背景。',
    '',
    '第二部分分析 Example 新产品、研发投入与用户增长。',
    '',
    '第三部分引用管理层公开说明并解释未来规划。',
    '',
    '第四部分讨论行业竞争、风险和长期机会。',
    '',
    '第五部分总结 Example 当前进展和后续观察重点。',
    '',
    '![chart](images/chart.png)',
    '![tracker](https://cdn.example.com/tracker.gif)',
    '',
  ].join('\n');
}

async function fixture(markdown = completeArticle()) {
  const root = await mkdtemp(join(tmpdir(), 'web-materializer-'));
  cmdInit({
    'session-dir': root,
    query: '采集一篇关于 Example 的文章',
    'direct-urls': JSON.stringify([SOURCE_URL]),
    'required-content-granularity': 'full-text',
  });
  const paths = sessionPaths(root);
  const rawDir = join(root, 'raw/bycli/web/example-report');
  await mkdir(join(rawDir, 'images'), { recursive: true });
  const articlePath = join(rawDir, 'article.md');
  await writeFile(articlePath, markdown);
  await writeFile(join(rawDir, 'images/chart.png'), 'chart-image');
  const executorResultPath = join(rawDir, 'executor-result.json');
  await writeFile(executorResultPath, `${JSON.stringify({
    schemaVersion: '1.0', executor: 'bycli', requestedUrl: SOURCE_URL, resolvedUrl: SOURCE_URL,
    status: 'saved', exitCode: 0, errorCode: null, timedOut: false, truncated: false,
    saved: 'raw/bycli/web/example-report/article.md', size: Buffer.byteLength(markdown),
    sha256: crypto.createHash('sha256').update(markdown).digest('hex'),
    title: 'Example 深度报道', startedAt: '2026-09-01T00:00:00.000Z',
    finishedAt: '2026-09-01T00:00:01.000Z', durationMs: 1000,
  }, null, 2)}\n`);
  recordPendingCollectionItem(paths, {
    itemId: 'example-report', source: 'public-internet', sourceSkill: 'bycli', backend: 'web',
    sourceUrl: SOURCE_URL, title: 'Example 深度报道',
    rawArtifacts: [
      'raw/bycli/web/example-report/article.md',
      'raw/bycli/web/example-report/executor-result.json',
    ],
    reason: 'awaiting-materialization',
  });
  return { root, paths, articlePath, executorResultPath };
}

test('analyzer removes remote media but keeps a complete article high confidence', () => {
  const result = analyzeWebMarkdown(completeArticle(), { title: 'Example 深度报道' });
  assert.equal(result.confidence, 'high');
  assert.equal(result.remoteMediaRemoved, 1);
  assert.doesNotMatch(result.markdown, /tracker\.gif/);
  assert.match(result.markdown, /images\/chart\.png/);
});

test('analyzer removes site-root images instead of treating them as local assets', () => {
  const markdown = `${completeArticle()}![site logo](/images/site-logo.png)\n`;
  const result = analyzeWebMarkdown(markdown, { title: 'Example 深度报道' });
  assert.equal(result.confidence, 'high');
  assert.equal(result.remoteMediaRemoved, 2);
  assert.doesNotMatch(result.markdown, /site-logo\.png/);
  assert.deepEqual(result.localAssets, ['images/chart.png']);
});

test('analyzer does not treat incidental login navigation in a long article as a challenge', () => {
  const paragraphs = Array.from({ length: 6 }, (_, index) =>
    `第${index + 1}部分介绍人工智能产业发展情况、应用进展与行业观察。`.repeat(8));
  const markdown = `登录\n\n${paragraphs.join('\n\n')}\n`;
  const result = analyzeWebMarkdown(markdown, { title: '人工智能产业发展调查' });
  assert.equal(result.confidence, 'high');
  assert.doesNotMatch(result.reasonCodes.join(','), /challenge-or-login-marker/);
});

test('materializes controlled web output with duplicated safe assets and registered receipt', async () => {
  const f = await fixture();
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });
    assert.equal(result.materialization.status, 'materialized');
    assert.equal(result.materialization.contentGranularity, 'full-text');
    assert.equal(await readFile(join(
      f.root, 'markdown/items/example-report/assets/images/chart.png',
    ), 'utf8'), 'chart-image');
    assert.equal(await readFile(join(
      f.root, 'sanitized/items/example-report/assets/images/chart.png',
    ), 'utf8'), 'chart-image');
    const sanitized = await readFile(join(
      f.root, 'sanitized/items/example-report/index.md',
    ), 'utf8');
    assert.match(sanitized, /source_url: "https:\/\/example\.com\/news\/1234567"/);
    assert.doesNotMatch(sanitized, /tracker\.gif/);
    assert.match(sanitized, /assets\/images\/chart\.png/);

    const payload = JSON.parse(await readFile(result.collectPayloadPath, 'utf8'));
    assert.equal(payload.contentGranularity, 'full-text');
    assert.equal(payload.fullTextEvidence.artifact, 'raw/materialization/example-report.json');
    const diagnostics = JSON.parse(await readFile(join(
      f.root, 'raw/materialization/example-report.json',
    ), 'utf8'));
    assert.ok(diagnostics.inputFiles.every((file) => /^sha256:[a-f0-9]{64}$/.test(file.sha256)));
    assert.ok(diagnostics.outputFiles.some((file) =>
      file.artifact === 'sanitized/items/example-report/assets/images/chart.png'
      && /^sha256:[a-f0-9]{64}$/.test(file.sha256)));
    assert.equal(cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }).ok, true);
    const status = collectionStatus(f.paths);
    assert.equal(status.deliveryComplete, true, JSON.stringify(status, null, 2));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('materializer drops referenced relative images that were not downloaded', async () => {
  const f = await fixture(`${completeArticle()}![missing](./missing-photo.jpg)\n`);
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });
    assert.equal(result.materialization.status, 'materialized');
    const sanitized = await readFile(join(
      f.root, 'sanitized/items/example-report/index.md',
    ), 'utf8');
    assert.doesNotMatch(sanitized, /missing-photo\.jpg/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('keeps challenge or structurally incomplete output pending without a collect payload', async () => {
  const f = await fixture('请完成验证码后继续访问');
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });
    assert.equal(result.materialization.status, 'pending');
    assert.equal(result.collectPayloadPath, null);
    assert.equal(collectionStatus(f.paths).deliveryComplete, false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('rejects a changed acquired article whose hash no longer matches', async () => {
  const f = await fixture();
  try {
    await writeFile(f.articlePath, 'tampered');
    await assert.rejects(
      runWebMaterialize(f.paths, {
        'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
      }),
      /hash|sha256|size/i,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('rejects an item raw directory that is itself a symlink', async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'web-materializer-outside-'));
  try {
    const rawDir = join(f.root, 'raw/bycli/web/example-report');
    const moved = join(outside, 'example-report');
    await rename(rawDir, moved);
    await symlink(moved, rawDir);
    await assert.rejects(
      runWebMaterialize(f.paths, {
        'item-id': 'example-report',
        'executor-result-file': join(rawDir, 'executor-result.json'),
      }),
      /符号链接|越出|不安全/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('returns idempotent success for an unchanged published materialization', async () => {
  const f = await fixture();
  try {
    const args = { 'item-id': 'example-report', 'executor-result-file': f.executorResultPath };
    const first = await runWebMaterialize(f.paths, args);
    const second = await runWebMaterialize(f.paths, args);
    assert.equal(second.idempotent, true);
    assert.equal(second.collectPayloadPath, first.collectPayloadPath);
    assert.equal(second.materialization.status, 'materialized');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
