'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  recordPendingCollectionItem,
  registerArxivAcquisitionVariant,
  registerFullTextEvidenceReceipt,
} from './collection-state.mjs';
import { atomicWriteJson, isInside, readJson } from './session.mjs';

const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TRUNCATION_MARKER = /(?:content\s+truncated|output\s+truncated|正文截断|内容截断|…\s*truncated)/i;
const MIN_BODY_CHARACTERS = 5_000;
const MIN_SECTION_HEADINGS = 5;

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
  let current = rawRoot;
  for (const segment of path.relative(rawRoot, candidate).split(path.sep)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) throw new Error(`${label} 不存在: ${requested}`);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} 路径不能包含符号链接`);
  }
  const stat = fs.statSync(candidate);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${label} 必须是非空普通文件`);
  if (!isInside(fs.realpathSync(rawRoot), fs.realpathSync(candidate))) {
    throw new Error(`${label} 实际位置越出 raw/`);
  }
  return { absolute: candidate, relative: toPosixRelative(paths.root, candidate), size: stat.size };
}

function arxivRepresentation(rawUrl, label) {
  let url;
  try {
    url = new URL(requireText(rawUrl, label));
  } catch {
    throw new Error(`${label} 必须是合法 arXiv URL`);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'arxiv.org'
    || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} 必须是无凭证、无查询参数的可信 arXiv HTTPS URL`);
  }
  const match = /^\/(abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/i.exec(url.pathname);
  if (!match) throw new Error(`${label} 必须是 arXiv abs、pdf 或 html 论文 URL`);
  const paperId = match[2].replace(/v\d+$/i, '').toLowerCase();
  if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})$/i.test(paperId)) {
    throw new Error(`${label} 的 arXiv 论文 ID 无效`);
  }
  return { url: url.toString(), paperId, representation: match[1].toLowerCase() };
}

function metadataIdentity(metadata) {
  const id = String(metadata?.id || metadata?.arxivId || metadata?.entry_id || '').trim()
    .replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf|html)\//i, '')
    .replace(/\.pdf$/i, '')
    .replace(/v\d+$/i, '')
    .toLowerCase();
  if (!id) throw new Error('--metadata-file 缺少 arXiv 论文 ID');
  return id;
}

function selectMetadataRecord(rawMetadata, paperId) {
  const queue = [rawMetadata];
  const seen = new Set();
  const matches = [];
  const envelopeKeys = ['data', 'result', 'paper', 'item', 'items', 'papers', 'results'];
  while (queue.length > 0) {
    const value = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    try {
      if (metadataIdentity(value) === paperId && typeof value.title === 'string' && value.title.trim()) {
        matches.push(value);
      }
    } catch {}
    for (const key of envelopeKeys) {
      if (value[key] && typeof value[key] === 'object') queue.push(value[key]);
    }
  }
  if (matches.length !== 1) {
    throw new Error(`--metadata-file 必须包含唯一匹配 ${paperId} 的 byCLI arXiv 论文对象`);
  }
  return matches[0];
}

function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function sourceMarkerUrl(text) {
  const match = /^>\s*原文链接:\s*(?:<(https:\/\/[^>\s]+)>|(https:\/\/\S+))\s*$/m.exec(text);
  return match?.[1] || match?.[2] || null;
}

function analyzeFullText(markdown, metadata, acquisitionUrl) {
  const text = requireText(markdown, '--fulltext-file').replace(/\r\n?/g, '\n');
  const sourceMarker = sourceMarkerUrl(text);
  const headingTitle = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || '';
  const headings = [...text.matchAll(/^#{2,6}\s+(.+)$/gm)].map((match) => match[1].trim());
  const hasAbstract = headings.some((heading) => /^abstract\b/i.test(heading));
  const hasIntroduction = headings.some((heading) => /^(?:\d+(?:\.\d+)*\s+)?introduction\b/i.test(heading));
  const hasReferences = headings.some((heading) => /^(?:\d+(?:\.\d+)*\s+)?references?\b/i.test(heading));
  const reasonCodes = [
    ...(sourceMarker !== acquisitionUrl ? ['source-marker-mismatch'] : []),
    ...(normalizeTitle(headingTitle) !== normalizeTitle(metadata.title) ? ['title-mismatch'] : []),
    ...(!hasAbstract ? ['missing-abstract'] : []),
    ...(!hasIntroduction ? ['missing-introduction'] : []),
    ...(!hasReferences ? ['missing-references'] : []),
    ...(headings.length < MIN_SECTION_HEADINGS ? ['insufficient-section-headings'] : []),
    ...(text.length < MIN_BODY_CHARACTERS ? ['insufficient-body-characters'] : []),
    ...(TRUNCATION_MARKER.test(text) ? ['truncation-marker'] : []),
  ];
  return {
    markdown: `${text.trim()}\n`,
    complete: reasonCodes.length === 0,
    reasonCodes,
    characterCount: text.length,
    headingCount: headings.length,
    hasAbstract,
    hasIntroduction,
    hasReferences,
  };
}

function atomicWriteText(filePath, content) {
  const temporary = path.join(
    path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function copyLocalImages(paths, fulltextArtifact, markdown, itemId) {
  const imagePattern = /!\[[^\]]*\]\(\s*(<?)([^\s)>]+)\1(?:\s+[^)]*)?\)/g;
  const rawRoot = path.join(paths.root, 'raw');
  const copies = [];
  const replacements = [];
  let match;
  while ((match = imagePattern.exec(markdown)) !== null) {
    const target = match[2];
    if (/^(?:https?:|data:|\/\/)/i.test(target)) {
      throw new Error(`arXiv 全文图片必须由 byCLI 本地化后再物化: ${target.slice(0, 120)}`);
    }
    const decoded = decodeURIComponent(target);
    const source = path.resolve(path.dirname(fulltextArtifact.absolute), decoded);
    if (!isInside(rawRoot, source) || !fs.existsSync(source)) {
      throw new Error(`arXiv 全文引用的本地图片不存在或越出 raw/: ${target}`);
    }
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0
      || !isInside(fs.realpathSync(rawRoot), fs.realpathSync(source))) {
      throw new Error(`arXiv 全文图片必须是 raw/ 内的非空普通文件: ${target}`);
    }
    const normalized = path.posix.normalize(decoded.replaceAll('\\', '/')).replace(/^\.\//, '');
    if (normalized.startsWith('../') || normalized === '..' || path.posix.isAbsolute(normalized)) {
      throw new Error(`arXiv 全文图片路径不安全: ${target}`);
    }
    const outputRelative = path.posix.join('assets', normalized);
    copies.push({
      source,
      rawRelative: toPosixRelative(paths.root, source),
      outputRelative,
    });
    const targetStart = match.index + match[0].indexOf(target);
    replacements.push({ start: targetStart, end: targetStart + target.length, value: outputRelative });
  }

  let rewritten = markdown;
  for (const replacement of replacements.reverse()) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.value}${rewritten.slice(replacement.end)}`;
  }
  const unique = [...new Map(copies.map((entry) => [entry.outputRelative, entry])).values()];
  for (const base of [
    ['markdown', 'items', itemId],
    ['sanitized', 'items', itemId],
  ]) {
    const root = ensureSafeDirectory(paths.root, base, 'arXiv 正文目录');
    for (const copy of unique) {
      const target = path.join(root, ...copy.outputRelative.split('/'));
      ensureSafeDirectory(root, copy.outputRelative.split('/').slice(0, -1), 'arXiv assets 目录');
      fs.copyFileSync(copy.source, target);
    }
  }
  return { markdown: rewritten, artifacts: unique.map((entry) => entry.rawRelative) };
}

