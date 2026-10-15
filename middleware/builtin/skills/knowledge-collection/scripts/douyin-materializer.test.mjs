import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cmdInit } from './research-state.mjs';
import { cmdCollect, collectionStatus } from './collection-state.mjs';
import { loadSession, persistSession, sessionPaths } from './session.mjs';
import { resolveDouyinArchiveFiles, runDouyinMaterialize } from './douyin-materializer.mjs';

const SOURCE = 'https://v.douyin.com/RpopXC5PB9c/';
const WORK_ID = '18446744073709551615';
const CANONICAL = `https://www.douyin.com/video/${WORK_ID}`;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture(t, { subtitles = false, registered = true, subtitleStatus = 'not-provided', source = SOURCE } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-materializer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  cmdInit({ 'session-dir': root, query: '归档用户提供的抖音视频',
    'source-scope': '["public-internet"]', 'direct-urls': JSON.stringify([source]),
    'required-content-granularity': 'any' });
  const paths = sessionPaths(root);
  const itemId = 'selected-video';
  const raw = `raw/bycli/douyin/${itemId}`;
  fs.mkdirSync(path.join(root, raw), { recursive: true });
  const metadata = { aweme_id: WORK_ID, url: CANONICAL, title: '<script>bad</script> [outside](https://evil.example)',
    media_type: 'video', author: { nickname: 'Example author' }, create_time: 1234, duration: 3,
    statistics: { digg_count: 0 }, image_count: 0 };
  const data = [
    ['video', 'source.mp4', Buffer.from('00000020ftypisom\0video fixture')],
    ['metadata', 'download.metadata.json', Buffer.from(JSON.stringify(metadata))],
  ];
  if (subtitles) {
    data.push(['subtitle-json', 'official.json', Buffer.from(JSON.stringify({ source: 'official_subtitle',
      language: 'zh', format: 'json', status: 'available', cues: [{ from: 0, to: 3, text: '官方字幕' }] }))]);
    data.push(['subtitle-vtt', 'official.vtt', Buffer.from('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\n官方字幕\n')]);
  }
  const files = data.map(([kind, name, bytes]) => {
    const artifact = `${raw}/${name}`;
    fs.writeFileSync(path.join(root, artifact), bytes);
    return { kind, artifact, size: bytes.length, sha256: hash(bytes) };
  });
  const artifact = `${raw}/executor-result.json`;
  const executor = { schemaVersion: '1.0', executor: 'bycli', adapter: 'douyin', status: 'saved', exitCode: 0,
    itemId, sourceUrl: source, workId: WORK_ID, canonicalUrl: CANONICAL,
    subtitleStatus: subtitles ? 'available' : subtitleStatus,
    limitations: ['未执行音频转录。'], files };
  const writeReceipt = () => {
    const bytes = Buffer.from(`${JSON.stringify(executor, null, 2)}\n`);
    fs.writeFileSync(path.join(root, artifact), bytes);
    if (registered) {
      const { session } = loadSession(paths);
      session.task.douyinAcquisitions = [{ itemId, sourceUrl: source, artifact, sha256: hash(bytes) }];
      persistSession(paths, session);
    }
  };
  writeReceipt();
  return { root, paths, itemId, artifact, executor, metadata, writeReceipt };
}

function materialize(f) {
  return runDouyinMaterialize(f.paths, { 'item-id': f.itemId,
    'executor-result-file': path.join(f.root, f.artifact) });
}

