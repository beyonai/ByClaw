#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ITEM_STATUSES = new Set(['success', 'failed', 'pending', 'unknown']);
const RUN_STATUSES = new Set(['success', 'partial', 'failed', 'unknown']);
const CLEANUP_STATUSES = new Set(['not-started', 'pending', 'completed', 'failed', 'skipped-retention', 'superseded']);
const OPERATIONS = new Set(['ingest', 'organize', 'external']);
const GLOBAL_STAGE_STATUSES = new Set(['not-required', 'pending', 'success', 'failed', 'unknown']);
const SESSION_STATUSES = new Set(['success', 'partial', 'failed', 'unknown']);
const SELECTION_MODES = new Set(['all', 'items']);
const METADATA_VERSION = '1.0';
const SENSITIVE_METADATA_KEY = /(token|cookie|secret|password|authorization|credential|device[_-]?code)/i;

function render(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseArgs(argv) {
  const command = argv[0];
  const args = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`无法识别的参数: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return { command, args };
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value.trim();
}

function requireNullableString(value, label) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串或 null`);
  }
}

function readJson(filePath, label = filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} 读取失败: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON: ${error.message}`);
  }
}

function readStandaloneJson(rawFilePath, label) {
  const filePath = path.resolve(requireString(rawFilePath, label));
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} 必须是普通 JSON 文件且不能是符号链接`);
  }
  return readJson(filePath, label);
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sessionPaths(rawSessionDir) {
  const root = path.resolve(requireString(rawSessionDir, '--session-dir'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`采集会话目录不存在: ${root}`);
  }
  const collectionResult = path.join(root, 'collection-result.json');
  const metadata = path.join(root, 'sanitized', 'metadata.json');
  if (!fs.existsSync(collectionResult) || !fs.existsSync(metadata)) {
    throw new Error('采集会话必须包含 collection-result.json 与 sanitized/metadata.json');
  }
  return {
    root,
    collectionResult,
    metadata,
    inputDir: path.join(root, '.post-processing-inputs'),
    lock: path.join(root, '.knowledge-collection-post-processing.lock'),
  };
}

function readLock(paths) {
  let stat;
  try {
    stat = fs.lstatSync(paths.lock);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('锁文件损坏: 必须是普通文件且不能是符号链接');
  }
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(paths.lock, 'utf8'));
  } catch (error) {
    throw new Error(`锁文件损坏: ${error.message}`);
  }
  if (
    !Number.isInteger(lock?.pid)
    || lock.pid <= 0
    || typeof lock.createdAt !== 'string'
    || typeof lock.ownerId !== 'string'
    || !lock.ownerId
    || typeof lock.command !== 'string'
    || !lock.command
  ) {
    throw new Error('锁文件损坏: 缺少合法 pid、createdAt、ownerId 或 command');
  }
  return lock;
}

function sameLock(left, right) {
  return left?.pid === right?.pid
    && left?.createdAt === right?.createdAt
    && left?.ownerId === right?.ownerId
    && left?.command === right?.command;
}

function assertLockShape(rawLock) {
  if (
    !Number.isInteger(rawLock?.pid)
    || rawLock.pid <= 0
    || typeof rawLock.createdAt !== 'string'
    || typeof rawLock.ownerId !== 'string'
    || !rawLock.ownerId
    || typeof rawLock.command !== 'string'
    || !rawLock.command
  ) {
    throw new Error('锁文件损坏: 缺少合法 pid、createdAt、ownerId 或 command');
  }
  return {
    pid: rawLock.pid,
    createdAt: rawLock.createdAt,
    ownerId: rawLock.ownerId,
    command: rawLock.command,
  };
}

