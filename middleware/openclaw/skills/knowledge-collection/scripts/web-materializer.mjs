'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  recordPendingCollectionItem,
  registerFullTextEvidenceReceipt,
} from './collection-state.mjs';
import { authorizePublicSource } from './discovery-authorization.mjs';
import { analyzeWebMarkdown } from './web-content-analysis.mjs';
import { atomicWriteJson, isInside, loadSession, readJson } from './session.mjs';

const ITEM_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

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

function assertSafeFile(root, candidate, label) {
  const lexicalRoot = path.resolve(root);
  const absolute = path.resolve(candidate);
  if (!isInside(lexicalRoot, absolute) || !fs.existsSync(absolute)) {
    throw new Error(`${label} 不存在或越出允许目录`);
  }
  if (!fs.existsSync(lexicalRoot) || fs.lstatSync(lexicalRoot).isSymbolicLink()) {
    throw new Error(`${label} 允许目录不能是符号链接`);
  }
  let current = absolute;
  while (current !== lexicalRoot) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} 路径不能包含符号链接`);
    current = path.dirname(current);
  }
  if (!fs.statSync(absolute).isFile()) throw new Error(`${label} 必须是普通文件`);
  const absoluteRoot = fs.realpathSync(lexicalRoot);
  const canonical = fs.realpathSync(absolute);
  if (!isInside(absoluteRoot, canonical)) throw new Error(`${label} 实际路径越出允许目录`);
  return absolute;
}

function controlledExecutorResult(paths, itemId, rawPath) {
  const expectedDir = path.join(paths.root, 'raw', 'bycli', 'web', itemId);
  const candidate = assertSafeFile(expectedDir, requireText(rawPath, '--executor-result-file'), '--executor-result-file');
  if (path.basename(candidate) !== 'executor-result.json') {
    throw new Error('--executor-result-file 必须是受控 executor-result.json');
  }
  return { absolute: candidate, relative: toPosixRelative(paths.root, candidate), value: readJson(candidate) };
}

function rewriteLocalAssets(markdown, assets) {
  let rewritten = markdown;
  for (const asset of assets) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rewritten = rewritten.replace(new RegExp(`(\\!\\[[^\\]]*\\]\\(\\s*)${escaped}(\\s*\\))`, 'g'), `$1assets/${asset}$2`);
  }
  return rewritten;
}

function removeLocalAssets(markdown, assets) {
  let cleaned = markdown;
  for (const asset of assets) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(
      `\\!\\[[^\\]]*\\]\\(\\s*<?${escaped}>?(?:\\s+['"][^'"]*['"])?\\s*\\)`,
      'g',
    ), '');
  }
  return cleaned;
}

function frontmatter(title, sourceUrl) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    'source: public-internet',
    `source_url: ${JSON.stringify(sourceUrl)}`,
    'collection_filters: {}',
    '---',
    '',
  ].join('\n');
}

function ensureDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory()) {
    throw new Error(`目录不安全: ${directory}`);
  }
}

function existingMaterialization(paths, itemId, identity) {
  const diagnosticsRelative = `raw/materialization/${itemId}.json`;
  const diagnosticsPath = path.join(paths.root, diagnosticsRelative);
  if (!fs.existsSync(diagnosticsPath)) return null;
  const diagnostics = readJson(assertSafeFile(
    paths.root, diagnosticsPath, 'existing materialization diagnostics',
  ));
  if (diagnostics.action !== 'materialize-web' || diagnostics.itemId !== itemId
    || diagnostics.requestedUrl !== identity.requestedUrl
    || diagnostics.resolvedUrl !== identity.resolvedUrl || diagnostics.complete !== true) {
    throw new Error(`MATERIALIZATION_CONFLICT: ${itemId} 物化身份不一致`);
  }
  for (const [kind, files] of [
    ['inputFiles', diagnostics.inputFiles], ['outputFiles', diagnostics.outputFiles],
  ]) {
    if (!Array.isArray(files) || !files.length) {
      throw new Error(`MATERIALIZATION_CONFLICT: ${itemId} ${kind} 不完整`);
    }
    for (const file of files) {
      const artifact = requireText(file?.artifact, `${kind}.artifact`);
      const absolute = assertSafeFile(paths.root, path.join(paths.root, artifact), `${kind}.artifact`);
      if (file.sha256 !== `sha256:${sha256(fs.readFileSync(absolute))}`) {
        throw new Error(`MATERIALIZATION_CONFLICT: ${itemId} ${artifact} 哈希变化`);
      }
    }
  }
  const payloadPath = path.join(paths.root, '.collection-inputs', `web-${itemId}.json`);
  const latest = loadSession(paths, { persistMigration: false }).session;
  const receipt = (latest.task?.fullTextEvidenceReceipts || [])
    .find((candidate) => candidate.artifact === diagnosticsRelative) || null;
  return {
    ok: true,
    action: 'materialize-web',
    idempotent: true,
    materialization: {
      status: 'materialized',
      contentGranularity: 'full-text',
      markdownPath: `markdown/items/${itemId}/index.md`,
      sanitizedPath: `sanitized/items/${itemId}/index.md`,
    },
    collectPayloadPath: fs.existsSync(payloadPath) ? payloadPath : null,
    diagnostics: diagnosticsRelative,
    receipt,
    timing: diagnostics.timing || { totalMs: 0 },
  };
}

export async function runWebMaterialize(paths, args, options = {}) {
  const now = options.now || (() => performance.now());
  const startedAt = now();
  const itemId = requireText(args?.['item-id'], '--item-id');
  if (!ITEM_ID.test(itemId)) throw new Error('--item-id 格式无效');
  const executorArtifact = controlledExecutorResult(paths, itemId, args?.['executor-result-file']);
  const executorResult = executorArtifact.value;
  if (executorResult?.schemaVersion !== '1.0' || executorResult.executor !== 'bycli'
    || executorResult.status !== 'saved' || executorResult.exitCode !== 0
    || executorResult.timedOut || executorResult.truncated || executorResult.errorCode) {
    throw new Error('executor-result 未确认成功且完整的 byCLI 网页抓取');
  }
  const savedRelative = requireText(executorResult.saved, 'executorResult.saved');
  const expectedSaved = `raw/bycli/web/${itemId}/article.md`;
  if (savedRelative !== expectedSaved) throw new Error('executorResult.saved 不属于当前 item');
  const savedAbsolute = assertSafeFile(
    path.join(paths.root, 'raw', 'bycli', 'web', itemId),
    path.join(paths.root, savedRelative),
    'executorResult.saved',
  );
  const rawMarkdown = fs.readFileSync(savedAbsolute, 'utf8');
  if (fs.statSync(savedAbsolute).size !== executorResult.size
    || sha256(rawMarkdown) !== executorResult.sha256) {
    throw new Error('executorResult size/sha256 与正文不一致');
  }

  const { session } = loadSession(paths, { persistMigration: false });
  const requested = authorizePublicSource(session.task?.discoveryGate, executorResult.requestedUrl);
  const resolved = authorizePublicSource(session.task?.discoveryGate, executorResult.resolvedUrl);
  if (requested.candidateId !== resolved.candidateId) throw new Error('resolvedUrl 与 requestedUrl 授权身份不一致');

  const analysis = analyzeWebMarkdown(rawMarkdown, executorResult);
  const diagnosticsDir = path.join(paths.root, 'raw', 'materialization');
  ensureDirectory(diagnosticsDir);
  const diagnosticsAbsolute = path.join(diagnosticsDir, `${itemId}.json`);
  const diagnosticsRelative = toPosixRelative(paths.root, diagnosticsAbsolute);
  const baseDiagnostics = {
    schemaVersion: '1.0',
    action: 'materialize-web',
    executor: 'bycli',
    transactionId: crypto.randomUUID(),
    itemId,
    requestedUrl: executorResult.requestedUrl,
    resolvedUrl: executorResult.resolvedUrl,
    sourceUrl: executorResult.resolvedUrl,
    complete: analysis.confidence === 'high',
    contentGranularity: analysis.confidence === 'high' ? 'full-text' : 'unknown',
    confidence: analysis.confidence,
    reasonCodes: analysis.reasonCodes,
    inputChars: analysis.inputChars,
    outputChars: analysis.outputChars,
    substantiveParagraphs: analysis.substantiveParagraphs,
    remoteMediaRemoved: analysis.remoteMediaRemoved,
  };
  const existing = existingMaterialization(paths, itemId, baseDiagnostics);
  if (existing) return existing;
  const acquisitionArtifacts = [executorArtifact.relative, savedRelative];

  if (analysis.confidence !== 'high') {
    atomicWriteJson(diagnosticsAbsolute, { ...baseDiagnostics, timing: { totalMs: Math.max(0, now() - startedAt) } });
    const pending = recordPendingCollectionItem(paths, {
      itemId,
      source: 'public-internet',
      sourceSkill: 'bycli',
      backend: 'web',
      sourceUrl: executorResult.resolvedUrl,
      title: analysis.title,
      rawArtifacts: [...acquisitionArtifacts, diagnosticsRelative],
      reason: 'web-materialization-low-confidence',
    });
    return {
      ok: true,
      action: 'materialize-web',
      materialization: pending.materialization,
      collectPayloadPath: null,
      diagnostics: diagnosticsRelative,
      receipt: null,
      timing: { totalMs: Math.max(0, now() - startedAt) },
    };
  }

  const rawItemDir = path.dirname(savedAbsolute);
  const localAssets = [];
  const unavailableLocalAssets = [];
  for (const relative of analysis.localAssets) {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
      throw new Error(`本地图片路径越界: ${relative}`);
    }
    const candidate = path.resolve(rawItemDir, relative);
    if (!isInside(path.resolve(rawItemDir), candidate)) {
      throw new Error(`本地图片路径越界: ${relative}`);
    }
    if (!fs.existsSync(candidate)) {
      unavailableLocalAssets.push(relative);
      continue;
    }
    const absolute = assertSafeFile(rawItemDir, candidate, `本地图片 ${relative}`);
    localAssets.push({ relative: relative.split(path.sep).join('/'), absolute });
  }
  baseDiagnostics.unavailableLocalMediaRemoved = unavailableLocalAssets.length;
  const cleanedMarkdown = removeLocalAssets(analysis.markdown, unavailableLocalAssets);
  const rendered = `${frontmatter(analysis.title, executorResult.resolvedUrl)}${rewriteLocalAssets(
    cleanedMarkdown,
    localAssets.map((asset) => asset.relative),
  )}`;
  const transactionRoot = path.join(paths.root, '.collection-tmp', `materialize-${baseDiagnostics.transactionId}`);
  const stagedMarkdown = path.join(transactionRoot, 'markdown');
  const stagedSanitized = path.join(transactionRoot, 'sanitized');
  ensureDirectory(stagedMarkdown);
  ensureDirectory(stagedSanitized);
  fs.writeFileSync(path.join(stagedMarkdown, 'index.md'), rendered, { mode: 0o600 });
  fs.writeFileSync(path.join(stagedSanitized, 'index.md'), rendered, { mode: 0o600 });
  for (const asset of localAssets) {
    for (const stagedRoot of [stagedMarkdown, stagedSanitized]) {
      const destination = path.join(stagedRoot, 'assets', asset.relative);
      ensureDirectory(path.dirname(destination));
      fs.copyFileSync(asset.absolute, destination);
    }
  }

  const markdownRelative = `markdown/items/${itemId}/index.md`;
  const sanitizedRelative = `sanitized/items/${itemId}/index.md`;
  const payloadRelative = `.collection-inputs/web-${itemId}.json`;
  const payloadAbsolute = path.join(paths.root, payloadRelative);
  const assetArtifacts = localAssets.map((asset) => toPosixRelative(paths.root, asset.absolute));
  const rawArtifacts = [...acquisitionArtifacts, ...assetArtifacts, diagnosticsRelative];
  const hashedArtifact = (artifact) => ({
    artifact,
    sha256: `sha256:${sha256(fs.readFileSync(path.join(paths.root, artifact)))}`,
  });
  const materializedAssetOutputs = localAssets.flatMap((asset) => [
    `markdown/items/${itemId}/assets/${asset.relative}`,
    `sanitized/items/${itemId}/assets/${asset.relative}`,
  ]).map((artifact) => ({
    artifact,
    sha256: `sha256:${sha256(fs.readFileSync(
      path.join(transactionRoot, artifact.startsWith('markdown/') ? 'markdown' : 'sanitized',
        'assets', artifact.split('/assets/')[1]),
    ))}`,
  }));
  const diagnostics = {
    ...baseDiagnostics,
    inputFiles: [...acquisitionArtifacts, ...assetArtifacts].map(hashedArtifact),
    outputFiles: [markdownRelative, sanitizedRelative]
      .map((artifact) => ({ artifact, sha256: `sha256:${sha256(rendered)}` }))
      .concat(materializedAssetOutputs),
    timing: { totalMs: Math.max(0, now() - startedAt) },
  };
  const payload = {
    schemaVersion: '1.0',
    itemId,
    source: 'public-internet',
    sourceSkill: 'bycli',
    backend: 'web',
    rawArtifacts,
    contentGranularity: 'full-text',
    fullTextEvidence: { schemaVersion: '1.0', executor: 'bycli', artifact: diagnosticsRelative },
    media: {
      coverStatus: 'unknown', coverCount: 0, materializedCoverCount: 0,
      reason: 'generic-web-cover-not-classified',
    },
    markdownPath: markdownRelative,
    sanitizedPath: sanitizedRelative,
    canonicalItem: {
      title: analysis.title,
      url: executorResult.resolvedUrl,
      author: '',
      publishTime: '',
      markdown: sanitizedRelative,
      fileName: sanitizedRelative,
    },
  };

  const targets = [
    [stagedMarkdown, path.join(paths.root, 'markdown', 'items', itemId)],
    [stagedSanitized, path.join(paths.root, 'sanitized', 'items', itemId)],
  ];
  const created = [];
  try {
    for (const [, target] of targets) {
      if (fs.existsSync(target)) throw new Error(`MATERIALIZATION_CONFLICT: ${target}`);
      ensureDirectory(path.dirname(target));
    }
    for (const [source, target] of targets) {
      fs.renameSync(source, target);
      created.push(target);
    }
    atomicWriteJson(diagnosticsAbsolute, diagnostics);
    created.push(diagnosticsAbsolute);
    atomicWriteJson(payloadAbsolute, payload);
    created.push(payloadAbsolute);
    const receipt = registerFullTextEvidenceReceipt(paths, {
      executor: 'bycli', sourceUrl: executorResult.resolvedUrl, artifact: diagnosticsRelative,
    });
    fs.rmSync(transactionRoot, { recursive: true, force: true });
    return {
      ok: true,
      action: 'materialize-web',
      materialization: {
        status: 'materialized', contentGranularity: 'full-text',
        markdownPath: markdownRelative, sanitizedPath: sanitizedRelative,
      },
      collectPayloadPath: payloadAbsolute,
      diagnostics: diagnosticsRelative,
      receipt,
      timing: diagnostics.timing,
    };
  } catch (error) {
    for (const target of created.reverse()) fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(transactionRoot, { recursive: true, force: true });
    throw error;
  }
}
