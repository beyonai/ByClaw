#!/usr/bin/env node
'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRANDS = Object.freeze(['米哈游', '华为', '比亚迪', '泡泡玛特', '小鹏汽车']);
const PHASES = Object.freeze([
  'discovery', 'acquisition', 'materialization', 'collectStatus', 'cloudCheck', 'cloudUploadList',
]);
const EVIDENCE_COMMON = Object.freeze([
  'status', 'discovery', 'phaseTimings', 'raw', 'finalMarkdown',
  'cloudCheck', 'cloudUpload', 'cloudList',
]);

export function median(values) {
  if (!Array.isArray(values) || !values.length
    || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('median 需要非空有限数字数组');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function evidencePath(root, relative, label) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    throw new Error(`${label} 必须是批次目录内的相对路径`);
  }
  const lexicalRoot = path.resolve(root);
  const target = path.resolve(lexicalRoot, relative);
  if (!isInside(lexicalRoot, target)) throw new Error(`${label} 相对路径越出批次目录`);
  let current = target;
  while (current !== lexicalRoot) {
    if (!fs.existsSync(current)) throw new Error(`${label} 证据文件不存在`);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} 不能是符号链接`);
    current = path.dirname(current);
  }
  if (!fs.statSync(target).isFile()) throw new Error(`${label} 必须是普通文件`);
  const canonicalRoot = fs.realpathSync(lexicalRoot);
  if (!isInside(canonicalRoot, fs.realpathSync(target))) throw new Error(`${label} 实际路径越界`);
  return target;
}

function readJson(root, relative, label) {
  const value = JSON.parse(fs.readFileSync(evidencePath(root, relative, label), 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`);
  return value;
}

function validateDocument(input, role) {
  const document = input?.document;
  const root = input?.root;
  if (document?.schemaVersion !== '2.0') throw new Error('PERFORMANCE_SCHEMA_MIGRATION_REQUIRED');
  if (document.role !== role) throw new Error(`${role} role 无效`);
  if (typeof root !== 'string' || !fs.statSync(root).isDirectory()) throw new Error(`${role} root 无效`);
  for (const key of ['batchId', 'environmentId', 'protocolVersion', 'startedAt']) {
    if (typeof document[key] !== 'string' || !document[key].trim()) throw new Error(`${role} ${key} 缺失`);
  }
  const version = document.version || document.buildId;
  if (typeof version !== 'string' || !version.trim() || /^(?:unknown|latest|test|placeholder)$/i.test(version)) {
    throw new Error(`${role} version/buildId 无效`);
  }
  if (!Array.isArray(document.runs) || document.runs.length !== BRANDS.length
    || document.runs.some((run, index) => run?.brand !== BRANDS[index])) {
    throw new Error(`${role} 品牌集合及顺序必须为 ${BRANDS.join('、')}`);
  }
  const preflight = readJson(root, document.preflight, `${role}.preflight`);
  if (preflight.ok !== true || !preflight.cloudResourceId || preflight.cloudList?.ok !== true
    || preflight.bycliDoctor?.connectivity !== 'connected') {
    throw new Error(`${role} preflight 未通过`);
  }
  if (role === 'candidate' && preflight.genericWebPath?.ok !== true) {
    throw new Error('candidate preflight 缺少通用网页路径验证');
  }
  return { root: path.resolve(root), document, version, preflight };
}

function chosenAttempt(run, label) {
  if (!Number.isInteger(run.measuredAttempt) || run.measuredAttempt < 1
    || !Array.isArray(run.attempts) || !run.attempts[run.measuredAttempt - 1]) {
    throw new Error(`${label} measuredAttempt 无效`);
  }
  const attemptIds = run.attempts.map((attempt) => attempt?.attemptId);
  if (attemptIds.some((id) => typeof id !== 'string' || !id) || new Set(attemptIds).size !== attemptIds.length) {
    throw new Error(`${label} attemptId 重复或无效`);
  }
  return run.attempts[run.measuredAttempt - 1];
}

