import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runArxivMaterialize } from './arxiv-materializer.mjs';
import { cmdCollect, collectionStatus } from './collection-state.mjs';
import { cmdPublish } from './publish-delivery.mjs';
import { cmdInit } from './research-state.mjs';
import { sessionPaths } from './session.mjs';

const SOURCE_URL = 'https://arxiv.org/pdf/2501.12948';
const ACQUISITION_URL = 'https://arxiv.org/html/2501.12948v2';
const TITLE = 'DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning';

function completeMarkdown(acquisitionUrl = ACQUISITION_URL, { autolink = false } = {}) {
  const body = 'The model learns reasoning behavior from reinforcement learning. '.repeat(45);
  const sourceMarker = autolink ? `<${acquisitionUrl}>` : acquisitionUrl;
  return [
    `# ${TITLE}`,
    '',
    `> 原文链接: ${sourceMarker}`,
    '',
    '## Abstract', body,
    '## 1 Introduction', body,
    '## 2 Approach', body,
    '![Training overview](images/training.png)',
    '## 3 Experiments', body,
    '## 4 Discussion and Limitations', body,
    '## 5 Conclusion', body,
    '## References', '[1] DeepSeek-AI. DeepSeek-V3 Technical Report.',
    '',
  ].join('\n\n');
}

