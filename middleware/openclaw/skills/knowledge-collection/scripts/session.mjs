#!/usr/bin/env node
/**
 * session.mjs — 知识采集一体化会话(单状态文件 session.json)共享基础设施。
 *
 * 单一事实源: <session-dir>/session.json(schemaVersion 2.0)
 *   { task, research, collection }
 * collection 子树只保存采集 inventory 与物化状态(schemaVersion 1.0);
 * sanitized/metadata.json 与 collection-result.json
 * 变为由 export-views 生成的导出视图(兼容旧消费者与 fileBrowser 预览)。
 *
 * 旧会话兼容: 目录只有 collection-result.json + sanitized/metadata.json 时,
 * 首次读写自动迁移为 session.json(不删除旧文件)。
 */
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const SESSION_SCHEMA_VERSION = '2.0';
export const COLLECTION_SCHEMA_VERSION = '1.0';
export const SENSITIVE_SESSION_KEY = /(token|cookie|secret|password|authorization|credential|device[_-]?code)/i;

export function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  return value;
}

export function requireNullableString(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} 必须是字符串或 null`);
  }
  return value;
}

export function readJson(filePath, label = filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`${label} 读取失败: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON: ${error.message}`);
  }
  return parsed;
}

export function readStandaloneJson(filePath, label) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return undefined;
  }
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`${label} 不存在: ${filePath}`);
  }
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} 必须是普通文件且不能是符号链接`);
  }
  return readJson(absolute, label);
}

export function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveTrustedSessionRoot(currentSessionRoot, label) {
  const configuredRoot = process.env.KNOWLEDGE_COLLECTION_SESSION_ROOT?.trim();
  const configuredSessionsRoot = process.env.KNOWLEDGE_COLLECTION_SESSIONS_ROOT?.trim();
  const sessionsRoot = configuredSessionsRoot
    ? path.resolve(configuredSessionsRoot)
    : (fs.existsSync('/by/.sessions') ? '/by/.sessions' : null);
  const sessionRoot = (configuredRoot || currentSessionRoot)
    ? path.resolve(configuredRoot || currentSessionRoot)
    : null;
  if (!sessionRoot) {
    throw new Error(`${label} 缺少当前 Agent 上下文的 Session Root`);
  }
  if (!sessionsRoot) {
    throw new Error(`${label} 无法验证当前 Agent 上下文的 Session Root`);
  }
  const sessionRelative = path.relative(sessionsRoot, sessionRoot);
  if (!sessionRelative
    || sessionRelative.startsWith('..')
    || path.isAbsolute(sessionRelative)
    || sessionRelative.split(path.sep).length !== 1) {
    throw new Error(`当前 Agent 上下文的 Session Root 必须是 ${sessionsRoot}/<sessionId>`);
  }
  if (fs.existsSync(sessionRoot)) {
    const sessionRootEntry = fs.lstatSync(sessionRoot);
    if (!sessionRootEntry.isDirectory() || sessionRootEntry.isSymbolicLink()) {
      throw new Error('当前 Agent 上下文的 Session Root 必须是普通目录且不能是符号链接');
    }
  }
  return sessionRoot;
}

function nearestExistingAncestor(candidate) {
  let existingAncestor = candidate;
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    existingAncestor = parent;
  }
  return existingAncestor;
}

/**
 * 对外路径以绝对路径传入时保持其位置；相对路径必须基于可信 Session Root 解析。
 * 相对路径仍需通过规范化路径和真实祖先双重校验，防止 `..` 或符号链接逃逸。
 */
export function resolveSandboxPath(rawPath, label, { currentSessionRoot } = {}) {
  const requested = requireString(rawPath, label);
  if (path.isAbsolute(requested)) {
    const candidate = path.resolve(requested);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`${label} 不能是符号链接`);
    }
    const ancestor = nearestExistingAncestor(candidate);
    if (ancestor !== candidate && !fs.statSync(ancestor).isDirectory()) {
      throw new Error(`${label} 的现有祖先必须是目录`);
    }
    return candidate;
  }

  const sessionRoot = resolveTrustedSessionRoot(currentSessionRoot, label);
  const candidate = path.resolve(sessionRoot, requested);
  const relative = path.relative(sessionRoot, candidate);
  const withinCurrentSession = !relative.startsWith('..')
    && !path.isAbsolute(relative);
  if (!withinCurrentSession) {
    throw new Error(`${label} 相对路径越出当前 Session Root: ${sessionRoot}`);
  }
  if (fs.existsSync(sessionRoot)) {
    const canonicalRoot = fs.realpathSync(sessionRoot);
    const existingAncestor = nearestExistingAncestor(candidate);
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`${label} 不能是符号链接`);
    }
    if ((existingAncestor !== candidate && !fs.statSync(existingAncestor).isDirectory())
      || !isInside(canonicalRoot, fs.realpathSync(existingAncestor))) {
      throw new Error(`${label} 相对路径通过符号链接越出当前 Session Root: ${sessionRoot}`);
    }
  }
  return candidate;
}

