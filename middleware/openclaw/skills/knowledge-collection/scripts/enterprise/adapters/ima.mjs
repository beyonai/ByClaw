import crypto from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { createArtifactWriter } from '../shared/artifact-writer.mjs';
import { positiveEnv, runCli } from '../shared/cli-runner.mjs';
import { copyResumeArtifacts, readResumeCandidates } from '../shared/resume.mjs';
import { deriveCollectionStatus, SOURCE_IDENTITY, handledOutcome, inventoryCounts } from '../shared/status-model.mjs';

const identity = SOURCE_IDENTITY.ima;
const MAX_CONTENT_BYTES = 50 * 1024 * 1024;
const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_COVER_TIMEOUT_MS = 15_000;
const MAX_COVER_REDIRECTS = 3;
const DEFAULT_WEIXIN_TIMEOUT_MS = 120_000;
const COVER_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function stringValue(value, keys) {
  for (const key of keys) {
    if (typeof value?.[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function records(value) {
  const root = objectValue(value) || {};
  for (const key of ['items', 'results', 'notes', 'documents', 'list', 'data']) {
    if (Array.isArray(root[key])) return root[key];
    if (Array.isArray(root[key]?.items)) return root[key].items;
  }
  if (Array.isArray(value)) return value;
  return [];
}

function contentOf(value) {
  const root = objectValue(value);
  if (!root) return '';
  for (const key of ['markdown', 'content', 'text', 'body', 'noteContent']) {
    if (typeof root[key] === 'string' && root[key].trim()) return root[key].trim();
  }
  for (const key of ['data', 'result', 'note', 'document']) {
    const nested = contentOf(root[key]);
    if (nested) return nested;
  }
  return '';
}

function discoveryExcerptOf(item) {
  if (item?.sourceType !== 'wiki' || typeof item.preview !== 'string' || !item.preview.trim()) return '';
  return item.preview.trim();
}

function isTrustedWechatArticleUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:'
    && url.hostname === 'mp.weixin.qq.com'
    && !url.username
    && !url.password
    && !url.port
    && (url.pathname === '/s' || url.pathname.startsWith('/s/'));
}

function requiresImaAuthForMaterialization(item) {
  return !discoveryExcerptOf(item)
    && !(item?.sourceType === 'wiki' && isTrustedWechatArticleUrl(item.sourceUrl));
}

function coverUrlsOf(value) {
  if (!Array.isArray(value?.coverUrls)) return [];
  return [...new Set(value.coverUrls.filter((url) => {
    if (typeof url !== 'string' || !url.trim()) return false;
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
  }).map((url) => url.trim()))];
}

function boundedInteger(value, fallback, maximum, label) {
  const normalized = value === undefined ? fallback : value;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}`);
  }
  return normalized;
}

function validatedCoverUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('IMA cover URL is invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('IMA cover URL must use HTTP or HTTPS');
  if (url.username || url.password) throw new Error('IMA cover URL must not contain credentials');
  return url;
}

async function readCoverBody(response, maxBytes) {
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
    if (!/^\d+$/.test(contentLength)) throw new Error('IMA cover content length is invalid');
    if (Number(contentLength) > maxBytes) throw new Error('IMA cover exceeds the size limit');
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        length += chunk.length;
        if (length > maxBytes) throw new Error('IMA cover exceeds the size limit');
        chunks.push(chunk);
      }
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      throw error;
    }
    if (length === 0) throw new Error('IMA cover response is empty');
    return Buffer.concat(chunks, length);
  }
  if (typeof response.arrayBuffer !== 'function') throw new Error('IMA cover response body is unavailable');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error('IMA cover response is empty');
  if (bytes.length > maxBytes) throw new Error('IMA cover exceeds the size limit');
  return bytes;
}

export async function downloadImaCover(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('IMA cover HTTP(S) downloader is unavailable');
  const maxBytes = boundedInteger(options.maxBytes, MAX_COVER_BYTES, MAX_COVER_BYTES, 'maxBytes');
  const timeoutMs = boundedInteger(
    options.timeoutMs, MAX_COVER_TIMEOUT_MS, MAX_COVER_TIMEOUT_MS, 'timeoutMs',
  );
  const maxRedirects = boundedInteger(
    options.maxRedirects, MAX_COVER_REDIRECTS, MAX_COVER_REDIRECTS, 'maxRedirects',
  );
  let current = validatedCoverUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('IMA cover download timed out'));
  }, timeoutMs);
  let redirects = 0;
  try {
    while (true) {
      let response;
      try {
        response = await fetchImpl(current.href, { redirect: 'manual', signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) throw new Error('IMA cover download timed out');
        throw error;
      }
      if (REDIRECT_STATUSES.has(response?.status)) {
        if (redirects >= maxRedirects) throw new Error('IMA cover redirect limit exceeded');
        const location = response.headers?.get?.('location');
        if (!location) throw new Error('IMA cover redirect is missing a location');
        current = validatedCoverUrl(new URL(location, current).href);
        redirects += 1;
        continue;
      }
      if (!response?.ok) throw new Error(`IMA cover download failed: HTTP ${response?.status || 'unknown'}`);
      const contentType = String(response.headers?.get?.('content-type') || '')
        .split(';', 1)[0].trim().toLowerCase();
      const extension = COVER_EXTENSIONS.get(contentType);
      if (!extension) throw new Error(`IMA cover content type is unsupported: ${contentType || 'unknown'}`);
      const bytes = await readCoverBody(response, maxBytes);
      return { bytes, extension };
    }
  } finally {
    clearTimeout(timeout);
  }
}

function itemFromRecord(record, sourceType, kb = '', materializationKb = '') {
  const sourceItemId = stringValue(record, ['mediaId', 'doc_id', 'docId', 'documentId', 'id', 'uuid', 'fileId']);
  if (!sourceItemId) return null;
  const title = stringValue(record, ['title', 'name', 'fileName', 'subject']) || sourceItemId;
  const sourceUrl = stringValue(record, ['url', 'sourceUrl', 'link']) || `ima://${sourceType}/${sourceItemId}`;
  const abstract = stringValue(record, ['abstract']);
  const introduction = stringValue(record, ['introduction']);
  return {
    sourceItemId,
    sourceUrl,
    title,
    sourceType,
    kb,
    materializationKb,
    preview: contentOf(record) || [abstract, introduction].filter(Boolean).join('\n\n'),
    abstract,
    introduction,
    completeEvidence: false,
    coverUrls: coverUrlsOf(record),
  };
}

export function imaContentGranularity({ completeEvidence, abstract, introduction } = {}) {
  if (completeEvidence === true) return 'full-text';
  if (typeof introduction === 'string' && introduction.trim()) return 'excerpt';
  if (typeof abstract === 'string' && abstract.trim()) return 'abstract';
  return 'unknown';
}

function mediaStateFor(item) {
  const coverCount = Array.isArray(item.coverUrls) ? item.coverUrls.length : 0;
  return coverCount > 0
    ? {
      coverStatus: 'unknown',
      coverCount,
      materializedCoverCount: 0,
      reason: 'cover-materialization-pending',
    }
    : {
      coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null,
    };
}

function knowledgeBaseId(value, name) {
  const bases = Array.isArray(value?.knowledge_bases) ? value.knowledge_bases : [];
  const match = bases.find((base) => base?.name === name) || bases[0];
  return stringValue(match, ['id']);
}

function itemIdFor(item) {
  return `ima-${crypto.createHash('sha256').update(`${item.sourceType}\n${item.sourceItemId}`).digest('hex').slice(0, 16)}`;
}

function articleDirectoryName(item) {
  const title = Array.from(String(item.title || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, ''))
    .slice(0, 80)
    .join('')
    .replace(/[.-]+$/g, '') || 'article';
  return `${title}-${itemIdFor(item)}`;
}

function materializationPaths(item) {
  const suffix = crypto.createHash('sha256').update(`${item.sourceType}\n${item.sourceItemId}`).digest('hex').slice(0, 16);
  const directory = articleDirectoryName(item);
  return {
    suffix,
    markdownPath: `markdown/items/${directory}/index.md`,
    sanitizedPath: `sanitized/items/${directory}/index.md`,
  };
}

function inventoryItem(item, rawArtifacts, materialization = {}, media = mediaStateFor(item)) {
  return {
    itemId: itemIdFor(item),
    title: item.title,
    sourceUrl: item.sourceUrl,
    sourceItemId: item.sourceItemId,
    sourceType: item.sourceType,
    materializationType: 'markdown',
    kb: item.kb,
    materializationKb: item.materializationKb,
    preview: item.preview,
    abstract: item.abstract,
    introduction: item.introduction,
    completeEvidence: item.completeEvidence === true,
    coverUrls: [...(item.coverUrls || [])],
    sourceSkill: identity.sourceSkill,
    backend: identity.backend,
    collectionFilters: item.kb ? { kb: item.kb } : {},
    rawArtifacts,
    media,
    materialization: {
      status: materialization.status || 'pending',
      markdownPath: materialization.markdownPath || null,
      sanitizedPath: materialization.sanitizedPath || null,
      pendingArtifactCleanup: [],
      reason: materialization.reason || 'discovery only; materialization is deferred',
      contentGranularity: materialization.contentGranularity || 'unknown',
    },
  };
}

function renderedMarkdown(content, item, coverMarkdown = []) {
  const covers = coverMarkdown.length ? `${coverMarkdown.join('\n\n')}\n\n` : '';
  return `---\ntitle: ${JSON.stringify(item.title)}\nsource: "ima"\nsource_url: ${JSON.stringify(item.sourceUrl)}\ncollection_filters: ${JSON.stringify(item.kb ? { kb: item.kb } : {})}\n---\n\n${covers}${content.trim()}\n`;
}

function coverFailureReason(error) {
  const message = reasonOf(error);
  if (/timed out/i.test(message)) return 'cover-download-timeout';
  if (/size limit|content length/i.test(message)) return 'cover-size-limit';
  if (/redirect/i.test(message)) return 'cover-redirect-invalid';
  if (/HTTPS|credentials|URL is invalid/i.test(message)) return 'cover-url-invalid';
  if (/content type|response is empty|body is unavailable/i.test(message)) return 'cover-content-invalid';
  if (/HTTP /i.test(message)) return 'cover-http-error';
  return 'cover-download-failed';
}

async function prepareCovers(item, fetchImpl) {
  const prepared = [];
  const failures = [];
  for (const [index, url] of (item.coverUrls || []).entries()) {
    try {
      const downloaded = await downloadImaCover(url, { fetchImpl });
      prepared.push({
        ...downloaded,
        name: `cover-${index + 1}.${downloaded.extension}`,
        markdown: `![封面 ${index + 1}](assets/cover-${index + 1}.${downloaded.extension})`,
      });
    } catch (error) {
      failures.push(coverFailureReason(error));
    }
  }
  return { prepared, failures };
}

function cliReason(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  if (/IMA_CREDENTIALS_UNAVAILABLE|auth|credential|unauthorized|401|403/i.test(output)) return 'IMA 连接尚未配置或已失效';
  if (result?.failure) return `ima failed to start: ${result.failure.code || result.failure.message}`;
  return `ima command failed with exit ${result?.exitCode}`;
}

async function authCheck(bin, env) {
  const result = await runCli(bin, ['auth', 'check', '--test', '--json'], { env });
  if (result.failure || result.exitCode !== 0) throw Object.assign(new Error(cliReason(result)), { auth: true });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw Object.assign(new Error('ima auth check returned invalid JSON'), { auth: true }); }
  if (parsed?.checks?.token_fetch !== true) {
    throw Object.assign(new Error('IMA 连接尚未配置或已失效'), { auth: true });
  }
  return parsed;
}

async function callJson(writer, bin, env, args, artifact) {
  const result = await runCli(bin, args, { env });
  if (result.failure || result.exitCode !== 0) throw Object.assign(new Error(cliReason(result)), { auth: /auth|credential|401|403/i.test(`${result.stdout}\n${result.stderr}`) });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error('ima returned invalid JSON'); }
  await writer.writeJson(artifact, parsed);
  return parsed;
}

