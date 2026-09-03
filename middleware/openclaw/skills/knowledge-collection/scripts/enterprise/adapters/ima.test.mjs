import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createImaAdapter, imaContentGranularity } from './ima.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ima-adapter-'));
  const bin = join(root, 'ima-fixture.mjs');
  await writeFile(bin, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const out = (value) => process.stdout.write(JSON.stringify(value));
if (process.env.IMA_CALLS_PATH) appendFileSync(process.env.IMA_CALLS_PATH, JSON.stringify(args) + '\\n');
if (args[0] === 'weixin' && args[1] === 'download' && process.env.WEIXIN_FAILURE_MODE === 'true') { process.stderr.write('weixin download failed'); process.exit(2); }
else if (args[0] === 'weixin' && args[1] === 'download') {
  const output = args[args.indexOf('--output') + 1];
  if (process.env.WEIXIN_ESCAPED_PATH === 'true') {
    const escaped = join(output, '..', 'escaped.md');
    mkdirSync(output, { recursive: true });
    writeFileSync(escaped, 'escaped article');
    out([{ title: 'ByCLI roadmap', status: 'success', size: '15 B', saved: escaped }]);
    process.exit(0);
  }
  const articleDir = join(output, 'ByCLI roadmap');
  mkdirSync(join(articleDir, 'images'), { recursive: true });
  const saved = join(articleDir, 'ByCLI roadmap.md');
  writeFileSync(saved, '# ByCLI roadmap\\n\\nComplete WeChat body.\\n\\n![diagram](images/diagram.png)\\n\\n![missing](images/missing.png)\\n\\n![remote](https://mmbiz.qpic.cn/failed.png)\\n\\n<video src="https://mmbiz.qpic.cn/clip.mp4" controls></video>\\n');
  writeFileSync(join(articleDir, 'images', 'diagram.png'), 'inline-image');
  out([{ title: 'ByCLI roadmap', status: 'success', size: '72 B', saved, source_url: args[args.indexOf('--url') + 1] }]);
}
else if (args[0] === 'ima' && args[1] === 'knowledge' && process.env.BYCLI_DUPLICATE_URLS === 'true') out([
  { mediaId: 'wiki-bycli-1', title: 'ByCLI roadmap', url: 'https://ima.qq.com/wiki-bycli-1', folderPath: '/Roadmap', abstract: 'bycli preview' },
  { mediaId: 'wiki-bycli-2', title: 'ByCLI roadmap copy', url: 'https://ima.qq.com/wiki-bycli-1', folderPath: '/Archive', abstract: 'duplicate preview' },
]);
else if (args[0] === 'ima' && args[1] === 'knowledge' && process.env.BYCLI_SUCCESS === 'true') out([{
  mediaId: 'wiki-bycli-1', title: process.env.BYCLI_TITLE || 'ByCLI roadmap', url: process.env.BYCLI_WECHAT_URL === 'true' ? 'https://mp.weixin.qq.com/s/article-token' : 'https://ima.qq.com/wiki-bycli-1', folderPath: '/Roadmap', abstract: 'bycli preview for knowledge-base collection and roadmap',
  ...(process.env.BYCLI_WITH_INTRODUCTION === 'true' ? { introduction: 'bycli opening paragraph' } : {}),
  ...(process.env.BYCLI_WITH_TWO_COVERS === 'true'
    ? { coverUrls: ['https://img.ima.qq.com/cover-1.png', 'https://img.ima.qq.com/cover-2.png'] }
    : process.env.BYCLI_WITH_COVER === 'true'
      ? { coverUrls: ['https://img.ima.qq.com/cover.png'] }
      : {}),
}]);
else if (args[0] === 'ima' && args[1] === 'knowledge-list' && process.env.BYCLI_ENUMERATION_MODE === 'true') out([
  { id: 'kb-a', name: 'Alpha' },
  { id: 'kb-b', name: 'Beta' },
]);
else if (args[0] === 'ima' && args[1] === 'knowledge' && process.env.BYCLI_ENUMERATION_MODE === 'true') {
  if (args[2] === 'kb-b' && process.env.BYCLI_PARTIAL_FAILURE === 'true') {
    process.stderr.write('knowledge base requires login');
    process.exit(2);
  }
  if (args[2] === 'kb-a') out([
    { mediaId: 'alpha-title', title: 'Roadmap title', url: 'https://ima.qq.com/alpha-title', abstract: 'summary' },
    { mediaId: 'alpha-folder', title: 'Folder match', url: 'https://ima.qq.com/alpha-folder', folderPath: '/roadmap/archive' },
    { mediaId: 'alpha-duplicate', title: 'Duplicate', url: 'https://ima.qq.com/alpha-title', tags: ['roadmap'] },
  ]);
  else out([
    { mediaId: 'beta-introduction', title: 'Introduction match', url: 'https://ima.qq.com/beta-introduction', introduction: 'Roadmap opening' },
    { mediaId: 'beta-tags', title: 'Tag match', url: 'https://ima.qq.com/beta-tags', tags: ['planning', 'roadmap'] },
    { mediaId: 'beta-unrelated', title: 'Unrelated', url: 'https://ima.qq.com/beta-unrelated', abstract: 'nothing useful' },
  ]);
}
else if (args[0] === 'ima' && args[1] === 'knowledge-list' && process.env.BYCLI_ALL_FAILURE_MODE === 'true') out([
  { id: 'kb-a', name: 'Alpha' },
  { id: 'kb-b', name: 'Beta' },
]);
else if (args[0] === 'ima' && args[1] === 'knowledge' && process.env.BYCLI_ALL_FAILURE_MODE === 'true') {
  process.stderr.write('knowledge fetch failed');
  process.exit(2);
}
else if (args[0] === 'ima' && args[1] === 'knowledge') { process.stderr.write('bycli knowledge failed'); process.exit(2); }
else { process.stderr.write('unexpected fixture command: ' + args.join(' ')); process.exit(2); }
`, { mode: 0o700 });
  await chmod(bin, 0o700);
  return { root, bin };
}

test('IMA unscoped search enumerates knowledge bases, filters locally, and never uses the standalone CLI', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_ENUMERATION_MODE: 'true', IMA_CALLS_PATH: callsPath },
    }).search({ outputDir, query: 'roadmap', limit: 4, metadataOnly: true });
    assert.equal(result.connector, 'ima');
    assert.equal(result.status, 'complete');
    assert.equal(result.counts.discovered, 4);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.deepEqual(metadata.collection.items.map((item) => item.sourceItemId), [
      'alpha-title',
      'alpha-folder',
      'beta-introduction',
      'beta-tags',
    ]);
    assert.equal(metadata.collection.items.every((item) => item.materialization.status === 'pending'), true);
    assert.equal(metadata.collection.items.every((item) => item.sourceSkill === 'bycli'), true);
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(calls.map((args) => args.slice(0, 3)), [
      ['ima', 'knowledge-list', '-f'],
      ['ima', 'knowledge', 'kb-a'],
      ['ima', 'knowledge', 'kb-b'],
    ]);
    assert.equal(calls.some((args) => ['auth', 'note', 'wiki'].includes(args[0])), false);
    assert.deepEqual(JSON.parse(await readFile(join(outputDir, 'raw/bycli-knowledge-list.json'), 'utf8')), [
      { id: 'kb-a', name: 'Alpha' },
      { id: 'kb-b', name: 'Beta' },
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA unscoped search reports partial while preserving successful knowledge bases', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_ENUMERATION_MODE: 'true',
        BYCLI_PARTIAL_FAILURE: 'true',
        IMA_CALLS_PATH: callsPath,
      },
    }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true });

    assert.equal(result.status, 'partial');
    assert.equal(result.counts.discovered, 2);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.sourceMetadata.discovery.failures.length, 1);
    assert.equal(metadata.sourceMetadata.discovery.failures[0].knowledgeBase, 'Beta');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => ['auth', 'note', 'wiki'].includes(args[0])), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA materializes trusted WeChat article URLs through bycli with localized inline images', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_SUCCESS: 'true',
        BYCLI_WECHAT_URL: 'true',
        IMA_CALLS_PATH: callsPath,
      },
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    const weixinCall = calls.find((args) => args[0] === 'weixin' && args[1] === 'download');
    assert.ok(weixinCall);
    assert.equal(weixinCall[weixinCall.indexOf('--url') + 1], 'https://mp.weixin.qq.com/s/article-token');
    assert.equal(weixinCall[weixinCall.indexOf('--download-images') + 1], 'true');
    assert.equal(weixinCall[weixinCall.indexOf('--site-session') + 1], 'persistent');
    assert.equal(weixinCall[weixinCall.indexOf('--keep-tab') + 1], 'true');
    assert.equal(calls.some((args) => args[0] === 'wiki' && args[1] === 'search'), false);

    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = metadata.collection.items[0];
    assert.equal(item.materialization.contentGranularity, 'full-text');
    assert.equal(item.completeEvidence, true);
    assert.equal(item.rawArtifacts.some((artifact) => /raw\/weixin-download-.*\.json$/.test(artifact)), true);
    assert.equal(item.rawArtifacts.some((artifact) => /raw\/weixin-.*\/ByCLI roadmap\/ByCLI roadmap\.md$/.test(artifact)), true);
    const markdown = await readFile(join(outputDir, item.materialization.sanitizedPath), 'utf8');
    assert.match(markdown, /Complete WeChat body/);
    assert.match(markdown, /!\[diagram\]\(assets\/article-images\/diagram\.png\)/);
    assert.doesNotMatch(markdown, /images\/missing\.png|https:\/\/mmbiz\.qpic\.cn|<\/video>/);
    assert.match(markdown, /missing/);
    assert.match(markdown, /remote/);
    assert.equal(
      (await readFile(join(outputDir, item.materialization.sanitizedPath.replace('index.md', 'assets/article-images/diagram.png')))).toString(),
      'inline-image',
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA rejects a bycli saved path outside its session staging directory', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_SUCCESS: 'true',
        BYCLI_WECHAT_URL: 'true',
        BYCLI_WITH_INTRODUCTION: 'true',
        WEIXIN_ESCAPED_PATH: 'true',
      },
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = metadata.collection.items[0];
    assert.equal(item.materialization.contentGranularity, 'excerpt');
    assert.equal(item.completeEvidence, false);
    assert.doesNotMatch(await readFile(join(outputDir, item.materialization.sanitizedPath), 'utf8'), /escaped article/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA does not switch trusted WeChat URLs to Wiki search when bycli download fails', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_SUCCESS: 'true',
        BYCLI_WECHAT_URL: 'true',
        BYCLI_WITH_INTRODUCTION: 'true',
        WEIXIN_FAILURE_MODE: 'true',
        IMA_CALLS_PATH: callsPath,
      },
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args[0] === 'weixin' && args[1] === 'download'), true);
    assert.equal(calls.some((args) => args[0] === 'wiki' && args[1] === 'search'), false);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = metadata.collection.items[0];
    assert.equal(item.materialization.status, 'materialized');
    assert.equal(item.materialization.contentGranularity, 'excerpt');
    assert.equal(item.completeEvidence, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base listing uses bycli results without a standalone fallback', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true', IMA_CALLS_PATH: callsPath },
    }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true, kb: 'kb-1' });
    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.items.find((item) => item.sourceType === 'wiki').sourceItemId, 'wiki-bycli-1');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args[0] === 'ima' && args[1] === 'knowledge'), true);
    assert.equal(calls.some((args) => args[0] === 'wiki' && args[1] === 'search'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base listing deduplicates repeated source URLs without discarding the raw response', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_DUPLICATE_URLS: 'true' },
    }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true, kb: 'kb-1' });

    assert.equal(result.status, 'complete');
    assert.equal(result.counts.discovered, 1);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.items.length, 1);
    const raw = JSON.parse(await readFile(join(outputDir, 'raw/bycli-knowledge.json'), 'utf8'));
    assert.equal(raw.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base collection uses only bycli knowledge data for materialization', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true', IMA_CALLS_PATH: callsPath },
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(calls.map((args) => args.slice(0, 3)), [['ima', 'knowledge', 'kb-name']]);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.match(await readFile(join(outputDir, metadata.collection.items[0].materialization.sanitizedPath), 'utf8'), /bycli preview/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA item directories use the first five visible title characters for both work copies', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_SUCCESS: 'true',
        BYCLI_TITLE: '👩‍💻甲乙丙丁戊',
      },
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = metadata.collection.items[0];
    assert.match(item.materialization.markdownPath, /^markdown\/items\/👩‍💻甲乙丙丁-ima-[a-f0-9]{16}\/index\.md$/u);
    assert.match(item.materialization.sanitizedPath, /^sanitized\/items\/👩‍💻甲乙丙丁-ima-[a-f0-9]{16}\/index\.md$/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA knowledge-base collection materializes its cover beside the body', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_SUCCESS: 'true',
        BYCLI_WITH_COVER: 'true',
        BYCLI_WITH_INTRODUCTION: 'true',
      },
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://img.ima.qq.com/cover.png');
        assert.equal(options.redirect, 'manual');
        return {
          status: 200,
          ok: true,
          headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
          arrayBuffer: async () => Buffer.from('cover-image'),
        };
      },
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = metadata.collection.items[0];
    assert.match(item.materialization.markdownPath, /^markdown\/items\/ByCLI-ima-[a-f0-9]{16}\/index\.md$/);
    assert.match(item.materialization.sanitizedPath, /^sanitized\/items\/ByCLI-ima-[a-f0-9]{16}\/index\.md$/);
    assert.equal(item.materialization.contentGranularity, 'excerpt');
    assert.deepEqual(item.media, {
      coverStatus: 'materialized', coverCount: 1, materializedCoverCount: 1, reason: null,
    });
    assert.match(
      await readFile(join(outputDir, item.materialization.sanitizedPath), 'utf8'),
      /!\[封面 1\]\(assets\/cover-1\.png\)/,
    );
    assert.equal(
      (await readFile(join(outputDir, item.materialization.sanitizedPath.replace(
        'index.md', 'assets/cover-1.png',
      )))).toString(),
      'cover-image',
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA materialization retains cover URLs from a metadata-only knowledge-base session', async () => {
  const { root, bin } = await fixture();
  try {
    const discoveryDir = join(root, 'discovery');
    await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true', BYCLI_WITH_COVER: 'true' },
    }).search({ outputDir: discoveryDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: true });
    const discoveryMetadata = JSON.parse(await readFile(join(discoveryDir, 'sanitized/metadata.json'), 'utf8'));
    const outputDir = join(root, 'materialized');
    const result = await createImaAdapter({
      bin,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => Buffer.from('cover-image'),
      }),
    }).materialize({ sessionDir: discoveryDir, outputDir, itemIds: [discoveryMetadata.collection.items[0].itemId] });

    const materializedMetadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(result.status, 'complete', materializedMetadata.collection.items[0].materialization.reason);
    assert.equal(materializedMetadata.collection.items[0].media.coverStatus, 'materialized');
    assert.equal(materializedMetadata.collection.items[0].materialization.contentGranularity, 'abstract');
    const collectionResult = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(collectionResult.filters, { kb: 'kb-name' });
    assert.equal(materializedMetadata.sourceMetadata.kb, 'kb-name');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA materializes discovered excerpts and covers without a standalone Wiki retrieval', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_SUCCESS: 'true',
        BYCLI_WITH_COVER: 'true',
        BYCLI_WITH_INTRODUCTION: 'true',
      },
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => Buffer.from('cover-image'),
      }),
    }).search({ outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false });

    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = metadata.collection.items[0];
    assert.equal(item.materialization.status, 'materialized');
    assert.equal(item.materialization.contentGranularity, 'excerpt');
    assert.match(item.materialization.sanitizedPath, /^sanitized\/items\/ByCLI-ima-[a-f0-9]{16}\/index\.md$/);
    assert.equal(item.media.coverStatus, 'materialized');
    assert.match(await readFile(join(outputDir, item.materialization.sanitizedPath), 'utf8'), /bycli opening paragraph/);
    assert.equal(
      (await readFile(join(outputDir, item.materialization.sanitizedPath.replace('index.md', 'assets/cover-1.png')))).toString(),
      'cover-image',
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA resume materializes discovered excerpts without invoking an IMA credential check', async () => {
  const { root, bin } = await fixture();
  try {
    const discoveryDir = join(root, 'discovery');
    await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true', BYCLI_WITH_COVER: 'true', BYCLI_WITH_INTRODUCTION: 'true' },
    }).search({ outputDir: discoveryDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: true });
    const metadata = JSON.parse(await readFile(join(discoveryDir, 'sanitized/metadata.json'), 'utf8'));
    const outputDir = join(root, 'materialized');
    const result = await createImaAdapter({
      bin,
      env: process.env,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => Buffer.from('cover-image'),
      }),
    }).materialize({ sessionDir: discoveryDir, outputDir, itemIds: [metadata.collection.items[0].itemId] });

    assert.equal(result.status, 'complete');
    const materialized = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = materialized.collection.items[0];
    assert.equal(item.materialization.contentGranularity, 'excerpt');
    assert.match(item.materialization.sanitizedPath, /^sanitized\/items\/ByCLI-ima-[a-f0-9]{16}\/index\.md$/);
    assert.equal(item.media.coverStatus, 'materialized');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA resume delegates a trusted WeChat URL without invoking an IMA credential check', async () => {
  const { root, bin } = await fixture();
  try {
    const discoveryDir = join(root, 'discovery');
    await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true', BYCLI_WECHAT_URL: 'true' },
    }).search({ outputDir: discoveryDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: true });
    const metadataPath = join(discoveryDir, 'sanitized/metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const candidate = metadata.collection.items[0];
    candidate.preview = '';
    candidate.abstract = '';
    candidate.introduction = '';
    await writeFile(metadataPath, JSON.stringify(metadata));

    const outputDir = join(root, 'materialized');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: process.env,
    }).materialize({ sessionDir: discoveryDir, outputDir, itemIds: [candidate.itemId] });

    assert.equal(result.status, 'complete');
    const materialized = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(materialized.collection.items[0].materialization.contentGranularity, 'full-text');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA cover failure preserves the article and reports the media gap separately', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const fetched = [];
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: {
        ...process.env,
        BYCLI_SUCCESS: 'true',
        BYCLI_WITH_TWO_COVERS: 'true',
      },
      fetchImpl: async (url) => {
        fetched.push(url);
        if (url.endsWith('cover-2.png')) throw new Error('network unavailable');
        return {
          status: 200,
          ok: true,
          headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
          arrayBuffer: async () => Buffer.from('cover-image'),
        };
      },
    }).search({
      outputDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: false,
    });

    assert.equal(result.status, 'complete');
    assert.deepEqual(fetched, [
      'https://img.ima.qq.com/cover-1.png',
      'https://img.ima.qq.com/cover-2.png',
    ]);
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    const item = metadata.collection.items[0];
    assert.equal(item.materialization.status, 'materialized');
    assert.deepEqual(item.media, {
      coverStatus: 'unavailable', coverCount: 2, materializedCoverCount: 1,
      reason: 'cover-download-failed',
    });
    assert.match(await readFile(join(outputDir, item.materialization.sanitizedPath), 'utf8'),
      /!\[封面 1\]\(assets\/cover-1\.png\)/);
    assert.equal(
      (await readFile(join(outputDir, item.materialization.sanitizedPath.replace(
        'index.md', 'assets/cover-1.png',
      )))).toString(),
      'cover-image',
    );
    const collectionResult = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.equal(collectionResult.items.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA specified knowledge-base failure does not fall back to a standalone CLI', async () => {
  const { root, bin } = await fixture();
  try {
    const callsPath = join(root, 'calls.json');
    const outputDir = join(root, 'search');
    await assert.rejects(
      createImaAdapter({
        bin,
        bycliBin: bin,
        env: { ...process.env, IMA_CALLS_PATH: callsPath },
      }).search({ outputDir, query: 'roadmap', limit: 10, metadataOnly: true, kb: 'kb-1' }),
      /bycli ima knowledge failed/,
    );
    const calls = (await readFile(callsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(calls.some((args) => args[0] === 'ima' && args[1] === 'knowledge'), true);
    assert.equal(calls.some((args) => ['auth', 'note', 'wiki'].includes(args[0])), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA unscoped search fails when every enumerated knowledge base fails', async () => {
  const { root, bin } = await fixture();
  try {
    await assert.rejects(
      createImaAdapter({
        bin,
        bycliBin: bin,
        env: { ...process.env, BYCLI_ALL_FAILURE_MODE: 'true' },
      }).search({ outputDir: join(root, 'search'), query: 'roadmap', limit: 10, metadataOnly: true }),
      /IMA knowledge enumeration failed/,
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA entry materializes its returned abstract without a standalone content lookup', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'search');
    const result = await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true' },
    }).search({ outputDir, query: 'roadmap', kb: 'kb-name', limit: 1, metadataOnly: false });
    assert.equal(result.status, 'complete');
    const metadata = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.equal(metadata.collection.items[0].materialization.contentGranularity, 'abstract');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA content granularity requires explicit completeness evidence', () => {
  assert.equal(imaContentGranularity({ completeEvidence: true }), 'full-text');
  assert.equal(imaContentGranularity({ introduction: 'opening', abstract: 'summary' }), 'excerpt');
  assert.equal(imaContentGranularity({ abstract: 'summary' }), 'abstract');
  assert.equal(imaContentGranularity({ genericContent: 'content field is not proof' }), 'unknown');
});

test('IMA controlled cover downloader accepts HTTP and enforces redirects, type, size, and timeout', async () => {
  const { downloadImaCover } = await import('./ima.mjs');
  assert.equal(typeof downloadImaCover, 'function');

  let httpRequestedUrl = '';
  const httpDownloaded = await downloadImaCover('http://img.test/cover.png', {
    fetchImpl: async (url) => {
      httpRequestedUrl = url;
      return {
        status: 200,
        ok: true,
        headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'image/png' : null },
        arrayBuffer: async () => Buffer.from('http-cover'),
      };
    },
  });
  assert.equal(httpRequestedUrl, 'http://img.test/cover.png');
  assert.deepEqual(httpDownloaded, { bytes: Buffer.from('http-cover'), extension: 'png' });
  await assert.rejects(
    downloadImaCover('ftp://img.test/cover.png', { fetchImpl: async () => null }),
    /HTTP or HTTPS/,
  );

  const redirectFetch = async () => ({
    status: 302,
    ok: false,
    headers: { get: (name) => name.toLowerCase() === 'location' ? '/next.png' : null },
  });
  await assert.rejects(
    downloadImaCover('https://img.test/start.png', { fetchImpl: redirectFetch, maxRedirects: 1 }),
    /redirect/i,
  );

  const response = (contentType, chunks, contentLength = null) => ({
    status: 200,
    ok: true,
    headers: {
      get: (name) => {
        if (name.toLowerCase() === 'content-type') return contentType;
        if (name.toLowerCase() === 'content-length') return contentLength;
        return null;
      },
    },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
        controller.close();
      },
    }),
  });
  await assert.rejects(
    downloadImaCover('https://img.test/not-image', {
      fetchImpl: async () => response('text/html', [[1, 2, 3]]),
    }),
    /content type/i,
  );
  await assert.rejects(
    downloadImaCover('https://img.test/too-large.png', {
      fetchImpl: async () => response('image/png', [[1, 2, 3], [4, 5, 6]]),
      maxBytes: 4,
    }),
    /size limit/i,
  );
  await assert.rejects(
    downloadImaCover('https://img.test/timeout.png', {
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      timeoutMs: 5,
    }),
    /timed out/i,
  );

  const downloaded = await downloadImaCover('https://img.test/cover.png', {
    fetchImpl: async () => response('image/png; charset=binary', [[1, 2], [3, 4]], '4'),
  });
  assert.deepEqual(downloaded, { bytes: Buffer.from([1, 2, 3, 4]), extension: 'png' });
});

test('IMA materialization preserves per-item knowledge bases for mixed candidates', async () => {
  const { root, bin } = await fixture();
  try {
    const discoveryDir = join(root, 'discovery');
    await createImaAdapter({
      bin,
      bycliBin: bin,
      env: { ...process.env, BYCLI_SUCCESS: 'true' },
    }).search({ outputDir: discoveryDir, query: 'knowledge-base collection', kb: 'kb-name', limit: 10, metadataOnly: true });
    const metadataPath = join(discoveryDir, 'sanitized/metadata.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const second = structuredClone(metadata.collection.items[0]);
    second.itemId = 'ima-mixed-kb-item';
    second.sourceItemId = 'wiki-bycli-2';
    second.sourceUrl = 'https://ima.qq.com/wiki-bycli-2';
    second.kb = 'another-kb';
    metadata.collection.items.push(second);
    await writeFile(metadataPath, JSON.stringify(metadata));

    const outputDir = join(root, 'materialized');
    const result = await createImaAdapter({ bycliBin: bin }).materialize({
      sessionDir: discoveryDir,
      outputDir,
      itemIds: metadata.collection.items.map((item) => item.itemId),
    });
    assert.equal(result.status, 'complete');
    const materialized = JSON.parse(await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'));
    assert.deepEqual(materialized.collection.items.map((item) => item.kb), ['kb-name', 'another-kb']);
    const collectionResult = JSON.parse(await readFile(join(outputDir, 'collection-result.json'), 'utf8'));
    assert.deepEqual(collectionResult.filters, {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('IMA resource collection reports unsupported without writing artifacts', async () => {
  const { root, bin } = await fixture();
  try {
    const outputDir = join(root, 'resource');
    const result = await createImaAdapter({ bin }).collectResource({ outputDir, url: 'https://example.com/article' });
    assert.equal(result.status, 'unsupported_capability');
  } finally { await rm(root, { recursive: true, force: true }); }
});
