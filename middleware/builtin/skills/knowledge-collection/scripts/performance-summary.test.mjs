import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { BRANDS, evaluatePerformance, median } from './performance-summary.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function writeJson(root, relative, value) {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return relative;
}

async function batch(role, times) {
  const root = await mkdtemp(join(tmpdir(), `performance-${role}-`));
  const batchId = `${role}-batch-20260901`;
  const cloudResourceId = 'cloud-20034261';
  const preflight = await writeJson(root, 'preflight.json', {
    ok: true, cloudResourceId, cloudList: { ok: true },
    bycliDoctor: { connectivity: 'connected' }, version: `${role}-v2`,
    ...(role === 'candidate' ? { genericWebPath: { ok: true, action: 'acquire-web' } } : {}),
  });
  const runs = [];
  for (const [index, brand] of BRANDS.entries()) {
    const attemptId = 'attempt-1';
    const dir = `runs/${index + 1}`;
    const sourceUrl = `https://example.com/news/${index + 1}`;
    const finalBody = `${brand} 的完整报道正文，包含足够内容用于验证。\n`;
    const finalMarkdown = `${dir}/final.md`;
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, finalMarkdown), finalBody);
    const localSha256 = sha256(finalBody);
    const startedAt = '2026-09-01T00:00:00.000Z';
    const listFinishedAt = new Date(Date.parse(startedAt) + times[index]).toISOString();
    const targetPath = `/validation/${batchId}/${role}/${brand}/${attemptId}.md`;
    const evidence = {
      status: await writeJson(root, `${dir}/status.json`, {
        collection: { deliveryComplete: true, pending: 0, failed: 0, contentGranularity: { 'full-text': 1 } },
      }),
      discovery: await writeJson(root, `${dir}/discovery.json`, {
        discoveryCalls: 1,
        selectedCandidate: {
          candidateId: `candidate-${index}`, url: sourceUrl, pageType: 'article',
          topicRelevance: { status: 'matched' },
        },
      }),
      phaseTimings: await writeJson(root, `${dir}/phases.json`, {
        phases: Object.fromEntries([
          'discovery', 'acquisition', 'materialization', 'collectStatus',
          'cloudCheck', 'cloudUploadList',
        ].map((name) => [name, { durationMs: 1 }])),
      }),
      raw: await writeJson(root, `${dir}/raw.json`, { sourceUrl, status: 'saved' }),
      finalMarkdown,
      cloudCheck: await writeJson(root, `${dir}/check.json`, {
        ok: true, exists: false, cloudResourceId, targetPath,
        finishedAt: '2026-09-01T00:00:01.000Z',
      }),
      cloudUpload: await writeJson(root, `${dir}/upload.json`, {
        ok: true, cloudResourceId, targetPath, bytes: Buffer.byteLength(finalBody),
        localSha256, resourceVersion: `rv-${index}`, finishedAt: '2026-09-01T00:00:02.000Z',
      }),
      cloudList: await writeJson(root, `${dir}/list.json`, {
        ok: true, cloudResourceId, finishedAt: listFinishedAt,
        items: [{ path: targetPath, size: Buffer.byteLength(finalBody), sha256: localSha256, resourceVersion: `rv-${index}` }],
      }),
    };
    if (role === 'baseline') {
      evidence.baselineAudit = await writeJson(root, `${dir}/audit.json`, {
        schemaVersion: '1.0', status: 'passed', coverageRatio: 1, fidelityRatio: 1,
        topicRelevant: true, sourceUrl,
      });
    } else {
      const rawSha256 = sha256(await readFile(join(root, evidence.raw)));
      evidence.materializationDiagnostics = await writeJson(root, `${dir}/diagnostics.json`, {
        action: 'materialize-web', complete: true, contentGranularity: 'full-text',
        transactionId: `tx-${index}`, requestedUrl: sourceUrl, resolvedUrl: sourceUrl,
        inputFiles: [{ artifact: evidence.raw, sha256: `sha256:${rawSha256}` }],
        outputFiles: [{ artifact: finalMarkdown, sha256: `sha256:${localSha256}` }],
      });
      evidence.fullTextReceipt = await writeJson(root, `${dir}/receipt.json`, {
        executor: 'bycli', sourceUrl, artifact: evidence.materializationDiagnostics,
      });
    }
    runs.push({ brand, measuredAttempt: 1, attempts: [{ attemptId, startedAt, evidence }] });
  }
  return {
    root,
    document: {
      schemaVersion: '2.0', role, batchId, version: `${role}-v2`,
      environmentId: 'project-cloud-runtime-fingerprint', protocolVersion: '2.0',
      startedAt: '2026-09-01T00:00:00.000Z', preflight, runs,
    },
  };
}

test('median handles odd and even numeric samples', () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([10, 4, 8, 2]), 6);
});