async function bycliKnowledgeList(writer, bycliBin, env, kb) {
  const result = await runCli(bycliBin, ['ima', 'knowledge', kb, '-f', 'json'], { env });
  if (result.failure || result.exitCode !== 0) {
    throw new Error(`bycli ima knowledge failed: ${cliReason(result)}`);
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error('bycli ima knowledge returned invalid JSON'); }
  if (!Array.isArray(parsed) && !objectValue(parsed)) {
    throw new Error('bycli ima knowledge returned an unsupported JSON shape');
  }
  await writer.writeJson('raw/bycli-knowledge.json', parsed);
  return parsed;
}

function bycliDownloadRecord(value) {
  const candidates = Array.isArray(value) ? value : records(value);
  return candidates.find((candidate) => objectValue(candidate) && stringValue(candidate, ['saved']))
    || (objectValue(value) && stringValue(value, ['saved']) ? value : null);
}

function containedRelativePath(parent, child) {
  const result = relative(parent, child);
  if (!result || result === '..' || result.startsWith(`..${sep}`) || isAbsolute(result)) return '';
  return result;
}

async function prepareWechatImages(savedPath, sanitizedPath) {
  const imageDirectory = dirname(savedPath) + `${sep}images`;
  let entries;
  try { entries = await readdir(imageDirectory, { withFileTypes: true }); }
  catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const prepared = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const sourcePath = `${imageDirectory}${sep}${entry.name}`;
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) continue;
    totalBytes += sourceInfo.size;
    if (totalBytes > MAX_CONTENT_BYTES) throw new Error('WeChat inline images exceed materialization limit');
    prepared.push({
      sourcePath: `images/${entry.name}`,
      targetPath: sanitizedPath.replace(/index\.md$/, `assets/article-images/${entry.name}`),
      bytes: await readFile(sourcePath),
    });
  }
  return prepared;
}

