'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  recordFailedCollectionItem,
  recordPendingCollectionItem,
} from './collection-state.mjs';
import { authorizePublicSource } from './discovery-authorization.mjs';
import { runCli } from './enterprise/shared/cli-runner.mjs';
import { loadSession } from './session.mjs';

export const ACQUIRE_WEB_TIMEOUT_MS = 45_000;
export const MAX_WEB_ARTICLE_BYTES = 10 * 1024 * 1024;
const EXTRACT_CHUNK_SIZE = 256 * 1024;
const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const STRONG_CHALLENGE_MARKER = /(?:验证码|安全验证|环境验证|访问过于频繁|captcha|verify\s+you)/i;
const LOGIN_MARKER = /(?:登录|log\s*in|sign\s*in)/i;
const MAX_LOGIN_PAGE_CHARS = 800;
const SENSITIVE_DIAGNOSTIC = /((?:authorization|cookie|credential|password|secret|token)\s*(?:=|:)\s*)(?:Bearer\s+)?[^\s,;]+/gi;
const MAX_DIAGNOSTIC_URL_CHARS = 2_000;
const DEFAULT_BRIDGE_SCRIPT = '/app/skills/bycli/scripts/bridge-bootstrap.mjs';
const LOCAL_BRIDGE_SCRIPT = fileURLToPath(new URL('../../bycli/scripts/bridge-bootstrap.mjs', import.meta.url));

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function toPosixRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function safeStderr(value) {
  return typeof value === 'string'
    ? value.replace(SENSITIVE_DIAGNOSTIC, '$1[REDACTED]').slice(0, 2_000) : '';
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isChallengePage(title, article) {
  if (STRONG_CHALLENGE_MARKER.test(`${title}\n${article}`)) return true;
  if (LOGIN_MARKER.test(title)) return true;
  return article.trim().length <= MAX_LOGIN_PAGE_CHARS && LOGIN_MARKER.test(article);
}

function outputErrorCode(outcome) {
  const parsed = parseJson(outcome?.stdout) || parseJson(outcome?.stderr);
  const code = parsed?.error?.code || parsed?.errorCode || parsed?.code;
  if (typeof code === 'string' && code) return code;
  const match = /\b(BROWSER_CONNECT|AUTH_REQUIRED|CAPTCHA|RATE_LIMITED|TIMEOUT)\b/i
    .exec(`${outcome?.stdout || ''}\n${outcome?.stderr || ''}`);
  return match ? match[1].toUpperCase() : 'COMMAND_EXEC';
}

function probeFailure(reasonCode) {
  const code = String(reasonCode || 'COMMAND_EXEC');
  return {
    status: ['BROWSER_CONNECT', 'TIMEOUT', 'COMMAND_EXEC', 'BRIDGE_UNAVAILABLE', 'BRIDGE_RECOVERY_BUSY']
      .includes(code) ? 'infrastructure-blocked' : 'unavailable',
    reasonCode: code,
  };
}

function normalizedHttpUrl(rawUrl, label) {
  let url;
  try {
    url = new URL(requireText(rawUrl, label));
  } catch {
    throw new Error(`${label} 必须是有效 HTTP URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${label} 必须是安全 HTTP URL`);
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  return url.toString();
}

function authorizationComparableUrl(rawUrl, label) {
  const normalized = normalizedHttpUrl(rawUrl, label);
  const url = new URL(normalized);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function authorizationEquivalentHttpUrl(left, right) {
  return authorizationComparableUrl(left, 'authorized URL')
    === authorizationComparableUrl(right, 'resolved URL');
}

function diagnosticUrl(value) {
  if (typeof value !== 'string') return null;
  return [...value].slice(0, MAX_DIAGNOSTIC_URL_CHARS).join('');
}

function failureDiagnostic(stage, mismatchKind, requestedUrl, resolvedUrl) {
  return {
    stage,
    mismatchKind,
    requestedUrl: diagnosticUrl(requestedUrl),
    resolvedUrl: diagnosticUrl(resolvedUrl),
  };
}

function resolvedUrlFromOutput(stdout) {
  const parsed = parseJson(stdout);
  if (parsed) {
    const candidate = parsed.url ?? parsed.value ?? parsed.resolvedUrl ?? parsed.resolved_url;
    return typeof candidate === 'string' ? normalizedHttpUrl(candidate, 'resolvedUrl') : null;
  }
  return typeof stdout === 'string' && stdout.trim()
    ? normalizedHttpUrl(stdout.trim(), 'resolvedUrl') : null;
}

function baseInventoryUpdate(itemId, sourceUrl, title = '') {
  return {
    itemId,
    source: 'public-internet',
    sourceSkill: 'bycli',
    backend: 'web',
    sourceUrl,
    title,
    rawArtifacts: [],
    reason: 'acquiring',
  };
}

function existingResult(paths, itemId, requestedUrl) {
  const targetDir = path.join(paths.root, 'raw', 'bycli', 'web', itemId);
  if (!fs.existsSync(targetDir)) return null;
  const resultPath = path.join(targetDir, 'executor-result.json');
  if (!fs.existsSync(resultPath) || fs.lstatSync(resultPath).isSymbolicLink()) {
    throw new Error(`ACQUISITION_CONFLICT: ${itemId} 已存在不完整抓取目录`);
  }
  const result = parseJson(fs.readFileSync(resultPath, 'utf8'));
  if (!result || result.requestedUrl !== requestedUrl) {
    throw new Error(`ACQUISITION_CONFLICT: ${itemId} 抓取身份不一致`);
  }
  if (result.status === 'saved' && typeof result.saved === 'string') {
    const saved = path.join(paths.root, result.saved);
    if (fs.existsSync(saved) && fs.statSync(saved).isFile()
      && fs.statSync(saved).size === result.size
      && sha256(fs.readFileSync(saved)) === result.sha256) {
      return { ...result, executorResult: toPosixRelative(paths.root, resultPath), idempotent: true };
    }
  }
  throw new Error(`ACQUISITION_CONFLICT: ${itemId} 已存在不可覆盖的抓取证据`);
}

function publishArtifacts(paths, itemId, result, article = null) {
  const transactionId = crypto.randomUUID();
  const temporaryRoot = path.join(paths.root, '.collection-tmp');
  const stage = path.join(temporaryRoot, `acquire-${transactionId}`);
  const targetParent = path.join(paths.root, 'raw', 'bycli', 'web');
  const target = path.join(targetParent, itemId);
  fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
  fs.mkdirSync(targetParent, { recursive: true, mode: 0o700 });
  try {
    if (article !== null) fs.writeFileSync(path.join(stage, 'article.md'), article, { mode: 0o600 });
    fs.writeFileSync(path.join(stage, 'executor-result.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    if (fs.existsSync(target)) throw new Error(`ACQUISITION_CONFLICT: ${itemId} 已存在抓取目录`);
    fs.renameSync(stage, target);
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return toPosixRelative(paths.root, path.join(target, 'executor-result.json'));
}

export async function acquireWebProbe(candidate, options = {}) {
  const requestedUrl = normalizedHttpUrl(
    candidate?.acquisitionUrls?.[0] || candidate?.canonicalUrl,
    'candidate acquisition URL',
  );
  const allowedUrls = new Set([candidate?.canonicalUrl, ...(candidate?.acquisitionUrls || [])]
    .map((url) => authorizationComparableUrl(url, 'candidate acquisition URL')));
  const requested = new URL(requestedUrl);
  const unsupportedHost = /(^|\.)(?:youtube\.com|youtu\.be|bilibili\.com|douyin\.com|x\.com|twitter\.com|reddit\.com|redd\.it|facebook\.com|instagram\.com|linkedin\.com|xiaohongshu\.com|xueqiu\.com)$/iu;
  const specializedFeed = /(?:^|\/)(?:feed|rss|atom)(?:[/.]|$)/iu.test(requested.pathname)
    || /\.(?:rss|atom|xml)$/iu.test(requested.pathname);
  if (unsupportedHost.test(requested.hostname) || specializedFeed) {
    return { status: 'unsupported', reasonCode: 'SOURCE_REQUIRES_SPECIALIZED_VERIFIER' };
  }
  const runProcess = options.runProcess || runCli;
  const now = options.now || Date.now;
  const startedAt = now();
  const totalTimeoutMs = Math.max(1, Math.min(
    ACQUIRE_WEB_TIMEOUT_MS,
    Number.isFinite(Number(options.remainingBudgetMs)) ? Number(options.remainingBudgetMs) : ACQUIRE_WEB_TIMEOUT_MS,
  ));
  const browserSession = `kc-probe-${String(options.probeId || crypto.randomUUID())
    .replace(/[^a-z0-9_-]/gi, '-').slice(0, 48)}`;
  const remaining = () => Math.max(1, totalTimeoutMs - (now() - startedAt));
  const execute = async (bin, commandArgs, maxOutputBytes = MAX_WEB_ARTICLE_BYTES) => {
    if (remaining() <= 1) throw new Error(`CLI timeout after ${totalTimeoutMs}ms`);
    return runProcess(bin, commandArgs, { timeoutMs: remaining(), maxOutputBytes });
  };
  const bridgeScript = options.bridgeScript || (fs.existsSync(DEFAULT_BRIDGE_SCRIPT)
    ? DEFAULT_BRIDGE_SCRIPT : LOCAL_BRIDGE_SCRIPT);
  let browserOpened = false;
  let keepForUserAction = false;
  try {
    const bridge = await execute(process.execPath, [bridgeScript, '--format', 'json'], 256 * 1024);
    if (bridge.exitCode !== 0 || parseJson(bridge.stdout)?.ok !== true) {
      return { status: 'infrastructure-blocked', reasonCode: 'BRIDGE_UNAVAILABLE' };
    }
    const open = await execute('bycli', ['browser', browserSession, 'open', requestedUrl], 256 * 1024);
    if (open.exitCode !== 0) {
      return probeFailure(outputErrorCode(open));
    }
    browserOpened = true;
    const currentUrl = await execute('bycli', ['browser', browserSession, 'get', 'url'], 256 * 1024);
    if (currentUrl.exitCode !== 0) {
      return probeFailure(outputErrorCode(currentUrl));
    }
    const resolvedUrl = resolvedUrlFromOutput(currentUrl.stdout);
    const resolved = resolvedUrl ? new URL(resolvedUrl) : null;
    const trustedWechatRedirect = requested.hostname === 'weixin.sogou.com'
      && resolved?.hostname === 'mp.weixin.qq.com' && /^\/s(?:\/|$)/u.test(resolved.pathname);
    if (!resolvedUrl || (!allowedUrls.has(authorizationComparableUrl(resolvedUrl, 'resolved URL'))
      && !trustedWechatRedirect)) {
      return {
        status: 'unavailable',
        reasonCode: 'SOURCE_NOT_AUTHORIZED_BY_DISCOVERY',
        failureDiagnostic: failureDiagnostic(
          'resolved-url-authorization',
          resolvedUrl ? 'redirect-not-authorized' : 'resolved-url-unavailable',
          requestedUrl,
          resolvedUrl,
        ),
      };
    }

    let expectedStart = 0;
    let totalChars = null;
    let title = '';
    let markdown = '';
    while (true) {
      const extracted = await execute('bycli', [
        'browser', browserSession, 'extract', '--chunk-size', String(EXTRACT_CHUNK_SIZE),
        '--start', String(expectedStart),
      ]);
      if (extracted.exitCode !== 0) {
        return probeFailure(outputErrorCode(extracted));
      }
      const chunk = parseJson(extracted.stdout);
      let chunkUrl = null;
      try { chunkUrl = normalizedHttpUrl(chunk?.url, 'extract.url'); } catch {}
      if (!chunkUrl || !authorizationEquivalentHttpUrl(chunkUrl, resolvedUrl)) {
        return {
          status: 'unavailable',
          reasonCode: 'EXECUTOR_CHUNK_INVALID',
          failureDiagnostic: failureDiagnostic(
            'extract-url-continuity', 'extract-url-changed', resolvedUrl, chunkUrl,
          ),
        };
      }
      if (chunk.start !== expectedStart || !Number.isInteger(chunk.end) || chunk.end < chunk.start
        || !Number.isInteger(chunk.total_chars) || (totalChars !== null && totalChars !== chunk.total_chars)
        || typeof chunk.content !== 'string') {
        return { status: 'unavailable', reasonCode: 'EXECUTOR_CHUNK_INVALID' };
      }
      totalChars ??= chunk.total_chars;
      const chunkTitle = typeof chunk.title === 'string' ? chunk.title.trim() : '';
      if (title && chunkTitle && title !== chunkTitle) {
        return { status: 'unavailable', reasonCode: 'EXECUTOR_CHUNK_INVALID' };
      }
      title ||= chunkTitle;
      markdown += chunk.content;
      if (Buffer.byteLength(markdown) > MAX_WEB_ARTICLE_BYTES) {
        return { status: 'unavailable', reasonCode: 'EXECUTOR_OUTPUT_TRUNCATED' };
      }
      if (chunk.next_start_char === null) {
        if (chunk.end !== totalChars) {
          return { status: 'unavailable', reasonCode: 'EXECUTOR_CHUNK_INVALID' };
        }
        break;
      }
      if (!Number.isInteger(chunk.next_start_char) || chunk.next_start_char !== chunk.end
        || chunk.next_start_char <= expectedStart) {
        return { status: 'unavailable', reasonCode: 'EXECUTOR_CHUNK_INVALID' };
      }
      expectedStart = chunk.next_start_char;
    }
    if (isChallengePage(title, markdown)) {
      keepForUserAction = true;
      return {
        status: 'requires-user-action', reasonCode: 'AUTH_OR_CHALLENGE',
        requestedUrl, resolvedUrl, title, browserSession,
      };
    }
    if (!markdown.trim()) return { status: 'unavailable', reasonCode: 'EXECUTOR_EMPTY_RESULT' };
    return { status: 'saved', requestedUrl, resolvedUrl, title, markdown, executor: 'bycli' };
  } catch (error) {
    return {
      status: 'infrastructure-blocked',
      reasonCode: /timeout after \d+ms/i.test(error.message) ? 'TIMEOUT' : 'COMMAND_EXEC',
    };
  } finally {
    if (browserOpened && !keepForUserAction) {
      try { await execute('bycli', ['browser', browserSession, 'close'], 256 * 1024); } catch {}
    }
  }
}

export function acquireWechatProbe(candidate, options = {}) {
  const hostname = new URL(candidate?.canonicalUrl).hostname;
  if (!['mp.weixin.qq.com', 'weixin.sogou.com'].includes(hostname)) {
    throw new Error('WECHAT_PROBE_SOURCE_INVALID');
  }
  return acquireWebProbe(candidate, { ...options, sourceFamily: 'wechat' });
}

export function acquireArxivProbe(candidate, options = {}) {
  const hostname = new URL(candidate?.canonicalUrl).hostname;
  const html = candidate?.acquisitionUrls?.find((url) => /^https:\/\/arxiv\.org\/html\//iu.test(url));
  if (hostname !== 'arxiv.org' || !html) throw new Error('ARXIV_HTML_PROBE_SOURCE_INVALID');
  return acquireWebProbe({
    ...candidate,
    acquisitionUrls: [html, ...candidate.acquisitionUrls.filter((url) => url !== html)],
  }, { ...options, sourceFamily: 'arxiv' });
}

export async function cleanupProbeSession(sessionId, options = {}) {
  if (!/^kc-probe-[a-z0-9_-]{1,64}$/iu.test(String(sessionId || ''))) {
    throw new Error('PROBE_BROWSER_SESSION_INVALID');
  }
  const runProcess = options.runProcess || runCli;
  const outcome = await runProcess('bycli', ['browser', sessionId, 'close'], {
    timeoutMs: 10_000,
    maxOutputBytes: 256 * 1024,
  });
  if (outcome.exitCode !== 0) throw new Error(`PROBE_BROWSER_CLEANUP_FAILED: ${outputErrorCode(outcome)}`);
  return { ok: true, sessionId };
}

export async function runWebAcquire(paths, args, options = {}) {
  const itemId = requireText(args?.['item-id'], '--item-id');
  if (!ITEM_ID.test(itemId)) throw new Error('--item-id 格式无效');
  const requestedUrl = normalizedHttpUrl(args?.['source-url'], '--source-url');
  const { session } = loadSession(paths, { persistMigration: false });
  const requestedAuthorization = authorizePublicSource(session.task?.discoveryGate, requestedUrl);
  if (!requestedAuthorization) throw new Error('SOURCE_NOT_AUTHORIZED_BY_DISCOVERY');
  const previous = existingResult(paths, itemId, requestedUrl);
  if (previous) return { ok: true, action: 'acquire-web', ...previous };

  recordPendingCollectionItem(paths, baseInventoryUpdate(itemId, requestedUrl));
  const runProcess = options.runProcess || runCli;
  const now = options.now || Date.now;
  const startedAtMs = now();
  const startedAt = new Date(startedAtMs).toISOString();
  const browserSession = `kc-web-${itemId}-${crypto.randomUUID().slice(0, 8)}`;
  let browserOpened = false;

  const remaining = () => Math.max(1, ACQUIRE_WEB_TIMEOUT_MS - (now() - startedAtMs));
  const execute = async (bin, commandArgs, maxOutputBytes = MAX_WEB_ARTICLE_BYTES) => {
    if (remaining() <= 1) throw new Error(`CLI timeout after ${ACQUIRE_WEB_TIMEOUT_MS}ms`);
    return runProcess(bin, commandArgs, { timeoutMs: remaining(), maxOutputBytes });
  };
  const bridgeScript = options.bridgeScript || (fs.existsSync(DEFAULT_BRIDGE_SCRIPT)
    ? DEFAULT_BRIDGE_SCRIPT : LOCAL_BRIDGE_SCRIPT);

  const finish = (partial, article = null, state = 'failed') => {
    const finishedAtMs = now();
    const savedRelative = article === null ? null : `raw/bycli/web/${itemId}/article.md`;
    const result = {
      schemaVersion: '1.0',
      executor: 'bycli',
      requestedUrl,
      resolvedUrl: partial.resolvedUrl || null,
      status: partial.status,
      exitCode: Number.isInteger(partial.exitCode) ? partial.exitCode : null,
      errorCode: partial.errorCode || null,
      timedOut: Boolean(partial.timedOut),
      truncated: Boolean(partial.truncated),
      saved: savedRelative,
      size: article === null ? 0 : Buffer.byteLength(article),
      sha256: article === null ? null : sha256(article),
      title: partial.title || '',
      browserSession: partial.status === 'requires-user-action' ? browserSession : null,
      startedAt,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: Math.max(0, finishedAtMs - startedAtMs),
      ...(partial.stderr ? { stderr: safeStderr(partial.stderr) } : {}),
      ...(partial.failureDiagnostic ? { failureDiagnostic: partial.failureDiagnostic } : {}),
    };
    const executorResult = publishArtifacts(paths, itemId, result, article);
    const rawArtifacts = [executorResult, ...(savedRelative ? [savedRelative] : [])];
    const update = {
      ...baseInventoryUpdate(itemId, requestedUrl, result.title),
      rawArtifacts,
      reason: partial.errorCode || (state === 'pending' ? 'awaiting-materialization' : 'acquisition-failed'),
    };
    if (state === 'failed') recordFailedCollectionItem(paths, update);
    else recordPendingCollectionItem(paths, update);
    return { ok: true, action: 'acquire-web', ...result, executorResult };
  };

  try {
    const bridge = await execute(process.execPath, [bridgeScript, '--format', 'json'], 256 * 1024);
    const bridgeResult = parseJson(bridge.stdout);
    if (bridge.exitCode !== 0 || bridgeResult?.ok !== true) {
      return finish({
        status: 'failed', exitCode: bridge.exitCode, errorCode: bridgeResult?.code || 'BRIDGE_UNAVAILABLE',
        stderr: bridge.stderr,
      });
    }

    const open = await execute('bycli', ['browser', browserSession, 'open', requestedUrl], 256 * 1024);
    if (open.exitCode !== 0) {
      return finish({
        status: 'failed', exitCode: open.exitCode, errorCode: outputErrorCode(open), stderr: open.stderr,
      });
    }
    browserOpened = true;

    const currentUrl = await execute('bycli', ['browser', browserSession, 'get', 'url'], 256 * 1024);
    if (currentUrl.exitCode !== 0) {
      return finish({
        status: 'failed', exitCode: currentUrl.exitCode,
        errorCode: outputErrorCode(currentUrl), stderr: currentUrl.stderr,
      });
    }
    const resolvedUrl = resolvedUrlFromOutput(currentUrl.stdout);
    if (!resolvedUrl) {
      return finish({ status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_RESOLVED_URL_UNAVAILABLE' });
    }
    try {
      if (!authorizationEquivalentHttpUrl(requestedUrl, resolvedUrl)) {
        const resolvedAuthorization = authorizePublicSource(session.task?.discoveryGate, resolvedUrl);
        if (resolvedAuthorization.candidateId !== requestedAuthorization.candidateId) {
          throw new Error('SOURCE_NOT_AUTHORIZED_BY_DISCOVERY');
        }
      }
    } catch (error) {
      return finish({
        status: 'failed', exitCode: 1, errorCode: 'SOURCE_NOT_AUTHORIZED_BY_DISCOVERY',
        resolvedUrl, stderr: error.message,
        failureDiagnostic: failureDiagnostic(
          'resolved-url-authorization', 'redirect-not-authorized', requestedUrl, resolvedUrl,
        ),
      });
    }

    let expectedStart = 0;
    let totalChars = null;
    let title = '';
    let article = '';
    while (true) {
      const extracted = await execute('bycli', [
        'browser', browserSession, 'extract', '--chunk-size', String(EXTRACT_CHUNK_SIZE),
        '--start', String(expectedStart),
      ]);
      if (extracted.exitCode !== 0) {
        return finish({
          status: 'failed', exitCode: extracted.exitCode,
          errorCode: outputErrorCode(extracted), resolvedUrl, stderr: extracted.stderr,
        });
      }
      const chunk = parseJson(extracted.stdout);
      let chunkUrl = null;
      try { chunkUrl = normalizedHttpUrl(chunk?.url, 'extract.url'); } catch {}
      if (!chunkUrl || !authorizationEquivalentHttpUrl(chunkUrl, resolvedUrl)) {
        return finish({
          status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_CHUNK_INVALID', resolvedUrl,
          failureDiagnostic: failureDiagnostic(
            'extract-url-continuity', 'extract-url-changed', resolvedUrl, chunkUrl,
          ),
        });
      }
      if (!Number.isInteger(chunk.start) || chunk.start !== expectedStart
        || !Number.isInteger(chunk.end) || chunk.end < chunk.start
        || !Number.isInteger(chunk.total_chars) || (totalChars !== null && totalChars !== chunk.total_chars)
        || typeof chunk.content !== 'string') {
        return finish({ status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_CHUNK_INVALID', resolvedUrl });
      }
      totalChars ??= chunk.total_chars;
      const chunkTitle = typeof chunk.title === 'string' ? chunk.title.trim() : '';
      if (title && chunkTitle && title !== chunkTitle) {
        return finish({ status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_CHUNK_INVALID', resolvedUrl });
      }
      title ||= chunkTitle;
      article += chunk.content;
      if (Buffer.byteLength(article) > MAX_WEB_ARTICLE_BYTES) {
        return finish({
          status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_OUTPUT_TRUNCATED',
          resolvedUrl, title, truncated: true,
        });
      }
      if (chunk.next_start_char === null) {
        if (chunk.end !== totalChars) {
          return finish({ status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_CHUNK_INVALID', resolvedUrl });
        }
        break;
      }
      if (!Number.isInteger(chunk.next_start_char) || chunk.next_start_char !== chunk.end
        || chunk.next_start_char <= expectedStart) {
        return finish({ status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_CHUNK_INVALID', resolvedUrl });
      }
      expectedStart = chunk.next_start_char;
    }

    if (isChallengePage(title, article)) {
      return finish({
        status: 'requires-user-action', exitCode: 0, errorCode: 'AUTH_OR_CHALLENGE', resolvedUrl, title,
      }, null, 'pending');
    }
    if (!article.trim()) {
      return finish({ status: 'failed', exitCode: 1, errorCode: 'EXECUTOR_EMPTY_RESULT', resolvedUrl, title });
    }
    const result = finish({ status: 'saved', exitCode: 0, resolvedUrl, title }, article, 'pending');
    try {
      await execute('bycli', ['browser', browserSession, 'close'], 256 * 1024);
      browserOpened = false;
    } catch {
      // The saved executor result is authoritative. The finally block makes one best-effort close retry.
    }
    return result;
  } catch (error) {
    const timedOut = /timeout after \d+ms/i.test(error.message);
    return finish({
      status: 'failed', exitCode: null, errorCode: timedOut ? 'TIMEOUT' : 'COMMAND_EXEC',
      timedOut, stderr: error.message,
    });
  } finally {
    if (browserOpened) {
      const target = path.join(paths.root, 'raw', 'bycli', 'web', itemId, 'executor-result.json');
      const persisted = fs.existsSync(target) ? parseJson(fs.readFileSync(target, 'utf8')) : null;
      if (persisted?.status !== 'requires-user-action') {
        try { await execute('bycli', ['browser', browserSession, 'close'], 256 * 1024); } catch {}
      }
    }
  }
}
