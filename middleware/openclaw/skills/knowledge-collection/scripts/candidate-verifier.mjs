import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { promoteProbeMaterialization } from './collection-state.mjs';
import { commitProbeAttempt, pauseProbeRun, readProbeRun } from './probe-state.mjs';
import { loadSession } from './session.mjs';
import { assessMaterializedTopic } from './topic-relevance.mjs';
import { analyzeWebMarkdown } from './web-content-analysis.mjs';
import {
  acquireArxivProbe,
  acquireWechatProbe,
  acquireWebProbe,
  authorizationEquivalentHttpUrl,
} from './web-acquirer.mjs';
import { sanitizeWechatMarkdown } from './wechat-materializer.mjs';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function normalizedBody(markdown) {
  return String(markdown || '')
    .replace(/^---\n[\s\S]*?\n---\n/u, '')
    .replace(/^#{1,6}\s+.*$/gmu, '')
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gmu, '')
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim();
}

export function contentFingerprint(markdown) {
  return `sha256:${sha256(normalizedBody(markdown))}`;
}

function terminal(paths, runId, attemptId, result) {
  return commitProbeAttempt(paths, runId, attemptId, {
    acquisitionOutcome: result.acquisitionOutcome,
    pageVerification: result.pageVerification || 'not-evaluated',
    verifiedTopicStatus: result.verifiedTopicStatus || 'not-evaluated',
    promotionStatus: result.promotionStatus || 'not-eligible',
    reasonCode: result.reasonCode,
    ...(result.contentFingerprint ? { contentFingerprint: result.contentFingerprint } : {}),
    ...(result.duplicateOf ? { duplicateOf: result.duplicateOf } : {}),
    ...(result.failureDiagnostic ? { failureDiagnostic: result.failureDiagnostic } : {}),
  });
}

function safeParent(root, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes('..')) {
    throw new Error(`PROBE_ARTIFACT_PATH_INVALID: ${relativePath}`);
  }
  const normalized = relativePath.split(path.sep).join('/');
  if (!['raw/probes/', 'markdown/', 'sanitized/items/', '.collection-tmp/']
    .some((prefix) => normalized.startsWith(prefix))) {
    throw new Error(`PROBE_ARTIFACT_PATH_INVALID: ${relativePath}`);
  }
  const parent = path.dirname(path.resolve(root, relativePath));
  const resolvedRoot = path.resolve(root);
  if (!parent.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`PROBE_ARTIFACT_PATH_INVALID: ${relativePath}`);
  }
  let current = resolvedRoot;
  for (const segment of path.relative(resolvedRoot, parent).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`PROBE_ARTIFACT_PARENT_UNSAFE: ${relativePath}`);
    }
  }
  return path.resolve(root, relativePath);
}

function publishArtifacts(root, artifacts) {
  const transaction = crypto.randomUUID();
  const stageRoot = `.collection-tmp/probe-${transaction}`;
  try {
    for (const [relativePath, content] of artifacts) {
      const staged = safeParent(root, `${stageRoot}/${relativePath}`);
      fs.writeFileSync(staged, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      const descriptor = fs.openSync(staged, 'r');
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
    for (const [relativePath, content] of artifacts) {
      const staged = path.resolve(root, stageRoot, relativePath);
      const target = safeParent(root, relativePath);
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile() || fs.readFileSync(target, 'utf8') !== content) {
          throw new Error(`PROBE_ARTIFACT_CONFLICT: ${relativePath}`);
        }
        fs.unlinkSync(staged);
      } else {
        fs.renameSync(staged, target);
        const parentDescriptor = fs.openSync(path.dirname(target), 'r');
        try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
      }
    }
  } finally {
    fs.rmSync(path.resolve(root, stageRoot), { recursive: true, force: true });
  }
}