function sanitizeWechatMarkdown(content, preparedImages) {
  const localized = new Map(preparedImages.map((image) => [
    image.sourcePath,
    image.targetPath.split('/').slice(-3).join('/'),
  ]));
  return content
    .replace(/<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_match, alt, rawDestination) => {
      const destination = rawDestination.trim().split(/\s+/, 1)[0].replace(/^<|>$/g, '');
      const local = localized.get(destination);
      return local ? `![${alt}](${local})` : alt;
    })
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<img\b[^>]*>/gi, '');
}

async function bycliWechatDownload(writer, bycliBin, env, item, paths) {
  const rawDirectory = `raw/weixin-${paths.suffix}`;
  const artifact = `raw/weixin-download-${paths.suffix}.json`;
  const outputDirectory = writer.absolute(rawDirectory);
  const result = await runCli(bycliBin, [
    'weixin', 'download',
    '--url', item.sourceUrl,
    '--output', outputDirectory,
    '--download-images', 'true',
    '--site-session', 'persistent',
    '--keep-tab', 'true',
    '-f', 'json',
  ], {
    env,
    timeoutMs: positiveEnv('KNOWLEDGE_COLLECTION_WEIXIN_TIMEOUT_MS', DEFAULT_WEIXIN_TIMEOUT_MS, env),
  });
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch { /* retained as diagnostics below */ }
  await writer.writeJson(artifact, parsed ?? {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    failure: result.failure ? { code: result.failure.code, message: result.failure.message } : null,
  });
  const fail = (message) => {
    const error = new Error(message);
    error.rawArtifacts = [artifact];
    throw error;
  };
  if (result.failure || result.exitCode !== 0) fail(`bycli weixin download failed: ${cliReason(result)}`);
  if (!parsed) fail('bycli weixin download returned invalid JSON');
  const record = bycliDownloadRecord(parsed);
  if (!record || !/^success$/i.test(stringValue(record, ['status']))) {
    fail('bycli weixin download did not report success');
  }
  const reportedPath = stringValue(record, ['saved']);
  let outputRealPath;
  let savedRealPath;
  try {
    outputRealPath = await realpath(outputDirectory);
    savedRealPath = await realpath(reportedPath);
  } catch {
    fail('bycli weixin download saved path is not readable');
  }
  const relativeSavedPath = containedRelativePath(outputRealPath, savedRealPath);
  if (!relativeSavedPath) fail('bycli weixin download saved path escaped its output directory');
  const savedInfo = await lstat(savedRealPath);
  if (!savedInfo.isFile() || savedInfo.isSymbolicLink()) fail('bycli weixin download saved path is not a regular file');
  const content = await readFile(savedRealPath, 'utf8');
  if (!content.trim()) fail('bycli weixin download saved an empty article');
  return {
    artifact,
    content,
    savedPath: savedRealPath,
    savedArtifact: `${rawDirectory}/${relativeSavedPath.split(sep).join('/')}`,
  };
}

