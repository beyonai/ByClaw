#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRANDS = Object.freeze(['米哈游', '华为', '比亚迪', '泡泡玛特', '小鹏汽车']);
const EVIDENCE_KEYS = Object.freeze([
  'raw',
  'sourceUrl',
  'classificationReasons',
  'sanitizationReport',
  'phaseTimings',
]);

export function median(values) {
  if (!Array.isArray(values) || !values.length
    || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('median 需要非空有限数字数组');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validateRuns(label, runs) {
  if (!Array.isArray(runs) || runs.length !== BRANDS.length) {
    throw new Error(`${label} 必须包含 5 个品牌运行记录`);
  }
  const brands = runs.map((run) => run?.brand);
  if (brands.some((brand) => typeof brand !== 'string') || new Set(brands).size !== BRANDS.length) {
    throw new Error(`${label} 品牌记录重复或无效`);
  }
  if (BRANDS.some((brand) => !brands.includes(brand))) {
    throw new Error(`${label} 品牌集合必须是 ${BRANDS.join('、')}`);
  }
  for (const run of runs) {
    if (typeof run.totalMs !== 'number' || !Number.isFinite(run.totalMs) || run.totalMs <= 0) {
      throw new Error(`${label} ${run.brand} totalMs 必须是正数`);
    }
  }
  return runs;
}

function criterion(passed, actual, expected) {
  return { passed: Boolean(passed), actual, expected };
}

export function evaluatePerformance({ baseline, candidate }) {
  const baselineRuns = validateRuns('baseline', baseline);
  const candidateRuns = validateRuns('candidate', candidate);
  const baselineMedianMs = median(baselineRuns.map((run) => run.totalMs));
  const candidateMedianMs = median(candidateRuns.map((run) => run.totalMs));
  const candidateMaxMs = Math.max(...candidateRuns.map((run) => run.totalMs));
  const medianImprovementRatio = (baselineMedianMs - candidateMedianMs) / baselineMedianMs;
  const correctRuns = candidateRuns.filter((run) => run.deliveryComplete === true
    && run.fullText === 1 && run.pending === 0 && run.failed === 0).length;
  const cloudRuns = candidateRuns.filter((run) => run.cloudVerified === true
    && Number.isInteger(run.cloudBytes) && run.cloudBytes > 0).length;
  const articleRuns = candidateRuns.filter((run) => run.selectedPageType === 'article').length;
  const boundedDiscoveryRuns = candidateRuns.filter((run) => Number.isInteger(run.discoveryCalls)
    && run.discoveryCalls >= 1 && run.discoveryCalls <= 2).length;
  const noAdHocRuns = candidateRuns.filter((run) => run.adHocCleanupScripts === 0).length;
  const evidenceRuns = candidateRuns.filter((run) => run.evidence
    && EVIDENCE_KEYS.every((key) => run.evidence[key] === true)).length;
  const criteria = {
    correctDelivery: criterion(correctRuns === 5, `${correctRuns}/5`, '5/5'),
    cloudDelivery: criterion(cloudRuns === 5, `${cloudRuns}/5`, '5/5'),
    articleSelection: criterion(articleRuns === 5, `${articleRuns}/5`, '5/5'),
    boundedDiscovery: criterion(boundedDiscoveryRuns === 5, `${boundedDiscoveryRuns}/5`, '5/5'),
    noAdHocCleanup: criterion(noAdHocRuns === 5, `${noAdHocRuns}/5`, '5/5'),
    evidenceComplete: criterion(evidenceRuns === 5, `${evidenceRuns}/5`, '5/5'),
    medianTime: criterion(candidateMedianMs <= 240_000, candidateMedianMs, '<=240000'),
    maximumTime: criterion(candidateMaxMs <= 360_000, candidateMaxMs, '<=360000'),
    medianImprovement: criterion(medianImprovementRatio >= 0.4, medianImprovementRatio, '>=0.4'),
  };
  return {
    ok: true,
    action: 'performance-summary',
    metrics: {
      baselineMedianMs,
      candidateMedianMs,
      candidateMaxMs,
      medianImprovementRatio,
    },
    criteria,
    passed: Object.values(criteria).every((item) => item.passed),
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
  if (!args['--baseline-file'] || !args['--candidate-file']) {
    throw new Error('必须同时提供 --baseline-file 与 --candidate-file');
  }
  return args;
}

function readRuns(filePath, label) {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} 必须是普通 JSON 文件`);
  const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  return parsed?.runs;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = evaluatePerformance({
      baseline: readRuns(args['--baseline-file'], 'baseline'),
      candidate: readRuns(args['--candidate-file'], 'candidate'),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      action: 'performance-summary',
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