function loadAndValidateLock(paths) {
  let content;
  try {
    content = fs.readFileSync(paths.lock, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  try {
    return assertLockShape(JSON.parse(content));
  } catch (error) {
    if (error.message.startsWith('锁文件损坏')) {
      throw error;
    }
    throw new Error(`锁文件损坏: ${error.message}`);
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    if (error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

function quarantineStaleLock(paths, lock) {
  const expected = assertLockShape(lock);
  let expectedStat;
  try {
    expectedStat = fs.lstatSync(paths.lock);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (!expectedStat.isFile()) {
    return false;
  }
  const current = loadAndValidateLock(paths);
  if (!current || !sameLock(expected, current)) {
    return false;
  }
  const quarantine = `${paths.lock}.stale.${lock.ownerId}.${crypto.randomUUID()}`;
  try {
    fs.renameSync(paths.lock, quarantine);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY') {
      return false;
    }
    throw error;
  }
  try {
    const currentAfterRename = fs.lstatSync(paths.lock);
    if (currentAfterRename.isSymbolicLink() || !currentAfterRename.isFile()) {
      throw new Error('锁文件损坏: 遭到不受信任篡改');
    }
    fs.rmSync(quarantine, { force: true });
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  try {
    const quarantineStat = fs.lstatSync(quarantine);
    if (quarantineStat.isSymbolicLink() || !quarantineStat.isFile()) {
      throw new Error('锁文件损坏: 归档路径类型异常');
    }
    let quarantinedLock;
    try {
      quarantinedLock = assertLockShape(JSON.parse(fs.readFileSync(quarantine, 'utf8')));
    } catch (error) {
      throw new Error(`锁文件损坏: 归档内容无效: ${error.message}`);
    }
    if (!sameLock(expected, quarantinedLock)) {
      // Another stale-lock reclaimer moved a newer owner between our check and rename.
      // Restore it without overwriting a lock that may have been created meanwhile.
      try {
        fs.linkSync(quarantine, paths.lock);
      } catch (error) {
        if (error.code === 'EEXIST') {
          throw new Error('锁状态在回收期间发生变化，请稍后重试');
        }
        throw error;
      }
      fs.rmSync(quarantine, { force: true });
      return false;
    }
    fs.rmSync(quarantine, { force: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

function removeLockByIdentity(paths, identity) {
  if (!identity) {
    return false;
  }
  try {
    const current = fs.lstatSync(paths.lock);
    if (current.isSymbolicLink() || !current.isFile()
      || current.dev !== identity.dev || current.ino !== identity.ino) {
      return false;
    }
    fs.unlinkSync(paths.lock);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function acquireSessionLock(paths, command) {
  const ownerId = crypto.randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor;
    let createdIdentity;
    try {
      descriptor = fs.openSync(paths.lock, 'wx', 0o600);
      const created = fs.fstatSync(descriptor);
      createdIdentity = { dev: created.dev, ino: created.ino };
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
          ownerId,
          command,
        })}\n`);
      } catch (error) {
        try { fs.closeSync(descriptor); } catch {}
        descriptor = undefined;
        removeLockByIdentity(paths, createdIdentity);
        throw error;
      }
      return { descriptor, ownerId };
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
        removeLockByIdentity(paths, createdIdentity);
      }
      if (error.code !== 'EEXIST') {
        throw error;
      }
      const existing = readLock(paths);
      if (!existing) {
        continue;
      }
      if (isProcessAlive(existing.pid)) {
        throw new Error(`当前采集会话锁持有进程仍存活: pid=${existing.pid}, command=${existing.command}`);
      }
      const recovered = quarantineStaleLock(paths, existing);
      if (!recovered) {
        continue;
      }
    }
  }
  throw new Error('无法取得采集会话后处理锁');
}

function releaseSessionLock(paths, ownerId) {
  try {
    const current = readLock(paths);
    if (current?.ownerId === ownerId) {
      fs.unlinkSync(paths.lock);
    }
  } catch {}
}

function withSessionLock(paths, command, callback) {
  const { descriptor, ownerId } = acquireSessionLock(paths, command);
  try {
    return callback();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    releaseSessionLock(paths, ownerId);
  }
}

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

function loadSession(paths, { persistMigration = false } = {}) {
  const collectionResult = readJson(paths.collectionResult, 'collection-result.json');
  const rawMetadata = readJson(paths.metadata, 'sanitized/metadata.json');
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
  validateCanonicalView(paths.root, collectionResult, metadata);
  const metadataChanged = migratedMetadata !== rawMetadata || normalized.changed || materializations.changed;
  if ((persistMigration && metadataChanged) || materializations.recovered) {
    atomicWriteJson(paths.metadata, metadata);
  }
  if (collectionResultChanged || materializations.recovered) {
    atomicWriteJson(paths.collectionResult, collectionResult);
  }
  return {
    metadata,
    collectionResult,
    metadataChanged,
    collectionResultChanged,
    materializationRecovered: materializations.recovered,
    warnings: [...normalized.warnings, ...materializations.warnings],
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

function markMaterialized(paths, args) {
  const { payload: update } = readPayload(paths, args['item-json-file'], '--item-json-file');
  return withSessionLock(paths, 'mark-materialized', () => {
    const { metadata, collectionResult } = loadSession(paths);
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
    atomicWriteJson(paths.metadata, metadata);
    const drained = drainPendingArtifactCleanup(paths, metadata);
    if (drained.changed) {
      atomicWriteJson(paths.metadata, metadata);
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
  const { payload: run } = readPayload(paths, args['run-json-file'], '--run-json-file');
  return withSessionLock(paths, 'record-run', () => {
    const loaded = loadSession(paths);
    const { metadata } = loaded;
    if (loaded.materializationRecovered) {
      throw new Error('检测到无效 materialization，已安全降级为 pending；请先由原始执行器重新物化');
    }
    validateRun(run, new Set(metadata.collection.items.map((item) => item.itemId)));
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
    atomicWriteJson(paths.metadata, metadata);
    return { ok: true, action: 'record-run', runId: run.runId, metadata };
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
    const loaded = loadSession(paths, { persistMigration: true });
    const { metadata, collectionResult } = loaded;
    const warnings = [...loaded.warnings];
    if (!loaded.materializationRecovered) {
      const drained = drainPendingArtifactCleanup(paths, metadata);
      warnings.push(...drained.warnings);
      if (drained.changed) {
        atomicWriteJson(paths.metadata, metadata);
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
    return {
      ok: true,
      action: 'inspect',
      metadata,
      collectionResult,
      matchingRun: matchingRun || null,
      requiresResumeChoice,
      resumeChoices: requiresResumeChoice ? ['all', 'failed-only'] : [],
      failedItemIds,
      requiresGlobalStageRetry,
      warnings,
    };
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
    const { metadata, collectionResult } = loaded;
    if (loaded.materializationRecovered) {
      atomicWriteJson(paths.metadata, metadata);
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
    const retention = Boolean(metadata.retention?.auditRequired || metadata.retention?.userRequested);
    if (retention) {
      for (const item of successful) {
        item.cleanupStatus = 'skipped-retention';
      }
      atomicWriteJson(paths.metadata, metadata);
      return { ok: true, action: 'cleanup', runId, retention: true, removedSession: false, metadata };
    }

    const inventoryIds = new Set(metadata.collection.items.map((item) => item.itemId));
    const selectedIds = new Set(run.selection.itemIds);
    const coversInventory = run.selection.discardUnselected === true
      || (selectedIds.size === inventoryIds.size && [...inventoryIds].every((itemId) => selectedIds.has(itemId)));
    const selectedAllSuccess = run.status === 'success'
      && run.items.length === selectedIds.size
      && run.items.every((item) => item.status === 'success')
      && run.items.every((item) => !['completed', 'superseded'].includes(item.cleanupStatus));
    if (coversInventory && selectedAllSuccess) {
      const removedPath = paths.root;
      fs.rmSync(paths.root, { recursive: true, force: true });
      return { ok: true, action: 'cleanup', runId, removedSession: true, removedPath };
    }

    for (const item of successful) {
      item.cleanupStatus = 'pending';
    }
    atomicWriteJson(paths.metadata, metadata);

    const deletedSanitized = new Set();
    for (const runItem of successful) {
      const inventory = metadata.collection.items.find((item) => item.itemId === runItem.itemId);
      if (!inventory) {
        throw new Error(`cleanup itemId 不在 inventory 中: ${runItem.itemId}`);
      }
      const artifacts = [
        ['markdownPath', inventory.materialization.markdownPath],
        ['sanitizedPath', inventory.materialization.sanitizedPath],
      ].filter(([, relativePath]) => typeof relativePath === 'string' && relativePath);
      for (const [field, relativePath] of artifacts) {
        validateRelativePath(paths.root, relativePath, `${runItem.itemId}.${field}`, { allowMissing: true });
      }
      const cleanedArtifacts = [];
      const failedArtifacts = [];
      let failed = false;
      for (const [field, relativePath] of artifacts) {
        try {
          deleteArtifact(paths, relativePath, `${runItem.itemId}.${field}`);
          cleanedArtifacts.push(relativePath);
          if (field === 'sanitizedPath') {
            deletedSanitized.add(relativePath);
          }
        } catch (error) {
          failed = true;
          failedArtifacts.push(relativePath);
          runItem.reason = runItem.reason || error.message;
        }
      }
      runItem.cleanedArtifacts = [...new Set([...(runItem.cleanedArtifacts || []), ...cleanedArtifacts])];
      const previousPending = Array.isArray(inventory.materialization.pendingArtifactCleanup)
        ? inventory.materialization.pendingArtifactCleanup
        : [];
      if (failed) {
        inventory.materialization.pendingArtifactCleanup = [
          ...new Set([
            ...previousPending,
            ...failedArtifacts,
          ]),
        ].filter((artifact) => typeof artifact === 'string' && artifact.length > 0);
        runItem.cleanupStatus = 'failed';
        inventory.materialization.status = 'pending';
        inventory.materialization.reason = runItem.reason || 'cleanup-failed';
        inventory.materialization.markdownPath = null;
        inventory.materialization.sanitizedPath = null;
      } else {
        for (const [field] of artifacts) {
          inventory.materialization[field] = null;
        }
        runItem.cleanupStatus = 'completed';
        if (!inventory.materialization.markdownPath && !inventory.materialization.sanitizedPath) {
          inventory.materialization.status = 'pending';
          inventory.materialization.reason = null;
          inventory.materialization.pendingArtifactCleanup = previousPending;
        }
      }
    }
    collectionResult.items = (Array.isArray(collectionResult.items) ? collectionResult.items : [])
      .filter((item) => !deletedSanitized.has(item.fileName));
    atomicWriteJson(paths.collectionResult, collectionResult);
    atomicWriteJson(paths.metadata, metadata);
    return { ok: true, action: 'cleanup', runId, retention: false, removedSession: false, metadata, collectionResult };
  });
}

function unlockStale(paths) {
  const lock = readLock(paths);
  if (!lock) {
    return { ok: true, action: 'unlock-stale', removed: false, previousLock: null };
  }
  if (isProcessAlive(lock.pid)) {
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
    loaded.metadata.retention.userRequested = rawKeep === 'true';
    atomicWriteJson(paths.metadata, loaded.metadata);
    return {
      ok: true,
      action: 'set-retention',
      userRequested: loaded.metadata.retention.userRequested,
      metadata: loaded.metadata,
    };
  });
}

function help() {
  return {
    name: 'knowledge-collection-post-processing',
    inputDirectory: '.post-processing-inputs/',
    schemaVersion: METADATA_VERSION,
    cleanupStatuses: [...CLEANUP_STATUSES],
    targets: {
      ingest: { kind: 'knowledge-base', id: 'resource-id', path: '/confirmed-directory' },
      organize: { kind: 'knowledge-organization', id: 'organization-run-key' },
      external: { kind: 'external', id: 'stable-task-key' },
    },
    payloads: {
      'mark-materialized': {
        schemaVersion: METADATA_VERSION,
        itemId: 'inventory-item-id',
        markdownPath: 'markdown/item.md',
        sanitizedPath: 'sanitized/items/item.md',
        persistedMaterializationFields: [
          'status', 'markdownPath', 'sanitizedPath', 'pendingArtifactCleanup', 'reason',
        ],
        canonicalItem: ['title', 'url', 'author', 'publishTime', 'markdown', 'fileName'],
      },
      'record-run': {
        schemaVersion: METADATA_VERSION,
        fields: ['runId', 'operation', 'target', 'selection', 'status', 'sessionStatus', 'globalStage', 'items'],
        selection: ['mode', 'itemIds', 'discardUnselected', 'discardUnselectedConfirmed'],
        selectionModes: [...SELECTION_MODES],
        sessionStatuses: [...SESSION_STATUSES],
      },
    },
    commands: {
      'init-session': '创建并校验私有采集会话骨架，写入 canonical view 与 inventory metadata',
      inspect: '读取并迁移后处理状态，检测相同 operation + target 的续跑选择',
      'mark-materialized': '登记原始执行器生成的 Markdown 与 sanitized 正文',
      'record-run': '追加或更新一次 post-processing run',
      cleanup: '按 run 状态执行完整会话或部分工作副本清理',
      'unlock-stale': '仅在锁持有 PID 已不存在时安全回收残留锁',
      'set-retention': '设置是否保留本次会话工作副本',
    },
  };
}

function validateInitialCollectionResult(collectionResult) {
  if (!collectionResult || typeof collectionResult !== 'object' || Array.isArray(collectionResult)) {
    throw new Error('collection-result.json 根节点必须是对象');
  }
  const allowed = new Set(['schemaVersion', 'title', 'source', 'backend', 'url', 'filters', 'items']);
  const unexpected = Object.keys(collectionResult).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new Error(`collection-result.json 包含不支持的字段: ${unexpected.join(', ')}`);
  }
  if (collectionResult.schemaVersion !== METADATA_VERSION) {
    throw new Error(`collection-result.json schemaVersion 必须是 ${METADATA_VERSION}`);
  }
  for (const key of ['title', 'source', 'backend', 'url']) {
    requireString(collectionResult[key], `collection-result.json.${key}`);
  }
  if (!collectionResult.filters || typeof collectionResult.filters !== 'object' || Array.isArray(collectionResult.filters)) {
    throw new Error('collection-result.json filters 必须是对象');
  }
  if (!Array.isArray(collectionResult.items)) {
    throw new Error('collection-result.json items 必须是数组');
  }
  if (collectionResult.items.length > 10) {
    throw new Error('init-session 最多允许预物化 10 篇正文');
  }
}

function initSession(args) {
  const root = path.resolve(requireString(args['session-dir'], '--session-dir'));
  const metadataInput = readStandaloneJson(args['metadata-input-file'], '--metadata-input-file');
  const collectionResult = readStandaloneJson(
    args['collection-result-input-file'],
    '--collection-result-input-file',
  );
  validateInitialCollectionResult(collectionResult);
  if (fs.existsSync(root)) {
    if (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length > 0) {
      throw new Error(`目标 session 目录必须不存在或为空: ${root}`);
    }
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const directory of ['raw', 'markdown', 'sanitized', path.join('sanitized', 'items'), '.post-processing-inputs']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(root, directory), 0o700);
  }
  try {
    atomicWriteJson(path.join(root, 'collection-result.json'), collectionResult);
    atomicWriteJson(path.join(root, 'sanitized', 'metadata.json'), metadataInput);
    const paths = sessionPaths(root);
    const loaded = loadSession(paths, { persistMigration: true });
    if (loaded.materializationRecovered) {
      throw new Error('初始化 metadata 包含无效 materialization');
    }
    return {
      ok: true,
      action: 'init-session',
      sessionDir: root,
      metadata: loaded.metadata,
      collectionResult: loaded.collectionResult,
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === 'help') {
    render(help());
    return;
  }
  if (command === 'init-session') {
    render(initSession(args));
    return;
  }
  const paths = sessionPaths(args['session-dir']);
  const inputFile = command === 'mark-materialized'
    ? path.resolve(requireString(args['item-json-file'], '--item-json-file'))
    : command === 'record-run'
      ? path.resolve(requireString(args['run-json-file'], '--run-json-file'))
      : null;
  let result;
  try {
    if (command === 'inspect') {
      result = inspect(paths, args);
    } else if (command === 'mark-materialized') {
      result = markMaterialized(paths, args);
    } else if (command === 'record-run') {
      result = recordRun(paths, args);
    } else if (command === 'cleanup') {
      result = cleanup(paths, args);
    } else if (command === 'unlock-stale') {
      result = unlockStale(paths);
    } else if (command === 'set-retention') {
      result = setRetention(paths, args);
    } else {
      throw new Error(`未知命令: ${command}`);
    }
    if (inputFile) {
      fs.unlinkSync(inputFile);
    }
  } catch (error) {
    if (inputFile && error instanceof Error) {
      error.inputFile = inputFile;
    }
    throw error;
  }
  render(result);
}

try {
  main();
} catch (error) {
  render({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    ...(error instanceof Error && typeof error.inputFile === 'string' ? { inputFile: error.inputFile } : {}),
  });
  process.exitCode = 1;
}