test('a registered video archive is collected as unknown without inventing full text', t => {
  const f = fixture(t);
  const result = materialize(f);
  const payload = JSON.parse(fs.readFileSync(result.collectPayloadPath, 'utf8'));
  assert.equal(payload.contentGranularity, 'unknown');
  assert.equal(payload.fullTextEvidence, undefined);
  assert.equal(payload.canonicalItem.url, SOURCE);
  const markdown = fs.readFileSync(path.join(f.root, payload.sanitizedPath), 'utf8');
  assert.ok(markdown.includes(`<video controls src="assets/${WORK_ID}.mp4"`));
  assert.ok(markdown.includes('](assets/metadata.json)'));
  assert.ok(!markdown.includes('<script>'));
  assert.ok(!markdown.includes('](https://evil.example)'));
  for (const base of ['markdown', 'sanitized']) {
    const asset = path.join(f.root, base, 'items', f.itemId, 'assets', `${WORK_ID}.mp4`);
    assert.deepEqual(fs.readFileSync(asset), fs.readFileSync(path.join(f.root, f.executor.files[0].artifact)));
  }
  cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath });
  assert.equal(collectionStatus(f.paths).deliveryComplete, true);
  assert.equal(collectionStatus(f.paths).contentGranularity['full-text'], 0);
  assert.equal(loadSession(f.paths).session.task.fullTextEvidenceReceipts, undefined);
});

test('official subtitle JSON and VTT are copied with local links', t => {
  const f = fixture(t, { subtitles: true });
  const result = materialize(f);
  assert.equal(result.subtitleStatus, 'available');
  const text = fs.readFileSync(path.join(f.root, 'sanitized/items', f.itemId, 'index.md'), 'utf8');
  for (const name of ['subtitle-01.json', 'subtitle-01.vtt']) {
    assert.ok(text.includes(`](assets/${name})`));
    assert.ok(fs.statSync(path.join(f.root, 'sanitized/items', f.itemId, 'assets', name)).size > 0);
  }
});

test('unavailable official subtitles do not prevent archiving the requested video', t => {
  const f = fixture(t, { subtitleStatus: 'unavailable' });
  const result = materialize(f);
  assert.equal(result.subtitleStatus, 'unavailable');
  assert.equal(result.materialization.contentGranularity, 'unknown');
  assert.ok(fs.readFileSync(path.join(f.root, result.materialization.sanitizedPath), 'utf8').includes('未执行音频转录'));
});

test('an unregistered executor receipt cannot materialize an archive', t => {
  const f = fixture(t, { registered: false });
  assert.throws(() => materialize(f), /ACQUISITION_NOT_REGISTERED/);
  assert.equal(fs.existsSync(path.join(f.root, 'sanitized/items', f.itemId)), false);
});

test('changing the registered receipt is rejected before creating output', t => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, f.artifact), ' ');
  assert.throws(() => materialize(f), /INTEGRITY/);
});

for (const kind of ['video', 'metadata', 'subtitle-json', 'subtitle-vtt']) {
  test(`changing the ${kind} bytes fails size and hash verification`, t => {
    const f = fixture(t, { subtitles: true });
    const entry = f.executor.files.find(file => file.kind === kind);
    fs.appendFileSync(path.join(f.root, entry.artifact), 'changed');
    assert.throws(() => materialize(f), /INTEGRITY/);
    assert.equal(fs.existsSync(path.join(f.root, 'sanitized/items', f.itemId)), false);
  });
}

for (const mutate of [
  receipt => { receipt.files = receipt.files.filter(file => file.kind !== 'video'); },
  receipt => { receipt.files.push({ ...receipt.files[0] }); },
  receipt => { receipt.canonicalUrl = 'https://www.douyin.com/video/99'; },
  receipt => { receipt.workId = Number(WORK_ID); },
  receipt => { receipt.files[0].kind = 'executable'; },
  receipt => { receipt.subtitleStatus = 'available'; },
]) {
  test(`invalid archive identity or file manifest is rejected (${mutate.toString()})`, t => {
    const f = fixture(t);
    mutate(f.executor);
    f.writeReceipt();
    assert.throws(() => materialize(f), /DOUYIN_|作品|文件|字幕/);
  });
}

test('metadata for a different work cannot supply the archive title', t => {
  const f = fixture(t);
  const entry = f.executor.files.find(file => file.kind === 'metadata');
  const bytes = Buffer.from(JSON.stringify({ ...f.metadata, aweme_id: '99' }));
  fs.writeFileSync(path.join(f.root, entry.artifact), bytes);
  Object.assign(entry, { size: bytes.length, sha256: hash(bytes) });
  f.writeReceipt();
  assert.throws(() => materialize(f), /IDENTITY|作品/);
});

