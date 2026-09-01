'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { recordPendingCollectionItem } from './collection-state.mjs';
import { atomicWriteJson, isInside, readJson } from './session.mjs';

const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SUCCESS_STATUSES = new Set(['saved', 'downloaded']);
const CHALLENGE_MARKER = /(?:登录后继续访问|内容加载中|验证码|访问过于频繁|环境异常|安全验证|captcha|verify\s+you)/i;
const RELATED_HEADING = /^(?:相关阅读|相关推荐|延伸阅读)$/;
const RELATED_LINK = /^\[[^\]]*\]\(https?:\/\/mp\.weixin\.qq\.com\/[^)]*\)$/i;
const REMOTE_IMAGE = /!\[[^\]]*\]\(\s*https?:\/\/[^)]+\)/gi;
const UI_MARKERS = new Set([
  '赞赏',
  '调整字体大小',
  'Scan to Follow',
  '暂无留言',
  '写留言',
  '轻触阅读原文',
  '向上滑动看下一个',
  '继续滑动看下一个',
]);

function elapsedMilliseconds(start, end) {
  const value = Number(end) - Number(start);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

function toPosixRelative(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join('/');
}

function assertSafeDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} 必须是普通目录且不能是符号链接`);
  }
}

function ensureSafeDirectory(root, segments, label) {
  let current = root;
  assertSafeDirectory(current, label);
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    assertSafeDirectory(current, label);
  }
  return current;
}

function resolveRawArtifact(paths, rawPath, label) {
  const requested = requireText(rawPath, label);
  const rawRoot = path.join(paths.root, 'raw');
  assertSafeDirectory(rawRoot, 'raw 目录');
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested) : path.resolve(paths.root, requested);
  if (!isInside(rawRoot, candidate) || candidate === rawRoot) {
    throw new Error(`${label} 必须位于会话 raw/ 内`);
  }
  const relativeSegments = path.relative(rawRoot, candidate).split(path.sep);
  let current = rawRoot;
  for (const segment of relativeSegments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) throw new Error(`${label} 不存在: ${requested}`);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} 路径不能包含符号链接`);
  }
  const stat = fs.statSync(candidate);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${label} 必须是非空普通文件`);
  const canonicalRawRoot = fs.realpathSync(rawRoot);
  const canonicalCandidate = fs.realpathSync(candidate);
  if (!isInside(canonicalRawRoot, canonicalCandidate)) throw new Error(`${label} 实际位置越出 raw/`);
  return {
    absolute: candidate,
    relative: toPosixRelative(paths.root, candidate),
    size: stat.size,
  };
}

function trustedResolvedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:'
      && url.hostname === 'mp.weixin.qq.com'
      && /^\/s(?:\/|$)/.test(url.pathname)
      ? url.toString() : null;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function paragraphCount(markdown, executorResult) {
  const title = typeof executorResult?.title === 'string' ? executorResult.title.trim() : '';
  const author = typeof executorResult?.author === 'string' ? executorResult.author.trim() : '';
  return markdown
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !paragraph.startsWith('# '))
    .filter((paragraph) => paragraph !== title && paragraph !== author)
    .length;
}

export function sanitizeWechatMarkdown(markdown, executorResult = {}) {
  const input = requireText(markdown, '微信 Markdown').replace(/\r\n?/g, '\n');
  const output = [];
  const removedBlocks = [];
  let inRelatedReading = false;
  let sawTerminalBoundary = false;
  let remoteMediaRemoved = 0;

  for (const originalLine of input.split('\n')) {
    const trimmed = originalLine.trim();
    if (RELATED_HEADING.test(trimmed)) {
      inRelatedReading = true;
      sawTerminalBoundary = true;
      removedBlocks.push('related-reading');
      continue;
    }
    if (inRelatedReading) {
      if (!trimmed || RELATED_LINK.test(trimmed)) continue;
      inRelatedReading = false;
    }
    if (UI_MARKERS.has(trimmed)) {
      sawTerminalBoundary = true;
      removedBlocks.push('wechat-ui');
      continue;
    }
    const withoutRemoteImages = originalLine.replace(REMOTE_IMAGE, () => {
      remoteMediaRemoved += 1;
      removedBlocks.push('remote-image');
      return '';
    });
    output.push(withoutRemoteImages);
  }

  const sanitized = `${output.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
  const inputParagraphs = paragraphCount(input, executorResult);
  const outputParagraphs = paragraphCount(sanitized, executorResult);
  const hasTitle = typeof executorResult.title === 'string' && executorResult.title.trim().length > 0;
  const hasChallenge = CHALLENGE_MARKER.test(input);
  const enoughBody = outputParagraphs >= 5;
  const hasTerminalBoundary = sawTerminalBoundary || sanitized.trim().length > 0;
  const confidence = hasTitle && !hasChallenge && enoughBody && hasTerminalBoundary ? 'high' : 'low';
  const reasonCodes = confidence === 'high'
    ? ['complete-wechat-article-structure']
    : [
      ...(hasChallenge ? ['challenge-or-login-marker'] : []),
      ...(!hasTitle ? ['missing-title'] : []),
      ...(!enoughBody ? ['insufficient-body-paragraphs'] : []),
      ...(!hasTerminalBoundary ? ['missing-terminal-boundary'] : []),
    ];
  return {
    markdown: sanitized,
    confidence,
    reasonCodes,
    removedBlocks: unique(removedBlocks),
    inputParagraphs,
    outputParagraphs,
    remoteMediaRemoved,
  };
}