test('derives 5/5 correctness, cloud evidence, timings, and improvement from schema 2.0 files', async () => {
  const baseline = await batch('baseline', [540_000, 480_000, 600_000, 450_000, 510_000]);
  const candidate = await batch('candidate', [180_000, 210_000, 240_000, 200_000, 220_000]);
  try {
    const result = evaluatePerformance({ baseline, candidate });
    assert.equal(result.passed, true);
    assert.equal(result.comparable, true);
    assert.equal(result.correctDelivery.baseline, '5/5');
    assert.equal(result.correctDelivery.candidate, '5/5');
    assert.equal(result.metrics.baselineMedianMs, 510_000);
    assert.equal(result.metrics.candidateMedianMs, 210_000);
    assert.ok(result.metrics.medianImprovementRatio >= 0.4);
  } finally {
    await rm(baseline.root, { recursive: true, force: true });
    await rm(candidate.root, { recursive: true, force: true });
  }
});

test('returns non-comparable and null improvement when either role is below 5/5', async () => {
  const baseline = await batch('baseline', BRANDS.map(() => 500_000));
  const candidate = await batch('candidate', BRANDS.map(() => 200_000));
  try {
    const discoveryPath = join(candidate.root, candidate.document.runs[0].attempts[0].evidence.discovery);
    await writeFile(discoveryPath, JSON.stringify({ discoveryCalls: 1, selectedCandidate: { pageType: 'weak' } }));
    const result = evaluatePerformance({ baseline, candidate });
    assert.equal(result.comparable, false);
    assert.equal(result.passed, false);
    assert.equal(result.correctDelivery.candidate, '4/5');
    assert.equal(result.metrics.medianImprovementRatio, null);
  } finally {
    await rm(baseline.root, { recursive: true, force: true });
    await rm(candidate.root, { recursive: true, force: true });
  }
});

test('accepts a candidate delivered through the controlled WeChat materializer', async () => {
  const baseline = await batch('baseline', BRANDS.map(() => 500_000));
  const candidate = await batch('candidate', BRANDS.map(() => 200_000));
  try {
    const evidence = candidate.document.runs[0].attempts[0].evidence;
    const discoveryPath = join(candidate.root, evidence.discovery);
    const rawPath = join(candidate.root, evidence.raw);
    const diagnosticsPath = join(candidate.root, evidence.materializationDiagnostics);
    const receiptPath = join(candidate.root, evidence.fullTextReceipt);
    const sourceUrl = 'https://weixin.sogou.com/link?url=mihoyo-fixture';
    const resolvedUrl = 'https://mp.weixin.qq.com/s/mihoyo-fixture';
    const discovery = JSON.parse(await readFile(discoveryPath, 'utf8'));
    discovery.selectedCandidate.url = sourceUrl;
    await writeFile(discoveryPath, JSON.stringify(discovery));
    await writeFile(rawPath, JSON.stringify({ sourceUrl, status: 'saved' }));
    await writeFile(diagnosticsPath, JSON.stringify({
      action: 'materialize-wechat', complete: true, contentGranularity: 'full-text',
      transactionId: 'wechat-tx-1', requestedUrl: sourceUrl, resolvedUrl,
      inputFiles: [{ artifact: evidence.raw, sha256: `sha256:${sha256(await readFile(rawPath))}` }],
      outputFiles: [{
        artifact: evidence.finalMarkdown,
        sha256: `sha256:${sha256(await readFile(join(candidate.root, evidence.finalMarkdown)))}`,
      }],
    }));
    await writeFile(receiptPath, JSON.stringify({
      executor: 'bycli', sourceUrl, artifact: evidence.materializationDiagnostics,
    }));

    const result = evaluatePerformance({ baseline, candidate });
    assert.equal(result.correctDelivery.candidate, '5/5');
    assert.equal(result.passed, true);
  } finally {
    await rm(baseline.root, { recursive: true, force: true });
    await rm(candidate.root, { recursive: true, force: true });
  }
});

test('rejects v1, mismatched protocol, paired-attempt drift, absolute paths, and symlinks', async () => {
  const baseline = await batch('baseline', BRANDS.map(() => 500_000));
  const candidate = await batch('candidate', BRANDS.map(() => 200_000));
  try {
    assert.throws(() => evaluatePerformance({
      baseline: { ...baseline, document: { runs: [] } }, candidate,
    }), /PERFORMANCE_SCHEMA_MIGRATION_REQUIRED/);
    candidate.document.protocolVersion = '3.0';
    assert.throws(() => evaluatePerformance({ baseline, candidate }), /protocolVersion/);
    candidate.document.protocolVersion = '2.0';
    candidate.document.runs[0].measuredAttempt = 2;
    assert.throws(() => evaluatePerformance({ baseline, candidate }), /measuredAttempt/);
    candidate.document.runs[0].measuredAttempt = 1;
    candidate.document.runs[0].attempts[0].evidence.raw = '/tmp/raw.json';
    assert.throws(() => evaluatePerformance({ baseline, candidate }), /相对路径/);
    candidate.document.runs[0].attempts[0].evidence.raw = 'runs/1/raw-link.json';
    await symlink(join(candidate.root, 'runs/1/raw.json'), join(candidate.root, 'runs/1/raw-link.json'));
    assert.throws(() => evaluatePerformance({ baseline, candidate }), /符号链接/);
  } finally {
    await rm(baseline.root, { recursive: true, force: true });
    await rm(candidate.root, { recursive: true, force: true });
  }
});
