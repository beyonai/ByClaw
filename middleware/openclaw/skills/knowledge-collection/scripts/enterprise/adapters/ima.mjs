import crypto from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
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
const TITLE_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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
    folderPath: stringValue(record, ['folderPath', 'sourcePath']),
    tags: Array.isArray(record?.tags) ? record.tags.filter((tag) => typeof tag === 'string') : [],
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

function itemIdFor(item) {
  return `ima-${crypto.createHash('sha256').update(`${item.sourceType}\n${item.sourceItemId}`).digest('hex').slice(0, 16)}`;
}

function articleDirectoryName(item) {
  const normalizedTitle = String(item.title || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  const title = Array.from(TITLE_SEGMENTER.segment(normalizedTitle), ({ segment }) => segment)
    .slice(0, 5)
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
    folderPath: item.folderPath,
    tags: [...(item.tags || [])],
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

function bycliReason(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  if (/auth|credential|unauthorized|login|登录|401|403/i.test(output)) return 'IMA 网页登录状态不可用';
  if (/BRIDGE_UNAVAILABLE|BRIDGE_RECOVERY_BUSY|browser bridge|ECONNREFUSED/i.test(output)) {
    return 'byCLI browser bridge is unavailable';
  }
  if (result?.failure) return `bycli failed to start: ${result.failure.code || result.failure.message}`;
  return `bycli command failed with exit ${result?.exitCode}`;
}

function isAuthorizationFailure(result) {
  return /auth|credential|unauthorized|login|登录|401|403/i.test(`${result?.stdout || ''}\n${result?.stderr || ''}`);
}

function bridgeReasonCode(result) {
  const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
  if (/BRIDGE_RECOVERY_BUSY/i.test(output)) return 'BRIDGE_RECOVERY_BUSY';
  if (/BRIDGE_UNAVAILABLE|browser bridge|ECONNREFUSED/i.test(output)) return 'BRIDGE_UNAVAILABLE';
  return null;
}

async function callBycliImaJson(writer, bycliBin, env, args, artifact) {
  const result = await runCli(bycliBin, ['ima', ...args, '-f', 'json'], { env });
  if (result.failure || result.exitCode !== 0) {
    const reason = bycliReason(result);
    const reasonCode = bridgeReasonCode(result);
    await writer.writeJson(artifact, {
      status: 'failed',
      exitCode: result.exitCode,
      failure: result.failure ? { code: result.failure.code || 'start-failed' } : null,
      reason,
    });
    throw Object.assign(new Error(`bycli ima ${args[0]} failed: ${reason}`), {
      auth: isAuthorizationFailure(result),
      bridge: reasonCode !== null,
      reasonCode,
      rawArtifacts: [artifact],
    });
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch {
    await writer.writeJson(artifact, { status: 'failed', reason: 'invalid-json' });
    throw Object.assign(new Error(`bycli ima ${args[0]} returned invalid JSON`), { rawArtifacts: [artifact] });
  }
  await writer.writeJson(artifact, parsed);
  return parsed;
}

async function bycliKnowledgeList(writer, bycliBin, env, kb) {
  const parsed = await callBycliImaJson(writer, bycliBin, env, ['knowledge', kb], 'raw/bycli-knowledge.json');
  if (!Array.isArray(parsed) && !objectValue(parsed)) {
    throw new Error('bycli ima knowledge returned an unsupported JSON shape');
  }
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
  if (result.failure || result.exitCode !== 0) fail(`bycli weixin download failed: ${bycliReason(result)}`);
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

function knowledgeBasesOf(value) {
  return records(value).map((record) => {
    const id = stringValue(record, ['id', 'knowledgeBaseId']);
    const name = stringValue(record, ['name', 'knowledgeBase']);
    const selector = id || name;
    return selector ? { id, name, selector } : null;
  }).filter(Boolean);
}

function recordMatchesQuery(record, query) {
  const terms = String(query || '').normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const tags = Array.isArray(record?.tags) ? record.tags.join(' ') : '';
  const searchable = [
    stringValue(record, ['title', 'name', 'fileName', 'subject']),
    stringValue(record, ['folderPath']),
    stringValue(record, ['abstract']),
    stringValue(record, ['introduction']),
    stringValue(record, ['sourcePath']),
    stringValue(record, ['url', 'sourceUrl', 'link']),
    tags,
  ].join('\n').normalize('NFKC').toLocaleLowerCase();
  return terms.every((term) => searchable.includes(term));
}

function knowledgeArtifact(selector) {
  const suffix = crypto.createHash('sha256').update(selector).digest('hex').slice(0, 16);
  return `raw/bycli-knowledge-${suffix}.json`;
}

function boundedConcurrency(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= 16 ? numeric : 4;
}

async function mapWithConcurrency(values, concurrency, operation) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(boundedConcurrency(concurrency), values.length) },
    () => worker(),
  ));
  return results;
}

