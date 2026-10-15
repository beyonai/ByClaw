import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { authorizePublicSource } from './discovery-authorization.mjs';
import { assertExternalSessionWriteAllowed } from './probe-state.mjs';
import { loadSession, persistSession, requireString, withSessionLock } from './session.mjs';
import { assertPolicy, digest, fileEntry, safeFile, sourceUrl, workUrl } from './douyin-artifacts.mjs';

const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const KINDS = new Set(['video', 'metadata', 'subtitle-json', 'subtitle-vtt']);
const SUBTITLE_STATUSES = new Set(['available', 'not-provided', 'unavailable']);

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

function itemIdOf(value) {
  const itemId = requireString(value, '--item-id');
  if (!ITEM_ID.test(itemId)) fail('DOUYIN_ITEM_ID_INVALID', '条目 ID 格式无效');
  return itemId;
}

function relativeFile(value, prefix) {
  if (typeof value !== 'string' || !value.startsWith(`${prefix}/`)
    || value.includes('\\') || value.split('/').some(segment => !segment || segment === '.' || segment === '..')
    || path.posix.normalize(value) !== value) {
    fail('DOUYIN_ARCHIVE_PATH_INVALID', '文件必须位于当前条目的受控目录');
  }
  return value;
}

function verifyEntry(paths, entry, prefix) {
  if (!entry || !KINDS.has(entry.kind) || !Number.isSafeInteger(entry.size) || entry.size <= 0
    || typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256)) {
    fail('DOUYIN_ARCHIVE_INTEGRITY', '归档文件声明无效');
  }
  const artifact = relativeFile(entry.artifact, prefix);
  const absolute = safeFile(paths.root, path.join(paths.root, artifact));
  const actual = fileEntry(paths.root, absolute, entry.kind);
  if (actual.size !== entry.size || actual.sha256 !== entry.sha256) {
    fail('DOUYIN_ARCHIVE_INTEGRITY', '归档文件长度或哈希变化');
  }
  return { ...entry, absolute };
}

function validateFileKinds(files, subtitleStatus) {
  if (!Array.isArray(files) || files.length < 2 || files.length > 8
    || files.filter(file => file?.kind === 'video').length !== 1
    || files.filter(file => file?.kind === 'metadata').length !== 1
    || new Set(files.map(file => file?.artifact)).size !== files.length
    || files.some(file => !KINDS.has(file?.kind))) {
    fail('DOUYIN_ARCHIVE_INCOMPLETE', '必须包含唯一视频和元数据文件，且文件不能重复');
  }
  const jsonCount = files.filter(file => file.kind === 'subtitle-json').length;
  const vttCount = files.filter(file => file.kind === 'subtitle-vtt').length;
  if (subtitleStatus === 'available' ? !jsonCount || jsonCount !== vttCount : jsonCount || vttCount) {
    fail('DOUYIN_ARCHIVE_INCOMPLETE', '字幕状态与归档字幕文件不一致');
  }
}

function safeDirectory(root, relative) {
  let current = root;
  for (const segment of ['', ...relative.split('/').filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail('DOUYIN_ARCHIVE_PATH_INVALID', '输出目录不能是符号链接或普通文件');
    }
  }
  return current;
}

function boundedJson(absolute, label) {
  if (fs.statSync(absolute).size > 10 * 1024 * 1024) fail('DOUYIN_ARCHIVE_INTEGRITY', `${label}过大`);
  try { return JSON.parse(fs.readFileSync(absolute, 'utf8')); }
  catch { fail('DOUYIN_ARCHIVE_INTEGRITY', `${label}不是有效 JSON`); }
}

function escapedText(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}()#!|]/g, '\\$&');
}

function renderMarkdown(executor, metadata, assets) {
  const title = typeof metadata.title === 'string' && metadata.title.trim()
    ? metadata.title.trim() : `抖音视频 ${executor.workId}`;
  const author = typeof metadata.author?.nickname === 'string' ? metadata.author.nickname : '';
  const lines = ['---', `title: ${JSON.stringify(escapedText(title))}`, 'source: public-internet',
    `source_url: ${JSON.stringify(executor.sourceUrl)}`, 'collection_filters: {}', '---', '',
    `# ${escapedText(title)}`, '', `作品 ID：${executor.workId}`, '',
    ...(author ? [`作者：${escapedText(author)}`, ''] : []),
    '本材料归档视频文件和可用官方字幕；正文粒度为 unknown，不代表完整文字转录。', '',
    `<video controls src="assets/${executor.workId}.mp4"></video>`, '',
    `[下载视频](assets/${executor.workId}.mp4)`, '', '[作品元数据](assets/metadata.json)', '',
    `官方字幕状态：${executor.subtitleStatus}`, '',
  ];
  for (const asset of assets.filter(file => file.kind.startsWith('subtitle-'))) {
    lines.push(`[官方字幕 ${asset.kind === 'subtitle-json' ? 'JSON' : 'VTT'}](assets/${asset.name})`, '');
  }
  lines.push('无可用官方字幕时跳过字幕归档；未执行音频转录。', '');
  for (const limitation of executor.limitations) lines.push(`- ${escapedText(limitation)}`);
  return { title, author, markdown: `${lines.join('\n')}\n` };
}

