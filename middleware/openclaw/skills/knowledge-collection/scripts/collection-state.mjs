#!/usr/bin/env node

/**
 * collection-state.mjs — 采集物化与后处理状态机(原 knowledge-collection-post-processing.mjs)。
 *
 * 状态持久化已迁移到一体化单文件 <session-dir>/session.json(collection 子树,
 * 形状与旧 sanitized/metadata.json 完全一致,校验逻辑不变)。
 * sanitized/metadata.json 与 collection-result.json 由 export-views 生成/维护,
 * 作为兼容导出视图;旧会话(只有 collection-result.json + sanitized/metadata.json)
 * 首次读写自动迁移为 session.json。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  requireString,
  requireNullableString,
  readJson,
  readStandaloneJson,
  atomicWriteJson,
  isInside,
  sessionPaths,
  loadSession as sessionLoad,
  persistCollection,
  withSessionLock,
  isProcessAlive,
  readLock,
} from './session.mjs';


const ITEM_STATUSES = new Set(['success', 'failed', 'pending', 'unknown']);
const RUN_STATUSES = new Set(['success', 'partial', 'failed', 'unknown']);
const CLEANUP_STATUSES = new Set(['not-started', 'pending', 'completed', 'failed', 'skipped-retention', 'superseded']);
const OPERATIONS = new Set(['ingest', 'organize', 'external']);
const GLOBAL_STAGE_STATUSES = new Set(['not-required', 'pending', 'success', 'failed', 'unknown']);
const SESSION_STATUSES = new Set(['success', 'partial', 'failed', 'unknown']);
const SELECTION_MODES = new Set(['all', 'items']);
const METADATA_VERSION = '1.0';
const SENSITIVE_METADATA_KEY = /(token|cookie|secret|password|authorization|credential|device[_-]?code)/i;

// 会话空间根。沙箱把宿主机 <BYCLAW_SANDBOX_FILE_VOLUME_ROOT>/byclaw-<userCode>/by 挂到 /by，
// 所以 /by 下的绝对路径去掉该前缀就是 fileBrowser 的 path 参数。
const SANDBOX_WORKSPACE_ROOT = '/by';
const IMAGE_DOWNLOAD_ENDPOINT = '/byaiService/fileBrowser/download';
const DEFAULT_IMAGE_LINK_LANGUAGE = 'zh-CN';
// bycli 把下载的图片统一写进文章目录下的 images/，Markdown 里是 images/img_001.png 这种相对链接。
const LOCAL_IMAGE_LINK_PATTERN = /!\[([^\]]*)\]\(\s*(images\/[^)\s]+?)\s*\)/g;

function stableItemId(item) {
  const identity = [item.url, item.title, item.fileName].filter(Boolean).join('\n');
  return `item-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
}

function sanitizeMetadataValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
    .map(([key, item]) => [key, sanitizeMetadataValue(item)]));
}

function assertNoSensitiveMetadataKeys(value, currentPath = 'sanitized/metadata.json') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveMetadataKeys(item, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
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

function materializationFromCanonical(root, item) {
  const sanitizedPath = typeof item.fileName === 'string' ? item.fileName : null;
  const inferredMarkdown = sanitizedPath ? path.posix.join('markdown', path.posix.basename(sanitizedPath)) : null;
  const markdownPath = inferredMarkdown && fs.existsSync(path.join(root, inferredMarkdown)) ? inferredMarkdown : null;
  return {
    status: sanitizedPath && fs.existsSync(path.join(root, sanitizedPath)) ? 'materialized' : 'pending',
    markdownPath,
    sanitizedPath: sanitizedPath && fs.existsSync(path.join(root, sanitizedPath)) ? sanitizedPath : null,
    reason: null,
  };
}

function migrateMetadata(root, rawMetadata, collectionResult) {
  if (rawMetadata?.schemaVersion === METADATA_VERSION) {
    return rawMetadata;
  }
  const knownLegacy = new Set([
    'schemaVersion', 'storage', 'collection', 'retention', 'postProcessing', 'sourceMetadata',
    'storageFallback', 'partial', 'audit_required', 'auditRequired', 'userRequested',
  ]);
  const sourceMetadata = sanitizeMetadataValue(Object.fromEntries(
    Object.entries(rawMetadata || {}).filter(([key]) => !knownLegacy.has(key)),
  ));
  return {
    schemaVersion: METADATA_VERSION,
    storage: { fallback: Boolean(rawMetadata?.storageFallback) },
    collection: {
      status: rawMetadata?.partial ? 'partial' : 'complete',
      items: (Array.isArray(collectionResult.items) ? collectionResult.items : []).map((item) => ({
        itemId: stableItemId(item),
        title: String(item.title || ''),
        sourceUrl: String(item.url || ''),
        sourceItemId: null,
        sourceSkill: String(collectionResult.backend || ''),
        backend: String(collectionResult.backend || ''),
        collectionFilters: collectionResult.filters && typeof collectionResult.filters === 'object' ? collectionResult.filters : {},
        rawArtifacts: [],
        materialization: materializationFromCanonical(root, item),
      })),
    },
    retention: {
      auditRequired: Boolean(rawMetadata?.audit_required ?? rawMetadata?.auditRequired),
      userRequested: Boolean(rawMetadata?.userRequested),
    },
    postProcessing: { runs: [] },
    ...(Object.keys(sourceMetadata).length ? { sourceMetadata } : {}),
  };
}

function normalizeCurrentMetadata(rawMetadata) {
  let metadata = rawMetadata;
  let changed = false;
  const warnings = [];
  const ensureClone = () => {
    if (!changed) {
      metadata = JSON.parse(JSON.stringify(rawMetadata));
      changed = true;
    }
  };
  const legacyKeys = ['partial', 'storageFallback', 'audit_required', 'auditRequired', 'userRequested'];
  const presentLegacy = legacyKeys.filter((key) => Object.hasOwn(rawMetadata, key));
  if (presentLegacy.length) {
    ensureClone();
    for (const key of presentLegacy) {
      delete metadata[key];
    }
    warnings.push(`检测到旧扁平字段并已按嵌套字段规范化: ${presentLegacy.join(', ')}`);
  }
  if (Array.isArray(rawMetadata?.postProcessing?.runs)) {
    rawMetadata.postProcessing.runs.forEach((rawRun, index) => {
      const needsUpgrade = rawRun?.schemaVersion !== METADATA_VERSION
        || typeof rawRun?.globalStage === 'string'
        || !rawRun?.globalStage
        || !rawRun?.selection
        || !Array.isArray(rawRun.selection?.itemIds)
        || !SELECTION_MODES.has(rawRun?.selection?.mode)
        || typeof rawRun?.selection?.discardUnselected !== 'boolean'
        || typeof rawRun?.selection?.discardUnselectedConfirmed !== 'boolean'
        || !Array.isArray(rawRun?.items)
        || rawRun.items.some((item) => (
          !ITEM_STATUSES.has(item?.status)
          || typeof item?.stage !== 'string'
          || !Object.hasOwn(item, 'reason')
          || !Object.hasOwn(item, 'downstreamRef')
          || !CLEANUP_STATUSES.has(item?.cleanupStatus)
          || !Array.isArray(item?.cleanedArtifacts)
        ));
      if (!needsUpgrade) {
        return;
      }
      ensureClone();
      const run = metadata.postProcessing.runs[index];
      run.schemaVersion = METADATA_VERSION;
      const legacyItemIds = Array.isArray(run?.selection?.itemIds)
        ? run.selection.itemIds
        : Array.isArray(run?.items) ? run.items.map((item) => item?.itemId) : [];
      const dedupedItemIds = Array.isArray(legacyItemIds)
        ? [...new Set(legacyItemIds.filter((itemId) => typeof itemId === 'string'))]
        : [];
      const collectionItemIds = new Set((metadata.collection?.items || []).map((item) => item.itemId));
      const inferredMode = dedupedItemIds.length > 0
        && dedupedItemIds.length === collectionItemIds.size
        && [...collectionItemIds].every((itemId) => dedupedItemIds.includes(itemId))
        ? 'all'
        : 'items';
      run.selection = {
        mode: SELECTION_MODES.has(run?.selection?.mode) ? run.selection.mode : inferredMode,
        itemIds: dedupedItemIds,
        discardUnselected: typeof run?.selection?.discardUnselected === 'boolean'
          ? run.selection.discardUnselected
          : false,
        discardUnselectedConfirmed: typeof run?.selection?.discardUnselectedConfirmed === 'boolean'
          ? run.selection.discardUnselectedConfirmed
          : false,
      };
      if (typeof run.globalStage === 'string' || !run.globalStage) {
        const legacyStage = typeof run.globalStage === 'string' ? run.globalStage.toLowerCase() : '';
        if (run.operation === 'organize') {
          const legacyStatuses = new Map([
            ['success', 'success'],
            ['build-success', 'success'],
            ['failed', 'failed'],
            ['build-failed', 'failed'],
            ['pending', 'pending'],
            ['unknown', 'unknown'],
          ]);
          const status = legacyStatuses.get(legacyStage) || 'unknown';
          run.globalStage = {
            name: 'build',
            required: true,
            status,
            reason: status === 'unknown' ? 'legacy-global-stage-unverified' : null,
          };
        } else {
          run.globalStage = { name: null, required: false, status: 'not-required', reason: null };
        }
      }
      const operation = run?.operation === 'organize'
        ? 'organize'
        : run?.operation === 'external'
          ? 'external'
          : 'ingest';
      if (!Array.isArray(run.items)) {
        run.items = [];
      }
      for (const item of run.items) {
        item.reason ??= null;
        if (item.downstreamRef === undefined || item.downstreamRef === null) {
          item.downstreamRef = null;
        } else if (typeof item.downstreamRef !== 'string') {
          item.downstreamRef = null;
        }
        item.stage ??= item.status === 'success'
          ? operation === 'organize'
            ? 'ads-organized'
            : operation === 'external'
              ? 'completed'
              : 'build-submitted'
          : 'upload';
        if (!ITEM_STATUSES.has(item.status)) {
          item.status = 'unknown';
        }
        item.cleanupStatus ??= 'not-started';
        if (!CLEANUP_STATUSES.has(item.cleanupStatus)) {
          item.cleanupStatus = 'not-started';
        }
        item.cleanedArtifacts ??= [];
      }
      run.status = deriveRunStatus(run);
      const inventoryIds = new Set((metadata.collection?.items || []).map((item) => item.itemId));
      run.sessionStatus = deriveSessionStatus(run, inventoryIds);
      warnings.push(`已升级旧 post-processing run: ${run.runId || index}`);
    });
  }
  return { metadata, changed, warnings };
}

function validateRelativePath(root, relativePath, label, { allowMissing = false } = {}) {
  requireString(relativePath, label);
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${label} 不能使用绝对路径`);
  }
  const resolvedRoot = fs.realpathSync(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!isInside(resolvedRoot, candidate)) {
    throw new Error(`${label} 越出采集根目录`);
  }
  if (!fs.existsSync(candidate)) {
    if (allowMissing) {
      return candidate;
    }
    throw new Error(`${label} 不存在或无法读取: ${relativePath}`);
  }
  const realCandidate = fs.realpathSync(candidate);
  if (!isInside(resolvedRoot, realCandidate)) {
    throw new Error(`${label} 符号链接越出采集根目录`);
  }
  return candidate;
}

function validateMarkdownPath(root, relativePath, label) {
  const candidate = validateRelativePath(root, relativePath, label);
  if (!fs.statSync(candidate).isFile()) {
    throw new Error(`${label} 必须指向普通文件`);
  }
  if (!['.md', '.markdown'].includes(path.extname(candidate).toLowerCase())) {
    throw new Error(`${label} 必须指向 Markdown 文件`);
  }
  return candidate;
}

function validatePathPrefix(root, relativePath, directory, label) {
  const candidate = path.resolve(root, relativePath);
  const expectedRoot = path.resolve(root, directory);
  if (candidate === expectedRoot || !isInside(expectedRoot, candidate)) {
    throw new Error(`${label} 必须位于 ${directory.split(path.sep).join('/')}/`);
  }
}

function allowedWorkCopyPath(paths, relativePath, { requireExisting = false } = {}) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    return false;
  }
  try {
    const extension = path.extname(relativePath).toLowerCase();
    if (!['.md', '.markdown'].includes(extension)) {
      return false;
    }
    const inMarkdown = (() => {
      try {
        validatePathPrefix(paths.root, relativePath, 'markdown', 'workCopyPath');
        return true;
      } catch {
        return false;
      }
    })();
    const inSanitized = (() => {
      try {
        validatePathPrefix(paths.root, relativePath, path.join('sanitized', 'items'), 'workCopyPath');
        return true;
      } catch {
        return false;
      }
    })();
    if (!inMarkdown && !inSanitized) {
      return false;
    }
    const candidate = validateRelativePath(paths.root, relativePath, 'workCopyPath', {
      allowMissing: !requireExisting,
    });
    return !requireExisting || fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function normalizeMaterializations(paths, metadata) {
  let changed = false;
  let recovered = false;
  const warnings = [];
  const invalidSanitizedPaths = new Set();
  const invalidSourceUrls = new Set();
  for (const item of metadata?.collection?.items || []) {
    const materialization = item?.materialization;
    if (!materialization || typeof materialization !== 'object' || Array.isArray(materialization)) {
      continue;
    }
    if (materialization.pendingArtifactCleanup === undefined) {
      materialization.pendingArtifactCleanup = [];
      changed = true;
    }
    if (!Array.isArray(materialization.pendingArtifactCleanup)) {
      continue;
    }
    const safePending = [...new Set(materialization.pendingArtifactCleanup.filter((relativePath) => {
      const safe = allowedWorkCopyPath(paths, relativePath);
      if (!safe) {
        warnings.push(`inventory ${item.itemId} pendingArtifactCleanup 含无效工作副本路径，已忽略`);
      }
      return safe;
    }))];
    if (safePending.length !== materialization.pendingArtifactCleanup.length
      || safePending.some((value, index) => value !== materialization.pendingArtifactCleanup[index])) {
      materialization.pendingArtifactCleanup = safePending;
      changed = true;
    }

    const markdownValid = allowedWorkCopyPath(paths, materialization.markdownPath, { requireExisting: true })
      && (() => {
        try {
          validatePathPrefix(paths.root, materialization.markdownPath, 'markdown', 'markdownPath');
          return true;
        } catch {
          return false;
        }
      })();
    const sanitizedValid = allowedWorkCopyPath(paths, materialization.sanitizedPath, { requireExisting: true })
      && (() => {
        try {
          validatePathPrefix(
            paths.root,
            materialization.sanitizedPath,
            path.join('sanitized', 'items'),
            'sanitizedPath',
          );
          return true;
        } catch {
          return false;
        }
      })();
    const consistent = materialization.status === 'materialized'
      ? markdownValid && sanitizedValid
      : materialization.markdownPath === null && materialization.sanitizedPath === null;
    if (consistent) {
      continue;
    }

    materialization.status = 'pending';
    if (typeof materialization.sanitizedPath === 'string' && materialization.sanitizedPath) {
      invalidSanitizedPaths.add(materialization.sanitizedPath);
    }
    if (typeof item.sourceUrl === 'string' && item.sourceUrl) {
      invalidSourceUrls.add(item.sourceUrl);
    }
    materialization.markdownPath = null;
    materialization.sanitizedPath = null;
    materialization.pendingArtifactCleanup = [...materialization.pendingArtifactCleanup];
    materialization.reason = 'materialization-invalid';
    warnings.push(`inventory ${item.itemId} materialization 无效，已降级为 pending`);
    changed = true;
    recovered = true;
  }
  return { changed, recovered, warnings, invalidSanitizedPaths, invalidSourceUrls };
}

function drainPendingArtifactCleanup(paths, metadata) {
  let changed = false;
  const warnings = [];
  for (const item of metadata.collection.items) {
    const materialization = item.materialization;
    const currentPaths = new Set([
      materialization.markdownPath,
      materialization.sanitizedPath,
    ].filter(Boolean));
    const retained = [];
    for (const relativePath of materialization.pendingArtifactCleanup) {
      if (currentPaths.has(relativePath)) {
        warnings.push(`inventory ${item.itemId} pendingArtifactCleanup 指向当前工作副本，已忽略`);
        changed = true;
        continue;
      }
      if (!allowedWorkCopyPath(paths, relativePath)) {
        warnings.push(`inventory ${item.itemId} pendingArtifactCleanup 含无效工作副本路径，已忽略`);
        changed = true;
        continue;
      }
      try {
        deleteArtifact(paths, relativePath, `${item.itemId}.pendingArtifactCleanup`);
        changed = true;
      } catch (error) {
        retained.push(relativePath);
        warnings.push(`inventory ${item.itemId} 旧工作副本待续清: ${error.message}`);
      }
    }
    if (retained.length !== materialization.pendingArtifactCleanup.length
      || retained.some((value, index) => value !== materialization.pendingArtifactCleanup[index])) {
      materialization.pendingArtifactCleanup = retained;
      changed = true;
    }
  }
  return { changed, warnings };
}

function readPayload(paths, rawFilePath, label) {
  const filePath = path.resolve(requireString(rawFilePath, label));
  if (!fs.existsSync(paths.inputDir) || !fs.statSync(paths.inputDir).isDirectory()) {
    throw new Error('采集会话必须包含 .post-processing-inputs/');
  }
  if (!isInside(path.resolve(paths.inputDir), filePath)) {
    throw new Error(`${label} 必须位于 .post-processing-inputs/`);
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} 不能是符号链接`);
  }
  if (!stat.isFile()) {
    throw new Error(`${label} 必须是普通 JSON 文件`);
  }
  const payload = readJson(filePath, label);
  if (payload?.schemaVersion !== METADATA_VERSION) {
    throw new Error(`${label} schemaVersion 必须是 ${METADATA_VERSION}`);
  }
  return { filePath, payload };
}

function loadSession(paths, { persistMigration = false, skipCanonicalValidation = false, persistRecovery = true } = {}) {
  const { session, migrated } = sessionLoad(paths);
  const rawMetadata = session.collection;
  let collectionResult;
  if (fs.existsSync(paths.collectionResult)) {
    collectionResult = readJson(paths.collectionResult, 'collection-result.json');
  } else {
    // 研究先行阶段尚无采集产物: 以空 canonical view 参与校验(有 materialized inventory 时仍会报错)
    collectionResult = {
      schemaVersion: '1.0', title: '', source: '', backend: '', url: '', filters: {}, items: [],
    };
  }
  const migratedMetadata = migrateMetadata(paths.root, rawMetadata, collectionResult);
  const normalized = normalizeCurrentMetadata(migratedMetadata);
  const metadata = normalized.metadata;
  const materializations = normalizeMaterializations(paths, metadata);
  let collectionResultChanged = false;
  if (Array.isArray(collectionResult.items)) {
    const canonicalItems = collectionResult.items.map(canonicalViewItem);
    collectionResultChanged = JSON.stringify(canonicalItems) !== JSON.stringify(collectionResult.items);
    collectionResult.items = canonicalItems;
  }
  if (materializations.invalidSanitizedPaths.size) {
    const previousItems = Array.isArray(collectionResult.items) ? collectionResult.items : [];
    collectionResult.items = previousItems.filter((item) => !materializations.invalidSanitizedPaths.has(
      item.fileName,
    ));
    collectionResultChanged = collectionResult.items.length !== previousItems.length;
  }
  if (materializations.invalidSourceUrls.size) {
    const materializedSourceUrls = new Set(metadata.collection.items
      .filter((item) => item.materialization.status === 'materialized')
      .map((item) => item.sourceUrl));
    const previousItems = Array.isArray(collectionResult.items) ? collectionResult.items : [];
    collectionResult.items = previousItems.filter((item) => !(
      materializations.invalidSourceUrls.has(item.url)
      && !materializedSourceUrls.has(item.url)
    ));
    collectionResultChanged = collectionResultChanged || collectionResult.items.length !== previousItems.length;
  }
  validateMetadata(metadata);
  if (!skipCanonicalValidation) {
    validateCanonicalView(paths.root, collectionResult, metadata);
  }
  const metadataChanged = migratedMetadata !== rawMetadata || normalized.changed || materializations.changed || migrated;
  const recoveryNeeded = materializations.recovered || migrated
    || session.collection?.schemaVersion !== '1.0';
  if (persistRecovery && ((persistMigration && metadataChanged) || recoveryNeeded)) {
    persistCollection(paths, session, metadata);
  }
  if (persistRecovery && (collectionResultChanged || materializations.recovered)) {
    atomicWriteJson(paths.collectionResult, collectionResult);
  }
  return {
    metadata,
    collectionResult,
    metadataChanged,
    collectionResultChanged,
    materializationRecovered: materializations.recovered,
    warnings: [...normalized.warnings, ...materializations.warnings],
    session,
  };
}


function validateMetadata(metadata) {
  assertNoSensitiveMetadataKeys(metadata);
  if (metadata?.schemaVersion !== METADATA_VERSION) {
    throw new Error(`sanitized/metadata.json schemaVersion 必须是 ${METADATA_VERSION}`);
  }
  if (!metadata.storage || typeof metadata.storage !== 'object' || Array.isArray(metadata.storage)) {
    throw new Error('sanitized/metadata.json storage 必须是对象');
  }
  if (typeof metadata.storage.fallback !== 'boolean') {
    throw new Error('sanitized/metadata.json storage.fallback 必须是布尔值');
  }
  if (!metadata.collection || typeof metadata.collection !== 'object' || Array.isArray(metadata.collection)) {
    throw new Error('sanitized/metadata.json collection 必须是对象');
  }
  if (!['complete', 'partial', 'failed'].includes(metadata.collection.status)) {
    throw new Error(`sanitized/metadata.json collection.status 无效: ${metadata.collection.status}`);
  }
  if (!Array.isArray(metadata?.collection?.items)) {
    throw new Error('sanitized/metadata.json collection.items 必须是数组');
  }
  const seen = new Set();
  const seenArticleIdentities = new Set();
  const seenWorkCopyPaths = new Set();
  for (const item of metadata.collection.items) {
    const itemId = requireString(item?.itemId, 'inventory itemId');
    if (seen.has(itemId)) {
      throw new Error(`inventory itemId 重复: ${itemId}`);
    }
    seen.add(itemId);
    const sourceSkill = requireString(item?.sourceSkill, `inventory ${itemId} sourceSkill`);
    const sourceUrl = requireString(item?.sourceUrl, `inventory ${itemId} sourceUrl`);
    const identity = articleIdentity({ sourceSkill, sourceUrl });
    if (seenArticleIdentities.has(identity)) {
      throw new Error(`inventory sourceSkill + sourceUrl 重复: ${identity.replace('\n', ' / ')}`);
    }
    seenArticleIdentities.add(identity);
    if (!['materialized', 'pending', 'failed'].includes(item?.materialization?.status)) {
      throw new Error(`inventory ${itemId} materialization.status 无效`);
    }
    for (const field of ['markdownPath', 'sanitizedPath']) {
      const value = item.materialization[field];
      if (value !== null && (typeof value !== 'string' || !value.trim())) {
        throw new Error(`inventory ${itemId} materialization.${field} 必须是路径或 null`);
      }
    }
    if (!Array.isArray(item.materialization.pendingArtifactCleanup)
      || item.materialization.pendingArtifactCleanup.some((artifact) => typeof artifact !== 'string')) {
      throw new Error(`inventory ${itemId} materialization.pendingArtifactCleanup 必须是字符串数组`);
    }
    const shouldHavePaths = item.materialization.status === 'materialized';
    const hasBothPaths = typeof item.materialization.markdownPath === 'string'
      && typeof item.materialization.sanitizedPath === 'string';
    if (shouldHavePaths !== hasBothPaths) {
      throw new Error(`inventory ${itemId} materialization 状态与路径不一致`);
    }
    if (shouldHavePaths) {
      for (const field of ['markdownPath', 'sanitizedPath']) {
        const workCopyPath = item.materialization[field];
        if (seenWorkCopyPaths.has(workCopyPath)) {
          throw new Error(`inventory 工作副本路径重复: ${workCopyPath}`);
        }
        seenWorkCopyPaths.add(workCopyPath);
      }
    }
    if (!Array.isArray(item.rawArtifacts) || item.rawArtifacts.some((artifact) => typeof artifact !== 'string')) {
      throw new Error(`inventory ${itemId} rawArtifacts 必须是字符串数组`);
    }
  }
  if (!metadata.retention || typeof metadata.retention !== 'object' || Array.isArray(metadata.retention)) {
    throw new Error('sanitized/metadata.json retention 必须是对象');
  }
  for (const field of ['auditRequired', 'userRequested']) {
    if (typeof metadata.retention[field] !== 'boolean') {
      throw new Error(`sanitized/metadata.json retention.${field} 必须是布尔值`);
    }
  }
  if (!Array.isArray(metadata?.postProcessing?.runs)) {
    throw new Error('sanitized/metadata.json postProcessing.runs 必须是数组');
  }
  const inventoryIds = new Set(metadata.collection.items.map((item) => item.itemId));
  for (const run of metadata.postProcessing.runs) {
    validateRun(run, inventoryIds);
  }
}

function validateCanonicalView(root, collectionResult, metadata) {
  const materializedByPath = new Map(metadata.collection.items
    .filter((item) => item.materialization.status === 'materialized')
    .map((item) => [item.materialization.sanitizedPath, item]));
  const seenPaths = new Set();
  for (const [index, item] of (Array.isArray(collectionResult.items) ? collectionResult.items : []).entries()) {
    if (!item || typeof item !== 'object' || typeof item.fileName !== 'string' || typeof item.markdown !== 'string') {
      throw new Error(`collection-result.json items[${index}] canonical view 条目无效`);
    }
    if (item.fileName !== item.markdown) {
      throw new Error(`collection-result.json items[${index}] markdown 与 fileName 不一致`);
    }
    if (seenPaths.has(item.fileName)) {
      throw new Error(`collection-result.json canonical view 路径重复: ${item.fileName}`);
    }
    seenPaths.add(item.fileName);
    const inventory = materializedByPath.get(item.fileName);
    if (!inventory) {
      throw new Error(`collection-result.json canonical view 路径未对应 materialized inventory: ${item.fileName}`);
    }
    if (item.url !== inventory.sourceUrl) {
      throw new Error(`collection-result.json canonical view URL 与 inventory 不一致: ${item.fileName}`);
    }
    validateMarkdownPath(root, item.fileName, `collection-result.json items[${index}].fileName`);
  }
  const hiddenMaterializedPaths = [...materializedByPath.keys()].filter((sanitizedPath) => !seenPaths.has(sanitizedPath));
  if (hiddenMaterializedPaths.length) {
    throw new Error(`materialized inventory 未出现在 collection-result.json canonical view: ${hiddenMaterializedPaths.join(', ')}`);
  }
}

function validateCanonicalItem(item, sanitizedPath) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('canonicalItem 必须是对象');
  }
  for (const key of ['title', 'url', 'markdown', 'fileName']) {
    requireString(item[key], `canonicalItem.${key}`);
  }
  for (const key of ['author', 'publishTime']) {
    if (typeof item[key] !== 'string') {
      throw new Error(`canonicalItem.${key} 必须是字符串`);
    }
  }
  if (item.markdown !== sanitizedPath || item.fileName !== sanitizedPath) {
    throw new Error('canonicalItem.markdown 与 fileName 必须等于 sanitizedPath');
  }
}

function canonicalViewItem(item) {
  const keys = ['title', 'url', 'author', 'publishTime', 'markdown', 'fileName'];
  return Object.fromEntries(keys
    .filter((key) => Object.hasOwn(item || {}, key))
    .map((key) => [key, item[key]]));
}


function metadataSummary(metadata) {
  const runs = (metadata.postProcessing?.runs || []).map((run) => runSummary(run));
  return {
    schemaVersion: metadata.schemaVersion,
    collectionStatus: metadata.collection?.status,
    items: metadata.collection?.items?.length || 0,
    materialized: (metadata.collection?.items || []).filter((item) => item.materialization?.status === 'materialized').length,
    pending: (metadata.collection?.items || []).filter((item) => item.materialization?.status === 'pending').length,
    failed: (metadata.collection?.items || []).filter((item) => item.materialization?.status === 'failed').length,
    retention: metadata.retention,
    runs,
  };
}

function runSummary(run) {
  if (!run || typeof run !== 'object') {
    return null;
  }
  const count = (status) => run.items?.filter((item) => item.status === status).length || 0;
  return {
    runId: run.runId,
    operation: run.operation,
    target: run.target,
    status: run.status,
    sessionStatus: run.sessionStatus,
    selection: run.selection,
    items: {
      total: run.items?.length || 0,
      success: count('success'),
      failed: count('failed'),
      pending: count('pending'),
      unknown: count('unknown'),
    },
    globalStage: run.globalStage,
  };
}

function selectedItemIds(args, metadata) {
  const ids = new Set();
  if (typeof args['item-ids'] === 'string' && args['item-ids'].trim()) {
    for (const raw of args['item-ids'].split(',')) {
      const itemId = raw.trim();
      if (itemId) {
        ids.add(itemId);
      }
    }
  }
  for (const value of Array.isArray(args['item-id']) ? args['item-id'] : (args['item-id'] ? [args['item-id']] : [])) {
    if (typeof value === 'string' && value.trim()) {
      ids.add(value.trim());
    }
  }
  if (!ids.size) {
    return null;
  }
  const inventoryIds = new Set((metadata.collection?.items || []).map((item) => item.itemId));
  for (const itemId of ids) {
    if (!inventoryIds.has(itemId)) {
      throw new Error(`rewrite-image-links 指定了不在 inventory 中的 itemId: ${itemId}`);
    }
  }
  return ids;
}

function deletePayloadInput(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return `输入文件类型异常,保留未删除: ${filePath}`;
  }
  try {
    fs.unlinkSync(filePath);
    return null;
  } catch (error) {
    return `输入文件删除失败,已保留: ${filePath} (${error.message})`;
  }
}

function quarantineRelativePath(paths, relativePath, label) {
  const candidate = validateRelativePath(paths.root, relativePath, label, { allowMissing: true });
  if (!fs.existsSync(candidate)) {
    return null;
  }
  const realCandidate = fs.realpathSync(candidate);
  const realRoot = fs.realpathSync(paths.root);
  if (!isInside(realRoot, realCandidate)) {
    throw new Error(`${label} 符号链接越出采集根目录`);
  }
  if (!fs.statSync(candidate).isFile()) {
    throw new Error(`${label} 必须指向普通文件`);
  }
  const quarantine = `${candidate}.trash-${crypto.randomUUID()}`;
  fs.renameSync(candidate, quarantine);
  return { original: candidate, quarantine };
}

function rollbackQuarantine(moved) {
  const failures = [];
  for (const { original, quarantine } of [...moved].reverse()) {
    try {
      if (!fs.existsSync(original) && fs.existsSync(quarantine)) {
        fs.renameSync(quarantine, original);
      }
    } catch (error) {
      failures.push(`${original}: ${error.message}`);
    }
  }
  return failures;
}

function deleteQuarantined(moved) {
  const warnings = [];
  for (const { original, quarantine } of moved) {
    try {
      fs.rmSync(quarantine, { force: true, maxRetries: 2, retryDelay: 50 });
    } catch (error) {
      warnings.push(`待删除文件残留: ${quarantine} (${error.message});原始路径 ${original} 已释放`);
    }
  }
  return warnings;
}

function archiveDeliverables(paths, session) {
  const deliverables = [
    session?.research?.reportPath,
    path.join(paths.root, 'research-tree.md'),
  ].filter((filePath) => typeof filePath === 'string' && filePath && fs.existsSync(filePath));
  if (!deliverables.length) {
    return null;
  }
  const archive = path.join(path.dirname(paths.root), `${path.basename(paths.root)}.delivered`);
  fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
  const copied = [];
  for (const filePath of deliverables) {
    const target = path.join(archive, path.basename(filePath));
    fs.copyFileSync(filePath, target);
    copied.push(target);
  }
  return archive;
}

function removeSessionRootTransactional(paths, runId) {
  const root = paths.root;
  const trash = path.join(
    path.dirname(root),
    `.${path.basename(root)}.trash-${runId}-${crypto.randomUUID()}`,
  );
  fs.renameSync(root, trash);
  try {
    fs.rmSync(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    return { removedSession: true, removedPath: root, trashPath: trash };
  } catch (error) {
    throw new Error(`会话已整体移入待删除目录 ${trash},但递归删除失败: ${error.message}。请手工检查并清理该目录`);
  }
}

function researchReportPending(session) {
  if (session?.task?.mode === 'collection') {
    return false;
  }
  const complete = session?.task?.status === 'complete'
    && typeof session?.research?.reportPath === 'string'
    && session.research.reportPath.trim()
    && fs.existsSync(session.research.reportPath);
  return !complete;
}

function markMaterialized(paths, args) {
  const { payload: update } = readPayload(paths, args['item-json-file'], '--item-json-file');
  return withSessionLock(paths, 'mark-materialized', () => {
    const { metadata, collectionResult, session } = loadSession(paths);
    const itemId = requireString(update.itemId, 'itemId');
    const inventory = metadata.collection.items.find((item) => item.itemId === itemId);
    if (!inventory) {
      throw new Error(`inventory 中不存在 itemId: ${itemId}`);
    }
    const markdownPath = requireString(update.markdownPath, 'markdownPath');
    const sanitizedPath = requireString(update.sanitizedPath, 'sanitizedPath');
    validateMarkdownPath(paths.root, markdownPath, 'markdownPath');
    validateMarkdownPath(paths.root, sanitizedPath, 'sanitizedPath');
    validatePathPrefix(paths.root, markdownPath, 'markdown', 'markdownPath');
    validatePathPrefix(paths.root, sanitizedPath, path.join('sanitized', 'items'), 'sanitizedPath');
    validateCanonicalItem(update.canonicalItem, sanitizedPath);
    if (update.canonicalItem.url !== inventory.sourceUrl) {
      throw new Error('canonicalItem.url 必须与 inventory.sourceUrl 一致');
    }
    const previousMaterialization = {
      ...inventory.materialization,
      pendingArtifactCleanup: [...(inventory.materialization.pendingArtifactCleanup || [])],
    };
    const persistedCanonicalItem = canonicalViewItem(update.canonicalItem);
    const changedPreviousPaths = [
      previousMaterialization.markdownPath,
      previousMaterialization.sanitizedPath,
    ].filter((previousPath) => (
      typeof previousPath === 'string'
      && previousPath
      && previousPath !== markdownPath
      && previousPath !== sanitizedPath
      && allowedWorkCopyPath(paths, previousPath)
    ));
    inventory.materialization = {
      status: 'materialized',
      markdownPath,
      sanitizedPath,
      pendingArtifactCleanup: [...new Set([
        ...previousMaterialization.pendingArtifactCleanup,
        ...changedPreviousPaths,
      ])],
      reason: null,
    };
    const items = (Array.isArray(collectionResult.items) ? collectionResult.items : [])
      .map(canonicalViewItem);
    const previousSanitizedPath = String(previousMaterialization.sanitizedPath || '');
    collectionResult.items = [
      ...items.filter((item) => item.fileName !== previousSanitizedPath && item.fileName !== sanitizedPath),
      persistedCanonicalItem,
    ];
    atomicWriteJson(paths.collectionResult, collectionResult);
    persistCollection(paths, session, metadata);
    const drained = drainPendingArtifactCleanup(paths, metadata);
    if (drained.changed) {
      persistCollection(paths, session, metadata);
    }
    return {
      ok: true,
      action: 'mark-materialized',
      itemId,
      metadata,
      collectionResult,
      warnings: drained.warnings,
    };
  });
}

function validateRun(run, inventoryIds) {
  if (run?.schemaVersion !== METADATA_VERSION) {
    throw new Error(`run schemaVersion 必须是 ${METADATA_VERSION}`);
  }
  requireString(run?.runId, 'runId');
  if (!OPERATIONS.has(run?.operation)) {
    throw new Error(`operation 无效: ${run?.operation}`);
  }
  if (!run.target || typeof run.target !== 'object' || Array.isArray(run.target)) {
    throw new Error('target 必须是对象');
  }
  if (run.operation === 'ingest') {
    if (run.target.kind !== 'knowledge-base') {
      throw new Error('ingest target.kind 必须是 knowledge-base');
    }
    requireString(run.target.id, 'ingest target.id');
    requireString(run.target.path, 'ingest target.path');
  } else if (run.operation === 'organize') {
    if (run.target.kind !== 'knowledge-organization') {
      throw new Error('organize target.kind 必须是 knowledge-organization');
    }
    requireString(run.target.id, 'organize target.id');
  } else if (run.operation === 'external') {
    if (run.target.kind !== 'external') {
      throw new Error('external target.kind 必须是 external');
    }
    requireString(run.target.id, 'external target.id');
  }
  if (!RUN_STATUSES.has(run.status)) {
    throw new Error(`run status 无效: ${run.status}`);
  }
  if (!run.selection || !Array.isArray(run.selection.itemIds)) {
    throw new Error('selection.itemIds 必须是数组');
  }
  if (!SELECTION_MODES.has(run.selection.mode)) {
    throw new Error(`selection.mode 无效: ${run.selection.mode}`);
  }
  if (typeof run.selection.discardUnselected !== 'boolean') {
    throw new Error('selection.discardUnselected 必须是布尔值');
  }
  if (typeof run.selection.discardUnselectedConfirmed !== 'boolean') {
    throw new Error('selection.discardUnselectedConfirmed 必须是布尔值');
  }
  if (!run.selection.itemIds.length) {
    throw new Error('selection.itemIds 不能为空');
  }
  if (run.selection.discardUnselected === true && run.selection.discardUnselectedConfirmed !== true) {
    throw new Error('discardUnselected 必须有用户明确确认');
  }
  if (!Array.isArray(run.items)) {
    throw new Error('run items 必须是数组');
  }
  if (!run.globalStage || typeof run.globalStage !== 'object' || Array.isArray(run.globalStage)) {
    throw new Error('globalStage 必须是对象');
  }
  if (typeof run.globalStage.required !== 'boolean') {
    throw new Error('globalStage.required 必须是布尔值');
  }
  if (!GLOBAL_STAGE_STATUSES.has(run.globalStage.status)) {
    throw new Error(`globalStage.status 无效: ${run.globalStage.status}`);
  }
  requireNullableString(run.globalStage.reason, 'globalStage.reason');
  if (run.globalStage.required && run.globalStage.status === 'not-required') {
    throw new Error('required globalStage 不能是 not-required');
  }
  if (!run.globalStage.required && run.globalStage.status !== 'not-required') {
    throw new Error('非必要 globalStage 必须是 not-required');
  }
  if (run.globalStage.required) {
    requireString(run.globalStage.name, 'required globalStage.name');
  } else if (run.globalStage.name !== null) {
    throw new Error('非必要 globalStage.name 必须是 null');
  }
  if (run.operation === 'ingest' && run.globalStage.required) {
    throw new Error('ingest 的 build 已逐篇记录，globalStage 不能设为 required');
  }
  if (run.operation === 'organize' && (
    run.globalStage.required !== true || run.globalStage.name !== 'build'
  )) {
    throw new Error('organize 必须记录 required build globalStage');
  }
  const runItemIds = new Set();
  for (const item of run.items) {
    const itemId = requireString(item?.itemId, 'run itemId');
    if (!inventoryIds.has(itemId)) {
      throw new Error(`run itemId 不在 inventory 中: ${itemId}`);
    }
    if (runItemIds.has(itemId)) {
      throw new Error(`run itemId 重复: ${itemId}`);
    }
    runItemIds.add(itemId);
    if (!ITEM_STATUSES.has(item.status)) {
      throw new Error(`run item ${itemId} status 无效: ${item.status}`);
    }
    requireString(item.stage, `run item ${itemId} stage`);
    requireNullableString(item.reason, `run item ${itemId} reason`);
    if (item.downstreamRef !== null && typeof item.downstreamRef !== 'string') {
      throw new Error(`run item ${itemId} downstreamRef 必须是字符串或 null`);
    }
    if (item.status === 'success') {
      const requiredStage = run.operation === 'ingest'
        ? 'build-submitted'
        : run.operation === 'organize'
          ? 'ads-organized'
          : 'completed';
      if (item.stage !== requiredStage) {
        throw new Error(`${run.operation} success item ${itemId} stage 必须是 ${requiredStage}`);
      }
    }
    item.cleanupStatus ??= 'not-started';
    if (!CLEANUP_STATUSES.has(item.cleanupStatus)) {
      throw new Error(`run item ${itemId} cleanupStatus 无效: ${item.cleanupStatus}`);
    }
  }
  const selectedIds = new Set();
  for (const itemId of run.selection.itemIds) {
    requireString(itemId, 'selection itemId');
    if (selectedIds.has(itemId)) {
      throw new Error(`selection itemId 重复: ${itemId}`);
    }
    selectedIds.add(itemId);
    if (!inventoryIds.has(itemId)) {
      throw new Error(`selection itemId 不在 inventory 中: ${itemId}`);
    }
  }
  if (selectedIds.size !== runItemIds.size || [...selectedIds].some((itemId) => !runItemIds.has(itemId))) {
    throw new Error('run.items 必须与 selection.itemIds 一一对应');
  }
  if (run.selection.mode === 'all'
    && (selectedIds.size !== inventoryIds.size || [...inventoryIds].some((itemId) => !selectedIds.has(itemId)))) {
    throw new Error('selection.mode=all 必须覆盖完整 inventory');
  }
  const expectedStatus = deriveRunStatus(run);
  if (run.status !== expectedStatus) {
    throw new Error(`run status 与逐篇状态或 globalStage 不一致，应为 ${expectedStatus}`);
  }
  if (!SESSION_STATUSES.has(run.sessionStatus)) {
    throw new Error(`sessionStatus 无效: ${run.sessionStatus}`);
  }
  const expectedSession = deriveSessionStatus(run, inventoryIds);
  if (run.sessionStatus !== expectedSession) {
    throw new Error(`sessionStatus 与 inventory、selection 或 run status 不一致，应为 ${expectedSession}`);
  }
}

function deriveRunStatus(run) {
  let expectedStatus;
  if (run.globalStage.required && run.globalStage.status === 'failed') {
    expectedStatus = 'failed';
  } else if (run.globalStage.required && run.globalStage.status === 'unknown') {
    expectedStatus = 'unknown';
  } else if (run.globalStage.required && run.globalStage.status === 'pending') {
    expectedStatus = 'partial';
  } else if (run.items.every((item) => item.status === 'success')) {
    expectedStatus = 'success';
  } else if (run.items.every((item) => item.status === 'failed')) {
    expectedStatus = 'failed';
  } else if (run.items.every((item) => item.status === 'unknown')) {
    expectedStatus = 'unknown';
  } else {
    expectedStatus = 'partial';
  }
  return expectedStatus;
}

function deriveSessionStatus(run, inventoryIds) {
  const selectedIds = new Set(run.selection.itemIds);
  const coversInventory = run.selection.discardUnselected === true
    || (selectedIds.size === inventoryIds.size && [...inventoryIds].every((itemId) => selectedIds.has(itemId)));
  if (!coversInventory || run.status === 'partial') {
    return 'partial';
  }
  return run.status;
}

function recordRun(paths, args) {
  const payloadPath = path.resolve(requireString(args['run-json-file'], '--run-json-file'));
  const { payload: run } = readPayload(paths, payloadPath, '--run-json-file');
  return withSessionLock(paths, 'record-run', () => {
    const loaded = loadSession(paths);
    const { metadata, session } = loaded;
    if (loaded.materializationRecovered) {
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    validateRun(run, new Set(metadata.collection.items.map((item) => item.itemId)));
    const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
    if (dryRun) {
      return {
        ok: true,
        action: 'record-run',
        dryRun: true,
        runId: run.runId,
        summary: runSummary(run),
        note: '校验通过;未持久化',
      };
    }
    const index = metadata.postProcessing.runs.findIndex((item) => item.runId === run.runId);
    if (index === -1) {
      const selectedIdentities = new Set(run.selection.itemIds.map((itemId) => {
        const inventory = metadata.collection.items.find((item) => item.itemId === itemId);
        return articleIdentity(inventory);
      }));
      for (const previousRun of metadata.postProcessing.runs) {
        for (const previousItem of previousRun.items) {
          const previousInventory = metadata.collection.items.find((item) => item.itemId === previousItem.itemId);
          if (previousInventory && selectedIdentities.has(articleIdentity(previousInventory))
            && !['completed', 'superseded'].includes(previousItem.cleanupStatus)) {
            previousItem.cleanupStatus = 'superseded';
          }
        }
      }
      metadata.postProcessing.runs.push(run);
    } else {
      const previous = metadata.postProcessing.runs[index];
      const previousItemIds = [...previous.selection.itemIds].sort();
      const nextItemIds = [...run.selection.itemIds].sort();
      const sameSelection = previous.selection.mode === run.selection.mode
        && previous.selection.discardUnselected === run.selection.discardUnselected
        && previous.selection.discardUnselectedConfirmed === run.selection.discardUnselectedConfirmed
        && previousItemIds.length === nextItemIds.length
        && previousItemIds.every((itemId, itemIndex) => itemId === nextItemIds[itemIndex]);
      if (previous.operation !== run.operation || !sameTarget(previous.target, run.target) || !sameSelection) {
        throw new Error('已有 run 的 operation、target 与 selection 不可改变；请创建新 run');
      }
      const previousItemsById = new Map(previous.items.map((item) => [item.itemId, item]));
      const mergedItems = run.items.map((incoming) => {
        const existing = previousItemsById.get(incoming.itemId);
        if (!existing) {
          return incoming;
        }
        const existingCleanedArtifacts = existing.cleanedArtifacts;
        const merged = {
          ...existing,
          ...incoming,
          cleanupStatus: typeof existing.cleanupStatus === 'string'
            ? existing.cleanupStatus
            : incoming.cleanupStatus,
        };
        if (Array.isArray(existingCleanedArtifacts)) {
          merged.cleanedArtifacts = existingCleanedArtifacts;
        }
        return merged;
      });
      metadata.postProcessing.runs[index] = {
        ...previous,
        ...run,
        items: mergedItems,
      };
    }
    persistCollection(paths, session, metadata);
    const warning = deletePayloadInput(payloadPath);
    const full = args.full === true || args.full === 'true';
    return {
      ok: true,
      action: 'record-run',
      runId: run.runId,
      ...(warning ? { warning } : {}),
      ...(full ? { metadata } : { summary: runSummary(run) }),
    };
  });
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sameTarget(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function inspect(paths, args) {
  return withSessionLock(paths, 'inspect', () => {
    const loaded = loadSession(paths, { persistMigration: false, persistRecovery: false });
    const { metadata, collectionResult, session } = loaded;
    const warnings = [...loaded.warnings];
    const drainPending = args['drain-pending'] === true || args['drain-pending'] === 'true';
    if (drainPending && !loaded.materializationRecovered) {
      const drained = drainPendingArtifactCleanup(paths, metadata);
      warnings.push(...drained.warnings);
      if (drained.changed) {
        persistCollection(paths, session, metadata);
      }
    }
    let matchingRun;
    if (args.operation && args['target-json']) {
      const target = JSON.parse(args['target-json']);
      matchingRun = [...metadata.postProcessing.runs]
        .reverse()
        .find((run) => run.operation === args.operation && sameTarget(run.target, target));
    }
    const inventoryIds = metadata.collection.items.map((item) => item.itemId);
    const selectedIds = new Set(matchingRun?.selection?.itemIds || []);
    const unselectedIds = matchingRun && matchingRun.selection.discardUnselected !== true
      ? inventoryIds.filter((itemId) => !selectedIds.has(itemId))
      : [];
    const failedItemIds = matchingRun
      ? [
        ...matchingRun.items
          .filter((item) => ['failed', 'pending', 'unknown'].includes(item.status))
          .map((item) => item.itemId),
        ...unselectedIds,
      ]
      : [];
    const requiresResumeChoice = Boolean(
      matchingRun
      && (
        ['partial', 'failed', 'unknown'].includes(matchingRun.status)
        || ['partial', 'failed', 'unknown'].includes(matchingRun.sessionStatus)
      ),
    );
    const requiresGlobalStageRetry = Boolean(
      matchingRun?.globalStage?.required
      && ['failed', 'pending', 'unknown'].includes(matchingRun.globalStage.status),
    );
    const full = args.full === true || args.full === 'true';
    const summary = {
      action: 'inspect',
      collection: metadataSummary(metadata),
      matchingRun: matchingRun ? runSummary(matchingRun) : null,
      requiresResumeChoice,
      resumeChoices: requiresResumeChoice ? ['all', 'failed-only'] : [],
      failedItemIds,
      requiresGlobalStageRetry,
      drainedPendingArtifacts: drainPending,
      warnings,
    };
    if (full) {
      return {
        ok: true,
        metadata,
        collectionResult,
        ...summary,
      };
    }
    return { ok: true, ...summary };
  });
}

function deleteArtifact(paths, relativePath, label) {
  const candidate = validateRelativePath(paths.root, relativePath, label, { allowMissing: true });
  if (!fs.existsSync(candidate)) {
    return { path: relativePath, deleted: true, alreadyMissing: true };
  }
  const realCandidate = fs.realpathSync(candidate);
  const realRoot = fs.realpathSync(paths.root);
  if (!isInside(realRoot, realCandidate)) {
    throw new Error(`${label} 符号链接越出采集根目录`);
  }
  if (!fs.statSync(candidate).isFile()) {
    throw new Error(`${label} 必须指向普通文件`);
  }
  fs.unlinkSync(candidate);
  return { path: relativePath, deleted: true, alreadyMissing: false };
}

function cleanup(paths, args) {
  const runId = requireString(args['run-id'], '--run-id');
  return withSessionLock(paths, 'cleanup', () => {
    const loaded = loadSession(paths);
    const { metadata, collectionResult, session } = loaded;
    if (loaded.materializationRecovered) {
      persistCollection(paths, session, metadata);
      if (loaded.collectionResultChanged) {
        atomicWriteJson(paths.collectionResult, collectionResult);
      }
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    const run = metadata.postProcessing.runs.find((item) => item.runId === runId);
    if (!run) {
      throw new Error(`找不到 post-processing run: ${runId}`);
    }
    validateRun(run, new Set(metadata.collection.items.map((item) => item.itemId)));
    const successful = run.items.filter((item) => (
      item.status === 'success' && !['completed', 'superseded'].includes(item.cleanupStatus)
    ));
    const requiresRematerialization = successful.some((runItem) => {
      const inventory = metadata.collection.items.find((item) => item.itemId === runItem.itemId);
      return inventory?.materialization?.status !== 'materialized'
        || inventory?.materialization?.reason === 'materialization-invalid';
    });
    if (requiresRematerialization) {
      throw new Error('成功项缺少有效 materialization；请先由原始执行器重新物化');
    }
    const reportPending = researchReportPending(session);
    const retention = Boolean(metadata.retention?.auditRequired || metadata.retention?.userRequested) || reportPending;
    const inventoryIds = new Set(metadata.collection.items.map((item) => item.itemId));
    const selectedIds = new Set(run.selection.itemIds);
    const coversInventory = run.selection.discardUnselected === true
      || (selectedIds.size === inventoryIds.size && [...inventoryIds].every((itemId) => selectedIds.has(itemId)));
    const selectedAllSuccess = run.status === 'success'
      && run.items.length === selectedIds.size
      && run.items.every((item) => item.status === 'success')
      && run.items.every((item) => !['completed', 'superseded'].includes(item.cleanupStatus));
    const fullRemoval = coversInventory && selectedAllSuccess;
    const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
    const full = args.full === true || args.full === 'true';
    if (dryRun) {
      return {
        ok: true,
        action: 'cleanup',
        dryRun: true,
        runId,
        plan: retention
          ? { action: 'retain-session', reason: reportPending ? 'research-report-pending' : 'retention-policy' }
          : fullRemoval
            ? { action: 'remove-session', path: paths.root }
            : {
              action: 'partial-cleanup',
              itemIds: successful.map((item) => item.itemId),
              keepRaw: true,
              note: '仅删除成功项工作副本,保留 raw/ 与未完成项',
            },
        summary: runSummary(run),
      };
    }
    if (retention) {
      for (const item of successful) {
        item.cleanupStatus = 'skipped-retention';
      }
      persistCollection(paths, session, metadata);
      return {
        ok: true,
        action: 'cleanup',
        runId,
        retention: true,
        reason: reportPending ? 'research-report-pending' : 'retention-policy',
        removedSession: false,
        summary: metadataSummary(metadata),
      };
    }

    if (fullRemoval) {
      const shouldArchiveDeliverables = args['archive-deliverables'] === true || args['archive-deliverables'] === 'true';
      const archivePath = shouldArchiveDeliverables ? archiveDeliverables(paths, session) : null;
      return {
        ok: true,
        action: 'cleanup',
        runId,
        ...(archivePath ? { archiveDeliverables: archivePath } : {}),
        ...removeSessionRootTransactional(paths, runId),
        summary: runSummary(run),
      };
    }

    for (const item of successful) {
      item.cleanupStatus = 'pending';
    }
    persistCollection(paths, session, metadata);

    const deletedSanitized = new Set();
    const warnings = [];
    for (const runItem of successful) {
      const inventory = metadata.collection.items.find((item) => item.itemId === runItem.itemId);
      if (!inventory) {
        throw new Error(`cleanup itemId 不在 inventory 中: ${runItem.itemId}`);
      }
      const artifacts = [
        ['markdownPath', inventory.materialization.markdownPath],
        ['sanitizedPath', inventory.materialization.sanitizedPath],
      ].filter(([, relativePath]) => typeof relativePath === 'string' && relativePath);
      const moved = [];
      try {
        for (const [field, relativePath] of artifacts) {
          validateRelativePath(paths.root, relativePath, `${runItem.itemId}.${field}`, { allowMissing: true });
          const quarantined = quarantineRelativePath(paths, relativePath, `${runItem.itemId}.${field}`);
          if (quarantined) {
            moved.push({ ...quarantined, relativePath });
          }
        }
      } catch (error) {
        const rollbackWarnings = rollbackQuarantine(moved);
        warnings.push(...rollbackWarnings.map((text) => `${runItem.itemId} 回滚警告: ${text}`));
        runItem.cleanupStatus = 'failed';
        runItem.reason = runItem.reason || `${error.message}
${error.stack}`;
        continue;
      }

      const originalArtifacts = artifacts.map(([, relativePath]) => relativePath);
      const sanitizedArtifact = inventory.materialization.sanitizedPath;
      const previousPending = Array.isArray(inventory.materialization.pendingArtifactCleanup)
        ? inventory.materialization.pendingArtifactCleanup
        : [];
      runItem.cleanedArtifacts = [...new Set([...(runItem.cleanedArtifacts || []), ...originalArtifacts])];
      inventory.materialization.markdownPath = null;
      inventory.materialization.sanitizedPath = null;
      inventory.materialization.status = 'pending';
      inventory.materialization.reason = null;
      inventory.materialization.pendingArtifactCleanup = previousPending.filter((item) => !originalArtifacts.includes(item));
      runItem.cleanupStatus = 'completed';
      for (const artifact of originalArtifacts) {
        if (artifact === sanitizedArtifact || artifact.startsWith(`${path.join('sanitized', 'items').split(path.sep).join('/')}/`)) {
          deletedSanitized.add(artifact);
        }
      }
      warnings.push(...deleteQuarantined(moved));
    }
    collectionResult.items = (Array.isArray(collectionResult.items) ? collectionResult.items : [])
      .filter((item) => !deletedSanitized.has(item.fileName));
    atomicWriteJson(paths.collectionResult, collectionResult);
    persistCollection(paths, session, metadata);
    return {
      ok: true,
      action: 'cleanup',
      runId,
      retention: false,
      removedSession: false,
      warnings,
      ...(full ? { metadata, collectionResult } : { summary: metadataSummary(metadata) }),
    };
  });
}

function unlockStale(paths) {
  const lock = readLock(paths);
  if (!lock) {
    return { ok: true, action: 'unlock-stale', removed: false, previousLock: null };
  }
  if (isProcessAlive(lock.pid, lock.processStartTime)) {
    throw new Error(`当前采集会话锁持有进程仍存活: pid=${lock.pid}, command=${lock.command}`);
  }
  const removed = quarantineStaleLock(paths, lock);
  if (!removed) {
    throw new Error('锁状态在回收期间发生变化，请稍后重试');
  }
  return { ok: true, action: 'unlock-stale', removed, previousLock: lock };
}

function setRetention(paths, args) {
  const rawKeep = args.keep;
  if (rawKeep !== 'true' && rawKeep !== 'false') {
    throw new Error('--keep 必须是 true 或 false');
  }
  return withSessionLock(paths, 'set-retention', () => {
    const loaded = loadSession(paths, { persistMigration: true });
    if (loaded.materializationRecovered) {
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    const nextValue = rawKeep === 'true';
    const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
    if (!dryRun) {
      loaded.metadata.retention.userRequested = nextValue;
      persistCollection(paths, loaded.session, loaded.metadata);
    }
    return {
      ok: true,
      action: 'set-retention',
      dryRun,
      userRequested: dryRun ? nextValue : loaded.metadata.retention.userRequested,
      ...(dryRun ? { note: '未持久化;去掉 --dry-run 后写入' } : { metadata: loaded.metadata }),
    };
  });
}

function requirePositiveInteger(value, label) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    throw new Error(`${label} 必须是正整数`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return parsed;
}

// 把采集会话内的绝对路径转成 fileBrowser 的 path 参数。会话目录位于 /by 之下时去掉该前缀；
// 位于工作区回退目录时无法映射到会话空间，调用方必须显式传 --workspace-root。
function toWorkspacePath(absolutePath, workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(absolutePath);
  if (!isInside(root, candidate) || candidate === root) {
    throw new Error(`路径不在会话空间根 ${workspaceRoot} 之内: ${absolutePath}`);
  }
  return `/${path.relative(root, candidate).split(path.sep).join('/')}`;
}

// 可选的绝对前缀，用于下游消费方无法解析站内相对路径的场景（例如把正文交给外部接口）。
// 只接受 http/https 的 origin；带凭据、路径、查询或片段的输入一律拒绝，避免拼出错误或泄露凭据的 URL。
function normalizeImageBaseUrl(value) {
  if (value === undefined) {
    return '';
  }
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    throw new Error('--base-url 不能为空');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`--base-url 不是合法 URL: ${raw}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('--base-url 只支持 http 或 https');
  }
  if (parsed.username || parsed.password) {
    throw new Error('--base-url 不得包含凭据');
  }
  if (parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
    throw new Error('--base-url 只能是 origin，不得包含路径、查询或片段');
  }
  return parsed.origin;
}

function buildImageDownloadUrl(workspacePath, resourceId, language, baseUrl) {
  const query = new URLSearchParams({
    resourceId: String(resourceId),
    path: workspacePath,
    language,
  });
  return `${baseUrl}${IMAGE_DOWNLOAD_ENDPOINT}?${query.toString()}`;
}

// 读取由 ingest upload-images 产出的「相对链接 → 目标 URL」映射。映射模式下不再按会话空间推导路径，
// 因此 --resource-id 与 --workspace-root 都不参与；只接受 http/https 绝对 URL 或站内绝对路径，
// 避免把正文改写成相对链接或非法协议。
function loadImageLinkMap(filePath) {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile()) {
    throw new Error(`--link-map-file 必须是普通文件: ${filePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    throw new Error(`--link-map-file 不是合法 JSON: ${error.message}`);
  }
  const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.linkMap
    ? parsed.linkMap
    : parsed;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('--link-map-file 必须是链接映射对象，或包含 linkMap 字段的对象');
  }
  const map = new Map();
  for (const [link, target] of Object.entries(raw)) {
    if (typeof target !== 'string' || !target.trim()) {
      throw new Error(`链接映射的目标必须是非空字符串: ${link}`);
    }
    const value = target.trim();
    if (/^https?:\/\//.test(value)) {
      map.set(link, value);
      continue;
    }
    if (value.startsWith('/')) {
      map.set(link, value);
      continue;
    }
    throw new Error(`链接映射的目标必须是 http/https URL 或站内绝对路径: ${link}`);
  }
  if (!map.size) {
    throw new Error('--link-map-file 未提供任何链接映射');
  }
  return map;
}

// 逐篇改写 sanitized 正文里的本地图片链接。默认按会话空间推导 fileBrowser 下载 URL，只做路径映射
// 不做上传；图片文件缺失时保留原链接并告警，避免把可用的相对链接换成死链。
// 传 --link-map-file 时改用映射模式：目标 URL 由上游（通常是 ingest upload-images 把图片传入知识库后）
// 提供，图片生命周期不再绑定采集会话，会话被 cleanup 删除后正文里的链接依然可用。
function rewriteImageLinks(paths, args) {
  const linkMapFile = typeof args['link-map-file'] === 'string' && args['link-map-file'].trim()
    ? args['link-map-file'].trim()
    : '';
  const linkMap = linkMapFile ? loadImageLinkMap(linkMapFile) : null;
  const resourceId = linkMap ? 0 : requirePositiveInteger(args['resource-id'], '--resource-id');
  const language = typeof args.language === 'string' && args.language.trim()
    ? args.language.trim()
    : DEFAULT_IMAGE_LINK_LANGUAGE;
  const workspaceRoot = typeof args['workspace-root'] === 'string' && args['workspace-root'].trim()
    ? path.resolve(args['workspace-root'].trim())
    : SANDBOX_WORKSPACE_ROOT;
  const baseUrl = normalizeImageBaseUrl(args['base-url']);
  const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
  return withSessionLock(paths, 'rewrite-image-links', () => {
    const { metadata } = loadSession(paths, { persistMigration: true });
    const selected = selectedItemIds(args, metadata);
    const warnings = [];
    const items = [];
    let rewrittenTotal = 0;
    const scopedItems = metadata.collection.items.filter((inventory) => !selected || selected.has(inventory.itemId));
    for (const inventory of scopedItems) {
      const sanitizedPath = inventory.materialization?.sanitizedPath;
      if (inventory.materialization?.status !== 'materialized' || typeof sanitizedPath !== 'string') {
        items.push({ itemId: inventory.itemId, status: 'skipped', reason: 'not-materialized', rewritten: 0 });
        continue;
      }
      const absoluteMarkdown = path.resolve(paths.root, sanitizedPath);
      const markdownDir = path.dirname(absoluteMarkdown);
      let markdown;
      try {
        markdown = fs.readFileSync(absoluteMarkdown, 'utf8');
      } catch (error) {
        warnings.push(`inventory ${inventory.itemId} 正文读取失败: ${error.message}`);
        items.push({ itemId: inventory.itemId, status: 'failed', reason: 'read-failed', rewritten: 0 });
        continue;
      }
      let rewritten = 0;
      let missing = 0;
      let unmappable = 0;
      const next = markdown.replace(LOCAL_IMAGE_LINK_PATTERN, (match, alt, relativeLink) => {
        // 映射模式：目标由上游提供，不读磁盘也不推导会话路径。映射缺失时保留原链接并告警。
        if (linkMap) {
          const mapped = linkMap.get(relativeLink);
          if (!mapped) {
            unmappable += 1;
            warnings.push(`inventory ${inventory.itemId} 链接映射缺失，已保留原链接: ${relativeLink}`);
            return match;
          }
          rewritten += 1;
          return `![${alt}](${mapped})`;
        }
        const decodedLink = (() => {
          try {
            return decodeURIComponent(relativeLink);
          } catch {
            return relativeLink;
          }
        })();
        if (decodedLink.split('/').includes('..')) {
          unmappable += 1;
          warnings.push(`inventory ${inventory.itemId} 图片链接含 .. 路径穿越，已保留原链接: ${relativeLink}`);
          return match;
        }
        const absoluteImage = path.resolve(markdownDir, decodedLink);
        if (!isInside(markdownDir, absoluteImage)) {
          unmappable += 1;
          warnings.push(`inventory ${inventory.itemId} 图片超出正文所在目录，已保留原链接: ${relativeLink}`);
          return match;
        }
        let imageStat;
        try {
          imageStat = fs.lstatSync(absoluteImage);
        } catch {
          missing += 1;
          warnings.push(`inventory ${inventory.itemId} 图片文件不存在，已保留原链接: ${relativeLink}`);
          return match;
        }
        if (!imageStat.isFile()) {
          missing += 1;
          warnings.push(`inventory ${inventory.itemId} 图片不是普通文件，已保留原链接: ${relativeLink}`);
          return match;
        }
        let workspacePath;
        try {
          workspacePath = toWorkspacePath(absoluteImage, workspaceRoot);
        } catch (error) {
          unmappable += 1;
          warnings.push(`inventory ${inventory.itemId} 图片无法映射到会话空间，已保留原链接: ${error.message}`);
          return match;
        }
        rewritten += 1;
        return `![${alt}](${buildImageDownloadUrl(workspacePath, resourceId, language, baseUrl)})`;
      });
      if (rewritten && !dryRun) {
        fs.writeFileSync(absoluteMarkdown, next, { mode: 0o600 });
      }
      rewrittenTotal += rewritten;
      items.push({
        itemId: inventory.itemId,
        status: rewritten || (!missing && !unmappable) ? 'success' : 'partial',
        sanitizedPath,
        rewritten,
        missing,
        unmappable,
      });
    }
    return {
      ok: true,
      action: 'rewrite-image-links',
      dryRun,
      mode: linkMap ? 'link-map' : 'workspace-path',
      selection: selected ? [...selected] : 'all',
      resourceId: linkMap ? undefined : resourceId,
      language: linkMap ? undefined : language,
      workspaceRoot: linkMap ? undefined : workspaceRoot,
      baseUrl: linkMap ? undefined : baseUrl,
      linkMapFile: linkMap ? linkMapFile : undefined,
      rewritten: rewrittenTotal,
      items,
      warnings,
    };
  });
}

// ── 一体化命令(由 knowledge-collection.mjs 分派) ──

/**
 * collect — 绑定命令: 登记执行器抓取结果(集合物化)。
 * 输入 --item-json-file 位于 .post-processing-inputs/: 单个物化载荷
 * (原 mark-materialized 格式)或 { items: [ ... ] } 批量载荷。
 * inventory 中缺失的 itemId 依据 canonicalItem + collection-result.json 自动补登,
 * 因此执行器输出产物后无需预先 init 登记。
 */
