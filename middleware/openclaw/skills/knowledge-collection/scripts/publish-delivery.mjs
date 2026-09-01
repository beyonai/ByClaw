#!/usr/bin/env node
'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectionStatus } from './collection-state.mjs';
import {
  isInside,
  isProcessAlive,
  linuxProcessStartTime,
  loadSession,
  persistSession,
  requireString,
  resolveSandboxPath,
  withSessionLock,
} from './session.mjs';

const DELIVERY_SCHEMA_VERSION = '1.0';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Value(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function slashPath(value) {
  return value.split(path.sep).join('/');
}

function assertRegularFile(filePath, label) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} 不存在: ${filePath}`);
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} 必须是普通文件且不能是符号链接: ${filePath}`);
  }
  if (stat.size === 0) throw new Error(`${label} 不能为空文件: ${filePath}`);
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertNoSymlinkComponents(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} 越出允许目录: ${candidate}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} 路径包含符号链接: ${current}`);
  }
}

function assertNoExistingSymlinkComponents(candidate, label) {
  let current = path.parse(candidate).root;
  for (const segment of candidate.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatIfPresent(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) throw new Error(`${label} 路径包含符号链接: ${current}`);
  }
}

function assertDeliveryDirectory(deliveryDir, sessionRoot) {
  const requested = resolveSandboxPath(deliveryDir, '--delivery-dir', {
    currentSessionRoot: sessionRoot,
  });
  if (requested === path.parse(requested).root) {
    throw new Error('--delivery-dir 不能是文件系统根目录');
  }
  assertNoExistingSymlinkComponents(requested, '--delivery-dir');
  const requestedStat = lstatIfPresent(requested);
  if (requestedStat) {
    const stat = requestedStat;
    if (stat.isSymbolicLink()) throw new Error('--delivery-dir 不能是符号链接');
    if (!stat.isDirectory()) throw new Error('--delivery-dir 必须是目录或尚不存在的目录路径');
  }
  return requested;
}

function directoryIsEmpty(directory) {
  return fs.readdirSync(directory).length === 0;
}

function taskSlug(query) {
  const slug = String(query || 'collection')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'collection';
}

function shortRunId(paths) {
  return crypto.createHash('sha256').update(fs.realpathSync(paths.root)).digest('hex').slice(0, 8);
}

function allocateChild(requested, session, paths) {
  const base = `${taskSlug(session.task?.query)}-collection-${shortRunId(paths)}`;
  for (let index = 1; index <= 1000; index += 1) {
    const name = index === 1 ? base : `${base}-${index}`;
    const candidate = path.join(requested, name);
    if (!lstatIfPresent(candidate)) return candidate;
  }
  throw new Error(`无法在交付目录中分配无冲突子目录: ${requested}`);
}

function chooseActualDirectory(requested, session, paths) {
  const previous = session.delivery;
  if (previous?.schemaVersion === DELIVERY_SCHEMA_VERSION
    && previous.requestedDirectory === requested
    && typeof previous.actualDirectory === 'string') {
    const actualDirectory = path.resolve(previous.actualDirectory);
    if (actualDirectory !== requested && path.dirname(actualDirectory) !== requested) {
      throw new Error('session.delivery.actualDirectory 不属于请求的交付目录');
    }
    return {
      actualDirectory, replacingOwned: true, replacingEmpty: false, previous,
    };
  }
  const requestedStat = lstatIfPresent(requested);
  if (!requestedStat) {
    return {
      actualDirectory: requested, replacingOwned: false, replacingEmpty: false, previous: null,
    };
  }
  if (directoryIsEmpty(requested)) {
    return {
      actualDirectory: requested, replacingOwned: false, replacingEmpty: true, previous: null,
    };
  }
  return {
    actualDirectory: allocateChild(requested, session, paths),
    replacingOwned: false,
    replacingEmpty: false,
    previous: null,
  };
}

function parseLocalTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
  if (!target || target.startsWith('#')) {
    throw new Error(`Markdown 图片必须引用实际本地文件: ${rawTarget}`);
  }
  if (target.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    throw new Error(`Markdown 仍包含远程或非本地图片引用: ${rawTarget}`);
  }
  const suffixIndex = target.search(/[?#]/);
  if (suffixIndex >= 0) target = target.slice(0, suffixIndex);
  try {
    return decodeURIComponent(target);
  } catch {
    throw new Error(`Markdown 图片路径不是合法编码: ${rawTarget}`);
  }
}

function renderedTarget(relativePath) {
  return /\s/.test(relativePath) ? `<${relativePath}>` : relativePath;
}

function normalizedReferenceId(value) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function protectedMarkdownRanges(markdown) {
  const protectedCharacters = new Uint8Array(markdown.length);
  const protect = (start, end) => protectedCharacters.fill(1, start, end);
  const withoutBlockquotePrefix = (line) => {
    let remaining = line;
    while (true) {
      const prefix = /^ {0,3}>[ \t]?/.exec(remaining);
      if (!prefix) return remaining;
      remaining = remaining.slice(prefix[0].length);
    }
  };
  let offset = 0;
  let fence = null;
  for (const line of markdown.match(/.*(?:\r?\n|$)/g) || []) {
    if (!line) continue;
    const content = line.replace(/\r?\n$/, '');
    if (fence) {
      protect(offset, offset + line.length);
      let closingCandidate = withoutBlockquotePrefix(content);
      if (fence.containerIndent > 0) {
        const continuation = new RegExp(`^ {${fence.containerIndent}}`);
        closingCandidate = closingCandidate.replace(continuation, '');
      }
      const closing = new RegExp(`^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`);
      if (closing.test(closingCandidate)) fence = null;
    } else {
      let openingCandidate = withoutBlockquotePrefix(content);
      const listPrefix = /^ {0,3}(?:[*+-]|\d{1,9}[.)])[ \t]+/.exec(openingCandidate);
      const containerIndent = listPrefix ? listPrefix[0].length : 0;
      if (listPrefix) openingCandidate = openingCandidate.slice(listPrefix[0].length);
      const opening = /^ {0,3}(`{3,}|~{3,})/.exec(openingCandidate);
      if (opening) {
        protect(offset, offset + line.length);
        fence = { character: opening[1][0], length: opening[1].length, containerIndent };
      } else if (/^(?: {4}|\t)/.test(withoutBlockquotePrefix(content))) {
        protect(offset, offset + line.length);
      }
    }
    offset += line.length;
  }

  let commentStart = markdown.indexOf('<!--');
  while (commentStart >= 0) {
    const closing = markdown.indexOf('-->', commentStart + 4);
    const commentEnd = closing < 0 ? markdown.length : closing + 3;
    protect(commentStart, commentEnd);
    commentStart = markdown.indexOf('<!--', commentEnd);
  }

  for (let index = 0; index < markdown.length;) {
    if (protectedCharacters[index] || markdown[index] !== '`') {
      index += 1;
      continue;
    }
    let runLength = 1;
    while (markdown[index + runLength] === '`') runLength += 1;
    let closing = index + runLength;
    while (closing < markdown.length) {
      closing = markdown.indexOf('`'.repeat(runLength), closing);
      if (closing < 0) break;
      const isExactRun = markdown[closing - 1] !== '`' && markdown[closing + runLength] !== '`';
      const rangeIsVisible = !protectedCharacters.subarray(closing, closing + runLength).some(Boolean);
      if (isExactRun && rangeIsVisible) {
        protect(index, closing + runLength);
        index = closing + runLength;
        break;
      }
      closing += runLength;
    }
    if (closing < 0) index += runLength;
  }
  return protectedCharacters;
}