async function discover(writer, request, bin, bycliBin, env) {
  const found = [];
  const seenSourceItems = new Set();
  const seenSourceUrls = new Set();
  const rawArtifacts = [];
  const fallbackReasons = [];
  let materializationKb = request.kb;
  const runDiscovery = async (sourceType, artifact, load) => {
    const response = await load();
    rawArtifacts.push(artifact);
    for (const record of records(response)) {
      const item = itemFromRecord(record, sourceType, request.kb);
      const sourceItemKey = item && `${sourceType}:${item.sourceItemId}`;
      if (!item || seenSourceItems.has(sourceItemKey) || seenSourceUrls.has(item.sourceUrl)) continue;
      seenSourceItems.add(sourceItemKey);
      seenSourceUrls.add(item.sourceUrl);
      found.push({ ...item, materializationKb, sourceRank: found.length + 1, rawArtifacts: [artifact] });
      if (found.length >= request.limit) break;
    }
  };
  if (request.kb) {
    const baseSearch = await callJson(writer, bin, env, ['wiki', 'search-base', request.kb, '--json'], 'raw/wiki-search-base.json');
    materializationKb = knowledgeBaseId(baseSearch, request.kb);
    if (!materializationKb) throw new Error(`ima knowledge base not found: ${request.kb}`);
    try {
      await runDiscovery('wiki', 'raw/bycli-knowledge.json', () => bycliKnowledgeList(writer, bycliBin, env, request.kb));
    } catch (error) {
      fallbackReasons.push(reasonOf(error));
      try {
        await runDiscovery('wiki', 'raw/wiki-search.json', () => callJson(
          writer,
          bin,
          env,
          ['wiki', 'search', request.query, '--kb', materializationKb, '--json'],
          'raw/wiki-search.json',
        ));
      } catch (fallbackError) {
        throw new Error(`IMA knowledge listing failed: bycli=${fallbackReasons.join('; ')}; wiki=${reasonOf(fallbackError)}`);
      }
    }
    return { found: found.slice(0, request.limit), rawArtifacts, fallbackReasons };
  }
  const noteArgs = ['note', 'search', '--content', request.query, '--start', '0', '--end', String(request.limit), '--json'];
  if (request.noteMode === 'title') {
    noteArgs.splice(2, 2, '--title', request.query);
  }
  await runDiscovery('note', 'raw/note-search.json', () => callJson(writer, bin, env, noteArgs, 'raw/note-search.json'));
  if (found.length < request.limit) {
    const wikiArgs = ['wiki', 'search', request.query, ...(request.kb ? ['--kb', request.kb] : []), '--json'];
    try {
      await runDiscovery('wiki', 'raw/wiki-search.json', () => callJson(writer, bin, env, wikiArgs, 'raw/wiki-search.json'));
    } catch (error) {
      if (fallbackReasons.length) {
        throw new Error(`IMA knowledge listing failed: bycli=${fallbackReasons.join('; ')}; wiki=${reasonOf(error)}`);
      }
      throw error;
    }
  }
  return { found: found.slice(0, request.limit), rawArtifacts, fallbackReasons };
}