function authors(metadata) {
  const values = Array.isArray(metadata.authors) ? metadata.authors : [];
  return values.map((entry) => typeof entry === 'string' ? entry : entry?.name)
    .filter((entry) => typeof entry === 'string' && entry.trim()).join(', ');
}

function frontmatter(metadata, sourceUrl, acquisitionUrl) {
  return [
    '---',
    `title: ${JSON.stringify(String(metadata.title || ''))}`,
    'source: public-internet',
    `source_url: ${JSON.stringify(sourceUrl)}`,
    `acquisition_url: ${JSON.stringify(acquisitionUrl)}`,
    'collection_filters: {}',
    '---',
    '',
  ].join('\n');
}

export async function runArxivMaterialize(paths, args) {
  const itemId = requireText(args?.['item-id'], '--item-id');
  if (!ITEM_ID.test(itemId)) throw new Error('--item-id 仅允许小写字母、数字、下划线和连字符，长度不超过 64');
  const source = arxivRepresentation(args?.['source-url'], '--source-url');
  const acquisition = arxivRepresentation(args?.['acquisition-url'], '--acquisition-url');
  if (acquisition.representation !== 'html') throw new Error('--acquisition-url 必须是 arXiv 官方 HTML 表示');
  if (source.paperId !== acquisition.paperId) throw new Error('source 与 acquisition 的 arXiv 论文 ID 不一致');

  const metadataArtifact = resolveRawArtifact(paths, args?.['metadata-file'], '--metadata-file');
  const fulltextArtifact = resolveRawArtifact(paths, args?.['fulltext-file'], '--fulltext-file');
  const rawMetadata = readJson(metadataArtifact.absolute, '--metadata-file');
  if (!rawMetadata || typeof rawMetadata !== 'object') {
    throw new Error('--metadata-file 必须包含单个 byCLI arXiv 论文结果对象');
  }
  const metadata = selectMetadataRecord(rawMetadata, source.paperId);
  const metadataUrl = metadata.url || metadata.entry_url || metadata.abs_url;
  if (metadataUrl && arxivRepresentation(metadataUrl, 'metadata.url').paperId !== source.paperId) {
    throw new Error('metadata.url 与 source 的 arXiv 论文 ID 不一致');
  }
  const rawMarkdown = fs.readFileSync(fulltextArtifact.absolute, 'utf8');
  const analysis = analyzeFullText(rawMarkdown, metadata, acquisition.url);

  registerArxivAcquisitionVariant(paths, {
    sourceUrl: source.url,
    acquisitionUrl: acquisition.url,
  });
  const rawMaterializationDir = ensureSafeDirectory(paths.root, ['raw', 'materialization'], '物化诊断目录');
  const diagnosticsPath = path.join(rawMaterializationDir, `${itemId}.json`);
  const diagnosticsRelative = toPosixRelative(paths.root, diagnosticsPath);
  const baseArtifacts = [metadataArtifact.relative, fulltextArtifact.relative, diagnosticsRelative];
  const diagnostics = {
    schemaVersion: '1.0',
    itemId,
    executor: 'bycli',
    sourceUrl: source.url,
    acquisitionUrl: acquisition.url,
    complete: analysis.complete,
    contentGranularity: analysis.complete ? 'full-text' : 'unknown',
    ruleVersion: 'arxiv-html-v1',
    reasonCodes: analysis.reasonCodes,
    characterCount: analysis.characterCount,
    headingCount: analysis.headingCount,
    hasAbstract: analysis.hasAbstract,
    hasIntroduction: analysis.hasIntroduction,
    hasReferences: analysis.hasReferences,
  };
  atomicWriteJson(diagnosticsPath, diagnostics);

  if (!analysis.complete) {
    const pending = recordPendingCollectionItem(paths, {
      itemId,
      source: 'public-internet',
      sourceSkill: 'bycli',
      backend: 'bycli',
      sourceUrl: source.url,
      title: String(metadata.title || ''),
      rawArtifacts: baseArtifacts,
      media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null },
      reason: 'arxiv-fulltext-incomplete',
    });
    return {
      ok: true,
      action: 'materialize-arxiv',
      materialization: pending.materialization,
      collectPayloadPath: null,
      diagnostics: diagnosticsRelative,
    };
  }

  const localized = copyLocalImages(paths, fulltextArtifact, analysis.markdown, itemId);
  const markdownDir = ensureSafeDirectory(paths.root, ['markdown', 'items', itemId], 'Markdown 工作目录');
  const sanitizedDir = ensureSafeDirectory(paths.root, ['sanitized', 'items', itemId], '净化正文目录');
  const markdownAbsolute = path.join(markdownDir, 'index.md');
  const sanitizedAbsolute = path.join(sanitizedDir, 'index.md');
  const rendered = `${frontmatter(metadata, source.url, acquisition.url)}${localized.markdown}`;
  atomicWriteText(markdownAbsolute, rendered);
  atomicWriteText(sanitizedAbsolute, rendered);
  const markdownPath = toPosixRelative(paths.root, markdownAbsolute);
  const sanitizedPath = toPosixRelative(paths.root, sanitizedAbsolute);
  const rawArtifacts = [...new Set([...baseArtifacts, ...localized.artifacts])];
  const payload = {
    schemaVersion: '1.0',
    itemId,
    source: 'public-internet',
    sourceSkill: 'bycli',
    backend: 'bycli',
    rawArtifacts,
    contentGranularity: 'full-text',
    fullTextEvidence: { schemaVersion: '1.0', executor: 'bycli', artifact: diagnosticsRelative },
    media: { coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null },
    markdownPath,
    sanitizedPath,
    canonicalItem: {
      title: String(metadata.title || ''),
      url: source.url,
      author: authors(metadata),
      publishTime: String(metadata.published || metadata.publishTime || ''),
      markdown: sanitizedPath,
      fileName: sanitizedPath,
    },
  };
  const collectPayloadPath = path.join(paths.inputDir, `arxiv-${itemId}.json`);
  atomicWriteJson(collectPayloadPath, payload);
  registerFullTextEvidenceReceipt(paths, {
    executor: 'bycli',
    sourceUrl: source.url,
    artifact: diagnosticsRelative,
  });
  return {
    ok: true,
    action: 'materialize-arxiv',
    materialization: { status: 'materialized', contentGranularity: 'full-text', markdownPath, sanitizedPath },
    collectPayloadPath,
    diagnostics: diagnosticsRelative,
  };
}