function forEachVisibleMarkdownMatch(markdown, pattern, callback) {
  const protectedCharacters = protectedMarkdownRanges(markdown);
  const expression = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const match of markdown.matchAll(expression)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!protectedCharacters.subarray(start, end).some(Boolean)) callback(match);
  }
}

function replaceVisibleMarkdown(markdown, pattern, replacer) {
  const edits = [];
  forEachVisibleMarkdownMatch(markdown, pattern, (match) => {
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      replacement: replacer(...match),
    });
  });
  let rewritten = markdown;
  for (const edit of edits.reverse()) {
    rewritten = `${rewritten.slice(0, edit.start)}${edit.replacement}${rewritten.slice(edit.end)}`;
  }
  return rewritten;
}

function rewriteHtmlMedia(markdown, rewriteTarget) {
  return replaceVisibleMarkdown(markdown, /<(img|source|video|audio)\b([^>]*)>/gi,
    (tag, name, attributes) => {
    const rewritten = attributes.replace(
      /(^|\s)(srcset|src|poster)\s*=\s*(?:(["'])(.*?)\3|([^\s"'=<>`]+))/gi,
      (_attribute, leading, attributeName, quote, quotedValue, unquotedValue) => {
        const value = quotedValue ?? unquotedValue;
        const htmlTarget = (target) => {
          const rewrittenTarget = rewriteTarget(target);
          const rawTarget = rewrittenTarget.startsWith('<') && rewrittenTarget.endsWith('>')
            ? rewrittenTarget.slice(1, -1) : rewrittenTarget;
          if (quote) return `${quote}${rawTarget}${quote}`;
          return /\s/.test(rawTarget) ? `"${rawTarget}"` : rawTarget;
        };
        if (attributeName.toLowerCase() !== 'srcset') {
          return `${leading}${attributeName}=${htmlTarget(value)}`;
        }
        const entries = value.split(',').map((entry) => {
          const trimmed = entry.trim();
          const match = /^(\S+)(.*)$/.exec(trimmed);
          if (!match) throw new Error('HTML srcset 包含空图片引用');
          const rewrittenEntry = rewriteTarget(match[1]);
          const rawEntry = rewrittenEntry.startsWith('<') && rewrittenEntry.endsWith('>')
            ? rewrittenEntry.slice(1, -1) : rewrittenEntry;
          return `${rawEntry}${match[2]}`;
        });
        const joined = entries.join(', ');
        return `${leading}${attributeName}=${quote ? `${quote}${joined}${quote}` : joined}`;
      },
    );
    return `<${name}${rewritten}>`;
    });
}

function outputMarkdownRelative(sourceRoot, sourceFile) {
  const relative = path.relative(sourceRoot, sourceFile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`下游 Markdown 越出 sanitized/items: ${sourceFile}`);
  }
  if (path.basename(relative).toLowerCase() === 'index.md') {
    const parentName = path.basename(path.dirname(relative));
    if (!parentName || parentName === '.') throw new Error(`无法为 Markdown 生成交付文件名: ${sourceFile}`);
    return `${parentName}.md`;
  }
  if (path.dirname(relative) !== '.') {
    throw new Error(`嵌套 Markdown 必须使用 <item>/index.md 布局: ${sourceFile}`);
  }
  return path.basename(relative);
}

function outputAssetRelative(sourceRoot, sourceMarkdown, sourceAsset, markdownOutput) {
  if (path.basename(sourceMarkdown).toLowerCase() !== 'index.md') {
    return slashPath(path.relative(sourceRoot, sourceAsset));
  }
  const assetsRoot = path.join(path.dirname(sourceMarkdown), 'assets');
  if (!isInside(assetsRoot, sourceAsset) || sourceAsset === assetsRoot) {
    throw new Error(`嵌套正文的本地图片必须位于同条目的 assets/ 目录: ${sourceAsset}`);
  }
  const stem = path.basename(markdownOutput, '.md');
  return slashPath(path.join(`${stem}-assets`, path.relative(assetsRoot, sourceAsset)));
}

function materializeMarkdown(sourceRoot, sourceMarkdown, outputRelative, assetOutputs) {
  assertRegularFile(sourceMarkdown, 'downstreamInput Markdown');
  const canonicalRoot = fs.realpathSync(sourceRoot);
  assertNoSymlinkComponents(sourceRoot, sourceMarkdown, 'downstreamInput Markdown');
  if (!isInside(canonicalRoot, fs.realpathSync(sourceMarkdown))) {
    throw new Error(`downstreamInput Markdown 越出 sanitized/items: ${sourceMarkdown}`);
  }
  let markdown = fs.readFileSync(sourceMarkdown, 'utf8');

  const rewriteTarget = (rawTarget) => {
    const localTarget = parseLocalTarget(rawTarget);
    const sourceAsset = path.isAbsolute(localTarget)
      ? path.resolve(localTarget)
      : path.resolve(path.dirname(sourceMarkdown), localTarget);
    if (!isInside(canonicalRoot, sourceAsset)) {
      throw new Error(`Markdown 图片越出 sanitized/items: ${rawTarget}`);
    }
    assertRegularFile(sourceAsset, 'Markdown 本地图片');
    assertNoSymlinkComponents(sourceRoot, sourceAsset, 'Markdown 本地图片');
    const realAsset = fs.realpathSync(sourceAsset);
    if (!isInside(canonicalRoot, realAsset)) {
      throw new Error(`Markdown 图片通过符号链接越出 sanitized/items: ${rawTarget}`);
    }
    const outputAsset = outputAssetRelative(sourceRoot, sourceMarkdown, sourceAsset, outputRelative);
    const existing = assetOutputs.get(outputAsset);
    if (existing && existing !== sourceAsset && sha256File(existing) !== sha256File(sourceAsset)) {
      throw new Error(`多个本地图片映射到同一交付路径: ${outputAsset}`);
    }
    assetOutputs.set(outputAsset, sourceAsset);
    return renderedTarget(outputAsset);
  };

  const referenceIds = new Set();
  forEachVisibleMarkdownMatch(markdown, /!\[([^\]]*)\]\[([^\]]*)\]/g, (match) => {
    referenceIds.add(normalizedReferenceId(match[2] || match[1]));
  });
  forEachVisibleMarkdownMatch(markdown, /!\[([^\]]+)\](?!\s*[[(])/g, (match) => {
    referenceIds.add(normalizedReferenceId(match[1]));
  });
  const foundReferenceIds = new Set();
  markdown = replaceVisibleMarkdown(
    markdown,
    /^([ \t]{0,3}\[([^\]]+)\]:\s*)(<[^>]+>|\S+)(.*)$/gm,
    (match, prefix, identifier, target, suffix) => {
      const normalized = normalizedReferenceId(identifier);
      if (!referenceIds.has(normalized)) return match;
      foundReferenceIds.add(normalized);
      return `${prefix}${rewriteTarget(target)}${suffix}`;
    },
  );
  for (const identifier of referenceIds) {
    if (!foundReferenceIds.has(identifier)) {
      throw new Error(`Markdown 图片引用缺少定义: ${identifier}`);
    }
  }

  markdown = replaceVisibleMarkdown(markdown, /!\[([^\]]*)\]\((<[^>]+>|[^\s)]+)([^)]*)\)/g,
    (_match, alt, target, suffix) => `![${alt}](${rewriteTarget(target)}${suffix})`);
  markdown = rewriteHtmlMedia(markdown, rewriteTarget);
  return markdown;
}