function atomicWriteText(filePath, content) {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function frontmatter(executorResult, resolvedUrl) {
  return [
    '---',
    `title: ${JSON.stringify(String(executorResult.title || ''))}`,
    'source: public-internet',
    `source_url: ${JSON.stringify(resolvedUrl)}`,
    'collection_filters: {}',
    '---',
    '',
  ].join('\n');
}

export async function runWechatMaterialize(paths, args, options = {}) {
  const now = options.now || (() => performance.now());
  const totalStartedAt = now();
  const itemId = requireText(args?.['item-id'], '--item-id');
  if (!ITEM_ID.test(itemId)) throw new Error('--item-id 仅允许小写字母、数字、下划线和连字符，长度不超过 64');

  const parseStartedAt = now();
  const executorArtifact = resolveRawArtifact(paths, args?.['executor-result-file'], '--executor-result-file');
  const executorResult = readJson(executorArtifact.absolute, '--executor-result-file');
  if (!executorResult || typeof executorResult !== 'object' || Array.isArray(executorResult)) {
    throw new Error('--executor-result-file 必须包含单个 byCLI Weixin 下载结果对象');
  }
  if (!SUCCESS_STATUSES.has(executorResult.status) || executorResult.error) {
    throw new Error(`byCLI Weixin 下载未成功: ${String(executorResult.status || 'unknown')}`);
  }
  const resolvedUrl = trustedResolvedUrl(executorResult.resolved_url);
  if (!resolvedUrl) throw new Error('resolved_url 必须是可信 mp.weixin.qq.com/s 文章 URL');
  const savedArtifact = resolveRawArtifact(paths, executorResult.saved, 'executorResult.saved');
  if (!Number.isInteger(executorResult.size) || executorResult.size <= 0
    || executorResult.size !== savedArtifact.size) {
    throw new Error('executorResult.size 必须与 saved 文件实际大小一致');
  }
  const rawMarkdown = fs.readFileSync(savedArtifact.absolute, 'utf8');
  const parseMs = elapsedMilliseconds(parseStartedAt, now());

  const sanitizeStartedAt = now();
  const sanitized = sanitizeWechatMarkdown(rawMarkdown, executorResult);
  const sanitizeMs = elapsedMilliseconds(sanitizeStartedAt, now());
  const rawMaterializationDir = ensureSafeDirectory(paths.root, ['raw', 'materialization'], '物化诊断目录');
  const diagnosticsPath = path.join(rawMaterializationDir, `${itemId}.json`);
  const diagnosticsRelative = toPosixRelative(paths.root, diagnosticsPath);
  const rawArtifacts = [executorArtifact.relative, savedArtifact.relative, diagnosticsRelative];
  const baseDiagnostics = {
    schemaVersion: '1.0',
    itemId,
    ruleVersion: 'wechat-v1',
    confidence: sanitized.confidence,
    reasonCodes: sanitized.reasonCodes,
    removedBlocks: sanitized.removedBlocks,
    inputParagraphs: sanitized.inputParagraphs,
    outputParagraphs: sanitized.outputParagraphs,
    remoteMediaRemoved: sanitized.remoteMediaRemoved,
  };

  const writeStartedAt = now();
  atomicWriteJson(diagnosticsPath, { ...baseDiagnostics, timing: null });
  let collectPayloadPath = null;
  let materialization;
  if (sanitized.confidence === 'high') {
    const markdownDir = ensureSafeDirectory(paths.root, ['markdown', 'items', itemId], 'Markdown 工作目录');
    const sanitizedDir = ensureSafeDirectory(paths.root, ['sanitized', 'items', itemId], '净化正文目录');
    const markdownAbsolute = path.join(markdownDir, 'index.md');
    const sanitizedAbsolute = path.join(sanitizedDir, 'index.md');
    const rendered = `${frontmatter(executorResult, resolvedUrl)}${sanitized.markdown}`;
    atomicWriteText(markdownAbsolute, rendered);
    atomicWriteText(sanitizedAbsolute, rendered);
    const markdownPath = toPosixRelative(paths.root, markdownAbsolute);
    const sanitizedPath = toPosixRelative(paths.root, sanitizedAbsolute);
    const payload = {
      schemaVersion: '1.0',
      itemId,
      source: 'public-internet',
      sourceSkill: 'bycli',
      backend: 'bycli',
      rawArtifacts,
      contentGranularity: 'full-text',
      media: {
        coverStatus: 'unknown',
        coverCount: 0,
        materializedCoverCount: 0,
        reason: 'wechat-download-cover-not-classified',
      },
      markdownPath,
      sanitizedPath,
      canonicalItem: {
        title: String(executorResult.title || ''),
        url: resolvedUrl,
        author: String(executorResult.author || ''),
        publishTime: String(executorResult.publish_time || executorResult.publishTime || ''),
        markdown: sanitizedPath,
        fileName: sanitizedPath,
      },
    };
    collectPayloadPath = path.join(paths.inputDir, `wechat-${itemId}.json`);
    atomicWriteJson(collectPayloadPath, payload);
    materialization = {
      status: 'materialized',
      contentGranularity: 'full-text',
      markdownPath,
      sanitizedPath,
    };
  } else {
    const pending = recordPendingCollectionItem(paths, {
      itemId,
      source: 'public-internet',
      sourceSkill: 'bycli',
      backend: 'bycli',
      sourceUrl: resolvedUrl,
      title: String(executorResult.title || ''),
      rawArtifacts,
      media: {
        coverStatus: 'unknown',
        coverCount: 0,
        materializedCoverCount: 0,
        reason: 'wechat-download-cover-not-classified',
      },
      reason: 'wechat-materialization-low-confidence',
    });
    materialization = pending.materialization;
  }
  const writeMs = elapsedMilliseconds(writeStartedAt, now());
  const timing = {
    parseMs,
    sanitizeMs,
    writeMs,
    totalMs: elapsedMilliseconds(totalStartedAt, now()),
  };
  atomicWriteJson(diagnosticsPath, { ...baseDiagnostics, timing });
  return {
    ok: true,
    action: 'materialize-wechat',
    materialization,
    collectPayloadPath,
    diagnostics: diagnosticsRelative,
    timing,
  };
}