for (const policy of [
  { requiredContentGranularity: 'full-text' },
  { workflow: 'public-collect' },
  { activeOrchestrationRunId: 'another-run' },
  { sourceScope: ['cloud-knowledge'] },
]) {
  test(`incompatible collection policy is refused (${JSON.stringify(policy)})`, t => {
    const f = fixture(t);
    const { session } = loadSession(f.paths);
    Object.assign(session.task, policy);
    // Simulate an existing owner; persistSession deliberately forbids writing that owner's state.
    fs.writeFileSync(f.paths.session, JSON.stringify(session));
    assert.throws(() => materialize(f), /REQUIRES_ANY|full-text|全文|POLICY|SOURCE_SCOPE|PUBLIC_COLLECT|ORCHESTRATION/);
  });
}

test('source authorization must still match the registered receipt', t => {
  const f = fixture(t);
  f.executor.sourceUrl = 'https://v.douyin.com/another/';
  f.writeReceipt();
  assert.throws(() => materialize(f), /SOURCE_NOT_AUTHORIZED|AUTHORIZATION/);
});

for (const source of ['https://www.douyin.com/jingxuan?modal_id=99',
  'https://douyin.com/?modal_id=99', 'https://www.douyin.com/video/99']) {
  test(`authorized source cannot materialize a different work (${source})`, t => {
    const f = fixture(t, { source });
    assert.throws(() => materialize(f), /DOUYIN_WORK_IDENTITY/);
    assert.equal(fs.existsSync(path.join(f.root, 'sanitized/items', f.itemId)), false);
    assert.equal(fs.existsSync(path.join(f.root, 'markdown/items', f.itemId)), false);
    assert.equal(loadSession(f.paths).session.task.douyinMaterializations, undefined);
    assert.ok(fs.existsSync(path.join(f.root, f.executor.files[0].artifact)));
  });
}

test('matching modal source retains the authorized URL in the materialized item', t => {
  const source = `https://www.douyin.com/jingxuan?recommend=1&modal_id=${WORK_ID}`;
  const f = fixture(t, { source });
  const result = materialize(f);
  const payload = JSON.parse(fs.readFileSync(result.collectPayloadPath, 'utf8'));
  assert.equal(payload.sourceUrl, source);
  assert.equal(payload.canonicalItem.url, source);
  assert.ok(fs.readFileSync(path.join(f.root, payload.sanitizedPath), 'utf8').includes(source));
  cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath });
  assert.equal(collectionStatus(f.paths).deliveryComplete, true);
  assert.equal(collectionStatus(f.paths).contentGranularity['full-text'], 0);
});

test('a raw artifact outside the controlled item directory is refused', t => {
  const f = fixture(t);
  const entry = f.executor.files[0];
  const bytes = fs.readFileSync(path.join(f.root, entry.artifact));
  entry.artifact = 'raw/other-video.mp4';
  fs.writeFileSync(path.join(f.root, entry.artifact), bytes);
  f.writeReceipt();
  assert.throws(() => materialize(f), /PATH|越界|目录/);
});

test('a symlink cannot replace a source asset even with identical bytes', t => {
  const f = fixture(t);
  const target = path.join(f.root, f.executor.files[0].artifact);
  const outside = path.join(f.root, 'raw/other.mp4');
  fs.renameSync(target, outside);
  fs.symlinkSync(outside, target);
  assert.throws(() => materialize(f), /PATH_INVALID|SYMLINK|符号链接/);
});

test('existing user output is preserved without creating a second partial copy', t => {
  const f = fixture(t);
  const dir = path.join(f.root, 'sanitized/items', f.itemId);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'index.md'), 'user file');
  assert.throws(() => materialize(f), /CONFLICT|已存在/);
  assert.equal(fs.readFileSync(path.join(dir, 'index.md'), 'utf8'), 'user file');
  assert.equal(fs.existsSync(path.join(f.root, 'markdown/items', f.itemId)), false);
});