function stableItemSuffix(itemId, sourceKey) {
  const suffix = String(itemId || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/g, '');
  return suffix || sha256Value(sourceKey).slice(0, 8);
}

function buildPublishPlan(paths, downstreamInput, session, previousReceipt) {
  const sourceRoot = path.resolve(downstreamInput.directory);
  if (!fs.existsSync(sourceRoot)
    || fs.lstatSync(sourceRoot).isSymbolicLink()
    || !fs.lstatSync(sourceRoot).isDirectory()) {
    throw new Error('downstreamInput.directory 必须是普通目录且不能是符号链接');
  }
  const markdownOutputs = new Map();
  const assetOutputs = new Map();
  const canonicalSessionRoot = fs.realpathSync(paths.root);
  const itemIdsBySource = new Map((session.collection?.collection?.items || []).flatMap((item) => {
    const sanitizedPath = item?.materialization?.sanitizedPath;
    if (typeof sanitizedPath !== 'string') return [];
    const source = path.resolve(canonicalSessionRoot, sanitizedPath);
    if (!isInside(canonicalSessionRoot, source)) return [];
    return [[source, item.itemId]];
  }));
  const previousTargets = new Map((previousReceipt?.files || []).flatMap((entry) => {
    if (typeof entry?.source !== 'string' || typeof entry?.target !== 'string') return [];
    return [[path.resolve(canonicalSessionRoot, entry.source), entry.target]];
  }));
  const candidates = downstreamInput.files.map((sourceMarkdown) => {
    const source = path.resolve(sourceMarkdown);
    return {
      sourceMarkdown: source,
      sourceKey: slashPath(path.relative(canonicalSessionRoot, source)),
      baseOutput: outputMarkdownRelative(sourceRoot, source),
      itemId: itemIdsBySource.get(source),
      outputRelative: null,
    };
  });
  const usedOutputs = new Set();
  for (const candidate of candidates) {
    const priorTarget = previousTargets.get(candidate.sourceMarkdown);
    if (typeof priorTarget !== 'string'
      || path.dirname(priorTarget) !== '.'
      || path.extname(priorTarget).toLowerCase() !== '.md'
      || usedOutputs.has(priorTarget)) continue;
    candidate.outputRelative = priorTarget;
    usedOutputs.add(priorTarget);
  }
  for (const candidate of candidates) {
    if (candidate.outputRelative) continue;
    if (!usedOutputs.has(candidate.baseOutput)) {
      candidate.outputRelative = candidate.baseOutput;
      usedOutputs.add(candidate.baseOutput);
      continue;
    }
    const stem = path.basename(candidate.baseOutput, '.md');
    const suffix = stableItemSuffix(candidate.itemId, candidate.sourceKey);
    let outputRelative = `${stem}-${suffix}.md`;
    if (usedOutputs.has(outputRelative)) {
      outputRelative = `${stem}-${suffix}-${sha256Value(candidate.sourceKey).slice(0, 8)}.md`;
    }
    if (usedOutputs.has(outputRelative)) {
      throw new Error(`无法为同名 Markdown 分配稳定交付名称: ${candidate.sourceMarkdown}`);
    }
    candidate.outputRelative = outputRelative;
    usedOutputs.add(outputRelative);
  }
  for (const { sourceMarkdown, outputRelative } of candidates) {
    markdownOutputs.set(outputRelative, {
      source: sourceMarkdown,
      content: materializeMarkdown(sourceRoot, sourceMarkdown, outputRelative, assetOutputs),
    });
  }
  for (const relative of markdownOutputs.keys()) {
    if (assetOutputs.has(relative)) {
      throw new Error(`Markdown 与图片映射到同一交付路径: ${relative}`);
    }
  }
  return { markdownOutputs, assetOutputs };
}