function outputAssets(executor, files) {
  const counters = { 'subtitle-json': 0, 'subtitle-vtt': 0 };
  return files.map(file => {
    let name;
    if (file.kind === 'video') name = `${executor.workId}.mp4`;
    else if (file.kind === 'metadata') name = 'metadata.json';
    else {
      const extension = file.kind === 'subtitle-json' ? 'json' : 'vtt';
      name = `subtitle-${String(++counters[file.kind]).padStart(2, '0')}.${extension}`;
    }
    return { ...file, name };
  });
}

function rollbackOwnedOutput(paths, output) {
  try {
    const current = fs.lstatSync(output.absolute);
    if (current.isSymbolicLink() || current.dev !== output.identity.dev || current.ino !== output.identity.ino) return;
    if (!output.directory) {
      const bytes = fs.readFileSync(output.absolute);
      if (bytes.length <= output.bytes.length && bytes.equals(output.bytes.subarray(0, bytes.length))) fs.unlinkSync(output.absolute);
      return;
    }
    if (JSON.stringify(fs.readdirSync(output.absolute).sort()) !== JSON.stringify(['assets', 'index.md'])) return;
    const names = fs.readdirSync(path.join(output.absolute, 'assets')).sort();
    if (JSON.stringify(names) !== JSON.stringify(output.assets.map(asset => asset.name).sort())) return;
    const markdown = safeFile(paths.root, path.join(output.absolute, 'index.md'));
    if (digest(fs.readFileSync(markdown)) !== output.markdownHash) return;
    for (const asset of output.assets) {
      const copy = fileEntry(paths.root, safeFile(paths.root, path.join(output.absolute, 'assets', asset.name)), asset.kind);
      if (copy.size !== asset.size || copy.sha256 !== asset.sha256) return;
    }
    fs.rmSync(output.absolute, { recursive: true });
  } catch { /* Preserve replaced, modified or inaccessible output for inspection. */ }
}