function persistedAcquisition(root, base) {
  const acquisitionRoot = path.resolve(root, `${base}/acquisition`);
  const metadataPath = path.join(acquisitionRoot, 'executor-result.json');
  const bodyPath = path.join(acquisitionRoot, 'acquired.md');
  if (!fs.existsSync(acquisitionRoot)) return null;
  const stat = fs.lstatSync(acquisitionRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || !fs.existsSync(metadataPath) || !fs.existsSync(bodyPath)) {
    throw new Error('PROBE_ACQUISITION_EVIDENCE_INCOMPLETE');
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const markdown = fs.readFileSync(bodyPath, 'utf8');
  if (metadata.schemaVersion !== '1.0' || metadata.status !== 'saved'
    || metadata.markdownSha256 !== `sha256:${sha256(markdown)}`) {
    throw new Error('PROBE_ACQUISITION_EVIDENCE_INVALID');
  }
  return { ...metadata.executorResult, status: 'saved', markdown };
}

function persistAcquisition(root, base, acquired) {
  const executorResult = { ...acquired };
  delete executorResult.markdown;
  const target = path.resolve(root, `${base}/acquisition`);
  safeParent(root, `${base}/placeholder`);
  const stage = safeParent(root, `.collection-tmp/acquisition-${crypto.randomUUID()}/placeholder`);
  const stageRoot = path.dirname(stage);
  const contents = [
    ['acquired.md', acquired.markdown],
    ['executor-result.json', `${JSON.stringify({
      schemaVersion: '1.0', status: 'saved',
      markdownSha256: `sha256:${sha256(acquired.markdown)}`, executorResult,
    }, null, 2)}\n`],
  ];
  try {
    for (const [name, content] of contents) {
      const file = path.join(stageRoot, name);
      fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      const descriptor = fs.openSync(file, 'r');
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
    if (fs.existsSync(target)) throw new Error('PROBE_ACQUISITION_EVIDENCE_CONFLICT');
    fs.renameSync(stageRoot, target);
    const parentDescriptor = fs.openSync(path.dirname(target), 'r');
    try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
  } finally {
    if (fs.existsSync(stageRoot)) fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function writePromotionManifest(root, relativePath, manifest) {
  const target = safeParent(root, relativePath);
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  if (fs.existsSync(target)) {
    const previous = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (previous?.promotionId !== manifest.promotionId) {
      throw new Error(`PROBE_PROMOTION_MANIFEST_CONFLICT: ${relativePath}`);
    }
  }
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  const descriptor = fs.openSync(temporary, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, target);
  const parentDescriptor = fs.openSync(path.dirname(target), 'r');
  try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
}

function finishTerminalPromotionManifest(paths, runId, attempt) {
  if (attempt.promotionStatus !== 'promoted' || !attempt.promotionId) return;
  const relativePath = `raw/probes/${runId}/${attempt.candidateId}/${attempt.attemptId}/promotion-manifest.json`;
  const absolute = path.resolve(paths.root, relativePath);
  if (!fs.existsSync(absolute)) return;
  const manifest = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (manifest.phase === 'planned' && manifest.promotionId === attempt.promotionId) {
    for (const artifact of manifest.artifacts || []) {
      const artifactAbsolute = path.resolve(paths.root, artifact.path);
      if (!fs.existsSync(artifactAbsolute)
        || `sha256:${sha256(fs.readFileSync(artifactAbsolute))}` !== artifact.sha256) {
        throw new Error(`PROBE_PROMOTION_RECOVERY_INVALID: ${artifact.path}`);
      }
    }
    writePromotionManifest(paths.root, relativePath, { ...manifest, phase: 'committed' });
  }
}

function candidateAndAttempt(paths, runId, attemptId) {
  const run = readProbeRun(paths, runId);
  const attempt = run.attempts.find((entry) => entry.attemptId === attemptId);
  if (!attempt) {
    throw new Error(`PROBE_ATTEMPT_NOT_ACTIVE: ${attemptId}`);
  }
  if (attempt.attemptState === 'terminal') {
    finishTerminalPromotionManifest(paths, runId, attempt);
    return { run, attempt, terminal: true };
  }
  if (attempt.attemptState !== 'acquiring') throw new Error(`PROBE_ATTEMPT_NOT_ACTIVE: ${attemptId}`);
  const session = loadSession(paths, { persistMigration: false }).session;
  const candidate = session.task.discoveryGate.candidates.find(
    (entry) => entry.candidateId === attempt.candidateId,
  );
  if (!candidate || candidate.candidateVersion !== attempt.snapshot.candidateVersion
    || candidate.evidenceHash !== attempt.snapshot.evidenceHash) {
    throw new Error(`PROBE_CANDIDATE_SNAPSHOT_CONFLICT: ${attempt.candidateId}`);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(candidate.candidateId)
    || !/^[a-zA-Z0-9_-]{1,128}$/u.test(attemptId)
    || !/^[a-zA-Z0-9_-]{1,128}$/u.test(runId)) {
    throw new Error('PROBE_ARTIFACT_ID_INVALID: probe artifact 路径标识无效');
  }
  return {
    run,
    attempt,
    session,
    candidate: {
      ...candidate,
      canonicalUrl: attempt.snapshot.canonicalUrl,
      acquisitionUrls: [...attempt.snapshot.acquisitionUrls],
    },
  };
}

function validateAcquiredUrl(candidate, acquired) {
  const allowed = [...new Set([candidate.canonicalUrl, ...(candidate.acquisitionUrls || [])])];
  const isAllowed = (value) => {
    try { return allowed.some((url) => authorizationEquivalentHttpUrl(url, value)); } catch { return false; }
  };
  let trustedWechatRedirect = false;
  try {
    const requested = new URL(acquired.requestedUrl);
    const resolved = new URL(acquired.resolvedUrl);
    trustedWechatRedirect = requested.hostname === 'weixin.sogou.com'
      && resolved.hostname === 'mp.weixin.qq.com' && /^\/s(?:\/|$)/u.test(resolved.pathname);
  } catch {}
  if (!isAllowed(acquired.requestedUrl)
    || (!isAllowed(acquired.resolvedUrl) && !trustedWechatRedirect)) {
    throw new Error(`PROBE_ACQUISITION_URL_NOT_AUTHORIZED: ${acquired.resolvedUrl || acquired.requestedUrl}`);
  }
}

function sourceKind(candidate) {
  const hostname = new URL(candidate.canonicalUrl).hostname;
  if (hostname === 'mp.weixin.qq.com' || hostname === 'weixin.sogou.com') return 'wechat';
  if (hostname === 'arxiv.org') return 'arxiv';
  return 'web';
}

function acquisitionCandidate(candidate) {
  if (sourceKind(candidate) !== 'arxiv') return candidate;
  const html = candidate.acquisitionUrls.find((url) => /^https:\/\/arxiv\.org\/html\//iu.test(url));
  return html ? { ...candidate, acquisitionUrls: [html, ...candidate.acquisitionUrls.filter((url) => url !== html)] }
    : candidate;
}

export async function verifyCandidate(paths, { runId, attemptId }, options = {}) {
  const { run, attempt, session, candidate, terminal: alreadyTerminal } = candidateAndAttempt(
    paths, runId, attemptId,
  );
  if (alreadyTerminal) return JSON.parse(JSON.stringify(attempt));
  const acquireOptions = {
    probeId: `${runId}-${attemptId}`,
    runProcess: options.runProcess,
    bridgeScript: options.bridgeScript,
    now: options.now,
    remainingBudgetMs: options.remainingBudgetMs,
  };
  const acquire = options.acquire || ((target) => {
    const kind = sourceKind(target);
    if (kind === 'wechat') return acquireWechatProbe(target, acquireOptions);
    if (kind === 'arxiv') return acquireArxivProbe(target, acquireOptions);
    return acquireWebProbe(target, acquireOptions);
  });
  const evidenceBase = `raw/probes/${runId}/${candidate.candidateId}/${attemptId}`;
  let acquired = persistedAcquisition(paths.root, evidenceBase);
  if (!acquired) acquired = await acquire(acquisitionCandidate(candidate), { runId, attemptId });
  if (acquired?.status === 'requires-user-action') {
    if (run.input.manualPolicy === 'pause') {
      const paused = pauseProbeRun(paths, runId, {
        attemptId,
        reasonCode: acquired.reasonCode || 'REQUIRES_USER_ACTION',
        remainingBudgetMs: options.remainingBudgetMs ?? acquired.remainingBudgetMs,
        ...(acquired.browserSession ? {
          ownedSession: { kind: 'browser', sessionId: acquired.browserSession },
        } : {}),
      });
      return { attemptState: 'paused-user-action', runStatus: paused.status };
    }
    return terminal(paths, runId, attemptId, {
      acquisitionOutcome: 'skipped', reasonCode: 'REQUIRES_USER_ACTION_UNATTENDED',
    });
  }
  if (acquired?.status === 'infrastructure-blocked') {
    const blocked = pauseProbeRun(paths, runId, {
      attemptId,
      status: 'infrastructure-blocked',
      reasonCode: acquired.reasonCode || 'ACQUISITION_INFRASTRUCTURE_BLOCKED',
      remainingBudgetMs: options.remainingBudgetMs ?? acquired.remainingBudgetMs,
    });
    return { attemptState: 'infrastructure-blocked', runStatus: blocked.status };
  }
  if (acquired?.status !== 'saved') {
    return terminal(paths, runId, attemptId, {
      acquisitionOutcome: acquired?.status === 'unsupported' ? 'unsupported' : 'unavailable',
      reasonCode: acquired?.reasonCode || 'ACQUISITION_UNAVAILABLE',
      ...(acquired?.failureDiagnostic ? { failureDiagnostic: acquired.failureDiagnostic } : {}),
    });
  }

  validateAcquiredUrl(candidate, acquired);
  if (!persistedAcquisition(paths.root, evidenceBase)) {
    persistAcquisition(paths.root, evidenceBase, acquired);
    if (options.afterPersistAcquisition) await options.afterPersistAcquisition();
  }
  const kind = sourceKind(candidate);
  const wechat = kind === 'wechat' ? sanitizeWechatMarkdown(acquired.markdown, acquired) : null;
  const analysis = analyzeWebMarkdown(wechat?.markdown || acquired.markdown, acquired);
  if (kind === 'arxiv') {
    const headings = [...analysis.markdown.matchAll(/^#{2,6}\s+(.+)$/gmu)].map((match) => match[1]);
    const completePaper = analysis.markdown.length >= 5_000 && headings.length >= 5
      && headings.some((heading) => /abstract/iu.test(heading))
      && headings.some((heading) => /introduction/iu.test(heading))
      && headings.some((heading) => /references?/iu.test(heading));
    if (!completePaper) {
      analysis.confidence = 'low';
      analysis.reasonCodes = [...new Set([...analysis.reasonCodes, 'incomplete-arxiv-structure'])];
    }
  }
  if (analysis.confidence !== 'high') {
    return terminal(paths, runId, attemptId, {
      acquisitionOutcome: 'saved',
      pageVerification: 'verified-non-article',
      reasonCode: analysis.reasonCodes[0] || 'NOT_ARTICLE',
    });
  }
  const topic = assessMaterializedTopic(session.task.discoveryGate.topicContract, {
    title: analysis.title,
    markdown: analysis.markdown,
  });
  if (!['matched', 'not-required'].includes(topic.status)) {
    return terminal(paths, runId, attemptId, {
      acquisitionOutcome: 'saved',
      pageVerification: 'verified-article',
      verifiedTopicStatus: topic.status,
      reasonCode: `TOPIC_${topic.status.toUpperCase()}`,
    });
  }

  const fingerprint = contentFingerprint(analysis.markdown);
  const existing = session.collection.collection.items.find(
    (item) => item.contentFingerprint === fingerprint,
  );
  if (existing) {
    return terminal(paths, runId, attemptId, {
      acquisitionOutcome: 'saved',
      pageVerification: 'verified-article',
      verifiedTopicStatus: topic.status,
      promotionStatus: 'duplicate',
      reasonCode: 'DUPLICATE_CONTENT',
      contentFingerprint: fingerprint,
      duplicateOf: existing.itemId,
    });
  }

  const promotionId = `${runId}:${candidate.candidateId}:${sha256(fingerprint).slice(0, 16)}`;
  const itemId = `item-${sha256(promotionId).slice(0, 16)}`;
  const base = evidenceBase;
  const markdownPath = `markdown/${itemId}.md`;
  const sanitizedPath = `sanitized/items/${itemId}.md`;
  const receiptPath = `${base}/full-text-receipt.json`;
  const verificationPath = `${base}/verification.json`;
  const promotionManifestPath = `${base}/promotion-manifest.json`;
  const executor = String(acquired.executor || 'web');
  const sourceUrl = candidate.canonicalUrl;
  const receipt = {
    schemaVersion: '1.0', executor, sourceUrl, complete: true,
    contentGranularity: 'full-text', acquiredAt: attempt.startedAt,
  };
  const verificationReceipt = {
    schemaVersion: '1.0', runId, attemptId, candidateId: candidate.candidateId,
    requestedUrl: acquired.requestedUrl, resolvedUrl: acquired.resolvedUrl,
    pageVerification: 'verified-article', verifiedTopicStatus: topic.status,
    contentFingerprint: fingerprint,
    analysis: {
      title: analysis.title,
      confidence: analysis.confidence,
      reasonCodes: analysis.reasonCodes,
      inputChars: analysis.inputChars,
      outputChars: analysis.outputChars,
      substantiveParagraphs: analysis.substantiveParagraphs,
      remoteMediaRemoved: analysis.remoteMediaRemoved,
      localAssets: analysis.localAssets,
    },
    artifacts: {
      markdown: { path: markdownPath, sha256: `sha256:${sha256(analysis.markdown)}` },
      sanitized: { path: sanitizedPath, sha256: `sha256:${sha256(analysis.markdown)}` },
    },
    topic,
  };
  const promotionManifest = {
    schemaVersion: '1.0', phase: 'planned', promotionId, runId, attemptId,
    candidateId: candidate.candidateId, contentFingerprint: fingerprint,
    artifacts: [markdownPath, sanitizedPath, receiptPath, verificationPath].map((artifactPath) => ({
      path: artifactPath,
      sha256: `sha256:${sha256(artifactPath === markdownPath || artifactPath === sanitizedPath
        ? analysis.markdown : (artifactPath === receiptPath
          ? `${JSON.stringify(receipt, null, 2)}\n` : `${JSON.stringify(verificationReceipt, null, 2)}\n`))}`,
    })),
  };
  writePromotionManifest(paths.root, promotionManifestPath, promotionManifest);
  publishArtifacts(paths.root, [
    [markdownPath, analysis.markdown],
    [sanitizedPath, analysis.markdown],
    [receiptPath, `${JSON.stringify(receipt, null, 2)}\n`],
    [verificationPath, `${JSON.stringify(verificationReceipt, null, 2)}\n`],
  ]);
  if (options.afterPublishArtifacts) await options.afterPublishArtifacts();

  const promoted = promoteProbeMaterialization(paths, {
    runId,
    attemptId,
    promotionId,
    contentFingerprint: fingerprint,
    duplicateGroup: fingerprint,
    pageVerification: verificationReceipt.analysis,
    verifiedTopicStatus: topic.status,
    verificationReceipt: verificationPath,
    item: {
      itemId,
      source: 'public-internet',
      sourceSkill: executor,
      backend: 'web',
    rawArtifacts: [
      `${base}/acquisition/acquired.md`, `${base}/acquisition/executor-result.json`,
      receiptPath, verificationPath,
      promotionManifestPath,
    ],
      markdownPath,
      sanitizedPath,
      contentGranularity: 'full-text',
      fullTextEvidence: { schemaVersion: '1.0', executor, artifact: receiptPath },
      media: {
        coverStatus: 'not-present', coverCount: 0, materializedCoverCount: 0, reason: null,
      },
      canonicalItem: {
        title: analysis.title,
        url: sourceUrl,
        author: String(acquired.author || ''),
        publishTime: String(acquired.publishTime || ''),
        markdown: sanitizedPath,
        fileName: sanitizedPath,
      },
    },
  });
  writePromotionManifest(paths.root, promotionManifestPath, { ...promotionManifest, phase: 'committed' });
  return promoted;
}