async function fixture({ markdown = completeMarkdown(), metadataId = '2501.12948' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arxiv-materializer-'));
  cmdInit({
    'session-dir': root,
    query: 'DeepSeek-R1 PDF 全文',
    'direct-urls': JSON.stringify([SOURCE_URL]),
    'required-content-granularity': 'full-text',
  });
  const rawDir = join(root, 'raw/bycli/arxiv/deepseek-r1');
  await mkdir(join(rawDir, 'images'), { recursive: true });
  const metadataFile = join(rawDir, 'metadata.json');
  const fulltextFile = join(rawDir, 'executor-output.md');
  await writeFile(metadataFile, `${JSON.stringify({
    id: metadataId,
    title: TITLE,
    authors: ['DeepSeek-AI'],
    published: '2025-01-22',
    url: `https://arxiv.org/abs/${metadataId}`,
  }, null, 2)}\n`);
  await writeFile(fulltextFile, markdown);
  await writeFile(join(rawDir, 'images/training.png'), 'png-fixture');
  return { root, paths: sessionPaths(root), metadataFile, fulltextFile };
}

async function wrapMetadata(f, wrapper) {
  const metadata = JSON.parse(await readFile(f.metadataFile, 'utf8'));
  await writeFile(f.metadataFile, `${JSON.stringify(wrapper(metadata), null, 2)}\n`);
}

function args(f) {
  return {
    'metadata-file': f.metadataFile,
    'fulltext-file': f.fulltextFile,
    'source-url': SOURCE_URL,
    'acquisition-url': ACQUISITION_URL,
    'item-id': 'deepseek-r1-2501-12948',
  };
}

test('materializes verified arXiv HTML as registered full text', async () => {
  const f = await fixture();
  try {
    const result = await runArxivMaterialize(f.paths, args(f));
    assert.equal(result.materialization.status, 'materialized');
    assert.equal(result.materialization.contentGranularity, 'full-text');

    const payload = JSON.parse(await readFile(result.collectPayloadPath, 'utf8'));
    assert.equal(payload.contentGranularity, 'full-text');
    assert.equal(payload.canonicalItem.url, SOURCE_URL);
    assert.deepEqual(payload.fullTextEvidence, {
      schemaVersion: '1.0',
      executor: 'bycli',
      artifact: 'raw/materialization/deepseek-r1-2501-12948.json',
    });
    assert.ok(payload.rawArtifacts.includes('raw/bycli/arxiv/deepseek-r1/images/training.png'));

    const sanitized = await readFile(join(
      f.root, 'sanitized/items/deepseek-r1-2501-12948/index.md',
    ), 'utf8');
    assert.match(sanitized, /source_url: "https:\/\/arxiv\.org\/pdf\/2501\.12948"/);
    assert.match(sanitized, /acquisition_url: "https:\/\/arxiv\.org\/html\/2501\.12948v2"/);
    assert.match(sanitized, /\]\(assets\/images\/training\.png\)/);
    assert.equal(await readFile(join(
      f.root, 'sanitized/items/deepseek-r1-2501-12948/assets/images/training.png',
    ), 'utf8'), 'png-fixture');

    const receipt = JSON.parse(await readFile(join(
      f.root, 'raw/materialization/deepseek-r1-2501-12948.json',
    ), 'utf8'));
    assert.equal(receipt.sourceUrl, SOURCE_URL);
    assert.equal(receipt.acquisitionUrl, ACQUISITION_URL);
    assert.equal(receipt.complete, true);

    const collected = cmdCollect(f.paths, { 'item-json-file': result.collectPayloadPath });
    assert.equal(collected.ok, true);
    const status = collectionStatus(f.paths);
    assert.equal(status.deliveryComplete, true);
    assert.equal(status.requiredContentGranularity, 'full-text');
    assert.equal(status.contentGranularity['full-text'], 1);

    const session = JSON.parse(await readFile(join(f.root, 'session.json'), 'utf8'));
    assert.deepEqual(session.task.discoveryGate.candidates[0].acquisitionUrls, [
      SOURCE_URL,
      ACQUISITION_URL,
    ]);
    assert.match(session.task.fullTextEvidenceReceipts[0].artifactHash, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('accepts a uniquely matching paper inside a byCLI result envelope', async () => {
  const f = await fixture();
  try {
    await wrapMetadata(f, (paper) => ({ status: 'success', data: { items: [paper] } }));
    const result = await runArxivMaterialize(f.paths, args(f));
    assert.equal(result.materialization.contentGranularity, 'full-text');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('accepts the balanced Markdown autolink emitted by byCLI web read', async () => {
  const f = await fixture({ markdown: completeMarkdown(ACQUISITION_URL, { autolink: true }) });
  try {
    const result = await runArxivMaterialize(f.paths, args(f));
    assert.equal(result.materialization.status, 'materialized');
    assert.equal(result.materialization.contentGranularity, 'full-text');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('rejects malformed Markdown autolinks without weakening exact source matching', async () => {
  for (const marker of [`<${ACQUISITION_URL}`, `${ACQUISITION_URL}>`]) {
    const f = await fixture({
      markdown: completeMarkdown().replace(ACQUISITION_URL, marker),
    });
    try {
      const result = await runArxivMaterialize(f.paths, args(f));
      assert.equal(result.materialization.status, 'pending');
      const diagnostics = JSON.parse(await readFile(join(f.root, result.diagnostics), 'utf8'));
      assert.ok(diagnostics.reasonCodes.includes('source-marker-mismatch'));
      assert.equal(result.collectPayloadPath, null);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test('a corrected arXiv retry can close materialize, collect, status, and publish', async () => {
  const f = await fixture({
    markdown: completeMarkdown().replace(ACQUISITION_URL, `<${ACQUISITION_URL}`),
  });
  const deliveryDir = `${await realpath(f.root)}-delivery`;
  try {
    const first = await runArxivMaterialize(f.paths, args(f));
    assert.equal(first.materialization.status, 'pending');
    assert.equal(collectionStatus(f.paths).deliveryComplete, false);

    await writeFile(f.fulltextFile, completeMarkdown(ACQUISITION_URL, { autolink: true }));
    const corrected = await runArxivMaterialize(f.paths, args(f));
    assert.equal(corrected.materialization.status, 'materialized');
    assert.equal(cmdCollect(f.paths, { 'item-json-file': corrected.collectPayloadPath }).ok, true);
    assert.equal(collectionStatus(f.paths).deliveryComplete, true);

    const published = cmdPublish(f.paths, { 'delivery-dir': deliveryDir });
    assert.equal(published.delivery.actualDirectory, deliveryDir);
    assert.deepEqual(published.deliveryInput.files, [join(deliveryDir, 'deepseek-r1-2501-12948.md')]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(deliveryDir, { recursive: true, force: true });
  }
});

test('keeps structurally incomplete arXiv output pending and cannot satisfy full text', async () => {
  const f = await fixture({ markdown: completeMarkdown().replace(/## References[\s\S]*$/, '') });
  try {
    const result = await runArxivMaterialize(f.paths, args(f));
    assert.equal(result.materialization.status, 'pending');
    assert.equal(result.collectPayloadPath, null);
    assert.equal(collectionStatus(f.paths).deliveryComplete, false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('rejects a different paper identity or acquisition URL', async () => {
  const f = await fixture({ metadataId: '1706.03762' });
  try {
    await assert.rejects(runArxivMaterialize(f.paths, args(f)), /arXiv|论文 ID|source/i);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }

  const g = await fixture({ markdown: completeMarkdown('https://arxiv.org/html/1706.03762') });
  try {
    await assert.rejects(runArxivMaterialize(g.paths, {
      ...args(g), 'acquisition-url': 'https://arxiv.org/html/1706.03762',
    }), /arXiv|论文 ID|source/i);
  } finally {
    await rm(g.root, { recursive: true, force: true });
  }
});

test('rejects a full-text artifact that escapes raw through a symlink', async () => {
  const f = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'arxiv-materializer-outside-'));
  try {
    const outsideMarkdown = join(outside, 'paper.md');
    await writeFile(outsideMarkdown, completeMarkdown());
    await rm(f.fulltextFile);
    await symlink(outsideMarkdown, f.fulltextFile);
    await assert.rejects(runArxivMaterialize(f.paths, args(f)), /raw|符号链接|越出/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