async function discover(writer, request, bycliBin, env) {
  const found = [];
  const seenSourceItems = new Set();
  const seenSourceUrls = new Set();
  const rawArtifacts = [];
  const failures = [];
  const runDiscovery = (response, kb, selector, artifact) => {
    rawArtifacts.push(artifact);
    for (const record of records(response)) {
      if (!recordMatchesQuery(record, request.query)) continue;
      const item = itemFromRecord(record, 'wiki', kb, selector);
      const sourceItemKey = item && `wiki:${item.sourceItemId}`;
      if (!item || seenSourceItems.has(sourceItemKey) || seenSourceUrls.has(item.sourceUrl)) continue;
      seenSourceItems.add(sourceItemKey);
      seenSourceUrls.add(item.sourceUrl);
      found.push({ ...item, sourceRank: found.length + 1, rawArtifacts: [artifact] });
    }
  };
  if (request.kb) {
    const response = await bycliKnowledgeList(writer, bycliBin, env, request.kb);
    runDiscovery(response, request.kb, request.kb, 'raw/bycli-knowledge.json');
    return { found: found.slice(0, request.limit), rawArtifacts, failures };
  }

  const basesArtifact = 'raw/bycli-knowledge-list.json';
  const basesResponse = await callBycliImaJson(writer, bycliBin, env, ['knowledge-list'], basesArtifact);
  rawArtifacts.push(basesArtifact);
  const bases = knowledgeBasesOf(basesResponse);
  const baseResults = await mapWithConcurrency(bases, request.concurrency, async (base) => {
    const artifact = knowledgeArtifact(base.selector);
    try {
      const response = await callBycliImaJson(writer, bycliBin, env, ['knowledge', base.selector], artifact);
      return { base, artifact, response, error: null };
    } catch (error) {
      return { base, artifact, response: null, error };
    }
  });
  let successfulBases = 0;
  for (const { base, artifact, response, error } of baseResults) {
    if (!error) {
      successfulBases += 1;
      runDiscovery(response, base.name || base.id, base.selector, artifact);
      continue;
    }
    rawArtifacts.push(...(error.rawArtifacts || [artifact]));
    failures.push({ knowledgeBase: base.name || base.id, reason: reasonOf(error) });
  }
  if (bases.length > 0 && successfulBases === 0) {
    const error = new Error(`IMA knowledge enumeration failed: ${failures.map((failure) => `${failure.knowledgeBase}: ${failure.reason}`).join('; ')}`);
    error.auth = failures.some((failure) => /登录|auth|credential|unauthorized|401|403/i.test(failure.reason));
    const bridgeCodes = baseResults.map((result) => result.error?.reasonCode).filter(Boolean);
    error.bridge = bridgeCodes.length > 0;
    error.reasonCode = bridgeCodes.includes('BRIDGE_UNAVAILABLE')
      ? 'BRIDGE_UNAVAILABLE'
      : (bridgeCodes.includes('BRIDGE_RECOVERY_BUSY') ? 'BRIDGE_RECOVERY_BUSY' : null);
    error.rawArtifacts = rawArtifacts;
    throw error;
  }
  return { found: found.slice(0, request.limit), rawArtifacts, failures };
}

async function materializeOne(writer, item, bycliBin, env, fetchImpl) {
  const paths = materializationPaths(item);
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
        content = discoveryExcerptOf(item);
      }
    } catch (error) {
      if (Array.isArray(error?.rawArtifacts)) rawArtifacts = [...item.rawArtifacts, ...error.rawArtifacts];
      content = discoveryExcerptOf(item);
      if (!content) throw error;
    }
    if (!content) throw new Error('bycli ima returned no materializable excerpt');
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