export function assertSandboxSessionPath(rawPath, label, options = {}) {
  return resolveSandboxPath(rawPath, label, options);
}

export function resolveCollectionInputFile(paths, rawFilePath, label) {
  const filePath = path.resolve(requireString(rawFilePath, label));
  const inputDir = path.resolve(paths.inputDir);
  if (!isInside(inputDir, filePath)) {
    throw new Error(`${label} 必须位于 .collection-inputs/ 内`);
  }
  if (!fs.existsSync(inputDir) || !fs.lstatSync(inputDir).isDirectory()) {
    throw new Error('采集会话必须包含普通目录 .collection-inputs/');
  }
  const canonicalInputDir = path.resolve(fs.realpathSync(paths.root), '.collection-inputs');
  const realInputDir = fs.realpathSync(inputDir);
  if (realInputDir !== canonicalInputDir) {
    throw new Error(`${label} 必须位于 .collection-inputs/ 内`);
  }
  if (!fs.existsSync(filePath)) throw new Error(`${label} 不存在: ${rawFilePath}`);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} 必须是普通 JSON 文件且不能是符号链接`);
  }
  const realFilePath = fs.realpathSync(filePath);
  if (!isInside(realInputDir, realFilePath)) {
    throw new Error(`${label} 必须位于 .collection-inputs/ 内`);
  }
  return realFilePath;
}

export function assertNoSensitiveKeys(value, currentPath = 'session.json') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_SESSION_KEY.test(key)) {
      throw new Error(`${currentPath}.${key} 包含禁止持久化的敏感字段`);
    }
    assertNoSensitiveKeys(item, `${currentPath}.${key}`);
  }
}

/** 会话路径集合。旧会话(无 session.json)同样可解析,由 loadSession 触发迁移。 */
export function sessionPaths(rawSessionDir) {
  const root = path.resolve(requireString(rawSessionDir, '--session-dir'));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`采集会话目录不存在: ${root}`);
  }
  const session = path.join(root, 'session.json');
  const collectionResult = path.join(root, 'collection-result.json');
  const metadata = path.join(root, 'sanitized', 'metadata.json');
  if (!fs.existsSync(session) && (!fs.existsSync(collectionResult) || !fs.existsSync(metadata))) {
    throw new Error('采集会话必须包含 session.json,或(旧格式)collection-result.json 与 sanitized/metadata.json');
  }
  return {
    root,
    session,
    collectionResult,
    metadata,
    inputDir: path.join(root, '.collection-inputs'),
    lock: path.join(root, '.knowledge-collection.lock'),
  };
}

export function emptyCollectionMetadata() {
  return {
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    storage: { fallback: false },
    collection: { status: 'complete', items: [] },
  };
}

export function newSession(task = {}) {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    task: {
      query: '',
      mode: 'collection',
      breadth: 3,
      depth: 2,
      concurrency: 2,
      maxContextWords: 25000,
      deadlineMinutes: null,
      maxBranches: null,
      maxSourcesPerBranch: null,
      maxSearchRounds: null,
      startedAt: new Date().toISOString(),
      initialSearch: [],
      followups: [],
      combinedQuery: null,
      discoveryChannels: null,
      stopReason: null,
      status: 'initialized',
      ...task,
    },
    research: {
      branches: [],
      learnings: [],
      citations: {},
      context: [],
      visitedUrls: [],
      reportPath: null,
    },
    collection: emptyCollectionMetadata(),
  };
}

/** 读取权威状态: 优先 session.json; 旧会话可按调用方要求只在内存中迁移。 */
export function loadSession(paths, { persistMigration = true } = {}) {
  if (fs.existsSync(paths.session)) {
    const session = readJson(paths.session, 'session.json');
    if (session?.schemaVersion !== SESSION_SCHEMA_VERSION) {
      throw new Error(`session.json schemaVersion 必须是 ${SESSION_SCHEMA_VERSION}`);
    }
    if (!session.collection || typeof session.collection !== 'object' || Array.isArray(session.collection)) {
      throw new Error('session.json collection 必须是对象');
    }
    if (!session.task || typeof session.task !== 'object' || Array.isArray(session.task)) {
      throw new Error('session.json task 必须是对象');
    }
    if (session.task.publicationStatus === 'uncommitted') {
      throw new Error('session.json 表示企业采集 bundle 未提交完成');
    }
    if (!session.research || typeof session.research !== 'object' || Array.isArray(session.research)) {
      throw new Error('session.json research 必须是对象');
    }
    return { session, migrated: false };
  }
  // 旧会话迁移: collection-result.json + sanitized/metadata.json → session.json
  const metadata = readJson(paths.metadata, 'sanitized/metadata.json');
  const session = newSession();
  session.collection = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : emptyCollectionMetadata();
  if (persistMigration) persistSession(paths, session);
  return { session, migrated: true };
}

/** 权威写入: 校验敏感字段后原子落盘 session.json。 */
export function persistSession(paths, session) {
  const activeRunId = session?.task?.activeOrchestrationRunId;
  if (activeRunId) {
    const run = session.task?.publicCollectRun;
    if (run?.runId !== activeRunId || Number(run?.actionLease?.pid) !== process.pid) {
      throw new Error(`ORCHESTRATION_IN_PROGRESS: run=${activeRunId}`);
    }
  }
  assertNoSensitiveKeys(session);
  atomicWriteJson(paths.session, session);
}

/** 写 collection 子树(collection-state 使用),保持 research/task 不变。 */
export function persistCollection(paths, session, collectionMetadata) {
  session.collection = collectionMetadata;
  persistSession(paths, session);
}

export function markDeliveryStale(session, reason = 'collection-updated') {
  if (session?.delivery?.schemaVersion === '1.0'
    && session.delivery.status === 'published') {
    session.delivery = {
      ...session.delivery,
      status: 'stale',
      reason,
      staleAt: new Date().toISOString(),
    };
  }
}

// ── 会话锁(pid/createdAt/ownerId/command) ──

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
  if (rawLock.processStartTime !== undefined && typeof rawLock.processStartTime !== 'number') {
    throw new Error('锁文件损坏: processStartTime 必须是数字');
  }
  return {
    pid: rawLock.pid,
    createdAt: rawLock.createdAt,
    ownerId: rawLock.ownerId,
    command: rawLock.command,
    processStartTime: rawLock.processStartTime,
  };
}

export function readLock(paths) {
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
  return assertLockShape(lock);
}

function sameLock(left, right) {
  return left?.pid === right?.pid
    && left?.createdAt === right?.createdAt
    && left?.ownerId === right?.ownerId
    && left?.command === right?.command
    && left?.processStartTime === right?.processStartTime;
}

export function linuxProcessStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const commEnd = stat.lastIndexOf(')');
    const fields = stat.slice(commEnd + 2).trim().split(/\s+/);
    // /proc/<pid>/stat: field 22 is starttime;after comm+state it is fields[19].
    const value = Number(fields[19]);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function isProcessAlive(pid, expectedStartTime) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    if (error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
  if (expectedStartTime !== undefined && process.platform === 'linux') {
    const actual = linuxProcessStartTime(pid);
    if (actual !== undefined && actual !== expectedStartTime) {
      return false;
    }
  }
  return true;
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
  const current = readLock(paths);
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
    const quarantinedLock = assertLockShape(JSON.parse(fs.readFileSync(quarantine, 'utf8')));
    if (!sameLock(expected, quarantinedLock)) {
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

export function acquireSessionLock(paths, command) {
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
          processStartTime: linuxProcessStartTime(process.pid),
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
      if (isProcessAlive(existing.pid, existing.processStartTime)) {
        throw new Error(`当前采集会话锁持有进程仍存活: pid=${existing.pid}, command=${existing.command}`);
      }
      const recovered = quarantineStaleLock(paths, existing);
      if (!recovered) {
        continue;
      }
    }
  }
  throw new Error('无法取得采集会话锁');
}

export function withSessionLock(paths, command, callback) {
  const { descriptor, ownerId } = acquireSessionLock(paths, command);
  try {
    return callback();
  } finally {
    try { fs.closeSync(descriptor); } catch {}
    try {
      const current = readLock(paths);
      if (current?.ownerId === ownerId) {
        fs.unlinkSync(paths.lock);
      }
    } catch {}
  }
}

/** 会话目录骨架(init 使用)。 */
export function ensureSessionSkeleton(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const directory of ['raw', 'markdown', 'sanitized', path.join('sanitized', 'items'), '.collection-inputs']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.join(root, directory), 0o700);
  }
}