function deriveRun(batch, run, role, targetPaths) {
  const label = `${role}.${run.brand}`;
  const attempt = chosenAttempt(run, label);
  const evidence = attempt.evidence || {};
  for (const key of [...EVIDENCE_COMMON,
    ...(role === 'baseline' ? ['baselineAudit'] : ['materializationDiagnostics', 'fullTextReceipt'])]) {
    evidencePath(batch.root, evidence[key], `${label}.${key}`);
  }
  const status = readJson(batch.root, evidence.status, `${label}.status`);
  const discovery = readJson(batch.root, evidence.discovery, `${label}.discovery`);
  const phases = readJson(batch.root, evidence.phaseTimings, `${label}.phaseTimings`);
  const raw = readJson(batch.root, evidence.raw, `${label}.raw`);
  const check = readJson(batch.root, evidence.cloudCheck, `${label}.cloudCheck`);
  const upload = readJson(batch.root, evidence.cloudUpload, `${label}.cloudUpload`);
  const list = readJson(batch.root, evidence.cloudList, `${label}.cloudList`);
  const finalPath = evidencePath(batch.root, evidence.finalMarkdown, `${label}.finalMarkdown`);
  const finalBytes = fs.statSync(finalPath).size;
  const finalSha256 = sha256(fs.readFileSync(finalPath));
  const selected = discovery.selectedCandidate || {};
  const expectedTarget = `/validation/${batch.document.batchId}/${role}/${run.brand}/${attempt.attemptId}.md`;
  if (targetPaths.has(expectedTarget)) throw new Error(`云盘目标路径重复: ${expectedTarget}`);
  targetPaths.add(expectedTarget);
  const listed = Array.isArray(list.items) ? list.items.find((item) => item?.path === expectedTarget) : null;
  const startedMs = Date.parse(attempt.startedAt);
  const checkMs = Date.parse(check.finishedAt);
  const uploadMs = Date.parse(upload.finishedAt);
  const listMs = Date.parse(list.finishedAt);
  const phaseComplete = PHASES.every((name) => Number.isFinite(phases.phases?.[name]?.durationMs));
  const cloudVerified = check.ok === true && check.exists === false
    && upload.ok === true && list.ok === true && Boolean(listed)
    && [check.cloudResourceId, upload.cloudResourceId, list.cloudResourceId]
      .every((id) => id === batch.preflight.cloudResourceId)
    && check.targetPath === expectedTarget && upload.targetPath === expectedTarget
    && finalBytes > 0 && upload.bytes === finalBytes && listed?.size === finalBytes
    && upload.localSha256 === finalSha256 && (!listed?.sha256 || listed.sha256 === finalSha256)
    && (!upload.resourceVersion || !listed?.resourceVersion
      || upload.resourceVersion === listed.resourceVersion)
    && Number.isFinite(startedMs) && checkMs >= startedMs && uploadMs > checkMs && listMs > uploadMs;
  const commonCorrect = status.collection?.deliveryComplete === true
    && status.collection?.pending === 0 && status.collection?.failed === 0
    && status.collection?.contentGranularity?.['full-text'] >= 1
    && selected.pageType === 'article'
    && Number.isInteger(discovery.discoveryCalls) && discovery.discoveryCalls >= 1
    && discovery.discoveryCalls <= 2
    && raw.sourceUrl === selected.url && cloudVerified && phaseComplete;
  let roleCorrect = false;
  if (role === 'baseline') {
    const audit = readJson(batch.root, evidence.baselineAudit, `${label}.baselineAudit`);
    roleCorrect = audit.status === 'passed' && audit.topicRelevant === true
      && audit.sourceUrl === selected.url && audit.coverageRatio >= 0.9 && audit.fidelityRatio >= 0.95;
  } else {
    const diagnostics = readJson(
      batch.root, evidence.materializationDiagnostics, `${label}.materializationDiagnostics`,
    );
    const receipt = readJson(batch.root, evidence.fullTextReceipt, `${label}.fullTextReceipt`);
    const output = Array.isArray(diagnostics.outputFiles)
      ? diagnostics.outputFiles.find((item) => item?.artifact === evidence.finalMarkdown) : null;
    const hashesMatch = (files, kind) => Array.isArray(files) && files.length > 0
      && files.every((file, index) => {
        if (typeof file?.artifact !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(file?.sha256 || '')) {
          return false;
        }
        const artifactPath = evidencePath(
          batch.root, file.artifact, `${label}.materializationDiagnostics.${kind}[${index}]`,
        );
        return file.sha256 === `sha256:${sha256(fs.readFileSync(artifactPath))}`;
      });
    roleCorrect = selected.topicRelevance?.status === 'matched'
      && diagnostics.action === 'materialize-web' && diagnostics.complete === true
      && diagnostics.contentGranularity === 'full-text' && Boolean(diagnostics.transactionId)
      && diagnostics.requestedUrl === selected.url && diagnostics.resolvedUrl === selected.url
      && hashesMatch(diagnostics.inputFiles, 'inputFiles')
      && hashesMatch(diagnostics.outputFiles, 'outputFiles')
      && output?.sha256 === `sha256:${finalSha256}`
      && receipt.executor === 'bycli' && receipt.sourceUrl === selected.url
      && receipt.artifact === evidence.materializationDiagnostics;
  }
  return {
    brand: run.brand,
    measuredAttempt: run.measuredAttempt,
    totalMs: Number.isFinite(startedMs) && Number.isFinite(listMs) ? listMs - startedMs : null,
    correct: commonCorrect && roleCorrect,
    cloudVerified,
    phaseComplete,
  };
}

