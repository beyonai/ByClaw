#!/usr/bin/env node

/**
 * collection-state.mjs — 采集 inventory、正文物化与交付状态。
 *
 * 权威状态位于 <session-dir>/session.json 的 collection 子树。
 * 本模块只管理采集产物；交付终点是经过校验的 sanitized/items Markdown。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  requireString,
  readJson,
  atomicWriteJson,
  isInside,
  loadSession as sessionLoad,
  persistCollection,
  withSessionLock,
  markDeliveryStale,
  isProcessAlive,
  readLock,
  resolveCollectionInputFile,
} from './session.mjs';
import {
  deliveryCompleteForSession, summarizeCrawlDelivery, summarizePromotedDelivery,
} from './delivery-state.mjs';
import { summarizeProbeRun } from './probe-state.mjs';
import {
  authorizeArxivAcquisitionVariant as authorizeArxivVariant,
  authorizePublicSource,
} from './discovery-authorization.mjs';
import { assessMaterializedTopic } from './topic-relevance.mjs';
import {
  CONTENT_GRANULARITIES,
  COVER_STATUSES,
  normalizeContentGranularity,
  normalizeMediaState,
} from './enterprise/shared/status-model.mjs';

const METADATA_VERSION = '1.0';
const SENSITIVE_METADATA_KEY = /(token|cookie|secret|password|authorization|credential|device[_-]?code)/i;
const COLLECTION_STATUSES = new Set(['complete', 'partial', 'failed']);
const MATERIALIZATION_STATUSES = new Set(['materialized', 'pending', 'failed']);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const SOURCE_SCOPE_ALIAS = { dws: 'dingtalk', fws: 'feishu', wecom: 'wecom', ima: 'ima' };

function normalizedAuthorizationUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

function discoveryCandidateFor(session, source, sourceUrl) {
  if ((SOURCE_SCOPE_ALIAS[source] || source) !== 'public-internet') return null;
  const normalized = normalizedAuthorizationUrl(sourceUrl);
  const gate = session.task?.discoveryGate;
  if (!['1.1', '2.0'].includes(gate?.schemaVersion)) {
    throw new Error('DISCOVERY_RELEVANCE_MIGRATION_REQUIRED: 旧公共发现会话必须新建内部 run');
  }
  const direct = gate?.candidates?.find((candidate) => candidate.origin === 'user-provided'
    && (candidate.canonicalUrl === normalized || candidate.acquisitionUrls?.includes(normalized)));
  if (direct) return { ...direct, authorizationKind: 'user-provided' };

  const crawl = session.crawl;
  const crawlEntry = Array.isArray(crawl?.entries)
    ? crawl.entries.find((entry) => normalizedAuthorizationUrl(entry?.url) === normalized) : null;
  if (crawlEntry?.status === 'fetched'
    && (!crawl.scopePrefix || normalized?.startsWith(crawl.scopePrefix))) {
    return {
      origin: 'crawl-frontier',
      authorizationKind: 'crawl-frontier',
      canonicalUrl: normalized,
      topicRelevance: { status: 'not-required' },
    };
  }

  const candidate = authorizePublicSource(gate, sourceUrl);
  return candidate ? { ...candidate, authorizationKind: 'public-discover' } : candidate;
}

function assertMaterializedTopic(session, authorization, canonicalItem, sanitizedAbsolute) {
  if (authorization?.authorizationKind !== 'public-discover') return null;
  const topicRelevance = assessMaterializedTopic(session.task.discoveryGate.topicContract, {
    title: canonicalItem.title,
    markdown: fs.readFileSync(sanitizedAbsolute, 'utf8'),
  });
  if (!['matched', 'not-required'].includes(topicRelevance.status)) {
    throw new Error(`MATERIALIZED_CONTENT_NOT_RELEVANT: 实际正文与任务主题不匹配（${topicRelevance.status}）`);
  }
  return topicRelevance;
}

function stableItemId(item) {
  const identity = [item.url, item.title, item.fileName].filter(Boolean).join('\n');
  return `item-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeMetadataValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeMetadataValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
    .map(([key, item]) => [key, sanitizeMetadataValue(item)]));
}

function assertNoSensitiveMetadataKeys(value, currentPath = 'sanitized/metadata.json') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMetadataKeys(item, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_METADATA_KEY.test(key)) {
      throw new Error(`${currentPath}.${key} 包含禁止持久化的敏感字段`);
    }
    assertNoSensitiveMetadataKeys(item, `${currentPath}.${key}`);
  }
}

function articleIdentity({ sourceSkill = '', sourceUrl = '' } = {}) {
  return `${String(sourceSkill)}\n${String(sourceUrl)}`;
}

function normalizeDuplicateUrl(sourceUrl) {
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/index\.html$/i, '/') || '/';
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  url.searchParams.sort();
  return url.toString();
}

function normalizeDuplicateGroups(metadata) {
  const representatives = new Map();
  for (const item of metadata.collection.items) {
    const duplicateGroupKey = normalizeDuplicateUrl(item.sourceUrl)
      || `source:${articleIdentity(item)}`;
    const representative = representatives.get(duplicateGroupKey) || item.itemId;
    representatives.set(duplicateGroupKey, representative);
    item.duplicateGroupKey = duplicateGroupKey;
    item.duplicateOf = representative === item.itemId ? null : representative;
  }
}

function validateRelativePath(root, relativePath, label, { allowMissing = false } = {}) {
  requireString(relativePath, label);
  if (path.isAbsolute(relativePath)) throw new Error(`${label} 不能使用绝对路径`);
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!isInside(resolvedRoot, candidate)) throw new Error(`${label} 越出采集根目录`);
  if (!fs.existsSync(candidate)) {
    if (allowMissing) return candidate;
    throw new Error(`${label} 不存在或无法读取: ${relativePath}`);
  }
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error(`${label} 不能是符号链接`);
  const realCandidate = fs.realpathSync(candidate);
  if (!isInside(resolvedRoot, realCandidate)) throw new Error(`${label} 越出采集根目录`);
  return candidate;
}

function validatePathPrefix(root, relativePath, directory, label) {
  const candidate = path.resolve(root, relativePath);
  const expectedRoot = path.resolve(root, directory);
  if (candidate === expectedRoot || !isInside(expectedRoot, candidate)) {
    throw new Error(`${label} 必须位于 ${directory.split(path.sep).join('/')}/`);
  }
  const canonicalExpectedRoot = path.resolve(fs.realpathSync(root), directory);
  if (!fs.existsSync(expectedRoot) || fs.realpathSync(expectedRoot) !== canonicalExpectedRoot) {
    throw new Error(`${label} 的 ${directory.split(path.sep).join('/')} 目录不能是符号链接`);
  }
  const realCandidate = fs.existsSync(candidate) ? fs.realpathSync(candidate) : null;
  if (realCandidate && !isInside(canonicalExpectedRoot, realCandidate)) {
    throw new Error(`${label} 实际位置必须位于 ${directory.split(path.sep).join('/')}/`);
  }
}

function validateMarkdownPath(root, relativePath, label, expectedDirectory) {
  const candidate = validateRelativePath(root, relativePath, label);
  if (expectedDirectory) validatePathPrefix(root, relativePath, expectedDirectory, label);
  const stat = fs.statSync(candidate);
  if (!stat.isFile()) throw new Error(`${label} 必须指向普通文件`);
  if (!MARKDOWN_EXTENSIONS.has(path.extname(candidate).toLowerCase())) {
    throw new Error(`${label} 必须指向 Markdown 文件`);
  }
  if (stat.size <= 0) throw new Error(`${label} 必须指向非空 Markdown 文件`);
  try {
    fs.accessSync(candidate, fs.constants.R_OK);
  } catch {
    throw new Error(`${label} 必须指向当前进程可读的 Markdown 文件`);
  }
  return candidate;
}

function validateRawArtifacts(root, rawArtifacts) {
  if (!Array.isArray(rawArtifacts)) throw new Error('rawArtifacts 必须是字符串数组');
  const validated = rawArtifacts.map((artifact, index) => {
    const label = `rawArtifacts[${index}]`;
    const candidate = validateRelativePath(root, artifact, label);
    validatePathPrefix(root, artifact, 'raw', label);
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) throw new Error(`${label} 必须指向普通文件`);
    if (stat.size <= 0) throw new Error(`${label} 必须指向非空文件`);
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
    } catch {
      throw new Error(`${label} 必须指向当前进程可读的文件`);
    }
    return artifact;
  });
  return [...new Set(validated)];
}

function fullTextEvidenceHash(paths, artifact) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(path.join(paths.root, artifact))).digest('hex')}`;
}

function validateFullTextEvidence(paths, session, evidence, { sourceSkill, sourceUrl, rawArtifacts }) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('公共来源 full-text 必须提供获准执行器生成的 fullTextEvidence');
  }
  if (evidence.schemaVersion !== '1.0') {
    throw new Error('fullTextEvidence.schemaVersion 必须是 1.0');
  }
  const executor = requireString(evidence.executor, 'fullTextEvidence.executor');
  if (executor !== sourceSkill) {
    throw new Error('fullTextEvidence.executor 必须与 sourceSkill 一致');
  }
  const artifact = requireString(evidence.artifact, 'fullTextEvidence.artifact');
  validateRawArtifacts(paths.root, [artifact]);
  if (!rawArtifacts.includes(artifact)) {
    throw new Error('fullTextEvidence.artifact 必须同时登记在 rawArtifacts 中');
  }
  const receipt = readJson(path.join(paths.root, artifact), 'fullTextEvidence.artifact');
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.schemaVersion !== '1.0'
    || receipt.executor !== executor
    || receipt.sourceUrl !== sourceUrl
    || receipt.complete !== true
    || receipt.contentGranularity !== 'full-text') {
    throw new Error('执行器全文证据必须确认相同来源、执行器和 full-text 完整性');
  }
  const artifactHash = fullTextEvidenceHash(paths, artifact);
  const registered = session.task?.fullTextEvidenceReceipts?.some((entry) => (
    entry?.schemaVersion === '1.0'
      && entry.executor === executor
      && entry.sourceUrl === sourceUrl
      && entry.artifact === artifact
      && entry.artifactHash === artifactHash
  ));
  if (!registered) {
    throw new Error('fullTextEvidence 未由专用 materializer 注册或登记后已被修改');
  }
  return { schemaVersion: '1.0', executor, artifact };
}

export function registerFullTextEvidenceReceipt(paths, evidence) {
  return withSessionLock(paths, 'register-full-text-evidence', () => {
    const { session } = sessionLoad(paths, { persistMigration: true });
    const executor = requireString(evidence?.executor, 'fullTextEvidence.executor');
    const sourceUrl = requireString(evidence?.sourceUrl, 'fullTextEvidence.sourceUrl');
    const artifact = requireString(evidence?.artifact, 'fullTextEvidence.artifact');
    validateRawArtifacts(paths.root, [artifact]);
    const receipt = readJson(path.join(paths.root, artifact), 'fullTextEvidence.artifact');
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || receipt.schemaVersion !== '1.0'
      || receipt.executor !== executor
      || receipt.sourceUrl !== sourceUrl
      || receipt.complete !== true
      || receipt.contentGranularity !== 'full-text') {
      throw new Error('专用 materializer 只能登记已确认完整的执行器全文回执');
    }
    const registration = {
      schemaVersion: '1.0',
      executor,
      sourceUrl,
      artifact,
      artifactHash: fullTextEvidenceHash(paths, artifact),
    };
    const previous = Array.isArray(session.task.fullTextEvidenceReceipts)
      ? session.task.fullTextEvidenceReceipts : [];
    session.task.fullTextEvidenceReceipts = [
      ...previous.filter((entry) => !(entry?.executor === executor
        && entry?.sourceUrl === sourceUrl && entry?.artifact === artifact)),
      registration,
    ];
    persistCollection(paths, session, session.collection);
    return registration;
  });
}

export function registerArxivAcquisitionVariant(paths, { sourceUrl, acquisitionUrl }) {
  return withSessionLock(paths, 'register-arxiv-acquisition', () => {
    const { session } = sessionLoad(paths, { persistMigration: true });
    const candidate = authorizeArxivVariant(
      session.task?.discoveryGate,
      requireString(sourceUrl, 'sourceUrl'),
      requireString(acquisitionUrl, 'acquisitionUrl'),
    );
    markDeliveryStale(session);
    persistCollection(paths, session, session.collection);
    return clone(candidate);
  });
}

function safeWorkCopy(paths, relativePath, directory, { requireExisting = false } = {}) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return false;
  if (!MARKDOWN_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) return false;
  try {
    validatePathPrefix(paths.root, relativePath, directory, 'workCopyPath');
    if (requireExisting) validateMarkdownPath(paths.root, relativePath, 'workCopyPath', directory);
    else validateRelativePath(paths.root, relativePath, 'workCopyPath', { allowMissing: true });
    return true;
  } catch {
    return false;
  }
}

function materializationFromCanonical(root, item) {
  const sanitizedPath = typeof item.fileName === 'string' ? item.fileName : null;
  const markdownPath = sanitizedPath
    ? path.posix.join('markdown', path.posix.basename(sanitizedPath))
    : null;
  try {
    validateMarkdownPath(root, sanitizedPath, 'legacy sanitizedPath', path.join('sanitized', 'items'));
    validateMarkdownPath(root, markdownPath, 'legacy markdownPath', 'markdown');
    return {
      status: 'materialized', markdownPath, sanitizedPath, pendingArtifactCleanup: [], reason: null,
      contentGranularity: 'unknown',
    };
  } catch {
    return {
      status: 'pending', markdownPath: null, sanitizedPath: null,
      pendingArtifactCleanup: [], reason: 'materialization-missing', contentGranularity: 'unknown',
    };
  }
}

function normalizeMetadata(root, rawMetadata, collectionResult) {
  const knownLegacy = new Set([
    'schemaVersion', 'storage', 'collection', 'sourceMetadata',
    'storageFallback', 'partial', 'audit_required', 'auditRequired', 'userRequested',
    'retention', 'postProcessing',
  ]);
  const unknownMetadata = sanitizeMetadataValue(Object.fromEntries(
    Object.entries(rawMetadata || {}).filter(([key]) => !knownLegacy.has(key)),
  ));
  const explicitSourceMetadata = sanitizeMetadataValue(rawMetadata?.sourceMetadata || {});
  const hasCurrentInventory = Array.isArray(rawMetadata?.collection?.items);
  const items = hasCurrentInventory
    ? clone(rawMetadata.collection.items)
    : (Array.isArray(collectionResult.items) ? collectionResult.items : []).map((item) => ({
      itemId: stableItemId(item),
      title: String(item.title || ''),
      sourceUrl: String(item.url || ''),
      sourceItemId: null,
      sourceSkill: String(collectionResult.backend || ''),
      backend: String(collectionResult.backend || ''),
      collectionFilters: collectionResult.filters && typeof collectionResult.filters === 'object'
        ? clone(collectionResult.filters) : {},
      rawArtifacts: [],
      materialization: materializationFromCanonical(root, item),
    }));
  const sourceMetadata = { ...unknownMetadata, ...explicitSourceMetadata };
  const metadata = {
    schemaVersion: METADATA_VERSION,
    storage: { fallback: Boolean(rawMetadata?.storage?.fallback ?? rawMetadata?.storageFallback) },
    collection: {
      status: rawMetadata?.collection?.status
        || (rawMetadata?.partial ? 'partial' : 'complete'),
      items,
    },
    ...(Object.keys(sourceMetadata).length ? { sourceMetadata } : {}),
  };
  const warnings = [];
  if (rawMetadata?.retention !== undefined || rawMetadata?.postProcessing !== undefined) {
    warnings.push('已忽略旧版下游状态字段');
  }
  normalizeDuplicateGroups(metadata);
  return { metadata, warnings };
}

function normalizeMaterializations(paths, metadata) {
  let recovered = false;
  const warnings = [];
  const invalidSanitizedPaths = new Set();
  for (const item of metadata.collection.items) {
    const materialization = item.materialization && typeof item.materialization === 'object'
      ? item.materialization : {};
    const pending = Array.isArray(materialization.pendingArtifactCleanup)
      ? materialization.pendingArtifactCleanup : [];
    materialization.pendingArtifactCleanup = [...new Set(pending.filter((relativePath) => (
      safeWorkCopy(paths, relativePath, 'markdown')
      || safeWorkCopy(paths, relativePath, path.join('sanitized', 'items'))
    )))];
    item.materialization = materialization;
    const previousGranularity = materialization.contentGranularity;
    materialization.contentGranularity = normalizeContentGranularity(previousGranularity);
    if (previousGranularity !== undefined && previousGranularity !== materialization.contentGranularity) {
      warnings.push(`inventory ${item.itemId || '<unknown>'} materialization.contentGranularity 无效，已降级为 unknown`);
      recovered = true;
    }
    const previousMedia = item.media;
    item.media = normalizeMediaState(previousMedia, { coverUrls: item.coverUrls });
    if (previousMedia !== undefined && JSON.stringify(previousMedia) !== JSON.stringify(item.media)) {
      warnings.push(`inventory ${item.itemId || '<unknown>'} media 无效，已降级为 unknown`);
      recovered = true;
    }

    const materialized = materialization.status === 'materialized';
    const markdownValid = materialized
      && safeWorkCopy(paths, materialization.markdownPath, 'markdown', { requireExisting: true });
    const sanitizedValid = materialized
      && safeWorkCopy(paths, materialization.sanitizedPath, path.join('sanitized', 'items'), { requireExisting: true });
    const emptyStateValid = ['pending', 'failed'].includes(materialization.status)
      && materialization.markdownPath === null
      && materialization.sanitizedPath === null;
    if ((materialized && markdownValid && sanitizedValid) || emptyStateValid) {
      materialization.reason ??= null;
      continue;
    }

    if (typeof materialization.sanitizedPath === 'string') {
      invalidSanitizedPaths.add(materialization.sanitizedPath);
    }
    materialization.status = 'pending';
    materialization.markdownPath = null;
    materialization.sanitizedPath = null;
    materialization.reason = 'materialization-invalid';
    materialization.contentGranularity = 'unknown';
    warnings.push(`inventory ${item.itemId || '<unknown>'} materialization 无效，已降级为 pending`);
    recovered = true;
  }
  return { recovered, warnings, invalidSanitizedPaths };
}

function normalizeFullTextEvidence(paths, session, metadata) {
  let recovered = false;
  const warnings = [];
  const publicScope = Array.isArray(session.task?.sourceScope)
    && session.task.sourceScope.includes('public-internet');
  for (const item of metadata.collection.items) {
    if (item.materialization.contentGranularity !== 'full-text') continue;
    const isPublicItem = typeof item.discoveryCandidateId === 'string'
      || (publicScope && /^https?:\/\//i.test(item.sourceUrl));
    if (!isPublicItem) continue;
    try {
      item.fullTextEvidence = validateFullTextEvidence(paths, session, item.fullTextEvidence, {
        sourceSkill: item.sourceSkill,
        sourceUrl: item.sourceUrl,
        rawArtifacts: item.rawArtifacts,
      });
    } catch (error) {
      item.materialization.contentGranularity = 'unknown';
      delete item.fullTextEvidence;
      warnings.push(`inventory ${item.itemId || '<unknown>'} fullTextEvidence 无效，已降级为 unknown: ${error.message}`);
      recovered = true;
    }
  }
  return { recovered, warnings };
}

function validateMetadata(metadata) {
  assertNoSensitiveMetadataKeys(metadata);
  const allowedTopLevel = new Set(['schemaVersion', 'storage', 'collection', 'sourceMetadata']);
  for (const key of Object.keys(metadata || {})) {
    if (!allowedTopLevel.has(key)) throw new Error(`sanitized/metadata.json 不支持字段: ${key}`);
  }
  if (metadata.schemaVersion !== METADATA_VERSION) {
    throw new Error(`sanitized/metadata.json schemaVersion 必须是 ${METADATA_VERSION}`);
  }
  if (typeof metadata?.storage?.fallback !== 'boolean') {
    throw new Error('sanitized/metadata.json storage.fallback 必须是布尔值');
  }
  if (!COLLECTION_STATUSES.has(metadata?.collection?.status)) {
    throw new Error(`sanitized/metadata.json collection.status 无效: ${metadata?.collection?.status}`);
  }
  if (!Array.isArray(metadata.collection.items)) {
    throw new Error('sanitized/metadata.json collection.items 必须是数组');
  }

  const itemIds = new Set();
  const identities = new Set();
  const workCopies = new Set();
  for (const item of metadata.collection.items) {
    const itemId = requireString(item.itemId, 'inventory itemId');
    if (itemIds.has(itemId)) throw new Error(`inventory itemId 重复: ${itemId}`);
    itemIds.add(itemId);
    const sourceSkill = requireString(item.sourceSkill, `inventory ${itemId} sourceSkill`);
    const sourceUrl = requireString(item.sourceUrl, `inventory ${itemId} sourceUrl`);
    const identity = articleIdentity({ sourceSkill, sourceUrl });
    if (identities.has(identity)) {
      throw new Error(`inventory sourceSkill + sourceUrl 重复: ${identity.replace('\n', ' / ')}`);
    }
    identities.add(identity);
    requireString(item.duplicateGroupKey, `inventory ${itemId} duplicateGroupKey`);
    if (item.duplicateOf !== null && typeof item.duplicateOf !== 'string') {
      throw new Error(`inventory ${itemId} duplicateOf 必须是 itemId 或 null`);
    }
    if (!MATERIALIZATION_STATUSES.has(item?.materialization?.status)) {
      throw new Error(`inventory ${itemId} materialization.status 无效`);
    }
    if (!CONTENT_GRANULARITIES.has(item.materialization.contentGranularity)) {
      throw new Error(`inventory ${itemId} materialization.contentGranularity 无效`);
    }
    if (!COVER_STATUSES.has(item?.media?.coverStatus)) {
      throw new Error(`inventory ${itemId} media.coverStatus 无效`);
    }
    normalizeMediaState(item.media, { strict: true });
    if (!Array.isArray(item.rawArtifacts)
      || item.rawArtifacts.some((artifact) => typeof artifact !== 'string')) {
      throw new Error(`inventory ${itemId} rawArtifacts 必须是字符串数组`);
    }
    if (!Array.isArray(item.materialization.pendingArtifactCleanup)
      || item.materialization.pendingArtifactCleanup.some((artifact) => typeof artifact !== 'string')) {
      throw new Error(`inventory ${itemId} materialization.pendingArtifactCleanup 必须是字符串数组`);
    }
    const hasPaths = typeof item.materialization.markdownPath === 'string'
      && typeof item.materialization.sanitizedPath === 'string';
    if ((item.materialization.status === 'materialized') !== hasPaths) {
      throw new Error(`inventory ${itemId} materialization 状态与路径不一致`);
    }
    if (hasPaths) {
      for (const workCopy of [item.materialization.markdownPath, item.materialization.sanitizedPath]) {
        if (workCopies.has(workCopy)) throw new Error(`inventory 工作副本路径重复: ${workCopy}`);
        workCopies.add(workCopy);
      }
    }
  }
}

function canonicalViewItem(item) {
  const keys = ['title', 'url', 'author', 'publishTime', 'markdown', 'fileName'];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(item || {}, key)).map((key) => [key, item[key]]));
}

function reconcileCanonicalView(collectionResult, metadata) {
  const existingByPath = new Map((collectionResult.items || [])
    .map((item) => [item.fileName, canonicalViewItem(item)]));
  const seenGroups = new Set();
  const items = [];
  for (const inventory of metadata.collection.items) {
    if (inventory.materialization.status !== 'materialized'
      || seenGroups.has(inventory.duplicateGroupKey)) continue;
    seenGroups.add(inventory.duplicateGroupKey);
    const sanitizedPath = inventory.materialization.sanitizedPath;
    items.push(existingByPath.get(sanitizedPath) || canonicalViewItem({
      title: inventory.title,
      url: inventory.sourceUrl,
      author: '',
      publishTime: '',
      markdown: sanitizedPath,
      fileName: sanitizedPath,
    }));
  }
  const changed = JSON.stringify(items) !== JSON.stringify(collectionResult.items || []);
  collectionResult.items = items;
  return changed;
}

function validateCanonicalView(root, collectionResult, metadata) {
  const materializedByPath = new Map(metadata.collection.items
    .filter((item) => item.materialization.status === 'materialized')
    .map((item) => [item.materialization.sanitizedPath, item]));
  const seenPaths = new Set();
  const seenGroups = new Set();
  for (const [index, item] of (collectionResult.items || []).entries()) {
    if (item.fileName !== item.markdown) {
      throw new Error(`collection-result.json items[${index}] markdown 与 fileName 不一致`);
    }
    if (seenPaths.has(item.fileName)) {
      throw new Error(`collection-result.json canonical view 路径重复: ${item.fileName}`);
    }
    seenPaths.add(item.fileName);
    const inventory = materializedByPath.get(item.fileName);
    if (!inventory || item.url !== inventory.sourceUrl) {
      throw new Error(`collection-result.json canonical view 未对应 materialized inventory: ${item.fileName}`);
    }
    if (seenGroups.has(inventory.duplicateGroupKey)) {
      throw new Error(`collection-result.json canonical view 重复组出现多次: ${item.fileName}`);
    }
    seenGroups.add(inventory.duplicateGroupKey);
    validateMarkdownPath(root, item.fileName, `collection-result.json items[${index}].fileName`, path.join('sanitized', 'items'));
  }
}

function emptyCollectionResult() {
  return { schemaVersion: '1.0', title: '', source: '', backend: '', url: '', filters: {}, items: [] };
}

function loadCollectionSession(paths, { persistRecovery = false, skipCanonicalValidation = false } = {}) {
  const { session, migrated } = sessionLoad(paths, { persistMigration: persistRecovery });
  const rawMetadata = session.collection;
  const collectionResult = fs.existsSync(paths.collectionResult)
    ? readJson(paths.collectionResult, 'collection-result.json') : emptyCollectionResult();
  collectionResult.items = Array.isArray(collectionResult.items)
    ? collectionResult.items.map(canonicalViewItem) : [];
  const normalized = normalizeMetadata(paths.root, rawMetadata, collectionResult);
  const metadata = normalized.metadata;
  const materializations = normalizeMaterializations(paths, metadata);
  const fullTextEvidence = normalizeFullTextEvidence(paths, session, metadata);
  if (materializations.invalidSanitizedPaths.size) {
    collectionResult.items = collectionResult.items
      .filter((item) => !materializations.invalidSanitizedPaths.has(item.fileName));
  }
  const collectionResultChanged = reconcileCanonicalView(collectionResult, metadata);
  validateMetadata(metadata);
  if (!skipCanonicalValidation) validateCanonicalView(paths.root, collectionResult, metadata);
  const metadataChanged = JSON.stringify(metadata) !== JSON.stringify(rawMetadata) || migrated;
  if (persistRecovery && metadataChanged) persistCollection(paths, session, metadata);
  if (persistRecovery && (collectionResultChanged || materializations.recovered || fullTextEvidence.recovered)) {
    atomicWriteJson(paths.collectionResult, collectionResult);
  }
  return {
    session,
    metadata,
    collectionResult,
    metadataChanged,
    collectionResultChanged,
    materializationRecovered: materializations.recovered,
    warnings: [...normalized.warnings, ...materializations.warnings, ...fullTextEvidence.warnings],
  };
}

function readPayload(paths, rawFilePath, label) {
  const filePath = resolveCollectionInputFile(paths, rawFilePath, label);
  const payload = readJson(filePath, label);
  if (payload?.schemaVersion !== METADATA_VERSION) {
    throw new Error(`${label} schemaVersion 必须是 ${METADATA_VERSION}`);
  }
  return { filePath, payload };
}

function deletePayloadInput(filePath) {
  try {
    fs.unlinkSync(filePath);
    return null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return `输入文件删除失败，已保留以便人工处理: ${error.message}`;
  }
}

function deleteInternalWorkCopy(paths, relativePath) {
  const inMarkdown = safeWorkCopy(paths, relativePath, 'markdown');
  const inSanitized = safeWorkCopy(paths, relativePath, path.join('sanitized', 'items'));
  if (!inMarkdown && !inSanitized) throw new Error(`拒绝删除非工作副本路径: ${relativePath}`);
  const absolute = validateRelativePath(paths.root, relativePath, '旧工作副本', { allowMissing: true });
  if (!fs.existsSync(absolute)) return;
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`旧工作副本不是普通文件: ${relativePath}`);
  fs.unlinkSync(absolute);
}

function drainPendingArtifactCleanup(paths, metadata) {
  let changed = false;
  const warnings = [];
  const currentWorkCopies = new Set(metadata.collection.items.flatMap((item) => [
    item.materialization?.markdownPath,
    item.materialization?.sanitizedPath,
  ]).filter(Boolean));
  for (const item of metadata.collection.items) {
    const materialization = item.materialization;
    const retained = [];
    for (const relativePath of materialization.pendingArtifactCleanup) {
      if (currentWorkCopies.has(relativePath)) {
        changed = true;
        continue;
      }
      try {
        deleteInternalWorkCopy(paths, relativePath);
        changed = true;
      } catch (error) {
        retained.push(relativePath);
        warnings.push(`inventory ${item.itemId} 旧工作副本待续清: ${error.message}`);
      }
    }
    materialization.pendingArtifactCleanup = retained;
  }
  return { changed, warnings };
}

function validateCanonicalItem(item, sanitizedPath) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('canonicalItem 必须是对象');
  }
  for (const key of ['title', 'url', 'markdown', 'fileName']) requireString(item[key], `canonicalItem.${key}`);
  for (const key of ['author', 'publishTime']) {
    if (typeof item[key] !== 'string') throw new Error(`canonicalItem.${key} 必须是字符串`);
  }
  if (item.markdown !== sanitizedPath || item.fileName !== sanitizedPath) {
    throw new Error('canonicalItem.markdown 与 fileName 必须等于 sanitizedPath');
  }
}

function markOneMaterialized(paths, session, metadata, collectionResult, update) {
  const itemId = requireString(update.itemId, 'itemId');
  const rawArtifacts = update.rawArtifacts === undefined
    ? undefined : validateRawArtifacts(paths.root, update.rawArtifacts);
  let inventory = metadata.collection.items.find((item) => item.itemId === itemId);
  if (!inventory) {
    const canonical = update.canonicalItem && typeof update.canonicalItem === 'object'
      ? update.canonicalItem : {};
    const sourceUrl = requireString(canonical.url, 'canonicalItem.url');
    const source = requireString(update.source || collectionResult.source, 'source');
    const backend = requireString(update.backend || collectionResult.backend, 'backend');
    const sourceSkill = requireString(update.sourceSkill || backend, 'sourceSkill');
    const allowedSources = Array.isArray(session.task?.sourceScope) ? session.task.sourceScope : [];
    if (!allowedSources.includes(SOURCE_SCOPE_ALIAS[source] || source)) {
      throw new Error(`sourceScope 不允许来源 ${source}`);
    }
    const discoveryCandidate = discoveryCandidateFor(session, source, sourceUrl);
    if (!collectionResult.source) collectionResult.source = source;
    else if (collectionResult.source !== source) collectionResult.source = 'multi-source';
    if (!collectionResult.backend) collectionResult.backend = backend;
    else if (collectionResult.backend !== backend) collectionResult.backend = 'multi-backend';
    if (!collectionResult.title) collectionResult.title = session.task?.query || 'Collection';
    if (!collectionResult.url) collectionResult.url = sourceUrl;
    inventory = {
      itemId,
      title: String(canonical.title || ''),
      sourceUrl,
      sourceItemId: null,
      sourceSkill,
      backend,
      ...(discoveryCandidate?.authorizationKind === 'public-discover'
        ? { discoveryCandidateId: discoveryCandidate.candidateId } : {}),
      ...(discoveryCandidate ? { provenanceKind: discoveryCandidate.authorizationKind } : {}),
      collectionFilters: collectionResult.filters && typeof collectionResult.filters === 'object'
        ? clone(collectionResult.filters) : {},
      rawArtifacts: rawArtifacts ?? [],
      media: normalizeMediaState(undefined),
      materialization: {
        status: 'pending', markdownPath: null, sanitizedPath: null,
        pendingArtifactCleanup: [], reason: null, contentGranularity: 'unknown',
      },
    };
    metadata.collection.items.push(inventory);
  }

  const effectiveSource = update.source || collectionResult.source;
  const discoveryCandidate = effectiveSource
    ? discoveryCandidateFor(session, effectiveSource, inventory.sourceUrl)
    : null;
  if (discoveryCandidate?.authorizationKind === 'public-discover') {
    inventory.discoveryCandidateId = discoveryCandidate.candidateId;
  }
  if (discoveryCandidate) inventory.provenanceKind = discoveryCandidate.authorizationKind;

  const markdownPath = requireString(update.markdownPath, 'markdownPath');
  const sanitizedPath = requireString(update.sanitizedPath, 'sanitizedPath');
  validateMarkdownPath(paths.root, markdownPath, 'markdownPath', 'markdown');
  const sanitizedAbsolute = validateMarkdownPath(
    paths.root, sanitizedPath, 'sanitizedPath', path.join('sanitized', 'items'),
  );
  validateCanonicalItem(update.canonicalItem, sanitizedPath);
  if (update.canonicalItem.url !== inventory.sourceUrl) {
    throw new Error('canonicalItem.url 必须与 inventory.sourceUrl 一致');
  }
  const materializedTopicRelevance = assertMaterializedTopic(
    session, discoveryCandidate, update.canonicalItem, sanitizedAbsolute,
  );

  const previous = inventory.materialization || {};
  const oldPaths = [previous.markdownPath, previous.sanitizedPath]
    .filter((value) => typeof value === 'string'
      && value !== markdownPath && value !== sanitizedPath);
  inventory.title = update.canonicalItem.title;
  if (rawArtifacts !== undefined) inventory.rawArtifacts = rawArtifacts;
  const contentGranularity = normalizeContentGranularity(update.contentGranularity, { strict: true });
  const isPublicItem = effectiveSource === 'public-internet'
    || typeof inventory.discoveryCandidateId === 'string';
  if (isPublicItem && contentGranularity === 'full-text') {
    inventory.fullTextEvidence = validateFullTextEvidence(
      paths,
      session,
      update.fullTextEvidence ?? inventory.fullTextEvidence,
      {
        sourceSkill: inventory.sourceSkill,
        sourceUrl: inventory.sourceUrl,
        rawArtifacts: inventory.rawArtifacts,
      },
    );
  } else {
    delete inventory.fullTextEvidence;
  }
  inventory.materialization = {
    status: 'materialized',
    markdownPath,
    sanitizedPath,
    pendingArtifactCleanup: [...new Set([
      ...(Array.isArray(previous.pendingArtifactCleanup) ? previous.pendingArtifactCleanup : []),
      ...oldPaths,
    ])],
    reason: null,
    contentGranularity,
  };
  if (materializedTopicRelevance) inventory.materializedTopicRelevance = materializedTopicRelevance;
  else delete inventory.materializedTopicRelevance;
  inventory.media = update.media === undefined
    ? normalizeMediaState(inventory.media, { strict: true, coverUrls: inventory.coverUrls })
    : normalizeMediaState(update.media, { strict: true, coverUrls: inventory.coverUrls });
  const persistedCanonicalItem = canonicalViewItem(update.canonicalItem);
  const canonicalIndex = collectionResult.items.findIndex((item) => item.fileName === sanitizedPath);
  if (canonicalIndex >= 0) collectionResult.items[canonicalIndex] = persistedCanonicalItem;
  else collectionResult.items.push(persistedCanonicalItem);
  normalizeDuplicateGroups(metadata);
  reconcileCanonicalView(collectionResult, metadata);
  return { itemId, materialization: inventory.materialization, canonicalItem: canonicalViewItem(update.canonicalItem) };
}

function recordUnmaterializedCollectionItem(paths, update, targetStatus) {
  const action = targetStatus === 'failed' ? 'record-failed' : 'record-pending';
  return withSessionLock(paths, action, () => {
    const loaded = loadCollectionSession(paths, { skipCanonicalValidation: true });
    if (loaded.materializationRecovered) {
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    const itemId = requireString(update?.itemId, 'itemId');
    const source = requireString(update?.source, 'source');
    const sourceSkill = requireString(update?.sourceSkill, 'sourceSkill');
    const backend = requireString(update?.backend, 'backend');
    const sourceUrl = requireString(update?.sourceUrl, 'sourceUrl');
    const reason = requireString(update?.reason, 'reason');
    const title = typeof update?.title === 'string' ? update.title : '';
    const rawArtifacts = validateRawArtifacts(paths.root, update?.rawArtifacts || []);
    const allowedSources = Array.isArray(loaded.session.task?.sourceScope)
      ? loaded.session.task.sourceScope : [];
    if (!allowedSources.includes(SOURCE_SCOPE_ALIAS[source] || source)) {
      throw new Error(`sourceScope 不允许来源 ${source}`);
    }
    const discoveryCandidate = discoveryCandidateFor(loaded.session, source, sourceUrl);

    const duplicateIdentity = loaded.metadata.collection.items.find((item) =>
      item.itemId !== itemId && articleIdentity(item) === articleIdentity({ sourceSkill, sourceUrl }));
    if (duplicateIdentity) {
      throw new Error(`inventory sourceSkill + sourceUrl 已由 ${duplicateIdentity.itemId} 登记`);
    }

    let inventory = loaded.metadata.collection.items.find((item) => item.itemId === itemId);
    if (inventory?.materialization?.status === 'materialized') {
      return {
        ok: true,
        action,
        preservedMaterialized: true,
        itemId,
        materialization: clone(inventory.materialization),
      };
    }
    if (inventory && articleIdentity(inventory) !== articleIdentity({ sourceSkill, sourceUrl })) {
      throw new Error(`inventory ${itemId} 的 sourceSkill + sourceUrl 不允许变更`);
    }

    if (!inventory) {
      inventory = {
        itemId,
        title,
        sourceUrl,
        sourceItemId: null,
        sourceSkill,
        backend,
        ...(discoveryCandidate?.authorizationKind === 'public-discover'
          ? { discoveryCandidateId: discoveryCandidate.candidateId } : {}),
        ...(discoveryCandidate ? { provenanceKind: discoveryCandidate.authorizationKind } : {}),
        collectionFilters: loaded.collectionResult.filters
          && typeof loaded.collectionResult.filters === 'object'
          ? clone(loaded.collectionResult.filters) : {},
        rawArtifacts,
        media: normalizeMediaState(update.media, { strict: true }),
        materialization: {
          status: targetStatus,
          markdownPath: null,
          sanitizedPath: null,
          pendingArtifactCleanup: [],
          reason,
          contentGranularity: 'unknown',
        },
      };
      loaded.metadata.collection.items.push(inventory);
    } else {
      inventory.title = title || inventory.title;
      inventory.backend = backend;
      inventory.rawArtifacts = rawArtifacts;
      inventory.media = update.media === undefined
        ? normalizeMediaState(inventory.media, { strict: true })
        : normalizeMediaState(update.media, { strict: true });
      inventory.materialization = {
        status: targetStatus,
        markdownPath: null,
        sanitizedPath: null,
        pendingArtifactCleanup: Array.isArray(inventory.materialization?.pendingArtifactCleanup)
          ? inventory.materialization.pendingArtifactCleanup : [],
        reason,
        contentGranularity: 'unknown',
      };
    }

    const materializationStatuses = loaded.metadata.collection.items
      .map((item) => item.materialization?.status);
    loaded.metadata.collection.status = materializationStatuses.length > 0
      && materializationStatuses.every((status) => status === 'failed')
      ? 'failed' : 'partial';
    if (!loaded.collectionResult.source) loaded.collectionResult.source = source;
    else if (loaded.collectionResult.source !== source) loaded.collectionResult.source = 'multi-source';
    if (!loaded.collectionResult.backend) loaded.collectionResult.backend = backend;
    else if (loaded.collectionResult.backend !== backend) loaded.collectionResult.backend = 'multi-backend';
    if (!loaded.collectionResult.title) {
      loaded.collectionResult.title = loaded.session.task?.query || 'Collection';
    }
    if (!loaded.collectionResult.url) loaded.collectionResult.url = sourceUrl;
    normalizeDuplicateGroups(loaded.metadata);
    reconcileCanonicalView(loaded.collectionResult, loaded.metadata);
    validateMetadata(loaded.metadata);
    validateCanonicalView(paths.root, loaded.collectionResult, loaded.metadata);
    markDeliveryStale(loaded.session);
    persistCollection(paths, loaded.session, loaded.metadata);
    atomicWriteJson(paths.collectionResult, loaded.collectionResult);
    return {
      ok: true,
      action,
      preservedMaterialized: false,
      itemId,
      materialization: clone(inventory.materialization),
    };
  });
}

function reconcileCollectionStatus(metadata) {
  const statuses = metadata.collection.items.map((item) => item.materialization?.status);
  if (statuses.length === 0) return;
  if (statuses.every((status) => status === 'materialized')) {
    metadata.collection.status = 'complete';
  } else if (statuses.every((status) => status === 'failed')) {
    metadata.collection.status = 'failed';
  } else {
    metadata.collection.status = 'partial';
  }
}

export function recordPendingCollectionItem(paths, update) {
  return recordUnmaterializedCollectionItem(paths, update, 'pending');
}

export function recordFailedCollectionItem(paths, update) {
  return recordUnmaterializedCollectionItem(paths, update, 'failed');
}

export function cmdCollect(paths, args) {
  const { filePath, payload } = readPayload(paths, args['item-json-file'], '--item-json-file');
  const items = Array.isArray(payload.items) ? payload.items : [payload];
  if (!items.length) throw new Error('--item-json-file 未提供任何条目');
  return withSessionLock(paths, 'collect', () => {
    const loaded = loadCollectionSession(paths, { skipCanonicalValidation: true });
    if (loaded.materializationRecovered) {
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    const results = items.map((item) => markOneMaterialized(
      paths, loaded.session, loaded.metadata, loaded.collectionResult, item,
    ));
    reconcileCollectionStatus(loaded.metadata);
    validateMetadata(loaded.metadata);
    validateCanonicalView(paths.root, loaded.collectionResult, loaded.metadata);
    const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
    if (dryRun) return { ok: true, action: 'collect', dryRun: true, items: results };
    markDeliveryStale(loaded.session);
    persistCollection(paths, loaded.session, loaded.metadata);
    atomicWriteJson(paths.collectionResult, loaded.collectionResult);
    const drained = drainPendingArtifactCleanup(paths, loaded.metadata);
    if (drained.changed) persistCollection(paths, loaded.session, loaded.metadata);
    const deleteWarning = deletePayloadInput(filePath);
    return {
      ok: true,
      action: 'collect',
      items: results,
      warnings: [...drained.warnings, ...(deleteWarning ? [deleteWarning] : [])],
    };
  });
}

/**
 * Atomically promotes a verified public probe into the collection inventory and
 * completes its orchestration attempt. Probe artifacts must already have been
 * written; this transaction is the sole point where they become deliverable.
 */
