import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { cmdCollect, collectionStatus } from './collection-state.mjs';
import { cmdInit } from './research-state.mjs';
import { sessionPaths } from './session.mjs';
import { runWechatMaterialize, sanitizeWechatMarkdown } from './wechat-materializer.mjs';

const fixtures = join(dirname(new URL(import.meta.url).pathname), 'fixtures');

async function initializedSession() {
  const root = await mkdtemp(join(tmpdir(), 'wechat-materializer-'));
  cmdInit({
    'session-dir': root,
    query: '采集一篇文章',
    'source-scope': '["public-internet"]',
    'materialization-target': 'selected',
    'direct-urls': JSON.stringify([
      'https://weixin.sogou.com/link?url=fixture',
      'https://weixin.sogou.com/link?url=escape',
      'https://mp.weixin.qq.com/s/mihoyo',
      'https://mp.weixin.qq.com/s/ambiguous',
      'https://mp.weixin.qq.com/s/escape',
    ]),
  });
  return { root, paths: sessionPaths(root) };
}

async function writeExecutorFixture(root, itemId, fixtureName, overrides = {}) {
  const rawDir = join(root, 'raw/bycli/weixin', itemId);
  await mkdir(rawDir, { recursive: true });
  const saved = join(rawDir, 'index.md');
  await copyFile(join(fixtures, fixtureName), saved);
  const savedSize = (await stat(saved)).size;
  const result = {
    status: 'downloaded',
    saved: `raw/bycli/weixin/${itemId}/index.md`,
    size: savedSize,
    title: '米哈游的新探索',
    author: '星财经',
    publish_time: '2026-08-12T00:00:00Z',
    source_url: 'https://weixin.sogou.com/link?url=fixture',
    resolved_url: `https://mp.weixin.qq.com/s/${itemId}`,
    ...overrides,
  };
  const resultPath = join(rawDir, 'download-result.json');
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  return resultPath;
}