async function materializeOne(writer, item, bin, bycliBin, env, fetchImpl) {
  const paths = materializationPaths(item);
  const artifact = `raw/${item.sourceType}-get-${paths.suffix}.json`;
  const args = item.sourceType === 'note'
    ? ['note', 'get', item.sourceItemId, '--format', '0', '--json']
    : ['wiki', 'search', item.title, ...(item.materializationKb ? ['--kb', item.materializationKb] : []), '--json'];
  const createdFiles = [];
  let rawArtifacts = item.rawArtifacts;
  let materializedItem = item;
  let wechatImages = [];
  try {
    let content = '';
    try {
      if (item.sourceType === 'wiki' && isTrustedWechatArticleUrl(item.sourceUrl)) {
        const downloaded = await bycliWechatDownload(writer, bycliBin, env, item, paths);
        rawArtifacts = [...item.rawArtifacts, downloaded.artifact, downloaded.savedArtifact];
        wechatImages = await prepareWechatImages(downloaded.savedPath, paths.sanitizedPath);
        content = sanitizeWechatMarkdown(downloaded.content, wechatImages);
        materializedItem = { ...item, completeEvidence: true };
      } else {
        const response = await callJson(writer, bin, env, args, artifact);
        rawArtifacts = [...item.rawArtifacts, artifact];
        content = contentOf(response) || item.preview;
      }
    } catch (error) {
      if (Array.isArray(error?.rawArtifacts)) rawArtifacts = [...item.rawArtifacts, ...error.rawArtifacts];
      content = discoveryExcerptOf(item);
      if (!content) throw error;
    }
    if (!content) throw new Error(`ima ${item.sourceType} returned no content`);
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
      throw new Error('IMA content exceeds materialization limit');
    }
    for (const image of wechatImages) {
      await writer.writeBytes(image.targetPath, image.bytes);
      createdFiles.push(image.targetPath);
    }
    const coverResult = await prepareCovers(item, fetchImpl);
    const covers = [];
    for (const cover of coverResult.prepared) {
      const coverPath = paths.sanitizedPath.replace(/index\.md$/, `assets/${cover.name}`);
      try {
        await writer.writeBytes(coverPath, cover.bytes);
        createdFiles.push(coverPath);
        covers.push(cover);
      } catch {
        coverResult.failures.push('cover-write-failed');
      }
    }
    const markdown = renderedMarkdown(content, materializedItem, covers.map((cover) => cover.markdown));
    await writer.writeText(paths.markdownPath, markdown);
    createdFiles.push(paths.markdownPath);
    await writer.writeText(paths.sanitizedPath, markdown);
    createdFiles.push(paths.sanitizedPath);
    const media = item.coverUrls.length === 0
      ? mediaStateFor(item)
      : coverResult.failures.length === 0
        ? {
        coverStatus: 'materialized', coverCount: covers.length,
        materializedCoverCount: covers.length, reason: null,
      }
        : {
          coverStatus: 'unavailable', coverCount: item.coverUrls.length,
          materializedCoverCount: covers.length,
          reason: [...new Set(coverResult.failures)].join(','),
        };
    return inventoryItem(materializedItem, rawArtifacts, {
      status: 'materialized',
      ...paths,
      reason: null,
      contentGranularity: imaContentGranularity(materializedItem),
    }, media);
  } catch (error) {
    await writer.removeFiles(createdFiles);
    const failure = error instanceof Error ? error : new Error(reasonOf(error));
    failure.rawArtifacts = rawArtifacts;
    throw failure;
  }
}

