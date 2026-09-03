import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { cmdCollect, collectionStatus, recordPendingCollectionItem } from './collection-state.mjs';
import { executeLocalCommand } from './command-router.mjs';
import { recordDiscoveryResult, reserveDiscoveryAttempt } from './discovery-authorization.mjs';
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

async function fixture(markdown = completeArticle(), {
  discoveryPageType = null,
  requestedUrl = SOURCE_URL,
  resolvedUrl = requestedUrl,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'web-materializer-'));
  const initArgs = {
    'session-dir': root,
    query: '采集一篇关于 Example 的文章',
    'required-content-granularity': 'full-text',
  };
  if (!discoveryPageType) initArgs['direct-urls'] = JSON.stringify([requestedUrl]);
  cmdInit(initArgs);
  if (discoveryPageType) {
    const sessionPath = join(root, 'session.json');
    const session = JSON.parse(await readFile(sessionPath, 'utf8'));
    reserveDiscoveryAttempt(session.task.discoveryGate, {
      query: 'Example 深度文章',
      category: 'general',
    });
    recordDiscoveryResult(session.task.discoveryGate, {
      query: 'Example 深度文章',
      category: 'general',
      candidates: [{
        url: requestedUrl,
        title: 'Example 深度报道',
        pageType: discoveryPageType,
      }],
    });
    await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  }
  const paths = sessionPaths(root);
  const rawDir = join(root, 'raw/bycli/web/example-report');
  await mkdir(join(rawDir, 'images'), { recursive: true });
  const articlePath = join(rawDir, 'article.md');
  await writeFile(articlePath, markdown);
  await writeFile(join(rawDir, 'images/chart.png'), 'chart-image');
  const executorResultPath = join(rawDir, 'executor-result.json');
  await writeFile(executorResultPath, `${JSON.stringify({
    schemaVersion: '1.0', executor: 'bycli', requestedUrl, resolvedUrl,
    status: 'saved', exitCode: 0, errorCode: null, timedOut: false, truncated: false,
    saved: 'raw/bycli/web/example-report/article.md', size: Buffer.byteLength(markdown),
    sha256: crypto.createHash('sha256').update(markdown).digest('hex'),
    title: 'Example 深度报道', startedAt: '2026-09-01T00:00:00.000Z',
    finishedAt: '2026-09-01T00:00:01.000Z', durationMs: 1000,
  }, null, 2)}\n`);
  recordPendingCollectionItem(paths, {
    itemId: 'example-report', source: 'public-internet', sourceSkill: 'bycli', backend: 'web',
    sourceUrl: requestedUrl, title: 'Example 深度报道',
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

test('manual materialization persists a same-site redirect through collect and repeated status', async () => {
  const requestedUrl = 'https://m.example.com/article/123';
  const resolvedUrl = 'https://www.example.com/article/123?source=m_redirect&token=super-secret';
  const f = await fixture(completeArticle(), { requestedUrl, resolvedUrl });
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });
    assert.equal(result.materialization.status, 'materialized');
    const afterMaterialize = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(afterMaterialize.task.acquisitionEvidence.length, 1);
    assert.equal(afterMaterialize.task.acquisitionEvidence[0].resolvedUrl, resolvedUrl);
    assert.equal(afterMaterialize.task.discoveryGate.candidates[0].canonicalUrl, requestedUrl);
    assert.deepEqual(afterMaterialize.task.discoveryGate.candidates[0].acquisitionUrls, [requestedUrl]);

    const payload = JSON.parse(await readFile(result.collectPayloadPath, 'utf8'));
    const sanitized = await readFile(join(f.root, 'sanitized/items/example-report/index.md'), 'utf8');
    assert.equal(payload.canonicalItem.url, requestedUrl);
    assert.equal(sanitized.includes('super-secret'), false);
    assert.match(sanitized, /source_url: "https:\/\/m\.example\.com\/article\/123"/);

    assert.equal(cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }).ok, true);
    assert.equal(collectionStatus(f.paths).deliveryComplete, true);
    assert.equal(collectionStatus(sessionPaths(f.root)).deliveryComplete, true);
    const status = executeLocalCommand('status', { 'session-dir': f.root, full: true });
    assert.equal(JSON.stringify(status).includes('super-secret'), false);
    assert.equal(Object.hasOwn(status.task, 'acquisitionEvidence'), false);
    assert.equal(executeLocalCommand('export-views', { 'session-dir': f.root }).ok, true);
    const metadata = await readFile(join(f.root, 'sanitized/metadata.json'), 'utf8');
    const collectionResult = await readFile(join(f.root, 'collection-result.json'), 'utf8');
    assert.equal(metadata.includes('super-secret'), false);
    assert.equal(collectionResult.includes('super-secret'), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('missing redirect authorization evidence invalidates a completed delivery', async () => {
  const requestedUrl = 'https://m.example.com/article/123';
  const resolvedUrl = 'https://www.example.com/article/123?source=m_redirect';
  const f = await fixture(completeArticle(), { requestedUrl, resolvedUrl });
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });
    assert.equal(cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }).ok, true);
    assert.equal(collectionStatus(f.paths).deliveryComplete, true);

    await unlink(f.executorResultPath);
    const status = collectionStatus(sessionPaths(f.root));
    assert.equal(status.deliveryComplete, false);
    assert.match(status.warnings.join('\n'), /acquisition evidence|采集授权证据|原始证据/i);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('changed redirect authorization evidence invalidates a completed delivery', async () => {
  const requestedUrl = 'https://m.example.com/article/123';
  const resolvedUrl = 'https://www.example.com/article/123?source=m_redirect';
  const f = await fixture(completeArticle(), { requestedUrl, resolvedUrl });
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });
    assert.equal(cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }).ok, true);
    const evidence = JSON.parse(await readFile(f.executorResultPath, 'utf8'));
    evidence.title = 'tampered after registration';
    await writeFile(f.executorResultPath, `${JSON.stringify(evidence, null, 2)}\n`);

    const status = collectionStatus(sessionPaths(f.root));
    assert.equal(status.deliveryComplete, false);
    assert.match(status.warnings.join('\n'), /采集授权证据失效/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('discovered weak candidate keeps runtime redirect authorization through repeated status', async () => {
  const requestedUrl = 'https://m.example.com/article/123';
  const resolvedUrl = 'https://www.example.com/article/123?source=m_redirect';
  const f = await fixture(completeArticle(), {
    discoveryPageType: 'weak', requestedUrl, resolvedUrl,
  });
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });
    assert.equal(result.materialization.status, 'materialized');
    assert.equal(cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }).ok, true);
    const firstStatus = collectionStatus(f.paths);
    const repeatedStatus = collectionStatus(sessionPaths(f.root));
    assert.equal(firstStatus.deliveryComplete, true, JSON.stringify(firstStatus, null, 2));
    assert.equal(repeatedStatus.deliveryComplete, true, JSON.stringify(repeatedStatus, null, 2));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('materializes a discovery candidate while keeping body verification separate from discovery evidence', async () => {
  const f = await fixture(completeArticle(), { discoveryPageType: 'weak' });
  try {
    const result = await runWebMaterialize(f.paths, {
      'item-id': 'example-report', 'executor-result-file': f.executorResultPath,
    });

    assert.equal(result.materialization.status, 'materialized');
    assert.ok(result.collectPayloadPath);
    assert.equal(cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }).ok, true);
    const status = collectionStatus(f.paths);
    assert.equal(status.deliveryComplete, true, JSON.stringify(status, null, 2));
    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.equal(session.task.discoveryGate.candidates[0].discoveryDisposition, 'probe');
    assert.equal(session.task.discoveryGate.candidates[0].verificationRequired, true);
    assert.equal(Object.hasOwn(session.task.discoveryGate.candidates[0], 'verifiedBody'), false);
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