function verifyStagedMarkdown(stage, plan) {
  const verifyTarget = (markdownPath, rawTarget) => {
    const localTarget = parseLocalTarget(rawTarget);
    const target = path.resolve(path.dirname(markdownPath), localTarget);
    if (!isInside(stage, target)) throw new Error(`发布后图片链接越出交付目录: ${rawTarget}`);
    assertRegularFile(target, '发布后 Markdown 本地图片');
    assertNoSymlinkComponents(stage, target, '发布后 Markdown 本地图片');
  };
  for (const relative of plan.markdownOutputs.keys()) {
    const markdownPath = path.join(stage, relative);
    const content = fs.readFileSync(markdownPath, 'utf8');
    forEachVisibleMarkdownMatch(content, /!\[([^\]]*)\]\((<[^>]+>|[^\s)]+)([^)]*)\)/g,
      (match) => { verifyTarget(markdownPath, match[2]); });
    const referenceIds = new Set();
    forEachVisibleMarkdownMatch(content, /!\[([^\]]*)\]\[([^\]]*)\]/g, (match) => {
      referenceIds.add(normalizedReferenceId(match[2] || match[1]));
    });
    forEachVisibleMarkdownMatch(content, /!\[([^\]]+)\](?!\s*[[(])/g, (match) => {
      referenceIds.add(normalizedReferenceId(match[1]));
    });
    const foundReferenceIds = new Set();
    forEachVisibleMarkdownMatch(content, /^([ \t]{0,3}\[([^\]]+)\]:\s*)(<[^>]+>|\S+)(.*)$/gm,
      (match) => {
        const normalized = normalizedReferenceId(match[2]);
        if (referenceIds.has(normalized)) {
          foundReferenceIds.add(normalized);
          verifyTarget(markdownPath, match[3]);
        }
      });
    for (const identifier of referenceIds) {
      if (!foundReferenceIds.has(identifier)) throw new Error(`发布后图片引用缺少定义: ${identifier}`);
    }
    rewriteHtmlMedia(content, (target) => { verifyTarget(markdownPath, target); return target; });
  }
}