function failedInventory(item, error) {
  const media = error?.media || (item.coverUrls?.length
    ? {
      coverStatus: 'unavailable', coverCount: item.coverUrls.length,
      materializedCoverCount: 0, reason: 'article-materialization-failed-before-covers',
    }
    : mediaStateFor(item));
  return inventoryItem(
    item,
    Array.isArray(error?.rawArtifacts) ? error.rawArtifacts : item.rawArtifacts,
    { status: 'failed', reason: reasonOf(error) },
    media,
  );
}

function commonKnowledgeBase(items) {
  const values = [...new Set(items.map((item) => item.kb).filter(Boolean))];
  if (values.length > 1) {
    throw new Error(`IMA materialization cannot mix knowledge bases: ${values.join(', ')}`);
  }
  return values[0] || '';
}

async function persistSearch(writer, request, inventory, canonicalItems, rawArtifacts, status, discovery) {
  await writer.writeJson('raw/metadata.json', {
    ...identity,
    operation: 'search',
    rawArtifacts,
    status,
    sourceMetadata: { ...identity, operation: 'search', metadataOnly: Boolean(request.metadataOnly), discovery },
  });
  await writer.writeCollectionBundle({
    title: `IMA search: ${request.query}`,
    source: identity.source,
    backend: identity.backend,
    url: 'ima://search',
    filters: request.kb ? { kb: request.kb } : {},
    inventory,
    canonicalItems,
    sourceMetadata: { ...identity, operation: 'search', metadataOnly: Boolean(request.metadataOnly), discovery },
    metadataOnly: Boolean(request.metadataOnly),
  });
}