test('sanitizer preserves article content and removes only known WeChat noise', async () => {
  const raw = await readFile(join(fixtures, 'wechat-complete.md'), 'utf8');
  const result = sanitizeWechatMarkdown(raw, {
    title: '米哈游的新探索',
    author: '星财经',
    resolved_url: 'https://mp.weixin.qq.com/s/mihoyo',
  });

  for (const retained of [
    '# 米哈游的新探索',
    '星财经',
    '第一段正文介绍公司背景。',
    '第六段正文给出结论。',
    '注：图片来自网络；个人观点，仅供参考。',
  ]) {
    assert.match(result.markdown, new RegExp(retained.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const removed of ['相关阅读', '另一篇文章', '赞赏', '调整字体大小', 'Scan to Follow', 'mmbiz.qpic.cn']) {
    assert.doesNotMatch(result.markdown, new RegExp(removed));
  }
  assert.equal(result.confidence, 'high');
  assert.deepEqual(result.removedBlocks.sort(), ['related-reading', 'remote-image', 'wechat-ui']);
});

test('materializer writes deterministic artifacts and a full-text collect payload', async () => {
  const { root, paths } = await initializedSession();
  try {
    const resultPath = await writeExecutorFixture(root, 'mihoyo', 'wechat-complete.md');
    const args = { 'executor-result-file': resultPath, 'item-id': 'mihoyo' };
    const first = await runWechatMaterialize(paths, args);
    const firstMarkdown = await readFile(join(root, 'sanitized/items/mihoyo/index.md'), 'utf8');
    const second = await runWechatMaterialize(paths, args);
    const secondMarkdown = await readFile(join(root, 'sanitized/items/mihoyo/index.md'), 'utf8');

    assert.equal(first.materialization.status, 'materialized');
    assert.equal(first.materialization.contentGranularity, 'full-text');
    assert.equal(firstMarkdown, secondMarkdown);
    assert.match(firstMarkdown, /^---\ntitle: "米哈游的新探索"/);
    assert.doesNotMatch(firstMarkdown, /Scan to Follow|相关阅读|mmbiz\.qpic\.cn/);
    assert.equal(first.collectPayloadPath, second.collectPayloadPath);
    for (const value of Object.values(first.timing)) assert.ok(Number.isInteger(value) && value >= 0);

    const diagnostics = JSON.parse(await readFile(join(root, 'raw/materialization/mihoyo.json'), 'utf8'));
    assert.equal(diagnostics.action, 'materialize-wechat');
    assert.match(diagnostics.transactionId, /^[0-9a-f-]{36}$/);
    assert.equal(diagnostics.requestedUrl, 'https://weixin.sogou.com/link?url=fixture');
    assert.equal(diagnostics.resolvedUrl, 'https://mp.weixin.qq.com/s/mihoyo');
    assert.ok(diagnostics.inputFiles.every((file) => /^sha256:[a-f0-9]{64}$/.test(file.sha256)));
    assert.ok(diagnostics.outputFiles.every((file) => /^sha256:[a-f0-9]{64}$/.test(file.sha256)));
    assert.equal(diagnostics.confidence, 'high');
    assert.ok(diagnostics.outputParagraphs >= 7);

    const payload = JSON.parse(await readFile(first.collectPayloadPath, 'utf8'));
    assert.equal(payload.canonicalItem.url, 'https://weixin.sogou.com/link?url=fixture');
    assert.equal(payload.contentGranularity, 'full-text');
    assert.deepEqual(payload.fullTextEvidence, {
      schemaVersion: '1.0',
      executor: 'bycli',
      artifact: 'raw/materialization/mihoyo.json',
    });
    assert.equal(payload.markdownPath, 'markdown/items/mihoyo/index.md');
    assert.equal(payload.sanitizedPath, 'sanitized/items/mihoyo/index.md');
    assert.deepEqual(payload.rawArtifacts, [
      'raw/bycli/weixin/mihoyo/download-result.json',
      'raw/bycli/weixin/mihoyo/index.md',
      'raw/materialization/mihoyo.json',
    ]);

    const collected = cmdCollect(paths, { 'item-json-file': first.collectPayloadPath });
    assert.equal(collected.ok, true);
    const status = collectionStatus(paths);
    assert.equal(status.deliveryComplete, true);
    assert.equal(status.contentGranularity['full-text'], 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('low-confidence input remains pending with raw evidence', async () => {
  const { root, paths } = await initializedSession();
  try {
    const resultPath = await writeExecutorFixture(root, 'ambiguous', 'wechat-ambiguous.md', {
      title: '微信公众平台',
      resolved_url: 'https://mp.weixin.qq.com/s/ambiguous',
    });
    const result = await runWechatMaterialize(paths, {
      'executor-result-file': resultPath,
      'item-id': 'ambiguous',
    });

    assert.equal(result.materialization.status, 'pending');
    assert.equal(result.materialization.contentGranularity, 'unknown');
    assert.equal(result.collectPayloadPath, null);
    assert.equal(collectionStatus(paths).pending, 1);
    const session = JSON.parse(await readFile(join(root, 'session.json'), 'utf8'));
    assert.equal(session.collection.collection.items[0].materialization.reason,
      'wechat-materialization-low-confidence');
    assert.deepEqual(session.collection.collection.items[0].rawArtifacts, [
      'raw/bycli/weixin/ambiguous/download-result.json',
      'raw/bycli/weixin/ambiguous/index.md',
      'raw/materialization/ambiguous.json',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('materializer rejects saved Markdown that escapes raw through a symlink', async () => {
  const { root, paths } = await initializedSession();
  const outside = await mkdtemp(join(tmpdir(), 'wechat-materializer-outside-'));
  try {
    const rawDir = join(root, 'raw/bycli/weixin/escape');
    await mkdir(rawDir, { recursive: true });
    const outsideMarkdown = join(outside, 'index.md');
    await writeFile(outsideMarkdown, '# 外部文章\n\n正文。\n');
    await symlink(outsideMarkdown, join(rawDir, 'index.md'));
    const resultPath = join(rawDir, 'download-result.json');
    await writeFile(resultPath, `${JSON.stringify({
      status: 'downloaded',
      saved: 'raw/bycli/weixin/escape/index.md',
      size: (await stat(outsideMarkdown)).size,
      title: '外部文章',
      author: '',
      publish_time: '',
      source_url: 'https://weixin.sogou.com/link?url=escape',
      resolved_url: 'https://mp.weixin.qq.com/s/escape',
    })}\n`);

    await assert.rejects(
      runWechatMaterialize(paths, { 'executor-result-file': resultPath, 'item-id': 'escape' }),
      /raw|符号链接|越出/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