function writeStage(stage, plan, ownerId) {
  fs.mkdirSync(stage, { recursive: false, mode: 0o700 });
  writeStageOwner(stage, ownerId);
  for (const [relative, entry] of plan.markdownOutputs) {
    const output = path.join(stage, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, entry.content, { mode: 0o600 });
  }
  for (const [relative, source] of plan.assetOutputs) {
    const output = path.join(stage, relative);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, output);
    fs.chmodSync(output, 0o600);
  }
  verifyStagedMarkdown(stage, plan);
}

function writeStageOwner(stage, ownerId) {
  fs.writeFileSync(
    path.join(stage, '.knowledge-collection-staging.json'),
    `${JSON.stringify({ ownerId })}\n`,
    { mode: 0o600 },
  );
}

function listRegularFiles(root) {
  const entries = [];
  const walk = (directory) => {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`交付目录包含符号链接: ${absolute}`);
      if (stat.isDirectory()) {
        entries.push({ path: absolute, type: 'directory' });
        walk(absolute);
      } else if (stat.isFile()) entries.push({ path: absolute, type: 'file' });
      else throw new Error(`交付目录包含非普通文件: ${absolute}`);
    }
  };
  walk(root);
  return entries;
}

function publishedEntries(root) {
  return listRegularFiles(root)
    .map((entry) => ({
      relativePath: `${slashPath(path.relative(root, entry.path))}${entry.type === 'directory' ? '/' : ''}`,
      type: entry.type,
      ...(entry.type === 'file' ? { sha256: sha256File(entry.path) } : {}),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function receiptEntries(receipt) {
  const files = [...(receipt?.files || []), ...(receipt?.assets || [])]
    .map((entry) => ({ relativePath: slashPath(entry.target), type: 'file', sha256: entry.sha256 }));
  const directories = new Set();
  for (const entry of files) {
    let directory = path.posix.dirname(entry.relativePath);
    while (directory !== '.') {
      directories.add(`${directory}/`);
      directory = path.posix.dirname(directory);
    }
  }
  return [
    ...files,
    ...[...directories].map((relativePath) => ({ relativePath, type: 'directory' })),
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function planRecords(paths, plan) {
  const canonicalSessionRoot = fs.realpathSync(paths.root);
  const files = [...plan.markdownOutputs].map(([target, entry]) => ({
    source: slashPath(path.relative(canonicalSessionRoot, entry.source)),
    target: slashPath(target),
    sourceSha256: sha256File(entry.source),
    sha256: sha256Value(entry.content),
  }));
  const assets = [...plan.assetOutputs].map(([target, source]) => ({
    source: slashPath(path.relative(canonicalSessionRoot, source)),
    target: slashPath(target),
    sourceSha256: sha256File(source),
    sha256: sha256File(source),
  }));
  return { files, assets };
}

function deliveryPlanHash(requestedDirectory, actualDirectory, files, assets) {
  return `sha256:${sha256Value(JSON.stringify({
    requestedDirectory, actualDirectory, files, assets,
  }))}`;
}

function targetMatchesReceipt(receipt) {
  const target = receipt?.actualDirectory;
  try {
    if (typeof target !== 'string') return false;
    assertNoExistingSymlinkComponents(path.resolve(target), 'delivery.actualDirectory');
    const stat = lstatIfPresent(target);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return false;
    return JSON.stringify(publishedEntries(target)) === JSON.stringify(receiptEntries(receipt));
  } catch {
    return false;
  }
}

function stagingMatchesReceipt(receipt) {
  const stage = receipt?.stagingDirectory;
  try {
    if (typeof stage !== 'string') return false;
    assertNoExistingSymlinkComponents(path.resolve(stage), 'delivery.stagingDirectory');
    const stat = lstatIfPresent(stage);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return false;
    const entries = publishedEntries(stage).filter(
      (entry) => entry.relativePath !== '.knowledge-collection-staging.json',
    );
    return JSON.stringify(entries) === JSON.stringify(receiptEntries(receipt));
  } catch {
    return false;
  }
}

function sourceMatchesReceipt(paths, receipt, downstreamInput) {
  try {
    const canonicalSessionRoot = fs.realpathSync(paths.root);
    const expectedMarkdown = (receipt?.files || []).map(
      (entry) => path.resolve(canonicalSessionRoot, entry.source),
    ).sort();
    const currentMarkdown = [...(downstreamInput?.files || [])].map((entry) => path.resolve(entry)).sort();
    if (JSON.stringify(expectedMarkdown) !== JSON.stringify(currentMarkdown)) return false;
    return [...(receipt?.files || []), ...(receipt?.assets || [])].every((entry) => {
      const source = path.resolve(canonicalSessionRoot, entry.source);
      if (!isInside(canonicalSessionRoot, source)) return false;
      assertRegularFile(source, '交付来源文件');
      assertNoSymlinkComponents(canonicalSessionRoot, source, '交付来源文件');
      return sha256File(source) === entry.sourceSha256;
    });
  } catch {
    return false;
  }
}

function publishStage(stage, actualDirectory, {
  replacingOwned, replacingEmpty, previous, backupDirectory,
}) {
  if (!lstatIfPresent(actualDirectory)) {
    fs.renameSync(stage, actualDirectory);
    return;
  }
  if (!replacingOwned) {
    if (!replacingEmpty) {
      throw new Error(`交付目标在发布前被其他内容占用: ${actualDirectory}`);
    }
    if (!directoryIsEmpty(actualDirectory)) {
      throw new Error(`交付目标在发布前变为非空目录: ${actualDirectory}`);
    }
    fs.rmdirSync(actualDirectory);
    try {
      fs.renameSync(stage, actualDirectory);
    } catch (error) {
      fs.mkdirSync(actualDirectory, { recursive: false, mode: 0o700 });
      throw error;
    }
    return;
  }

  const backup = backupDirectory;
  if (typeof backup !== 'string' || lstatIfPresent(backup)) {
    throw new Error('无法安全分配已发布目标备份目录');
  }
  fs.renameSync(actualDirectory, backup);
  const backupReceipt = { ...previous, actualDirectory: backup };
  if (!targetMatchesReceipt(backupReceipt)) {
    fs.renameSync(backup, actualDirectory);
    throw new Error('已发布目标在替换期间发生漂移或被用户修改，拒绝覆盖');
  }
  try {
    fs.renameSync(stage, actualDirectory);
  } catch (error) {
    fs.renameSync(backup, actualDirectory);
    throw error;
  }
}

function waitBriefly(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function quarantineLock(lockPath, expectedStat) {
  let current;
  try {
    current = fs.lstatSync(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  if (current.isSymbolicLink() || !current.isFile()) {
    throw new Error(`交付目标锁必须是普通文件且不能是符号链接: ${lockPath}`);
  }
  if (!sameFileIdentity(current, expectedStat)) return false;
  const quarantine = `${lockPath}.stale.${crypto.randomUUID()}`;
  try {
    fs.renameSync(lockPath, quarantine);
  } catch (error) {
    if (error.code === 'ENOENT') return true;
    throw error;
  }
  const moved = fs.lstatSync(quarantine);
  if (!sameFileIdentity(moved, expectedStat)) {
    throw new Error(`交付目标锁在隔离期间发生替换: ${lockPath}`);
  }
  fs.unlinkSync(quarantine);
  return true;
}

function withDeliveryTargetLock(requestedDirectory, callback) {
  const lockRoot = path.join(tmpdir(), 'knowledge-collection-publish-locks');
  fs.mkdirSync(lockRoot, { recursive: true, mode: 0o700 });
  const lockRootStat = fs.lstatSync(lockRoot);
  if (lockRootStat.isSymbolicLink() || !lockRootStat.isDirectory()) {
    throw new Error(`交付目标锁目录必须是普通目录且不能是符号链接: ${lockRoot}`);
  }
  const lockPath = path.join(lockRoot, `${sha256Value(path.resolve(requestedDirectory))}.lock`);
  const ownerId = crypto.randomUUID();
  const lockValue = `${JSON.stringify({
    pid: process.pid,
    ownerId,
    createdAt: new Date().toISOString(),
    processStartTime: linuxProcessStartTime(process.pid),
  })}\n`;
  let acquired = false;
  for (let attempt = 0; !acquired; attempt += 1) {
    const temporaryLock = path.join(lockRoot, `.${path.basename(lockPath)}.${ownerId}.${attempt}.tmp`);
    try {
      fs.writeFileSync(temporaryLock, lockValue, { flag: 'wx', mode: 0o600 });
      fs.linkSync(temporaryLock, lockPath);
      fs.unlinkSync(temporaryLock);
      acquired = true;
      break;
    } catch (error) {
      try { fs.unlinkSync(temporaryLock); } catch {}
      if (error.code !== 'EEXIST') throw error;
      try {
        const existingStat = fs.lstatSync(lockPath);
        if (existingStat.isSymbolicLink() || !existingStat.isFile()) {
          throw new Error(`交付目标锁必须是普通文件且不能是符号链接: ${lockPath}`);
        }
        let current;
        try {
          current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        } catch (parseError) {
          if (Date.now() - existingStat.mtimeMs >= 5_000 && quarantineLock(lockPath, existingStat)) {
            continue;
          }
          waitBriefly(20);
          continue;
        }
        const validShape = Number.isInteger(current?.pid) && current.pid > 0
          && typeof current.ownerId === 'string' && current.ownerId
          && typeof current.createdAt === 'string' && !Number.isNaN(Date.parse(current.createdAt))
          && (current.processStartTime === undefined
            || (typeof current.processStartTime === 'number' && Number.isFinite(current.processStartTime)));
        if (!validShape) {
          if (Date.now() - existingStat.mtimeMs >= 5_000 && quarantineLock(lockPath, existingStat)) {
            continue;
          }
          waitBriefly(20);
          continue;
        }
        if (!isProcessAlive(current.pid, current.processStartTime)
          && quarantineLock(lockPath, existingStat)) {
          continue;
        }
      } catch (readError) {
        if (readError.code === 'ENOENT') continue;
        throw readError;
      }
      waitBriefly(20);
    }
  }
  try {
    return callback();
  } finally {
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (current.ownerId === ownerId) fs.unlinkSync(lockPath);
    } catch {}
  }
}

function cleanupOwnedStage(receipt) {
  const stage = receipt?.stagingDirectory;
  if (typeof stage !== 'string') return;
  const stat = lstatIfPresent(stage);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`计划中的 staging 不是普通目录: ${stage}`);
  }
  const marker = path.join(stage, '.knowledge-collection-staging.json');
  let owned = false;
  try {
    const markerValue = JSON.parse(fs.readFileSync(marker, 'utf8'));
    owned = markerValue.ownerId === receipt.stagingOwnerId;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!owned && !targetMatchesReceipt({ ...receipt, actualDirectory: stage })) {
    throw new Error(`无法证明 staging 所有权，拒绝清理: ${stage}`);
  }
  fs.rmSync(stage, { recursive: true, force: true });
}

function cleanupOwnedBackup(receipt) {
  const backup = receipt?.backupDirectory;
  const previousTarget = receipt?.previousTarget;
  if (typeof backup !== 'string' || !lstatIfPresent(backup)) return;
  if (!previousTarget || !targetMatchesReceipt({ ...previousTarget, actualDirectory: backup })) {
    throw new Error(`无法证明发布备份所有权，拒绝清理: ${backup}`);
  }
  fs.rmSync(backup, { recursive: true, force: true });
}

function publishResult(receipt) {
  return {
    ok: true,
    action: 'publish',
    delivery: publicDelivery(receipt),
    deliveryInput: deliveryInputFor(receipt),
  };
}

function persistDeliveryFailure(paths, session, receipt, reason, failurePhase = 'drift') {
  session.delivery = {
    ...receipt,
    status: 'failed',
    reason,
    failurePhase,
    failedAt: new Date().toISOString(),
  };
  persistSession(paths, session);
}

function publicDelivery(receipt) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    requestedDirectory: receipt.requestedDirectory,
    actualDirectory: receipt.actualDirectory,
    files: (receipt.files || []).map((entry) => path.join(receipt.actualDirectory, entry.target)),
    assets: (receipt.assets || []).map((entry) => path.join(receipt.actualDirectory, entry.target)),
  };
}

function deliveryInputFor(receipt) {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    directory: receipt.actualDirectory,
    files: (receipt.files || []).map((entry) => path.join(receipt.actualDirectory, entry.target)),
  };
}

export function inspectDelivery(paths) {
  const { session } = loadSession(paths, { persistMigration: false });
  const receipt = session.delivery;
  if (!receipt || receipt.schemaVersion !== DELIVERY_SCHEMA_VERSION) {
    return { warnings: [] };
  }
  const collection = collectionStatus(paths);
  if (receipt.status === 'failed') {
    return {
      warnings: [`用户交付失败: ${receipt.reason || 'unknown delivery failure'}`],
    };
  }
  if (receipt.status === 'planned') {
    return {
      warnings: ['用户交付计划尚未完成；请重新运行 publish 恢复'],
    };
  }
  if (!targetMatchesReceipt(receipt)) {
    return {
      warnings: ['用户交付目录已被修改；deliveryInput 已停用'],
    };
  }
  if (receipt.status === 'stale'
    || collection.deliveryComplete !== true
    || !sourceMatchesReceipt(paths, receipt, collection.downstreamInput)) {
    return {
      warnings: ['采集正文或其图片已变化；需要重新 publish'],
    };
  }
  return {
    deliveryInput: deliveryInputFor(receipt),
    warnings: [],
  };
}

export function cmdPublish(paths, args) {
  return withSessionLock(paths, 'publish', () => {
    const { session } = loadSession(paths, { persistMigration: true });
    const requestedDirectory = assertDeliveryDirectory(
      requireString(args['delivery-dir'], '--delivery-dir'),
      args['session-root'],
    );
    if (isInside(paths.root, requestedDirectory)) {
      throw new Error('--delivery-dir 不能位于内部采集会话目录中');
    }

    const collection = collectionStatus(paths);
    if (collection.deliveryComplete !== true) {
      throw new Error('只有 status.collection.deliveryComplete=true 后才能 publish');
    }
    if (collection.downstreamInput.files.length === 0) {
      throw new Error('没有可发布的 validated Markdown');
    }

    return withDeliveryTargetLock(requestedDirectory, () => {
      let previous = session.delivery?.schemaVersion === DELIVERY_SCHEMA_VERSION
        && session.delivery.requestedDirectory === requestedDirectory
        ? session.delivery : null;
      const recoveryPending = session.delivery?.status === 'planned'
        || (session.delivery?.status === 'failed' && session.delivery.failurePhase === 'recoverable');
      if (recoveryPending && !previous) {
        throw new Error('存在未完成的其他交付计划；请先使用原 requestedDirectory 恢复');
      }

      if (previous?.status === 'planned'
        || (previous?.status === 'failed' && previous.failurePhase === 'recoverable')) {
        if (targetMatchesReceipt(previous)) {
          cleanupOwnedStage(previous);
          cleanupOwnedBackup(previous);
          previous = {
            ...previous,
            status: 'published',
            publishedAt: previous.publishedAt || new Date().toISOString(),
            reason: null,
            failurePhase: null,
            stagingDirectory: null,
            stagingOwnerId: null,
            previousTarget: null,
          };
          session.delivery = previous;
          persistSession(paths, session);
        } else {
          cleanupOwnedStage(previous);
          const targetStat = lstatIfPresent(previous.actualDirectory);
          if (previous.targetDisposition === 'missing' && !targetStat) {
            previous = null;
          } else if (previous.targetDisposition === 'empty'
            && targetStat?.isDirectory() && directoryIsEmpty(previous.actualDirectory)) {
            previous = null;
          } else if (previous.targetDisposition === 'owned' && previous.previousTarget
            && targetMatchesReceipt({
              ...previous.previousTarget,
              actualDirectory: previous.actualDirectory,
            })) {
            previous = {
              ...previous.previousTarget,
              schemaVersion: DELIVERY_SCHEMA_VERSION,
              status: 'stale',
              failurePhase: null,
              requestedDirectory,
              actualDirectory: previous.actualDirectory,
            };
          } else if (previous.targetDisposition === 'owned' && previous.previousTarget
            && !targetStat && lstatIfPresent(previous.backupDirectory)
            && targetMatchesReceipt({
              ...previous.previousTarget,
              actualDirectory: previous.backupDirectory,
            })) {
            fs.renameSync(previous.backupDirectory, previous.actualDirectory);
            previous = {
              ...previous.previousTarget,
              schemaVersion: DELIVERY_SCHEMA_VERSION,
              status: 'stale',
              failurePhase: null,
              requestedDirectory,
              actualDirectory: previous.actualDirectory,
            };
          } else {
            persistDeliveryFailure(paths, session, previous, 'planned-target-drift');
            throw new Error('未完成交付计划的目标发生漂移，拒绝覆盖');
          }
        }
      }

      if (previous && targetMatchesReceipt(previous)
        && sourceMatchesReceipt(paths, previous, collection.downstreamInput)) {
        if (previous.status !== 'published') {
          previous = {
            ...previous, status: 'published', reason: null, failurePhase: null,
          };
          session.delivery = previous;
          persistSession(paths, session);
        }
        return publishResult(previous);
      }

      let choice;
      if (previous) {
        if (!targetMatchesReceipt(previous)) {
          persistDeliveryFailure(paths, session, previous, 'published-target-drift');
          throw new Error('已发布目标发生漂移或被用户修改，拒绝覆盖');
        }
        choice = {
          actualDirectory: previous.actualDirectory,
          replacingOwned: true,
          replacingEmpty: false,
          previous,
        };
      } else {
        const sessionWithoutDelivery = { ...session, delivery: undefined };
        choice = chooseActualDirectory(requestedDirectory, sessionWithoutDelivery, paths);
      }

      const {
        actualDirectory, replacingOwned, replacingEmpty,
      } = choice;
      if (isInside(paths.root, actualDirectory)) {
        throw new Error('实际交付目录不能位于内部采集会话目录中');
      }
      const plan = buildPublishPlan(paths, collection.downstreamInput, session, previous);
      const records = planRecords(paths, plan);
      const stageOwnerId = crypto.randomUUID();
      const stage = path.join(
        path.dirname(actualDirectory),
        `.${path.basename(actualDirectory)}.publish.${stageOwnerId}.tmp`,
      );
      const planned = {
        schemaVersion: DELIVERY_SCHEMA_VERSION,
        status: 'planned',
        requestedDirectory,
        actualDirectory,
        planHash: deliveryPlanHash(requestedDirectory, actualDirectory, records.files, records.assets),
        files: records.files,
        assets: records.assets,
        publishedAt: null,
        reason: null,
        failurePhase: null,
        stagingDirectory: stage,
        stagingOwnerId: stageOwnerId,
        backupDirectory: replacingOwned
          ? `${actualDirectory}.previous.${stageOwnerId}` : null,
        targetDisposition: replacingOwned ? 'owned' : (replacingEmpty ? 'empty' : 'missing'),
        previousTarget: replacingOwned ? { files: previous.files, assets: previous.assets } : null,
      };
      session.delivery = planned;
      persistSession(paths, session);

      try {
        fs.mkdirSync(path.dirname(actualDirectory), { recursive: true, mode: 0o700 });
        writeStage(stage, plan, stageOwnerId);
        if (!stagingMatchesReceipt(planned)) {
          throw new Error('发布前 staging 文件哈希复验失败');
        }
        fs.unlinkSync(path.join(stage, '.knowledge-collection-staging.json'));
        publishStage(stage, actualDirectory, {
          replacingOwned, replacingEmpty, previous, backupDirectory: planned.backupDirectory,
        });
        if (!targetMatchesReceipt(planned)) {
          throw new Error('发布后文件复验失败');
        }
        cleanupOwnedBackup(planned);
      } catch (error) {
        try { cleanupOwnedStage(planned); } catch {}
        persistDeliveryFailure(paths, session, planned, error.message, 'recoverable');
        throw error;
      }

      const receipt = {
        ...planned,
        status: 'published',
        publishedAt: new Date().toISOString(),
        failurePhase: null,
        stagingDirectory: null,
        stagingOwnerId: null,
        backupDirectory: null,
        previousTarget: null,
      };
      session.delivery = receipt;
      persistSession(paths, session);
      return publishResult(receipt);
    });
  });
}