export function runDouyinMaterialize(paths, args) {
  const startedAt = performance.now();
  const itemId = itemIdOf(args['item-id']);
  assertExternalSessionWriteAllowed(paths, 'materialize-douyin');
  return withSessionLock(paths, 'materialize-douyin', () => {
    const { session } = loadSession(paths, { persistMigration: false });
    assertPolicy(session);
    const rawPrefix = `raw/bycli/douyin/${itemId}`;
    const artifact = `${rawPrefix}/executor-result.json`;
    const requestedFile = path.resolve(requireString(args['executor-result-file'], '--executor-result-file'));
    if (requestedFile !== path.join(paths.root, artifact)) fail('DOUYIN_ARCHIVE_PATH_INVALID', '必须使用当前条目的执行回执');
    const registration = (session.task.douyinAcquisitions || []).filter(entry => entry.itemId === itemId && entry.artifact === artifact);
    if (registration.length !== 1) fail('ACQUISITION_NOT_REGISTERED', '未登记受控抖音采集回执');
    const receiptFile = safeFile(paths.root, requestedFile);
    const receiptBytes = fs.readFileSync(receiptFile);
    if (!HASH.test(registration[0].sha256) || digest(receiptBytes) !== registration[0].sha256) {
      fail('DOUYIN_ARCHIVE_INTEGRITY', '采集回执哈希变化');
    }
    const executor = boundedJson(receiptFile, '采集回执');
    if (executor.schemaVersion !== '1.0' || executor.executor !== 'bycli' || executor.adapter !== 'douyin'
      || executor.status !== 'saved' || executor.exitCode !== 0 || executor.itemId !== itemId
      || typeof executor.workId !== 'string' || !/^\d+$/.test(executor.workId)
      || executor.canonicalUrl !== workUrl(executor.workId)
      || !SUBTITLE_STATUSES.has(executor.subtitleStatus)
      || !Array.isArray(executor.limitations) || executor.limitations.some(value => typeof value !== 'string')) {
      fail('DOUYIN_ARCHIVE_INCOMPLETE', '执行结果未确认同一作品的完整视频归档');
    }
    const authorizedSource = sourceUrl(executor.sourceUrl);
    if (executor.sourceUrl !== authorizedSource || registration[0].sourceUrl !== authorizedSource
      || !authorizePublicSource(session.task.discoveryGate, authorizedSource)) {
      fail('SOURCE_NOT_AUTHORIZED_BY_DISCOVERY', '作品来源尚未获得授权');
    }
    validateFileKinds(executor.files, executor.subtitleStatus);
    const files = executor.files.map(entry => verifyEntry(paths, entry, rawPrefix));
    const metadata = boundedJson(files.find(file => file.kind === 'metadata').absolute, '作品元数据');
    if (!metadata || metadata.aweme_id !== executor.workId || metadata.url !== executor.canonicalUrl
      || metadata.media_type !== 'video') fail('DOUYIN_WORK_IDENTITY', '作品元数据身份不匹配');
    const assets = outputAssets(executor, files);
    const rendered = renderMarkdown(executor, metadata, assets);
    const markdownPath = `markdown/items/${itemId}/index.md`;
    const sanitizedPath = `sanitized/items/${itemId}/index.md`;
    const payloadRelative = `.collection-inputs/douyin-${itemId}.json`;
    const diagnosticsRelative = `raw/materialization/douyin-${itemId}.json`;
    const outputs = [`markdown/items/${itemId}`, `sanitized/items/${itemId}`, payloadRelative, diagnosticsRelative];
    if (outputs.some(relative => fs.existsSync(path.join(paths.root, relative)))
      || (session.task.douyinMaterializations || []).some(entry => entry.itemId === itemId)) {
      fail('MATERIALIZATION_CONFLICT', '归档物化输出已存在');
    }
    for (const directory of ['markdown/items', 'sanitized/items', '.collection-inputs', 'raw/materialization', '.collection-tmp']) {
      safeDirectory(paths.root, directory);
    }
    const stageRelative = `.collection-tmp/douyin-${crypto.randomUUID()}`;
    const stage = safeDirectory(paths.root, stageRelative);
    const created = [];
    try {
      for (const base of ['markdown', 'sanitized']) {
        const target = safeDirectory(paths.root, `${stageRelative}/${base}/assets`);
        for (const asset of assets) {
          const destination = path.join(target, asset.name);
          fs.copyFileSync(asset.absolute, destination, fs.constants.COPYFILE_EXCL);
          fs.chmodSync(destination, 0o600);
          const copy = fileEntry(paths.root, destination, asset.kind);
          if (copy.size !== asset.size || copy.sha256 !== asset.sha256) fail('DOUYIN_ARCHIVE_INTEGRITY', '视频或附件复制后校验失败');
        }
        fs.writeFileSync(path.join(target, '..', 'index.md'), rendered.markdown, { flag: 'wx', mode: 0o600 });
      }
      const diagnostics = { schemaVersion: '1.0', adapter: 'douyin', itemId,
        sourceUrl: executor.sourceUrl, workId: executor.workId, contentGranularity: 'unknown',
        sourceMarkdown: sanitizedPath, sourceMarkdownSha256: digest(rendered.markdown),
        subtitleStatus: executor.subtitleStatus, files: assets.map(asset => ({ kind: asset.kind,
          artifact: `sanitized/items/${itemId}/assets/${asset.name}`, size: asset.size, sha256: asset.sha256 })) };
      const diagnosticsBytes = `${JSON.stringify(diagnostics, null, 2)}\n`;
      const payload = { schemaVersion: '1.0', itemId, source: 'public-internet', sourceSkill: 'bycli', backend: 'bycli',
        sourceUrl: executor.sourceUrl, contentGranularity: 'unknown',
        sourceMetadata: { adapter: 'douyin', workId: executor.workId, subtitleStatus: executor.subtitleStatus },
        rawArtifacts: [artifact, ...files.map(file => file.artifact), diagnosticsRelative],
        media: { coverStatus: 'unknown', coverCount: 0, materializedCoverCount: 0, reason: 'video-archive-cover-not-classified' },
        markdownPath, sanitizedPath,
        canonicalItem: { title: rendered.title, url: executor.sourceUrl, author: rendered.author,
          publishTime: typeof metadata.create_time === 'number' ? String(metadata.create_time) : '',
          markdown: sanitizedPath, fileName: sanitizedPath } };
      for (const base of ['markdown', 'sanitized']) {
        const destination = path.join(paths.root, base, 'items', itemId);
        if (fs.existsSync(destination)) fail('MATERIALIZATION_CONFLICT', '归档目录已存在');
        fs.renameSync(path.join(stage, base), destination);
        created.push({ absolute: destination, directory: true, identity: fs.lstatSync(destination),
          assets, markdownHash: digest(rendered.markdown) });
      }
      for (const [relative, bytes] of [[diagnosticsRelative, diagnosticsBytes], [payloadRelative, `${JSON.stringify(payload, null, 2)}\n`]]) {
        const absolute = path.join(paths.root, relative);
        const fd = fs.openSync(absolute, 'wx', 0o600);
        created.push({ absolute, directory: false, identity: fs.fstatSync(fd), bytes: Buffer.from(bytes) });
        try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
      }
      session.task.douyinMaterializations = [...(session.task.douyinMaterializations || []),
        { itemId, artifact: diagnosticsRelative, sha256: digest(diagnosticsBytes) }];
      persistSession(paths, session);
      return { ok: true, action: 'materialize-douyin', itemId, subtitleStatus: executor.subtitleStatus,
        materialization: { status: 'materialized', contentGranularity: 'unknown', markdownPath, sanitizedPath },
        collectPayloadPath: path.join(paths.root, payloadRelative), diagnostics: diagnosticsRelative,
        timing: { totalMs: Math.round(performance.now() - startedAt) } };
    } catch (error) {
      for (const output of created.reverse()) rollbackOwnedOutput(paths, output);
      throw error;
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  });
}

export function resolveDouyinArchiveFiles(paths, session, sourceMarkdown) {
  if (typeof sourceMarkdown !== 'string') return [];
  let relative = path.isAbsolute(sourceMarkdown) ? path.relative(paths.root, sourceMarkdown).split(path.sep).join('/') : sourceMarkdown;
  if (path.isAbsolute(sourceMarkdown) && relative.split('/').includes('..')) {
    relative = path.relative(fs.realpathSync(paths.root), sourceMarkdown).split(path.sep).join('/');
  }
  if (relative.split('/').includes('..') || relative.includes('\\')) {
    fail('DOUYIN_ARCHIVE_PATH_INVALID', '归档正文必须位于当前会话');
  }
  const match = /^sanitized\/items\/([a-z0-9][a-z0-9_-]{0,63})\/index\.md$/.exec(relative);
  if (!match) return [];
  const itemId = match[1];
  const entries = (session.task?.douyinMaterializations || []).filter(entry => entry.itemId === itemId);
  if (!entries.length) {
    const archived = (session.collection?.collection?.items || []).some(item => (item.itemId === itemId || item.materialization?.sanitizedPath === relative)
      && (item.sourceMetadata?.adapter === 'douyin' || (item.sourceSkill === 'bycli' && ITEM_ID.test(item.itemId)
        && Array.isArray(item.rawArtifacts) && item.rawArtifacts.includes(`raw/bycli/douyin/${item.itemId}/executor-result.json`))));
    if (archived) fail('DOUYIN_ARCHIVE_NOT_REGISTERED', '抖音归档缺少物化登记');
    return [];
  }
  const expectedArtifact = `raw/materialization/douyin-${itemId}.json`;
  if (entries.length !== 1 || entries[0].artifact !== expectedArtifact || !HASH.test(entries[0].sha256)) {
    fail('DOUYIN_ARCHIVE_INTEGRITY', '物化登记无效');
  }
  const absolute = safeFile(paths.root, path.join(paths.root, expectedArtifact));
  if (digest(fs.readFileSync(absolute)) !== entries[0].sha256) fail('DOUYIN_ARCHIVE_INTEGRITY', '物化回执哈希变化');
  const manifest = boundedJson(absolute, '物化回执');
  if (manifest.schemaVersion !== '1.0' || manifest.adapter !== 'douyin' || manifest.itemId !== itemId
    || manifest.sourceMarkdown !== relative || manifest.contentGranularity !== 'unknown'
    || typeof manifest.workId !== 'string' || !/^\d+$/.test(manifest.workId)
    || !HASH.test(manifest.sourceMarkdownSha256) || !SUBTITLE_STATUSES.has(manifest.subtitleStatus)) {
    fail('DOUYIN_ARCHIVE_INTEGRITY', '物化回执与当前正文不一致');
  }
  const markdownFile = safeFile(paths.root, path.join(paths.root, relative));
  if (digest(fs.readFileSync(markdownFile)) !== manifest.sourceMarkdownSha256) fail('DOUYIN_ARCHIVE_INTEGRITY', '归档正文哈希变化');
  validateFileKinds(manifest.files, manifest.subtitleStatus);
  const prefix = `sanitized/items/${itemId}/assets`;
  return manifest.files.map(entry => {
    const verified = verifyEntry(paths, entry, prefix);
    const filename = path.posix.basename(entry.artifact);
    const expectedName = entry.kind === 'video' ? `${manifest.workId}.mp4`
      : entry.kind === 'metadata' ? 'metadata.json' : null;
    if (entry.artifact !== `${prefix}/${filename}`
      || (expectedName ? filename !== expectedName
        : !new RegExp(`^subtitle-0[1-3]\\.${entry.kind === 'subtitle-json' ? 'json' : 'vtt'}$`).test(filename))) {
      fail('DOUYIN_ARCHIVE_INTEGRITY', '物化附件名称或位置不匹配');
    }
    return { status: 'complete', absolute: verified.absolute, sha256: verified.sha256 };
  });
}