export function createImaAdapter(dependencies = {}) {
  const bin = dependencies.bin || 'ima';
  const bycliBin = dependencies.bycliBin || 'bycli';
  const env = dependencies.env || process.env;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;

  async function search(request = {}) {
    const outputDir = request.outputDir;
    const writer = await createArtifactWriter(outputDir);
    const normalized = {
      ...request,
      query: typeof request.query === 'string' ? request.query.trim() : '',
      limit: request.limit || 50,
    };
    try {
      await authCheck(bin, env);
      const discovery = await discover(writer, normalized, bin, bycliBin, env);
      const inventory = normalized.metadataOnly ? discovery.found.map((item) => inventoryItem(item, item.rawArtifacts)) : [];
      const materialized = [];
      if (!normalized.metadataOnly) {
        for (const item of discovery.found) {
          try { materialized.push(await materializeOne(writer, item, bin, bycliBin, env, fetchImpl)); }
          catch (error) { materialized.push(failedInventory(item, error)); }
        }
      }
      const finalInventory = normalized.metadataOnly ? inventory : materialized;
      const canonicalItems = finalInventory.filter((item) => item.materialization.status === 'materialized').map((item) => ({
        title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath,
      }));
      const status = deriveCollectionStatus({ metadataOnly: normalized.metadataOnly, itemStates: finalInventory.map((item) => item.materialization.status) });
      await persistSearch(writer, normalized, finalInventory, canonicalItems, discovery.rawArtifacts, status, {
        discovered: finalInventory.length,
        fallbackReasons: discovery.fallbackReasons,
      });
      return handledOutcome(identity.connector, status, outputDir, inventoryCounts(finalInventory));
    } catch (error) {
      if (error.auth) return handledOutcome(identity.connector, 'auth_required', outputDir, { failed: 0 });
      throw error;
    }
  }

  async function collectResource(request = {}) {
    return handledOutcome(identity.connector, 'unsupported_capability', request.outputDir);
  }

  async function materialize(request = {}) {
    const writer = await createArtifactWriter(request.outputDir);
    const candidates = await copyResumeArtifacts(writer, await readResumeCandidates(request.sessionDir, identity.source, request.itemIds || []));
    if (candidates.some(requiresImaAuthForMaterialization)) await authCheck(bin, env);
    const kb = commonKnowledgeBase(candidates);
    const inventory = [];
    for (const item of candidates) {
      try { inventory.push(await materializeOne(writer, item, bin, bycliBin, env, fetchImpl)); }
      catch (error) { inventory.push(failedInventory(item, error)); }
    }
    const canonicalItems = inventory.filter((item) => item.materialization.status === 'materialized').map((item) => ({ title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath }));
    const status = deriveCollectionStatus({ itemStates: inventory.map((item) => item.materialization.status) });
    await writer.writeCollectionBundle({
      title: 'IMA materialized collection',
      source: identity.source,
      backend: identity.backend,
      url: 'ima://materialize',
      filters: kb ? { kb } : {},
      inventory,
      canonicalItems,
      sourceMetadata: { ...identity, operation: 'materialize', ...(kb ? { kb } : {}) },
      metadataOnly: false,
    });
    return handledOutcome(identity.connector, status, request.outputDir, inventoryCounts(inventory));
  }

  return { ...identity, search, collectResource, materialize };
}