test('a failed copy preserves raw files and can retry without orphaned output', t => {
  const f = fixture(t);
  const copy = fs.copyFileSync;
  fs.copyFileSync = () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); };
  try { assert.throws(() => materialize(f), /disk full/); }
  finally { fs.copyFileSync = copy; }
  assert.equal(fs.existsSync(path.join(f.root, 'sanitized/items', f.itemId)), false);
  assert.equal(fs.existsSync(path.join(f.root, 'markdown/items', f.itemId)), false);
  assert.ok(fs.existsSync(path.join(f.root, f.artifact)));
  assert.ok(materialize(f).collectPayloadPath);
});

test('rollback preserves an output changed after this materialization created it', t => {
  const f = fixture(t);
  const rename = fs.renameSync;
  const markdownDir = path.join(f.root, 'markdown/items', f.itemId);
  fs.renameSync = (from, to) => {
    if (to === path.join(f.root, 'sanitized/items', f.itemId)) {
      fs.writeFileSync(path.join(markdownDir, 'user-note.txt'), 'user note');
      throw new Error('injected rename failure');
    }
    return rename(from, to);
  };
  try { assert.throws(() => materialize(f), /injected rename failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(path.join(markdownDir, 'user-note.txt'), 'utf8'), 'user note');
  assert.ok(fs.existsSync(path.join(f.root, f.artifact)));
});

test('publisher resolves only registered, hashed sanitized archive files', t => {
  const f = fixture(t, { subtitles: true });
  const result = materialize(f);
  const { session } = loadSession(f.paths);
  const files = resolveDouyinArchiveFiles(f.paths, session, result.materialization.sanitizedPath);
  assert.equal(files.length, 4);
  for (const file of files) {
    assert.equal(file.status, 'complete');
    assert.ok(file.absolute.startsWith(path.join(f.root, 'sanitized/items', f.itemId, 'assets') + path.sep));
    assert.equal(file.sha256, hash(fs.readFileSync(file.absolute)));
  }
  assert.deepEqual(resolveDouyinArchiveFiles(f.paths, session, 'sanitized/items/other/index.md'), []);
  assert.deepEqual(resolveDouyinArchiveFiles(f.paths, { task: {} }, result.materialization.sanitizedPath), []);
});

test('publisher rejects an archive asset changed after materialization', t => {
  const f = fixture(t);
  const result = materialize(f);
  fs.appendFileSync(path.join(f.root, 'sanitized/items', f.itemId, 'assets', `${WORK_ID}.mp4`), 'changed');
  assert.throws(() => resolveDouyinArchiveFiles(f.paths, loadSession(f.paths).session,
    result.materialization.sanitizedPath), /INTEGRITY/);
});

test('publisher rejects a modified materialization manifest', t => {
  const f = fixture(t);
  const result = materialize(f);
  const { session } = loadSession(f.paths);
  fs.appendFileSync(path.join(f.root, session.task.douyinMaterializations[0].artifact), ' ');
  assert.throws(() => resolveDouyinArchiveFiles(f.paths, session,
    result.materialization.sanitizedPath), /INTEGRITY/);
});

test('publisher rejects a changed source Markdown rather than trusting its former asset list', t => {
  const f = fixture(t);
  const result = materialize(f);
  fs.appendFileSync(path.join(f.root, result.materialization.sanitizedPath), '\nchanged');
  assert.throws(() => resolveDouyinArchiveFiles(f.paths, loadSession(f.paths).session,
    result.materialization.sanitizedPath), /INTEGRITY/);
});

test('publisher accepts an absolute path for the same registered source Markdown', t => {
  const f = fixture(t);
  const result = materialize(f);
  const files = resolveDouyinArchiveFiles(f.paths, loadSession(f.paths).session,
    path.join(f.root, result.materialization.sanitizedPath));
  assert.equal(files.length, 2);
});

test('publisher accepts the realpath form of a registered session Markdown', t => {
  const f = fixture(t);
  const result = materialize(f);
  const files = resolveDouyinArchiveFiles(f.paths, loadSession(f.paths).session,
    fs.realpathSync(path.join(f.root, result.materialization.sanitizedPath)));
  assert.equal(files.length, 2);
});

test('publisher rejects a source Markdown absolute path outside its session', t => {
  const f = fixture(t);
  assert.throws(() => resolveDouyinArchiveFiles(f.paths, loadSession(f.paths).session,
    path.join(f.root, '..', 'other-session', 'sanitized/items/selected-video/index.md')), /PATH_INVALID/);
});

test('a Douyin inventory marker prevents a missing registration from becoming an ordinary article', t => {
  const f = fixture(t);
  const result = materialize(f);
  const { session } = loadSession(f.paths);
  delete session.task.douyinMaterializations;
  session.collection.collection.items = [{ itemId: f.itemId, sourceMetadata: { adapter: 'douyin' },
    materialization: { sanitizedPath: result.materialization.sanitizedPath } }];
  assert.throws(() => resolveDouyinArchiveFiles(f.paths, session,
    result.materialization.sanitizedPath), /INTEGRITY|NOT_REGISTERED/);
});

test('a collected archive still requires its materialization registration when metadata markers were not persisted', t => {
  const f = fixture(t);
  const result = materialize(f);
  cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath });
  const { session } = loadSession(f.paths);
  delete session.task.douyinMaterializations;
  assert.equal(session.collection.collection.items[0].sourceMetadata, undefined);
  assert.throws(() => resolveDouyinArchiveFiles(f.paths, session,
    result.materialization.sanitizedPath), /INTEGRITY|NOT_REGISTERED/);
});