async function materializeItems(writer, items, bycliBin, env, fetchImpl, concurrency) {
  return mapWithConcurrency(items, concurrency, async (item) => {
    try {
      return await materializeOne(writer, item, bycliBin, env, fetchImpl);
    } catch (error) {
      return failedInventory(item, error);
    }
  });
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
  return values.length === 1 ? values[0] : '';
}

async function persistSearch(writer, request, inventory, canonicalItems, rawArtifacts, status, discovery, terminal = null) {
  const sourceMetadata = {
    ...identity,
    operation: 'search',
    metadataOnly: Boolean(request.metadataOnly),
    discovery,
    ...(terminal ? { terminal } : {}),
  };
  await writer.writeJson('raw/metadata.json', {
    ...identity,
    operation: 'search',
    rawArtifacts,
    status,
    sourceMetadata,
  });
  await writer.writeCollectionBundle({
    title: `IMA search: ${request.query}`,
    source: identity.source,
    backend: identity.backend,
    url: 'ima://search',
    filters: request.kb ? { kb: request.kb } : {},
    inventory,
    canonicalItems,
    sourceMetadata,
    metadataOnly: Boolean(request.metadataOnly),
    discoverySucceeded: status !== 'failed',
    paginationFailed: status === 'partial',
  });
}

export function createImaAdapter(dependencies = {}) {
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
      const discovery = await discover(writer, normalized, bycliBin, env);
      const inventory = normalized.metadataOnly ? discovery.found.map((item) => inventoryItem(item, item.rawArtifacts)) : [];
      const materialized = normalized.metadataOnly ? [] : await materializeItems(
        writer, discovery.found, bycliBin, env, fetchImpl, normalized.concurrency,
      );
      const finalInventory = normalized.metadataOnly ? inventory : materialized;
      const canonicalItems = finalInventory.filter((item) => item.materialization.status === 'materialized').map((item) => ({
        title: item.title, url: item.sourceUrl, author: '', publishTime: '', markdown: item.materialization.sanitizedPath, fileName: item.materialization.sanitizedPath,
      }));
      const status = deriveCollectionStatus({
        metadataOnly: normalized.metadataOnly,
        paginationFailed: discovery.failures.length > 0,
        itemStates: finalInventory.map((item) => item.materialization.status),
      });
      await persistSearch(writer, normalized, finalInventory, canonicalItems, discovery.rawArtifacts, status, {
        discovered: finalInventory.length,
        failures: discovery.failures,
      });
      return handledOutcome(identity.connector, status, outputDir, inventoryCounts(finalInventory));
    } catch (error) {
      if (error.bridge) {
        const reasonCode = error.reasonCode || 'BRIDGE_UNAVAILABLE';
        const terminal = {
          status: reasonCode === 'BRIDGE_RECOVERY_BUSY' ? 'bridge_recovery_busy' : 'bridge_unavailable',
          reasonCode,
          reason: reasonOf(error),
        };
        await persistSearch(
          writer,
          normalized,
          [],
          [],
          error.rawArtifacts || [],
          'failed',
          { discovered: 0, failures: [{ reason: terminal.reason }] },
          terminal,
        );
        return {
          ...handledOutcome(identity.connector, terminal.status, outputDir, { failed: 0 }),
          reasonCode: terminal.reasonCode,
          reason: terminal.reason,
        };
      }
      if (error.auth) return handledOutcome(identity.connector, 'auth_required', outputDir, { failed: 0 });
      throw error;
    }
  }

  async function collectResource(request = {}) {
    return handledOutcome(identity.connector, 'unsupported_capability', request.outputDir);
  }

  async function materialize(request = {}) {
    if (resolve(request.sessionDir || '') !== resolve(request.outputDir || '')) {
      throw new Error('IMA materialization must remain in the same discovery session');
    }
    const writer = await createArtifactWriter(request.outputDir, { allowExistingSession: true });
    const candidates = await copyResumeArtifacts(writer, await readResumeCandidates(request.sessionDir, identity.source, request.itemIds || []));
    const kb = commonKnowledgeBase(candidates);
    const inventory = await materializeItems(
      writer, candidates, bycliBin, env, fetchImpl, request.concurrency,
    );
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
