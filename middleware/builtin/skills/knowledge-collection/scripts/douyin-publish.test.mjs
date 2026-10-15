import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'knowledge-collection.mjs');
const workId = '1234567890123456789';
const sourceUrl = `https://www.douyin.com/video/${workId}`;
const itemId = 'douyin-archive';
const sanitizedRelative = `sanitized/items/${itemId}/index.md`;
const assetRelative = `sanitized/items/${itemId}/assets`;
const payloads = {
  [`${workId}.mp4`]: `${'controlled-video-bytes'.repeat(50000)}video-tail`,
  'metadata.json': '{"aweme_id":"1234567890123456789","title":"归档视频"}\n',
  'subtitle-01.json': '[{"start":0,"end":1000,"text":"官方字幕"}]\n',
  'subtitle-01.vtt': 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n官方字幕\n',
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function runCli(args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
  let json;
  try { json = JSON.parse(result.stdout); } catch { json = undefined; }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function registerManifest(sessionDir, manifest) {
  const artifact = `raw/materialization/douyin-${itemId}.json`;
  const absolute = join(sessionDir, artifact);
  mkdirSync(dirname(absolute), { recursive: true });
  manifest.sourceMarkdownSha256 = sha256(readFileSync(join(sessionDir, sanitizedRelative)));
  writeJson(absolute, manifest);
  const sessionFile = join(sessionDir, 'session.json');
  const session = JSON.parse(readFileSync(sessionFile, 'utf8'));
  session.task.douyinMaterializations = [{
    itemId, artifact, sha256: sha256(readFileSync(absolute)),
  }];
  session.collection.collection.items[0].sourceMetadata = {
    ...session.collection.collection.items[0].sourceMetadata, adapter: 'douyin',
  };
  writeJson(sessionFile, session);
  return { manifestFile: absolute, sessionFile };
}

function setupArchive() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'kc-douyin-publish-')));
  const sessionDir = join(root, 'internal-session');
  const deliveryDir = join(root, 'delivery');
  const init = runCli([
    'init', '--session-dir', sessionDir, '--query', '归档视频',
    '--source-scope', '["public-internet"]', '--direct-urls', JSON.stringify([sourceUrl]),
    '--materialization-target', 'selected', '--required-content-granularity', 'any',
  ]);
  assert.equal(init.code, 0, init.stderr || init.stdout);
  mkdirSync(join(sessionDir, assetRelative), { recursive: true });
  mkdirSync(join(sessionDir, 'markdown', itemId), { recursive: true });
  for (const [name, bytes] of Object.entries(payloads)) {
    writeFileSync(join(sessionDir, assetRelative, name), bytes);
  }
  const markdown = [
    '# 归档视频', '',
    `<video controls src="assets/${workId}.mp4"></video>`, '',
    `[视频](assets/${workId}.mp4)`,
    '[元数据](assets/metadata.json)',
    '[官方字幕 JSON](assets/subtitle-01.json)',
    '[官方字幕 VTT](assets/subtitle-01.vtt)', '',
  ].join('\n');
  writeFileSync(join(sessionDir, sanitizedRelative), markdown);
  writeFileSync(join(sessionDir, 'markdown', itemId, 'index.md'), markdown);
  const inputFile = join(sessionDir, '.collection-inputs', 'archive.json');
  writeJson(inputFile, {
    schemaVersion: '1.0', items: [{
      itemId, source: 'public-internet', backend: 'douyin', sourceSkill: 'douyin',
      markdownPath: `markdown/${itemId}/index.md`, sanitizedPath: sanitizedRelative,
      contentGranularity: 'unknown',
      canonicalItem: {
        title: '归档视频', url: sourceUrl, author: '示例作者', publishTime: '',
        markdown: sanitizedRelative, fileName: sanitizedRelative,
      },
    }],
  });
  const collected = runCli(['collect', '--session-dir', sessionDir, '--item-json-file', inputFile]);
  assert.equal(collected.code, 0, collected.stderr || collected.stdout);
  const kinds = ['video', 'metadata', 'subtitle-json', 'subtitle-vtt'];
  const manifest = {
    schemaVersion: '1.0', adapter: 'douyin', itemId, sourceUrl, workId,
    contentGranularity: 'unknown', sourceMarkdown: sanitizedRelative, subtitleStatus: 'available',
    files: Object.entries(payloads).map(([name, bytes], index) => ({
      kind: kinds[index], artifact: `${assetRelative}/${name}`,
      size: Buffer.byteLength(bytes), sha256: sha256(bytes),
    })),
  };
  const registration = registerManifest(sessionDir, manifest);
  return { root, sessionDir, deliveryDir, manifest, ...registration };
}