for (const damage of ['delete', 'tamper']) {
  test(`collect refuses a video ${damage === 'delete' ? 'removed' : 'changed'} after materialization`, t => {
    const f = fixture(t);
    const result = materialize(f);
    const asset = path.join(f.root, 'sanitized/items', f.itemId, 'assets', `${WORK_ID}.mp4`);
    if (damage === 'delete') fs.unlinkSync(asset);
    else {
      const bytes = fs.readFileSync(asset);
      bytes[bytes.length - 1] ^= 1;
      fs.writeFileSync(asset, bytes);
    }
    assert.throws(() => cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }), /DOUYIN_|ENOENT/);
    assert.ok(fs.existsSync(path.join(f.root, f.executor.files[0].artifact)));
  });

  test(`status withdraws completion and downstream files when a collected video is ${damage === 'delete' ? 'removed' : 'changed'}`, t => {
    const f = fixture(t);
    const result = materialize(f);
    cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath });
    assert.equal(collectionStatus(f.paths).deliveryComplete, true);
    const asset = path.join(f.root, 'sanitized/items', f.itemId, 'assets', `${WORK_ID}.mp4`);
    if (damage === 'delete') fs.unlinkSync(asset);
    else {
      const bytes = fs.readFileSync(asset);
      bytes[bytes.length - 1] ^= 1;
      fs.writeFileSync(asset, bytes);
    }
    const status = collectionStatus(f.paths);
    assert.equal(status.deliveryComplete, false);
    assert.equal(status.pending, 1);
    assert.equal(status.materialized, 0);
    assert.ok(status.warnings.some(warning => /DOUYIN_ARCHIVE|抖音归档/.test(warning)));
    assert.ok(!status.downstreamInput || status.downstreamInput.files.length === 0);
    assert.ok(fs.existsSync(path.join(f.root, f.executor.files[0].artifact)));
  });
}

test('collect refuses a missing registration even while the existing inventory entry is pending', t => {
  const f = fixture(t);
  const result = materialize(f);
  const { session } = loadSession(f.paths);
  delete session.task.douyinMaterializations;
  persistSession(f.paths, session);
  assert.throws(() => cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath }), /NOT_REGISTERED/);
});