export function promoteProbeMaterialization(paths, promotion) {
  return withSessionLock(paths, 'public-collect-promote', () => {
    const loaded = loadCollectionSession(paths, { skipCanonicalValidation: true });
    if (loaded.materializationRecovered) {
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    const runId = requireString(promotion?.runId, 'runId');
    const attemptId = requireString(promotion?.attemptId, 'attemptId');
    const promotionId = requireString(promotion?.promotionId, 'promotionId');
    const contentFingerprint = requireString(promotion?.contentFingerprint, 'contentFingerprint');
    const run = loaded.session.task?.publicCollectRun;
    if (!run || run.runId !== runId
      || loaded.session.task.activeOrchestrationRunId !== runId
      || loaded.session.task.orchestrationEpoch !== run.orchestrationEpoch) {
      throw new Error(`ORCHESTRATION_OWNER_MISMATCH: ${runId}`);
    }
    const attempt = run.attempts?.find((entry) => entry.attemptId === attemptId);
    if (!attempt || attempt.attemptState !== 'acquiring') {
      throw new Error(`PROBE_ATTEMPT_NOT_ACTIVE: ${attemptId}`);
    }
    if (loaded.metadata.collection.items.some((item) => item.promotionId === promotionId)) {
      return { promotionStatus: 'promoted', promotionId, itemId: promotion.item.itemId };
    }

    const evidence = promotion.item?.fullTextEvidence;
    const artifact = requireString(evidence?.artifact, 'fullTextEvidence.artifact');
    const executor = requireString(evidence?.executor, 'fullTextEvidence.executor');
    const sourceUrl = requireString(promotion.item?.canonicalItem?.url, 'canonicalItem.url');
    validateRawArtifacts(paths.root, [artifact]);
    const receipt = readJson(path.join(paths.root, artifact), 'fullTextEvidence.artifact');
    if (receipt?.schemaVersion !== '1.0' || receipt.executor !== executor
      || receipt.sourceUrl !== sourceUrl || receipt.complete !== true
      || receipt.contentGranularity !== 'full-text') {
      throw new Error('专用 materializer 只能登记已确认完整的执行器全文回执');
    }
    const registration = {
      schemaVersion: '1.0', executor, sourceUrl, artifact,
      artifactHash: fullTextEvidenceHash(paths, artifact),
    };
    const registrations = Array.isArray(loaded.session.task.fullTextEvidenceReceipts)
      ? loaded.session.task.fullTextEvidenceReceipts : [];
    loaded.session.task.fullTextEvidenceReceipts = [
      ...registrations.filter((entry) => !(entry?.executor === executor
        && entry?.sourceUrl === sourceUrl && entry?.artifact === artifact)),
      registration,
    ];

    const materialized = markOneMaterialized(
      paths, loaded.session, loaded.metadata, loaded.collectionResult, promotion.item,
    );
    const inventory = loaded.metadata.collection.items.find(
      (entry) => entry.itemId === materialized.itemId,
    );
    Object.assign(inventory, {
      probeRunId: runId,
      probeAttemptId: attemptId,
      probeCandidateId: attempt.candidateId,
      promotionId,
      contentFingerprint,
      duplicateGroup: promotion.duplicateGroup || contentFingerprint,
      pageVerification: clone(promotion.pageVerification),
      verifiedTopicStatus: promotion.verifiedTopicStatus,
      verificationReceipt: clone(promotion.verificationReceipt),
    });
    Object.assign(attempt, {
      attemptState: 'terminal',
      acquisitionOutcome: 'saved',
      pageVerification: 'verified-article',
      verifiedTopicStatus: promotion.verifiedTopicStatus,
      promotionStatus: 'promoted',
      reasonCode: 'PROMOTED',
      promotionId,
      itemId: materialized.itemId,
      contentFingerprint,
      finishedAt: new Date().toISOString(),
    });
    run.ownedSessionCleanupPending = (run.ownedSessionCleanupPending || [])
      .filter((entry) => entry?.attemptId !== attemptId);
    run.cursor += 1;
    run.pause = null;
    run.status = 'running';
    run.deliverableItemIds = [...new Set([...(run.deliverableItemIds || []), materialized.itemId])];
    run.duplicateGroups = [...new Set([...(run.duplicateGroups || []), promotion.duplicateGroup || contentFingerprint])];
    run.stateRevision += 1;
    run.updatedAt = new Date().toISOString();
    loaded.session.task.stateRevision = run.stateRevision;

    reconcileCollectionStatus(loaded.metadata);
    validateMetadata(loaded.metadata);
    validateCanonicalView(paths.root, loaded.collectionResult, loaded.metadata);
    markDeliveryStale(loaded.session);
    persistCollection(paths, loaded.session, loaded.metadata);
    atomicWriteJson(paths.collectionResult, loaded.collectionResult);
    return {
      attemptState: 'terminal',
      acquisitionOutcome: 'saved',
      pageVerification: 'verified-article',
      verifiedTopicStatus: promotion.verifiedTopicStatus,
      promotionStatus: 'promoted',
      reasonCode: 'PROMOTED',
      promotionId,
      itemId: materialized.itemId,
    };
  });
}

function contentGranularityCounts(items) {
  const counts = { 'full-text': 0, excerpt: 0, abstract: 0, unknown: 0 };
  for (const item of items) {
    if (item.materialization.status === 'materialized') {
      counts[item.materialization.contentGranularity] += 1;
    }
  }
  return counts;
}

function mediaCoverCounts(items) {
  const counts = { notPresent: 0, materialized: 0, unavailable: 0, unknown: 0 };
  const keys = {
    'not-present': 'notPresent', materialized: 'materialized', unavailable: 'unavailable', unknown: 'unknown',
  };
  for (const item of items) counts[keys[item.media.coverStatus]] += 1;
  return counts;
}

function metadataSummary(metadata) {
  const items = metadata.collection.items;
  const count = (status) => items.filter((item) => item.materialization.status === status).length;
  const groups = new Set(items.map((item) => item.duplicateGroupKey));
  return {
    schemaVersion: metadata.schemaVersion,
    collectionStatus: metadata.collection.status,
    items: items.length,
    materialized: count('materialized'),
    pending: count('pending'),
    failed: count('failed'),
    contentGranularity: contentGranularityCounts(items),
    mediaCovers: mediaCoverCounts(items),
    uniqueContentGroups: groups.size,
    duplicates: items.length - groups.size,
  };
}

function inspect(paths, args) {
  const loaded = loadCollectionSession(paths, { persistRecovery: false });
  const relevance = evaluateStoredTopicRelevance(
    paths, loaded.session, loaded.metadata, loaded.collectionResult,
  );
  const full = args.full === true || args.full === 'true';
  return {
    ok: true,
    action: 'inspect',
    summary: metadataSummary(loaded.metadata),
    warnings: [...new Set([...loaded.warnings, ...relevance.warnings])],
    ...(full ? { metadata: loaded.metadata, collectionResult: loaded.collectionResult } : {}),
  };
}

export function cmdExportViews(paths) {
  return withSessionLock(paths, 'export-views', () => {
    const loaded = loadCollectionSession(paths, { persistRecovery: true });
    const relevance = evaluateStoredTopicRelevance(
      paths, loaded.session, loaded.metadata, loaded.collectionResult,
    );
    atomicWriteJson(paths.metadata, loaded.metadata);
    atomicWriteJson(paths.collectionResult, loaded.collectionResult);
    return {
      ok: true,
      action: 'export-views',
      metadata: loaded.metadata,
      collectionResult: loaded.collectionResult,
      warnings: [...new Set([...loaded.warnings, ...relevance.warnings])],
    };
  });
}

export function buildDownstreamInput(paths, collectionResult) {
  const rawDirectory = path.resolve(paths.root, 'sanitized', 'items');
  const directory = path.resolve(fs.realpathSync(paths.root), 'sanitized', 'items');
  if (!fs.existsSync(rawDirectory)
    || fs.lstatSync(rawDirectory).isSymbolicLink()
    || !fs.lstatSync(rawDirectory).isDirectory()
    || fs.realpathSync(rawDirectory) !== directory) {
    throw new Error('downstreamInput.directory 必须是会话内的普通 sanitized/items 目录');
  }
  const files = [];
  for (const [index, item] of (collectionResult.items || []).entries()) {
    const relativePath = requireString(item.fileName, `collection-result.json items[${index}].fileName`);
    const absolutePath = validateMarkdownPath(
      paths.root, relativePath, `collection-result.json items[${index}].fileName`, path.join('sanitized', 'items'),
    );
    files.push(absolutePath);
  }
  return { schemaVersion: '1.0', directory, files };
}

function evaluateStoredTopicRelevance(paths, session, metadata, collectionResult) {
  const warnings = [];
  const gate = session.task?.discoveryGate;
  const publicItems = metadata.collection.items.filter((item) => [
    'public-discover', 'user-provided', 'crawl-frontier',
  ].includes(item.provenanceKind) || typeof item.discoveryCandidateId === 'string');
  if (!publicItems.length) return { valid: true, warnings };
  if (gate?.schemaVersion === '1.0' || !gate) {
    warnings.push('旧公共发现会话未包含主题相关性授权；状态保持只读，请新建内部 run 后再继续写入或首次发布');
    return { valid: true, warnings, legacy: true };
  }
  if (!['1.1', '2.0'].includes(gate.schemaVersion)) {
    return { valid: false, warnings: ['公共发现主题相关性授权状态无效'] };
  }
  const discoveredItems = publicItems.filter((item) => item.provenanceKind === 'public-discover'
    || (typeof item.discoveryCandidateId === 'string'
      && !['user-provided', 'crawl-frontier'].includes(item.provenanceKind)));
  const canonicalByPath = new Map(collectionResult.items.map((item) => [item.fileName, item]));
  let valid = true;
  for (const item of discoveredItems) {
    let candidate;
    try {
      candidate = authorizePublicSource(gate, item.sourceUrl);
    } catch (error) {
      valid = false;
      warnings.push(`inventory ${item.itemId} 发现主题授权失效: ${error.message}`);
      continue;
    }
    if (candidate?.candidateId !== item.discoveryCandidateId) {
      valid = false;
      warnings.push(`inventory ${item.itemId} discoveryCandidateId 与授权候选不一致`);
      continue;
    }
    if (item.materialization?.status !== 'materialized') continue;
    try {
      const sanitizedPath = item.materialization.sanitizedPath;
      const absolute = validateMarkdownPath(
        paths.root, sanitizedPath, `inventory ${item.itemId} sanitizedPath`, path.join('sanitized', 'items'),
      );
      const canonical = canonicalByPath.get(sanitizedPath);
      const assessment = assessMaterializedTopic(gate.topicContract, {
        title: canonical?.title || item.title || '',
        markdown: fs.readFileSync(absolute, 'utf8'),
      });
      if (!['matched', 'not-required'].includes(assessment.status)) {
        valid = false;
        warnings.push(`inventory ${item.itemId} 实际正文主题相关性失效（${assessment.status}）`);
      }
    } catch (error) {
      valid = false;
      warnings.push(`inventory ${item.itemId} 主题相关性复验失败: ${error.message}`);
    }
  }
  return { valid, warnings };
}

function promotionContentFingerprint(markdown) {
  const normalized = String(markdown || '')
    .replace(/^---\n[\s\S]*?\n---\n/u, '')
    .replace(/^#{1,6}\s+.*$/gmu, '')
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gmu, '')
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
  return `sha256:${crypto.createHash('sha256').update(normalized).digest('hex')}`;
}

function validatePromotionEvidence(paths, session) {
  const eligible = summarizePromotedDelivery(session);
  const inventory = new Map(session.collection.collection.items.map((item) => [item.itemId, item]));
  const validItemIds = [];
  const warnings = [];
  for (const itemId of eligible.deliverableItemIds) {
    const item = inventory.get(itemId);
    try {
      const receiptPath = requireString(item?.verificationReceipt, `inventory ${itemId} verificationReceipt`);
      const absolute = validateRelativePath(paths.root, receiptPath, `inventory ${itemId} verificationReceipt`);
      validatePathPrefix(paths.root, receiptPath, 'raw', `inventory ${itemId} verificationReceipt`);
      if (!item.rawArtifacts?.includes(receiptPath)) {
        throw new Error('verificationReceipt 必须登记在 rawArtifacts 中');
      }
      const sanitizedPath = requireString(
        item?.materialization?.sanitizedPath,
        `inventory ${itemId} sanitizedPath`,
      );
      const sanitizedAbsolute = validateMarkdownPath(
        paths.root, sanitizedPath, `inventory ${itemId} sanitizedPath`, 'sanitized',
      );
      const sanitizedMarkdown = fs.readFileSync(sanitizedAbsolute, 'utf8');
      const receipt = readJson(absolute, `inventory ${itemId} verificationReceipt`);
      if (receipt?.schemaVersion !== '1.0'
        || receipt.runId !== item.probeRunId
        || receipt.attemptId !== item.probeAttemptId
        || receipt.candidateId !== item.probeCandidateId
        || receipt.contentFingerprint !== item.contentFingerprint
        || receipt.pageVerification !== 'verified-article'
        || receipt.verifiedTopicStatus !== item.verifiedTopicStatus) {
        throw new Error('verificationReceipt 与晋升 inventory 不匹配');
      }
      const sanitizedHash = `sha256:${crypto.createHash('sha256').update(sanitizedMarkdown).digest('hex')}`;
      if (receipt.artifacts?.sanitized?.path !== sanitizedPath
        || receipt.artifacts.sanitized.sha256 !== sanitizedHash
        || promotionContentFingerprint(sanitizedMarkdown) !== item.contentFingerprint) {
        throw new Error('sanitized 正文哈希或内容指纹与晋升回执不匹配');
      }
      const topic = assessMaterializedTopic(session.task.discoveryGate.topicContract, {
        title: receipt.analysis?.title || item.canonicalItem?.title || '',
        markdown: sanitizedMarkdown,
      });
      if (!['matched', 'not-required'].includes(topic.status)
        || topic.status !== item.verifiedTopicStatus) {
        throw new Error(`sanitized 正文主题复验失败: ${topic.status}`);
      }
      validItemIds.push(itemId);
    } catch (error) {
      warnings.push(`inventory ${itemId} 正文验证回执失效: ${error.message}`);
    }
  }
  return {
    requestedItemCount: eligible.requestedItemCount,
    deliverableArticleCount: validItemIds.length,
    remainingCount: Math.max(0, eligible.requestedItemCount - validItemIds.length),
    validItemIds,
    warnings,
  };
}

export function finalizeVerifiedProbeRun(paths, runId, desiredStatus, detail = {}) {
  if (!['complete', 'partial', 'failed'].includes(desiredStatus)) {
    throw new Error(`ORCHESTRATION_TERMINAL_STATUS_INVALID: ${desiredStatus}`);
  }
  return withSessionLock(paths, 'public-collect-finalize-verified', () => {
    const { session, metadata } = loadCollectionSession(paths, { persistRecovery: false });
    session.collection = metadata;
    const run = session.task?.publicCollectRun;
    if (!run || run.runId !== runId || session.task.activeOrchestrationRunId !== runId
      || session.task.orchestrationEpoch !== run.orchestrationEpoch) {
      throw new Error(`ORCHESTRATION_OWNER_MISMATCH: ${runId}`);
    }
    if ((run.ownedSessionCleanupPending || []).length > 0) {
      throw new Error('ORCHESTRATION_CLEANUP_PENDING: 仍有命令自有 session/TAB 未清理');
    }
    const evidence = validatePromotionEvidence(paths, session);
    const status = evidence.remainingCount === 0
      ? 'complete' : (evidence.deliverableArticleCount > 0 ? 'partial' : 'failed');
    if (status !== desiredStatus) {
      throw new Error(`ORCHESTRATION_FINAL_RECONCILIATION_CONFLICT: expected=${desiredStatus} actual=${status}`);
    }
    run.deliverableItemIds = evidence.validItemIds;
    run.status = status;
    run.finishedAt = new Date().toISOString();
    run.updatedAt = run.finishedAt;
    run.stateRevision += 1;
    session.task.stateRevision = run.stateRevision;
    run.terminalReason = String(detail.reasonCode
      || (status === 'complete' ? 'REQUESTED_COUNT_REACHED' : 'CANDIDATES_EXHAUSTED'));
    run.pause = null;
    run.actionLease = null;
    delete session.task.activeOrchestrationRunId;
    delete session.task.orchestrationEpoch;
    persistCollection(paths, session, metadata);
    return JSON.parse(JSON.stringify(run));
  });
}

export function collectionStatus(paths) {
  const loaded = loadCollectionSession(paths, { persistRecovery: false });
  const { session, metadata, collectionResult } = loaded;
  // All derived completion checks must use the read-time revalidated view. Do
  // not persist it from this read-only command, but never consult stale raw
  // materialization state after normalization has detected artifact damage.
  session.collection = metadata;
  const items = metadata.collection.items;
  const count = (status) => items.filter((item) => item.materialization.status === status).length;
  const pending = count('pending');
  const failed = count('failed');
  const groups = new Set(items.map((item) => item.duplicateGroupKey));
  const materializationTarget = session.task?.materializationTarget || 'selected';
  const requiredContentGranularity = session.task?.requiredContentGranularity || 'any';
  const unmetRequiredGranularity = requiredContentGranularity === 'full-text'
    ? items.filter((item) => item.materialization.status === 'materialized'
      && item.materialization.contentGranularity !== 'full-text').length
    : 0;
  const relevance = evaluateStoredTopicRelevance(paths, session, metadata, collectionResult);
  const promotionEvidence = validatePromotionEvidence(paths, session);
  const baseProbeSummary = summarizeProbeRun(session);
  const probeSummary = baseProbeSummary ? {
    ...baseProbeSummary,
    deliverableArticleCount: promotionEvidence.deliverableArticleCount,
    remainingCount: promotionEvidence.remainingCount,
    effectiveStatus: promotionEvidence.warnings.length > 0
      ? 'invalidated' : baseProbeSummary.effectiveStatus,
  } : null;
  return {
    collectionStatus: metadata.collection.status,
    items: items.length,
    sourceRecords: items.length,
    materialized: count('materialized'),
    pending,
    failed,
    contentGranularity: contentGranularityCounts(items),
    mediaCovers: mediaCoverCounts(items),
    uniqueContentGroups: groups.size,
    duplicates: items.length - groups.size,
    materializationTarget,
    requiredContentGranularity,
    unmetRequiredGranularity,
    deliveryComplete: deliveryCompleteForSession(session) && relevance.valid
      && promotionEvidence.remainingCount === 0,
    publicCollectRun: probeSummary,
    crawl: summarizeCrawlDelivery(session),
    canonicalItems: collectionResult.items.length,
    ...(relevance.valid ? { downstreamInput: buildDownstreamInput(paths, collectionResult) } : {}),
    warnings: [...new Set([
      ...loaded.warnings, ...relevance.warnings, ...promotionEvidence.warnings,
    ])],
  };
}

function unlockStale(paths) {
  const lock = readLock(paths);
  if (!lock) return { ok: true, action: 'unlock-stale', removed: false, previousLock: null };
  if (isProcessAlive(lock.pid, lock.processStartTime)) {
    throw new Error(`当前采集会话锁持有进程仍存活: pid=${lock.pid}, command=${lock.command}`);
  }
  const current = readLock(paths);
  if (JSON.stringify(current) !== JSON.stringify(lock)) {
    throw new Error('锁状态在回收期间发生变化，请稍后重试');
  }
  fs.unlinkSync(paths.lock);
  return { ok: true, action: 'unlock-stale', removed: true, previousLock: lock };
}

export const cmdInspect = inspect;
export const cmdUnlockStale = unlockStale;

export function collectionHelp() {
  return {
    commands: {
      collect: '登记来源执行器返回的正文并更新 inventory',
      inspect: '只读检查采集状态',
      'unlock-stale': '仅在锁持有 PID 已不存在时安全回收残留锁',
      'export-views': '从 session.json 生成兼容导出视图',
    },
  };
}