function publish(fixture) {
  return runCli(['publish', '--session-dir', fixture.sessionDir, '--delivery-dir', fixture.deliveryDir]);
}

function assertArchiveUnavailable(fixture) {
  const status = runCli(['status', '--session-dir', fixture.sessionDir]);
  assert.equal(status.code, 0, status.stderr || status.stdout);
  assert.equal(status.json.collection.deliveryComplete, false);
  assert.equal(status.json.collection.pending, 1);
  assert.equal(status.json.collection.materialized, 0);
  assert.ok(status.json.warnings.some(warning => /DOUYIN_ARCHIVE_INVALID/.test(warning)));
  assert.ok(status.json.downstreamInput === undefined
    || (Array.isArray(status.json.downstreamInput.files) && status.json.downstreamInput.files.length === 0));
  assert.equal(status.json.deliveryInput, undefined);
}

test('publish copies registered Douyin video, metadata and official subtitle files and rewrites their links', () => {
  const fixture = setupArchive();
  try {
    const result = publish(fixture);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.deepEqual(result.json.deliveryInput.files, [join(fixture.deliveryDir, `${itemId}.md`)]);
    const markdown = readFileSync(join(fixture.deliveryDir, `${itemId}.md`), 'utf8');
    for (const [name, bytes] of Object.entries(payloads)) {
      assert.equal(readFileSync(join(fixture.deliveryDir, `${itemId}-assets`, name), 'utf8'), bytes);
      assert.ok(markdown.includes(`](${itemId}-assets/${name})`), `rewritten link for ${name}`);
    }
    assert.ok(markdown.includes(`src="${itemId}-assets/${workId}.mp4"`));
    assert.deepEqual(readdirSync(join(fixture.deliveryDir, `${itemId}-assets`)).sort(), Object.keys(payloads).sort());
    const receipt = JSON.parse(readFileSync(fixture.sessionFile, 'utf8')).delivery;
    assert.equal(receipt.assets.length, 4);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('ordinary links and source metadata cannot register extra files for publication', () => {
  const fixture = setupArchive();
  try {
    const outside = join(fixture.root, 'private.json');
    writeFileSync(outside, 'private-file');
    const extraAsset = join(fixture.sessionDir, assetRelative, 'unregistered.json');
    writeFileSync(extraAsset, 'unregistered-file');
    const markdownFile = join(fixture.sessionDir, sanitizedRelative);
    writeFileSync(markdownFile, `${readFileSync(markdownFile, 'utf8')}\n`
      + `[私有资料](${outside})\n[缺失文件](assets/missing.json)\n`
      + '[未登记文件](assets/unregistered.json)\n');
    registerManifest(fixture.sessionDir, fixture.manifest);
    const session = JSON.parse(readFileSync(fixture.sessionFile, 'utf8'));
    session.collection.collection.items[0].sourceMetadata = {
      adapter: 'douyin',
      attachments: [{ status: 'complete', localPath: outside, sha256: sha256('private-file') }],
      archiveFiles: [{ status: 'complete', absolute: outside, sha256: sha256('private-file') }],
    };
    writeJson(fixture.sessionFile, session);
    const result = publish(fixture);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const markdown = readFileSync(join(fixture.deliveryDir, `${itemId}.md`), 'utf8');
    assert.ok(markdown.includes(`[私有资料](${outside})`));
    assert.ok(markdown.includes('[缺失文件](assets/missing.json)'));
    assert.ok(markdown.includes('[未登记文件](assets/unregistered.json)'));
    assert.deepEqual(readdirSync(join(fixture.deliveryDir, `${itemId}-assets`)).sort(), Object.keys(payloads).sort());
    assert.equal(readFileSync(outside, 'utf8'), 'private-file');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test('registered reference links are rewritten while code examples and remote links are preserved', () => {
  const fixture = setupArchive();
  try {
    const markdownFile = join(fixture.sessionDir, sanitizedRelative);
    writeFileSync(markdownFile, `${readFileSync(markdownFile, 'utf8')}\n`
      + '[元数据副本][metadata]\n[metadata]: <assets/metadata.json> "metadata"\n'
      + '`[代码示例](assets/metadata.json)`\n'
      + '```markdown\n[围栏示例](assets/metadata.json)\n```\n'
      + '[远程资料](https://example.com/metadata.json)\n');
    registerManifest(fixture.sessionDir, fixture.manifest);
    const result = publish(fixture);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const markdown = readFileSync(join(fixture.deliveryDir, `${itemId}.md`), 'utf8');
    assert.ok(markdown.includes(`[metadata]: ${itemId}-assets/metadata.json "metadata"`));
    assert.ok(markdown.includes('`[代码示例](assets/metadata.json)`'));
    assert.ok(markdown.includes('[围栏示例](assets/metadata.json)'));
    assert.ok(markdown.includes('[远程资料](https://example.com/metadata.json)'));
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

for (const scenario of ['missing', 'tampered', 'symlink']) {
  test(`publish refuses a ${scenario} registered subtitle before creating delivery files`, () => {
    const fixture = setupArchive();
    try {
      const subtitle = join(fixture.sessionDir, assetRelative, 'subtitle-01.vtt');
      if (scenario === 'tampered') writeFileSync(subtitle, 'changed subtitle');
      else {
        unlinkSync(subtitle);
        if (scenario === 'symlink') {
          const outside = join(fixture.root, 'private.vtt');
          writeFileSync(outside, payloads['subtitle-01.vtt']);
          symlinkSync(outside, subtitle);
        }
      }
      assertArchiveUnavailable(fixture);
      const result = publish(fixture);
      assert.equal(result.code, 1, result.stdout);
      assert.match(result.json?.error || result.stderr, /只有 status\.collection\.deliveryComplete=true 后才能 publish/);
      assert.equal(existsSync(fixture.deliveryDir), false);
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
}

test('publish refuses a registered archive path outside its item assets directory', () => {
  const fixture = setupArchive();
  try {
    const outside = join(fixture.root, 'private.json');
    writeFileSync(outside, 'private-file');
    fixture.manifest.files[1] = {
      kind: 'metadata', artifact: outside, size: 12, sha256: sha256('private-file'),
    };
    registerManifest(fixture.sessionDir, fixture.manifest);
    assertArchiveUnavailable(fixture);
    const result = publish(fixture);
    assert.equal(result.code, 1, result.stdout);
    assert.match(result.json?.error || result.stderr, /只有 status\.collection\.deliveryComplete=true 后才能 publish/);
    assert.equal(existsSync(fixture.deliveryDir), false);
    assert.equal(readFileSync(outside, 'utf8'), 'private-file');
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

for (const change of ['manifest-tampered', 'registration-removed']) {
  test(`an unchanged published receipt cannot bypass ${change} archive authorization`, () => {
    const fixture = setupArchive();
    try {
      const initial = publish(fixture);
      assert.equal(initial.code, 0, initial.stderr || initial.stdout);
      if (change === 'manifest-tampered') {
        writeFileSync(fixture.manifestFile, `${readFileSync(fixture.manifestFile, 'utf8')} `);
      } else {
        const session = JSON.parse(readFileSync(fixture.sessionFile, 'utf8'));
        session.task.douyinMaterializations = [];
        writeJson(fixture.sessionFile, session);
      }
      assertArchiveUnavailable(fixture);
      const retried = publish(fixture);
      assert.equal(retried.code, 1, retried.stdout);
      assert.match(retried.json?.error || retried.stderr, /只有 status\.collection\.deliveryComplete=true 后才能 publish/);
      for (const [name, bytes] of Object.entries(payloads)) {
        assert.equal(readFileSync(join(fixture.deliveryDir, `${itemId}-assets`, name), 'utf8'), bytes);
      }
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
}

test('a newly registered subtitle pair invalidates an older receipt and is included on republish', () => {
  const fixture = setupArchive();
  try {
    const initial = publish(fixture);
    assert.equal(initial.code, 0, initial.stderr || initial.stdout);
    for (const [kind, extension, bytes] of [
      ['subtitle-json', 'json', '[{"text":"另一语言"}]\n'],
      ['subtitle-vtt', 'vtt', 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n另一语言\n'],
    ]) {
      const artifact = `${assetRelative}/subtitle-02.${extension}`;
      writeFileSync(join(fixture.sessionDir, artifact), bytes);
      fixture.manifest.files.push({ kind, artifact, size: Buffer.byteLength(bytes), sha256: sha256(bytes) });
    }
    registerManifest(fixture.sessionDir, fixture.manifest);
    const stale = runCli(['status', '--session-dir', fixture.sessionDir]);
    assert.equal(stale.code, 0, stale.stderr || stale.stdout);
    assert.equal(stale.json.collection.deliveryComplete, true);
    assert.deepEqual(stale.json.downstreamInput.files, [join(fixture.sessionDir, sanitizedRelative)]);
    assert.equal(stale.json.warnings.some(warning => /DOUYIN_ARCHIVE_INVALID/.test(warning)), false);
    assert.equal(stale.json.deliveryInput, undefined);
    const updated = publish(fixture);
    assert.equal(updated.code, 0, updated.stderr || updated.stdout);
    for (const extension of ['json', 'vtt']) {
      assert.ok(existsSync(join(fixture.deliveryDir, `${itemId}-assets`, `subtitle-02.${extension}`)));
    }
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