export function cmdCollect(paths, args) {
  const payloadPath = path.resolve(requireString(args['item-json-file'], '--item-json-file'));
  const { payload } = readPayload(paths, payloadPath, '--item-json-file');
  const items = Array.isArray(payload.items) ? payload.items : [payload];
  if (!items.length) {
    throw new Error('--item-json-file 未提供任何条目');
  }
  return withSessionLock(paths, 'collect', () => {
    const loaded = loadSession(paths, { skipCanonicalValidation: true });
    if (loaded.materializationRecovered) {
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    const { metadata, collectionResult, session } = loaded;
    const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
    const results = [];
    for (const update of items) {
      results.push(markOneMaterialized(paths, session, metadata, collectionResult, update));
    }
    // 登记完成后执行严格校验(与旧 init-session 后置校验语义一致)
    validateMetadata(metadata);
    validateCanonicalView(paths.root, collectionResult, metadata);
    if (dryRun) {
      return {
        ok: true,
        action: 'collect',
        dryRun: true,
        items: results,
        note: '校验通过;未持久化',
      };
    }
    persistCollection(paths, session, metadata);
    atomicWriteJson(paths.collectionResult, collectionResult);
    const drained = drainPendingArtifactCleanup(paths, metadata);
    if (drained.changed) {
      persistCollection(paths, session, metadata);
    }
    const warning = deletePayloadInput(payloadPath);
    return {
      ok: true,
      action: 'collect',
      items: results,
      warnings: [...(warning ? [warning] : []), ...drained.warnings],
    };
  });
}


/** 单条物化登记(原 mark-materialized 主体,inventory 缺失时按 canonicalItem 补登)。 */
function markOneMaterialized(paths, session, metadata, collectionResult, update) {
  const itemId = requireString(update.itemId, 'itemId');
  let inventory = metadata.collection.items.find((item) => item.itemId === itemId);
  if (!inventory) {
    const canonical = update.canonicalItem && typeof update.canonicalItem === 'object' ? update.canonicalItem : {};
    const sourceUrl = typeof canonical.url === 'string' ? canonical.url : '';
    if (!sourceUrl) {
      throw new Error('inventory 中不存在 itemId 且 canonicalItem.url 缺失: ' + itemId);
    }
    const backend = String(collectionResult.backend || '');
    inventory = {
      itemId,
      title: String(canonical.title || ''),
      sourceUrl,
      sourceItemId: null,
      sourceSkill: backend,
      backend,
      collectionFilters: collectionResult.filters && typeof collectionResult.filters === 'object' ? collectionResult.filters : {},
      rawArtifacts: [],
      materialization: {
        status: 'pending',
        markdownPath: null,
        sanitizedPath: null,
        pendingArtifactCleanup: [],
        reason: null,
      },
    };
    metadata.collection.items.push(inventory);
  }
  const markdownPath = requireString(update.markdownPath, 'markdownPath');
  const sanitizedPath = requireString(update.sanitizedPath, 'sanitizedPath');
  validateMarkdownPath(paths.root, markdownPath, 'markdownPath');
  validateMarkdownPath(paths.root, sanitizedPath, 'sanitizedPath');
  validatePathPrefix(paths.root, markdownPath, 'markdown', 'markdownPath');
  validatePathPrefix(paths.root, sanitizedPath, path.join('sanitized', 'items'), 'sanitizedPath');
  validateCanonicalItem(update.canonicalItem, sanitizedPath);
  if (update.canonicalItem.url !== inventory.sourceUrl) {
    throw new Error('canonicalItem.url 必须与 inventory.sourceUrl 一致');
  }
  const previousMaterialization = {
    ...inventory.materialization,
    pendingArtifactCleanup: [...(inventory.materialization.pendingArtifactCleanup || [])],
  };
  const persistedCanonicalItem = canonicalViewItem(update.canonicalItem);
  const changedPreviousPaths = [
    previousMaterialization.markdownPath,
    previousMaterialization.sanitizedPath,
  ].filter((previousPath) => (
    typeof previousPath === 'string'
    && previousPath
    && previousPath !== markdownPath
    && previousPath !== sanitizedPath
    && allowedWorkCopyPath(paths, previousPath)
  ));
  inventory.materialization = {
    status: 'materialized',
    markdownPath,
    sanitizedPath,
    pendingArtifactCleanup: [...new Set([
      ...previousMaterialization.pendingArtifactCleanup,
      ...changedPreviousPaths,
    ])],
    reason: null,
  };
  const items = (Array.isArray(collectionResult.items) ? collectionResult.items : [])
    .map(canonicalViewItem);
  const previousSanitizedPath = String(previousMaterialization.sanitizedPath || '');
  collectionResult.items = [
    ...items.filter((item) => item.fileName !== previousSanitizedPath && item.fileName !== sanitizedPath),
    persistedCanonicalItem,
  ];
  return {
    itemId,
    materialization: inventory.materialization,
    canonicalItem: persistedCanonicalItem,
  };
}

/** export-views — 由 session.json 生成兼容导出视图(sanitized/metadata.json + collection-result.json)。 */
export function cmdExportViews(paths) {
  return withSessionLock(paths, 'export-views', () => {
    const loaded = loadSession(paths, { persistMigration: true });
    const { metadata, collectionResult, session } = loaded;
    if (loaded.metadataChanged || loaded.collectionResultChanged) {
      persistCollection(paths, session, metadata);
      atomicWriteJson(paths.collectionResult, collectionResult);
    }
    atomicWriteJson(paths.metadata, metadata);
    return {
      ok: true,
      action: 'export-views',
      metadata,
      collectionResult,
      warnings: loaded.warnings,
    };
  });
}

/** collectionStatus — 供统一 status 命令汇总采集维度。 */
export function collectionStatus(paths) {
  // status 只写迁移/修复类恢复;正常 schema 2.0 读取不落盘。
  const loaded = loadSession(paths, { persistRecovery: true });
  const { metadata, collectionResult } = loaded;
  return {
    collectionStatus: metadata.collection.status,
    items: metadata.collection.items.length,
    materialized: metadata.collection.items
      .filter((item) => item.materialization?.status === 'materialized').length,
    runs: metadata.postProcessing.runs.length,
    retention: metadata.retention,
    canonicalItems: Array.isArray(collectionResult.items) ? collectionResult.items.length : 0,
    warnings: loaded.warnings || [],
  };
}

// 旧命令名导出(兼容别名,由统一 CLI 使用)
export const cmdInspect = inspect;
export const cmdRun = recordRun;
export const cmdCleanup = cleanup;
export const cmdUnlockStale = unlockStale;
export const cmdSetRetention = setRetention;
export const cmdRewriteImageLinks = rewriteImageLinks;
export function collectionHelp() {
  return {
    commands: {
      collect: '登记执行器抓取结果(集合物化;inventory 缺失时自动补登)',
      inspect: '读取并迁移后处理状态,检测相同 operation + target 的续跑选择',
      run: '追加或更新一次 post-processing run(ingest / organize / external)',
      cleanup: '按 run 状态执行完整会话或部分工作副本清理',
      'unlock-stale': '仅在锁持有 PID 已不存在时安全回收残留锁',
      'set-retention': '设置是否保留本次会话工作副本',
      'rewrite-image-links': '把 sanitized 正文里的本地图片相对链接改写为 fileBrowser 下载 URL',
      'export-views': '由 session.json 生成 sanitized/metadata.json 与 collection-result.json 导出视图',
    },
  };
}