function criterion(passed, actual, expected) {
  return { passed: Boolean(passed), actual, expected };
}

export function evaluatePerformance({ baseline, candidate }) {
  const b = validateDocument(baseline, 'baseline');
  const c = validateDocument(candidate, 'candidate');
  if (b.document.batchId === c.document.batchId) throw new Error('baseline 与 candidate batchId 必须不同');
  if (b.version === c.version) throw new Error('baseline 与 candidate version/buildId 必须不同');
  if (b.document.environmentId !== c.document.environmentId) throw new Error('environmentId 不一致');
  if (b.document.protocolVersion !== c.document.protocolVersion) throw new Error('protocolVersion 不一致');
  if (b.preflight.cloudResourceId !== c.preflight.cloudResourceId) throw new Error('cloudResourceId 不一致');
  for (let index = 0; index < BRANDS.length; index += 1) {
    if (b.document.runs[index].measuredAttempt !== c.document.runs[index].measuredAttempt) {
      throw new Error(`${BRANDS[index]} measuredAttempt 未配对`);
    }
  }
  const targetPaths = new Set();
  const baselineRuns = b.document.runs.map((run) => deriveRun(b, run, 'baseline', targetPaths));
  const candidateRuns = c.document.runs.map((run) => deriveRun(c, run, 'candidate', targetPaths));
  const baselineCorrect = baselineRuns.filter((run) => run.correct).length;
  const candidateCorrect = candidateRuns.filter((run) => run.correct).length;
  const comparable = baselineCorrect === 5 && candidateCorrect === 5;
  const baselineMedianMs = comparable ? median(baselineRuns.map((run) => run.totalMs)) : null;
  const candidateMedianMs = comparable ? median(candidateRuns.map((run) => run.totalMs)) : null;
  const candidateMaxMs = comparable ? Math.max(...candidateRuns.map((run) => run.totalMs)) : null;
  const medianImprovementRatio = comparable
    ? (baselineMedianMs - candidateMedianMs) / baselineMedianMs : null;
  const criteria = {
    correctDelivery: criterion(comparable, `${baselineCorrect}/5; ${candidateCorrect}/5`, '5/5; 5/5'),
    medianTime: criterion(comparable && candidateMedianMs <= 240_000, candidateMedianMs, '<=240000'),
    maximumTime: criterion(comparable && candidateMaxMs <= 360_000, candidateMaxMs, '<=360000'),
    medianImprovement: criterion(
      comparable && medianImprovementRatio >= 0.4, medianImprovementRatio, '>=0.4',
    ),
  };
  return {
    ok: true,
    action: 'performance-summary',
    comparable,
    correctDelivery: { baseline: `${baselineCorrect}/5`, candidate: `${candidateCorrect}/5` },
    metrics: { baselineMedianMs, candidateMedianMs, candidateMaxMs, medianImprovementRatio },
    runs: { baseline: baselineRuns, candidate: candidateRuns },
    criteria,
    passed: comparable && Object.values(criteria).every((item) => item.passed),
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--baseline-file', '--candidate-file'].includes(flag) || !value) {
      throw new Error('用法: performance-summary.mjs --baseline-file <file> --candidate-file <file>');
    }
    if (Object.hasOwn(args, flag)) throw new Error(`参数重复: ${flag}`);
    args[flag] = value;
  }
  if (!args['--baseline-file'] || !args['--candidate-file']) throw new Error('必须同时提供 baseline 与 candidate');
  return args;
}

function loadBatch(filePath, role) {
  const absolute = path.resolve(filePath);
  if (fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isFile()) {
    throw new Error(`${role} 必须是普通 JSON 文件`);
  }
  return { root: path.dirname(absolute), document: JSON.parse(fs.readFileSync(absolute, 'utf8')) };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = evaluatePerformance({
      baseline: loadBatch(args['--baseline-file'], 'baseline'),
      candidate: loadBatch(args['--candidate-file'], 'candidate'),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false, action: 'performance-summary',
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
