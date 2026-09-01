import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  BRANDS,
  evaluatePerformance,
  median,
} from './performance-summary.mjs';

const scriptPath = resolve(dirname(new URL(import.meta.url).pathname), 'performance-summary.mjs');

function run(brand, totalMs, overrides = {}) {
  return {
    brand,
    totalMs,
    discoveryCalls: 1,
    adHocCleanupScripts: 0,
    deliveryComplete: true,
    fullText: 1,
    pending: 0,
    failed: 0,
    cloudVerified: true,
    cloudBytes: 10_184,
    selectedPageType: 'article',
    evidence: {
      raw: true,
      sourceUrl: true,
      classificationReasons: true,
      sanitizationReport: true,
      phaseTimings: true,
    },
    ...overrides,
  };
}

function cli(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      let json;
      try { json = JSON.parse(stdout); } catch { json = undefined; }
      resolveRun({ code, stdout, stderr, json });
    });
  });
}

test('median handles odd and even numeric samples', () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([10, 4, 8, 2]), 6);
});

test('accepts a correct five-brand candidate with required time improvement', () => {
  const baselineTimes = [540_000, 480_000, 600_000, 450_000, 510_000];
  const candidateTimes = [180_000, 210_000, 240_000, 200_000, 220_000];
  const result = evaluatePerformance({
    baseline: BRANDS.map((brand, index) => run(brand, baselineTimes[index])),
    candidate: BRANDS.map((brand, index) => run(brand, candidateTimes[index])),
  });

  assert.equal(result.passed, true);
  assert.equal(result.metrics.baselineMedianMs, 510_000);
  assert.equal(result.metrics.candidateMedianMs, 210_000);
  assert.equal(result.metrics.candidateMaxMs, 240_000);
  assert.ok(result.metrics.medianImprovementRatio >= 0.4);
  assert.ok(Object.values(result.criteria).every((criterion) => criterion.passed));
});

test('reports correctness and evidence failures without rejecting valid input', () => {
  const result = evaluatePerformance({
    baseline: BRANDS.map((brand) => run(brand, 500_000)),
    candidate: BRANDS.map((brand, index) => run(brand, 200_000, index === 0 ? {
      selectedPageType: 'reject',
      cloudVerified: false,
      evidence: {
        raw: true,
        sourceUrl: true,
        classificationReasons: false,
        sanitizationReport: true,
        phaseTimings: true,
      },
    } : {})),
  });

  assert.equal(result.passed, false);
  assert.equal(result.criteria.articleSelection.passed, false);
  assert.equal(result.criteria.cloudDelivery.passed, false);
  assert.equal(result.criteria.evidenceComplete.passed, false);
  assert.equal(result.criteria.medianTime.passed, true);
});

test('rejects missing or duplicate brand records', () => {
  assert.throws(() => evaluatePerformance({
    baseline: BRANDS.slice(0, 4).map((brand) => run(brand, 500_000)),
    candidate: BRANDS.map((brand) => run(brand, 200_000)),
  }), /baseline.*5|品牌/);
  assert.throws(() => evaluatePerformance({
    baseline: BRANDS.map((brand) => run(brand, 500_000)),
    candidate: BRANDS.map((brand, index) => run(index === 4 ? BRANDS[0] : brand, 200_000)),
  }), /candidate.*品牌|重复/);
});

test('CLI returns machine-readable passed false with exit zero', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-summary-'));
  try {
    const baselinePath = join(root, 'baseline.json');
    const candidatePath = join(root, 'candidate.json');
    await writeFile(baselinePath, JSON.stringify({
      runs: BRANDS.map((brand) => run(brand, 500_000)),
    }));
    await writeFile(candidatePath, JSON.stringify({
      runs: BRANDS.map((brand) => run(brand, 400_000)),
    }));
    const result = await cli(['--baseline-file', baselinePath, '--candidate-file', candidatePath]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.ok, true);
    assert.equal(result.json.action, 'performance-summary');
    assert.equal(result.json.passed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
