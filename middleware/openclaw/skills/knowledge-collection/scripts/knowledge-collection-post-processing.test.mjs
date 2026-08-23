import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const scriptPath = resolve(dirname(new URL(import.meta.url).pathname), 'knowledge-collection-post-processing.mjs');
const unifiedScriptPath = resolve(dirname(new URL(import.meta.url).pathname), 'knowledge-collection.mjs');

function runCli(args) {
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

function runUnifiedCli(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [unifiedScriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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

function runCliWithPreload(preloadPath, args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['--require', preloadPath, scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
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

function canonicalItem(id) {
  return {
    title: `Article ${id}`,
    url: `https://example.com/${id}`,
    author: '',
    publishTime: '',
    markdown: `sanitized/items/${id}.md`,
    fileName: `sanitized/items/${id}.md`,
  };
}

function inventoryItem(id, status = 'materialized') {
  return {
    itemId: id,
    title: `Article ${id}`,
    sourceUrl: `https://example.com/${id}`,
    sourceItemId: id,
    sourceSkill: 'bycli',
    backend: 'bycli',
    collectionFilters: {},
    rawArtifacts: [`raw/${id}.json`],
    materialization: {
      status,
      markdownPath: status === 'materialized' ? `markdown/${id}.md` : null,
      sanitizedPath: status === 'materialized' ? `sanitized/items/${id}.md` : null,
      reason: null,
    },
  };
}

function metadata(items, overrides = {}) {
  return {
    schemaVersion: '1.0',
    storage: { fallback: false },
    collection: { status: 'complete', items },
    retention: { auditRequired: false, userRequested: false },
    postProcessing: { runs: [] },
    ...overrides,
  };
}

async function createSession(ids = ['a', 'b'], metadataValue) {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-collection-post-processing-'));
  await Promise.all([
    mkdir(join(root, 'raw'), { recursive: true }),
    mkdir(join(root, 'markdown'), { recursive: true }),
    mkdir(join(root, 'sanitized/items'), { recursive: true }),
    mkdir(join(root, '.post-processing-inputs'), { recursive: true }),
  ]);
  for (const id of ids) {
    await writeFile(join(root, `raw/${id}.json`), JSON.stringify({ id, content: `Body ${id}` }));
    await writeFile(join(root, `markdown/${id}.md`), `# Article ${id}\n\nBody ${id}`);
    await writeFile(join(root, `sanitized/items/${id}.md`), `# Article ${id}\n\nBody ${id}`);
  }
  await writeFile(join(root, 'collection-result.json'), JSON.stringify({
    schemaVersion: '1.0',
    title: 'Collection',
    source: 'public-internet',
    backend: 'bycli',
    url: 'https://example.com',
    filters: {},
    items: ids.map(canonicalItem),
  }));
  await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify(metadataValue ?? metadata(ids.map((id) => inventoryItem(id)))));
  return root;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeRun(root, name, value) {
  const path = join(root, '.post-processing-inputs', name);
  await writeFile(path, JSON.stringify(value));
  return path;
}

function runRecord(runId, itemStatuses, overrides = {}) {
  return {
    schemaVersion: '1.0',
    runId,
    operation: 'ingest',
    target: { kind: 'knowledge-base', id: 'kb-1', path: '/imports' },
    selection: {
      mode: 'all',
      itemIds: itemStatuses.map(([itemId]) => itemId),
      discardUnselected: false,
      discardUnselectedConfirmed: false,
    },
    status: itemStatuses.every(([, status]) => status === 'success') ? 'success' : 'partial',
    sessionStatus: itemStatuses.every(([, status]) => status === 'success') ? 'success' : 'partial',
    globalStage: { name: null, required: false, status: 'not-required', reason: null },
    items: itemStatuses.map(([itemId, status]) => ({
      itemId,
      status,
      stage: status === 'success' ? 'build-submitted' : 'upload',
      reason: status === 'success' ? null : 'fixture failure',
      downstreamRef: status === 'success' ? `/imports/${itemId}.md` : null,
      cleanupStatus: 'not-started',
    })),
    ...overrides,
  };
}

async function testInspectMigratesLegacyMetadataAndPreservesSourceFields() {
  const root = await createSession(['a'], { storageFallback: true, partial: false, backendCliVersion: '1.2.3' });
  try {
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.metadata.schemaVersion, '1.0');
    assert.equal(result.json.metadata.storage.fallback, true);
    assert.equal(result.json.metadata.collection.items.length, 1);
    assert.equal(result.json.metadata.collection.items[0].materialization.status, 'materialized');
    assert.equal(result.json.metadata.sourceMetadata.backendCliVersion, '1.2.3');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testMarkMaterializedUpdatesInventoryAndCanonicalView() {
  const root = await createSession([], metadata([inventoryItem('a', 'pending')]));
  try {
    await mkdir(join(root, 'markdown'), { recursive: true });
    await mkdir(join(root, 'sanitized/items'), { recursive: true });
    await writeFile(join(root, 'markdown/a.md'), '# A');
    await writeFile(join(root, 'sanitized/items/a.md'), '# A');
    const itemFile = await writeRun(root, 'materialized.json', {
      schemaVersion: '1.0',
      itemId: 'a',
      markdownPath: 'markdown/a.md',
      sanitizedPath: 'sanitized/items/a.md',
      canonicalItem: canonicalItem('a'),
    });
    const result = await runCli(['mark-materialized', '--session-dir', root, '--item-json-file', itemFile]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const persistedMetadata = await readJson(join(root, 'sanitized/metadata.json'));
    const collection = await readJson(join(root, 'collection-result.json'));
    assert.equal(persistedMetadata.collection.items[0].materialization.status, 'materialized');
    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].fileName, 'sanitized/items/a.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRecordRunAndInspectResumeScope() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'run.json', runRecord('run-1', [['a', 'success'], ['b', 'failed']]));
    const recorded = await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
    assert.equal(recorded.code, 0, recorded.stderr || recorded.stdout);
    const matching = await runCli(['inspect', '--session-dir', root, '--operation', 'ingest', '--target-json', JSON.stringify({ kind: 'knowledge-base', id: 'kb-1', path: '/imports' })]);
    assert.equal(matching.code, 0, matching.stderr || matching.stdout);
    assert.equal(matching.json.requiresResumeChoice, true);
    assert.deepEqual(matching.json.resumeChoices, ['all', 'failed-only']);
    assert.deepEqual(matching.json.failedItemIds, ['b']);
    const different = await runCli(['inspect', '--session-dir', root, '--operation', 'ingest', '--target-json', JSON.stringify({ kind: 'knowledge-base', id: 'kb-2', path: '/imports' })]);
    assert.equal(different.json.requiresResumeChoice, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSubsetSuccessRequiresResumeChoiceForUnselectedInventory() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'subset-success.json', runRecord('subset-success', [['a', 'success']], {
      selection: { mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'success',
      sessionStatus: 'partial',
    }));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile])).code, 0);
    const result = await runCli([
      'inspect', '--session-dir', root, '--operation', 'ingest',
      '--target-json', JSON.stringify({ kind: 'knowledge-base', id: 'kb-1', path: '/imports' }),
    ]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.requiresResumeChoice, true);
    assert.deepEqual(result.json.failedItemIds, ['b']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testDuplicateArticleIdentityIsRejected() {
  const value = metadata([inventoryItem('a'), inventoryItem('b')]);
  value.collection.items[1].sourceUrl = value.collection.items[0].sourceUrl;
  const root = await createSession(['a', 'b'], value);
  try {
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 1, result.stdout);
    assert.match(String(result.json?.error || ''), /sourceSkill.*sourceUrl.*重复/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCrossSourceHttpContentIsGroupedWithoutDroppingProvenance() {
  const value = metadata([inventoryItem('a'), inventoryItem('b')]);
  value.collection.items[0].sourceUrl = 'https://example.com/docs/index.html?b=2&a=1#top';
  value.collection.items[1].sourceUrl = 'https://example.com/docs/?a=1&b=2';
  value.collection.items[1].sourceSkill = 'feishu';
  value.collection.items[1].backend = 'feishu';
  const root = await createSession(['a', 'b'], value);
  try {
    const collection = await readJson(join(root, 'collection-result.json'));
    collection.items[0].url = value.collection.items[0].sourceUrl;
    collection.items[1].url = value.collection.items[1].sourceUrl;
    await writeFile(join(root, 'collection-result.json'), JSON.stringify(collection));

    const result = await runUnifiedCli(['export-views', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.metadata.collection.items.length, 2);
    assert.equal(result.json.collectionResult.items.length, 1);
    const [first, second] = result.json.metadata.collection.items;
    assert.equal(first.duplicateGroupKey, second.duplicateGroupKey);
    assert.equal(second.duplicateOf, first.itemId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNonHttpEnterpriseUrisAreNotMerged() {
  const value = metadata([inventoryItem('a'), inventoryItem('b')]);
  value.collection.items[0].sourceUrl = 'wecom-message:123';
  value.collection.items[1].sourceUrl = 'wecom-message:456';
  value.collection.items[1].sourceSkill = 'wecom-cli';
  value.collection.items[1].backend = 'wecom-cli';
  const root = await createSession(['a', 'b'], value);
  try {
    const collection = await readJson(join(root, 'collection-result.json'));
    collection.items[0].url = value.collection.items[0].sourceUrl;
    collection.items[1].url = value.collection.items[1].sourceUrl;
    await writeFile(join(root, 'collection-result.json'), JSON.stringify(collection));

    const result = await runUnifiedCli(['export-views', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.collectionResult.items.length, 2);
    const [first, second] = result.json.metadata.collection.items;
    assert.notEqual(first.duplicateGroupKey, second.duplicateGroupKey);
    assert.equal(first.duplicateOf, null);
    assert.equal(second.duplicateOf, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRecordRunRequiresExactSelectionSnapshot() {
  const cases = [
    {
      name: 'result outside selection',
      run: runRecord('run-extra', [['a', 'success'], ['b', 'success']], {
        selection: {
          mode: 'items',
          itemIds: ['a'],
          discardUnselected: false,
          discardUnselectedConfirmed: false,
        },
      }),
      pattern: /一一对应/,
    },
    {
      name: 'duplicate selection',
      run: runRecord('run-duplicate', [['a', 'success']], {
        selection: {
          mode: 'items',
          itemIds: ['a', 'a'],
          discardUnselected: false,
          discardUnselectedConfirmed: false,
        },
      }),
      pattern: /重复/,
    },
    {
      name: 'missing result',
      run: runRecord('run-missing', [['a', 'success']], {
        selection: {
          mode: 'items',
          itemIds: ['a', 'b'],
          discardUnselected: false,
          discardUnselectedConfirmed: false,
        },
      }),
      pattern: /一一对应/,
    },
  ];
  for (const fixture of cases) {
    const root = await createSession();
    try {
      const runFile = await writeRun(root, `${fixture.name}.json`, fixture.run);
      const result = await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
      assert.equal(result.code, 1, `${fixture.name}: ${result.stdout}`);
      assert.match(String(result.json?.error || ''), fixture.pattern);
      const persisted = await readJson(join(root, 'sanitized/metadata.json'));
      assert.deepEqual(persisted.postProcessing.runs, []);
      assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
      assert.equal(existsSync(join(root, 'sanitized/items/b.md')), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testRecordRunRequiresPendingEntryForEverySelectedItem() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'pending-snapshot.json', runRecord('run-pending', [
      ['a', 'success'],
      ['b', 'pending'],
    ]));
    const result = await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.postProcessing.runs[0].items.length, 2);
    assert.equal(persisted.postProcessing.runs[0].items[1].status, 'pending');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRecordRunValidatesDiscardConfirmationAndDerivedStatus() {
  const cases = [
    {
      name: 'discard without confirmation',
      run: runRecord('run-discard', [['a', 'success']], {
        selection: {
          mode: 'items',
          itemIds: ['a'],
          discardUnselected: true,
          discardUnselectedConfirmed: false,
        },
      }),
      pattern: /明确确认/,
    },
    {
      name: 'success with failed item',
      run: runRecord('run-bad-status', [['a', 'success'], ['b', 'failed']], { status: 'success' }),
      pattern: /run status.*不一致/,
    },
    {
      name: 'success with failed global stage',
      run: organizeRun('run-bad-global', [['a', 'success'], ['b', 'success']], {
        status: 'success',
        globalStage: { name: 'build', required: true, status: 'failed', reason: 'fixture failure' },
      }),
      pattern: /run status.*不一致/,
    },
  ];
  for (const fixture of cases) {
    const root = await createSession();
    try {
      const runFile = await writeRun(root, `${fixture.name}.json`, fixture.run);
      const result = await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
      assert.equal(result.code, 1, `${fixture.name}: ${result.stdout}`);
      assert.match(String(result.json?.error || ''), fixture.pattern);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testRecordRunValidatesSelectionSessionAndFieldTypes() {
  const invalidFixtures = [
    {
      name: 'invalid selection mode',
      run: runRecord('invalid-mode', [['a', 'success']], {
        selection: {
          mode: 'failed-only', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false,
        },
      }),
      ids: ['a'],
      pattern: /selection\.mode/,
    },
    {
      name: 'all mode omits inventory item',
      run: runRecord('incomplete-all', [['a', 'success']]),
      ids: ['a', 'b'],
      pattern: /完整 inventory/,
    },
    {
      name: 'missing discard booleans',
      run: runRecord('missing-discards', [['a', 'success']], {
        selection: { mode: 'items', itemIds: ['a'] },
        sessionStatus: 'partial',
      }),
      ids: ['a', 'b'],
      pattern: /discardUnselected.*布尔值/,
    },
    {
      name: 'session status mismatch',
      run: runRecord('bad-session-status', [['a', 'success']], {
        selection: {
          mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false,
        },
        sessionStatus: 'success',
      }),
      ids: ['a', 'b'],
      pattern: /sessionStatus.*partial/,
    },
    {
      name: 'item reason type',
      run: {
        ...runRecord('bad-item-reason', [['a', 'success']]),
        items: [{
          itemId: 'a', status: 'success', stage: 'build-submitted', reason: 42,
          downstreamRef: '/imports/a.md', cleanupStatus: 'not-started',
        }],
      },
      ids: ['a'],
      pattern: /reason.*字符串或 null/,
    },
    {
      name: 'global reason type',
      run: runRecord('bad-global-reason', [['a', 'success']], {
        globalStage: { name: null, required: false, status: 'not-required', reason: 42 },
      }),
      ids: ['a'],
      pattern: /globalStage\.reason/,
    },
  ];

  for (const fixture of invalidFixtures) {
    const root = await createSession(fixture.ids);
    try {
      const runFile = await writeRun(root, `${fixture.name}.json`, fixture.run);
      const result = await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
      assert.equal(result.code, 1, `${fixture.name}: ${result.stdout}`);
      assert.match(String(result.json?.error || ''), fixture.pattern, fixture.name);
      assert.equal(existsSync(runFile), true, fixture.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const discardRoot = await createSession(['a', 'b']);
  try {
    const runFile = await writeRun(discardRoot, 'confirmed-discard.json', runRecord('confirmed-discard', [
      ['a', 'success'],
    ], {
      selection: {
        mode: 'items', itemIds: ['a'], discardUnselected: true, discardUnselectedConfirmed: true,
      },
      sessionStatus: 'success',
    }));
    const result = await runCli(['record-run', '--session-dir', discardRoot, '--run-json-file', runFile]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
  } finally {
    await rm(discardRoot, { recursive: true, force: true });
  }
}

function organizeRun(runId, itemStatuses, overrides = {}) {
  const run = runRecord(runId, itemStatuses, {
    operation: 'organize',
    target: { kind: 'knowledge-organization', id: 'organizer-fixture' },
    globalStage: { name: 'build', required: true, status: 'success', reason: null },
    ...overrides,
  });
  run.items = run.items.map((item) => ({
    ...item,
    stage: item.status === 'success' ? 'ads-organized' : item.stage,
  }));
  return run;
}

async function testOperationSpecificContractsProtectBaseFlows() {
  const invalidFixtures = [
    {
      name: 'ingest target',
      run: runRecord('bad-ingest-target', [['a', 'success']], {
        target: { kind: 'external', id: 'not-a-kb' },
      }),
      pattern: /knowledge-base/,
    },
    {
      name: 'ingest success stage',
      run: runRecord('bad-ingest-stage', [['a', 'success']], {
        items: [{
          itemId: 'a', status: 'success', stage: 'upload', reason: null,
          downstreamRef: '/imports/a.md', cleanupStatus: 'not-started',
        }],
      }),
      pattern: /build-submitted/,
    },
    {
      name: 'organize success stage',
      run: {
        ...organizeRun('bad-organize-stage', [['a', 'success']]),
        items: [{
          itemId: 'a', status: 'success', stage: 'ods-ingested', reason: null,
          downstreamRef: 'ods-a', cleanupStatus: 'not-started',
        }],
      },
      pattern: /ads-organized/,
    },
    {
      name: 'skip is not a downstream run',
      run: { ...runRecord('skip-run', [['a', 'success']]), operation: 'skip' },
      pattern: /operation 无效/,
    },
  ];
  for (const fixture of invalidFixtures) {
    const root = await createSession(['a']);
    try {
      const runFile = await writeRun(root, `${fixture.name}.json`, fixture.run);
      const result = await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
      assert.equal(result.code, 1, `${fixture.name}: ${result.stdout}`);
      assert.match(String(result.json?.error || ''), fixture.pattern);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const organizeRoot = await createSession();
  try {
    const runFile = await writeRun(organizeRoot, 'organize-partial.json', organizeRun('organize-partial', [
      ['a', 'success'],
      ['b', 'failed'],
    ]));
    const recorded = await runCli(['record-run', '--session-dir', organizeRoot, '--run-json-file', runFile]);
    assert.equal(recorded.code, 0, recorded.stderr || recorded.stdout);
    const cleanupResult = await runCli(['cleanup', '--session-dir', organizeRoot, '--run-id', 'organize-partial']);
    assert.equal(cleanupResult.code, 0, cleanupResult.stderr || cleanupResult.stdout);
    assert.equal(existsSync(join(organizeRoot, 'sanitized/items/a.md')), false);
    assert.equal(existsSync(join(organizeRoot, 'sanitized/items/b.md')), true);
  } finally {
    await rm(organizeRoot, { recursive: true, force: true });
  }
}

async function testInspectExposesRequiredGlobalStageRetry() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'organize-global-failed.json', organizeRun('organize-global-failed', [
      ['a', 'success'],
      ['b', 'success'],
    ], {
      status: 'failed',
      sessionStatus: 'failed',
      globalStage: { name: 'build', required: true, status: 'failed', reason: 'build rejected' },
    }));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile])).code, 0);
    const result = await runCli([
      'inspect', '--session-dir', root,
      '--operation', 'organize',
      '--target-json', JSON.stringify({ kind: 'knowledge-organization', id: 'organizer-fixture' }),
    ]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.requiresResumeChoice, true);
    assert.deepEqual(result.json.failedItemIds, []);
    assert.equal(result.json.requiresGlobalStageRetry, true);
    assert.deepEqual(result.json.resumeChoices, ['all', 'failed-only']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testExistingRunCannotChangeItsOperationTargetOrSelection() {
  const root = await createSession();
  try {
    const original = await writeRun(root, 'immutable-original.json', runRecord('immutable-run', [['a', 'success']], {
      selection: { mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'success',
      sessionStatus: 'partial',
    }));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', original])).code, 0);
    const changed = await writeRun(root, 'immutable-changed.json', runRecord('immutable-run', [['b', 'success']], {
      target: { kind: 'knowledge-base', id: 'kb-2', path: '/other' },
      selection: { mode: 'items', itemIds: ['b'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'success',
      sessionStatus: 'partial',
    }));
    const result = await runCli(['record-run', '--session-dir', root, '--run-json-file', changed]);
    assert.equal(result.code, 1, result.stdout);
    assert.match(String(result.json?.error || ''), /已有 run.*不可改变/);
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.deepEqual(persisted.postProcessing.runs[0].selection.itemIds, ['a']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPartialCleanupDeletesOnlySuccessfulWorkingCopies() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'run.json', runRecord('run-1', [['a', 'success'], ['b', 'failed']]));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile])).code, 0);
    const result = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, 'markdown/a.md')), false);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), false);
    assert.equal(existsSync(join(root, 'markdown/b.md')), true);
    assert.equal(existsSync(join(root, 'raw/a.json')), true);
    const persistedMetadata = await readJson(join(root, 'sanitized/metadata.json'));
    const collection = await readJson(join(root, 'collection-result.json'));
    const itemA = persistedMetadata.collection.items.find((item) => item.itemId === 'a');
    const runA = persistedMetadata.postProcessing.runs[0].items.find((item) => item.itemId === 'a');
    assert.equal(itemA.materialization.status, 'pending');
    assert.equal(itemA.materialization.markdownPath, null);
    assert.equal(runA.cleanupStatus, 'completed');
    assert.deepEqual(collection.items.map((item) => item.title), ['Article b']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNewRunSupersedesOlderCleanupOwnership() {
  const root = await createSession();
  try {
    const firstFile = await writeRun(root, 'run-first.json', runRecord('run-1', [['a', 'success']], {
      selection: { mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'success',
      sessionStatus: 'partial',
    }));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', firstFile])).code, 0);
    const secondFile = await writeRun(root, 'run-second.json', runRecord('run-2', [['a', 'pending']], {
      selection: { mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'partial',
      sessionStatus: 'partial',
    }));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', secondFile])).code, 0);

    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.postProcessing.runs[0].items[0].cleanupStatus, 'superseded');
    const cleanup = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    assert.equal(cleanup.code, 0, cleanup.stderr || cleanup.stdout);
    assert.equal(existsSync(join(root, 'markdown/a.md')), true);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRecordRunPreservesExistingCompletedCleanupStatusForSameRunId() {
  const root = await createSession(['a', 'b']);
  try {
    const firstRunFile = await writeRun(root, 'run-first.json', runRecord('run-1', [['a', 'success']], {
      selection: { mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'success',
      sessionStatus: 'partial',
    }));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', firstRunFile])).code, 0);
    const firstCleanup = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    assert.equal(firstCleanup.code, 0, firstCleanup.stderr || firstCleanup.stdout);

    let persisted = await readJson(join(root, 'sanitized/metadata.json'));
    const persistedRunItemA = persisted.postProcessing.runs[0].items.find((item) => item.itemId === 'a');
    assert.equal(persistedRunItemA.cleanupStatus, 'completed');

    const secondRunFile = await writeRun(root, 'run-second.json', runRecord('run-1', [['a', 'success']], {
      selection: { mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'success',
      sessionStatus: 'partial',
    }));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', secondRunFile])).code, 0);

    persisted = await readJson(join(root, 'sanitized/metadata.json'));
    const updatedRunItemA = persisted.postProcessing.runs[0].items.find((item) => item.itemId === 'a');
    assert.equal(updatedRunItemA.cleanupStatus, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCompletedCleanupDoesNotDeleteRematerializedCurrentFile() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'run-completed.json', runRecord('run-1', [['a', 'success']], {
      selection: { mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
      status: 'success',
      sessionStatus: 'partial',
    }));
    await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
    await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    await writeFile(join(root, 'markdown/a.md'), '# A refreshed');
    await writeFile(join(root, 'sanitized/items/a.md'), '# A refreshed');
    const itemFile = await writeRun(root, 'rematerialized.json', {
      schemaVersion: '1.0',
      itemId: 'a',
      markdownPath: 'markdown/a.md',
      sanitizedPath: 'sanitized/items/a.md',
      canonicalItem: canonicalItem('a'),
    });
    assert.equal((await runCli(['mark-materialized', '--session-dir', root, '--item-json-file', itemFile])).code, 0);
    const cleanup = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    assert.equal(cleanup.code, 0, cleanup.stderr || cleanup.stdout);
    assert.equal(existsSync(join(root, 'markdown/a.md')), true);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPartialCleanupJournalsOnlyRemainingArtifacts() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'run.json', runRecord('run-1', [['a', 'success'], ['b', 'failed']]));
    assert.equal((await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile])).code, 0);
    await chmod(join(root, 'sanitized/items'), 0o500);
    const cleanup = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    await chmod(join(root, 'sanitized/items'), 0o700);
    assert.equal(cleanup.code, 0, cleanup.stderr || cleanup.stdout);
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    const materialized = persisted.collection.items.find((item) => item.itemId === 'a').materialization;
    const cleanedItem = persisted.postProcessing.runs[0].items.find((item) => item.itemId === 'a');
    assert.deepEqual(materialized.pendingArtifactCleanup, ['sanitized/items/a.md']);
    assert.deepEqual(cleanedItem.cleanedArtifacts, ['markdown/a.md']);
    assert.equal(existsSync(join(root, 'markdown/a.md')), false);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
  } finally {
    await chmod(join(root, 'sanitized/items'), 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

async function testSameUrlRematerializationReplacesOldWorkingCopies() {
  const root = await createSession(['a']);
  try {
    await writeFile(join(root, 'markdown/a-new.md'), '# A new');
    await writeFile(join(root, 'sanitized/items/a-new.md'), '# A new');
    const nextCanonical = {
      ...canonicalItem('a'),
      markdown: 'sanitized/items/a-new.md',
      fileName: 'sanitized/items/a-new.md',
    };
    const itemFile = await writeRun(root, 'replace-a.json', {
      schemaVersion: '1.0',
      itemId: 'a',
      markdownPath: 'markdown/a-new.md',
      sanitizedPath: 'sanitized/items/a-new.md',
      canonicalItem: nextCanonical,
    });
    const result = await runCli(['mark-materialized', '--session-dir', root, '--item-json-file', itemFile]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, 'markdown/a.md')), false);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), false);
    const collection = await readJson(join(root, 'collection-result.json'));
    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].fileName, 'sanitized/items/a-new.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRematerializationJournalsAndRetriesOldWorkingCopyCleanup() {
  const root = await createSession(['a']);
  const markdownDir = join(root, 'markdown');
  try {
    await writeFile(join(root, 'markdown/a-new.md'), '# A new');
    await writeFile(join(root, 'sanitized/items/a-new.md'), '# A new');
    await chmod(markdownDir, 0o500);
    const itemFile = await writeRun(root, 'replace-with-journal.json', {
      schemaVersion: '1.0',
      itemId: 'a',
      markdownPath: 'markdown/a-new.md',
      sanitizedPath: 'sanitized/items/a-new.md',
      canonicalItem: {
        ...canonicalItem('a'),
        markdown: 'sanitized/items/a-new.md',
        fileName: 'sanitized/items/a-new.md',
      },
    });
    const materialized = await runCli([
      'mark-materialized', '--session-dir', root, '--item-json-file', itemFile,
    ]);
    assert.equal(materialized.code, 0, materialized.stderr || materialized.stdout);
    let persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.collection.items[0].materialization.markdownPath, 'markdown/a-new.md');
    assert.deepEqual(
      persisted.collection.items[0].materialization.pendingArtifactCleanup,
      ['markdown/a.md'],
    );
    assert.equal(existsSync(join(root, 'markdown/a.md')), true);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), false);

    await chmod(markdownDir, 0o700);
    const inspected = await runCli(['inspect', '--session-dir', root]);
    assert.equal(inspected.code, 0, inspected.stderr || inspected.stdout);
    persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.deepEqual(persisted.collection.items[0].materialization.pendingArtifactCleanup, []);
    assert.equal(existsSync(join(root, 'markdown/a.md')), false);
    assert.equal(existsSync(join(root, 'markdown/a-new.md')), true);
  } finally {
    await chmod(markdownDir, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

async function testMarkMaterializedEnforcesSchemaDirectoriesAndIdentity() {
  const fixtures = [
    {
      name: 'markdown outside markdown directory',
      prepare: async (root) => writeFile(join(root, 'raw/a.md'), '# Raw A'),
      update: {
        schemaVersion: '1.0',
        itemId: 'a',
        markdownPath: 'raw/a.md',
        sanitizedPath: 'sanitized/items/a.md',
        canonicalItem: canonicalItem('a'),
      },
      pattern: /markdown\//,
    },
    {
      name: 'sanitized outside items directory',
      prepare: async (root) => {
        await mkdir(join(root, 'temporary'), { recursive: true });
        await writeFile(join(root, 'temporary/a.md'), '# Temporary A');
      },
      update: {
        schemaVersion: '1.0',
        itemId: 'a',
        markdownPath: 'markdown/a.md',
        sanitizedPath: 'temporary/a.md',
        canonicalItem: { ...canonicalItem('a'), markdown: 'temporary/a.md', fileName: 'temporary/a.md' },
      },
      pattern: /sanitized\/items\//,
    },
    {
      name: 'canonical url mismatch',
      prepare: async () => {},
      update: {
        schemaVersion: '1.0',
        itemId: 'a',
        markdownPath: 'markdown/a.md',
        sanitizedPath: 'sanitized/items/a.md',
        canonicalItem: { ...canonicalItem('a'), url: 'https://example.com/not-a' },
      },
      pattern: /sourceUrl/,
    },
    {
      name: 'missing schema version',
      prepare: async () => {},
      update: {
        itemId: 'a',
        markdownPath: 'markdown/a.md',
        sanitizedPath: 'sanitized/items/a.md',
        canonicalItem: canonicalItem('a'),
      },
      pattern: /schemaVersion/,
    },
  ];
  for (const fixture of fixtures) {
    const root = await createSession(['a']);
    try {
      await fixture.prepare(root);
      const itemFile = await writeRun(root, `${fixture.name}.json`, fixture.update);
      const result = await runCli(['mark-materialized', '--session-dir', root, '--item-json-file', itemFile]);
      assert.equal(result.code, 1, `${fixture.name}: ${result.stdout}`);
      assert.match(String(result.json?.error || ''), fixture.pattern);
      assert.equal(result.json?.inputFile, itemFile);
      assert.equal(existsSync(itemFile), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testPayloadFilesMustBePrivateSessionInputs() {
  const root = await createSession(['a']);
  try {
    const outsideInput = join(root, 'outside-run.json');
    await writeFile(outsideInput, JSON.stringify(runRecord('outside', [['a', 'success']])));
    const outside = await runCli(['record-run', '--session-dir', root, '--run-json-file', outsideInput]);
    assert.equal(outside.code, 1, outside.stdout);
    assert.match(String(outside.json?.error || ''), /.post-processing-inputs/);
    assert.equal(existsSync(outsideInput), true);

    const target = join(root, 'symlink-target.json');
    const link = join(root, '.post-processing-inputs', 'linked.json');
    await writeFile(target, JSON.stringify(runRecord('linked', [['a', 'success']])));
    await symlink(target, link);
    const linked = await runCli(['record-run', '--session-dir', root, '--run-json-file', link]);
    assert.equal(linked.code, 1, linked.stdout);
    assert.match(String(linked.json?.error || ''), /符号链接/);
    assert.equal(existsSync(link), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSuccessfulPayloadIsDeletedAndHelpPublishesSchema() {
  const root = await createSession(['a']);
  try {
    const runFile = await writeRun(root, 'consumed-run.json', runRecord('consumed', [['a', 'success']]));
    const recorded = await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
    assert.equal(recorded.code, 0, recorded.stderr || recorded.stdout);
    assert.equal(existsSync(runFile), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const helpResult = await runCli(['help']);
  assert.equal(helpResult.code, 0, helpResult.stderr || helpResult.stdout);
  const rendered = JSON.stringify(helpResult.json);
  for (const phrase of ['schemaVersion', 'discardUnselectedConfirmed', 'superseded', '.post-processing-inputs', 'knowledge-base', 'knowledge-organization', 'external', 'set-retention']) {
    assert.match(rendered, new RegExp(phrase.replaceAll('.', '\\.')));
  }
}

async function testSubsetSuccessKeepsSessionAndUnselectedItem() {
  const root = await createSession();
  try {
    const runFile = await writeRun(root, 'run.json', runRecord('run-1', [['a', 'success']], {
      selection: {
        mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false,
      },
      status: 'success',
      sessionStatus: 'partial',
    }));
    await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
    const result = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(existsSync(root), true);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), false);
    assert.equal(existsSync(join(root, 'sanitized/items/b.md')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRetentionPreventsCleanup() {
  const root = await createSession(['a'], metadata([inventoryItem('a')], { retention: { auditRequired: false, userRequested: true } }));
  try {
    const runFile = await writeRun(root, 'run.json', runRecord('run-1', [['a', 'success']]));
    await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
    const result = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.postProcessing.runs[0].items[0].cleanupStatus, 'skipped-retention');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRetentionCanBeUpdatedThroughStateCommand() {
  const root = await createSession(['a']);
  try {
    let result = await runCli(['set-retention', '--session-dir', root, '--keep', 'true']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    let persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.retention.userRequested, true);
    result = await runCli(['set-retention', '--session-dir', root, '--keep', 'false']);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.retention.userRequested, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testNewRunSupersedesSkippedRetentionCleanupOwnership() {
  const root = await createSession(['a'], metadata([inventoryItem('a')], {
    retention: { auditRequired: false, userRequested: true },
  }));
  try {
    const firstFile = await writeRun(root, 'retained-run.json', runRecord('retained-run', [['a', 'success']]));
    assert.equal((await runCli([
      'record-run', '--session-dir', root, '--run-json-file', firstFile,
    ])).code, 0);
    assert.equal((await runCli([
      'cleanup', '--session-dir', root, '--run-id', 'retained-run',
    ])).code, 0);
    let persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.postProcessing.runs[0].items[0].cleanupStatus, 'skipped-retention');

    persisted.retention.userRequested = false;
    await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify(persisted));
    const nextFile = await writeRun(root, 'latest-run.json', runRecord('latest-run', [['a', 'pending']]));
    const recorded = await runCli([
      'record-run', '--session-dir', root, '--run-json-file', nextFile,
    ]);
    assert.equal(recorded.code, 0, recorded.stderr || recorded.stdout);
    persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(persisted.postProcessing.runs[0].items[0].cleanupStatus, 'superseded');

    const oldCleanup = await runCli([
      'cleanup', '--session-dir', root, '--run-id', 'retained-run',
    ]);
    assert.equal(oldCleanup.code, 0, oldCleanup.stderr || oldCleanup.stdout);
    assert.equal(existsSync(root), true);
    assert.equal(existsSync(join(root, 'markdown/a.md')), true);
    assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testMalformedMetadataFailsClosedBeforeCleanup() {
  const fixtures = [
    {
      name: 'retention object',
      mutate: (value) => { value.retention = 'keep'; },
      pattern: /retention.*对象/,
    },
    {
      name: 'retention boolean',
      mutate: (value) => { value.retention.auditRequired = 'yes'; },
      pattern: /retention\.auditRequired.*布尔值/,
    },
    {
      name: 'storage fallback',
      mutate: (value) => { value.storage.fallback = 'false'; },
      pattern: /storage\.fallback.*布尔值/,
    },
    {
      name: 'collection status',
      mutate: (value) => { value.collection.status = 'done'; },
      pattern: /collection\.status/,
    },
  ];
  for (const fixture of fixtures) {
    const value = metadata([inventoryItem('a')]);
    value.postProcessing.runs.push(runRecord('run-invalid-metadata', [['a', 'success']]));
    fixture.mutate(value);
    const root = await createSession(['a'], value);
    try {
      const inspectResult = await runCli(['inspect', '--session-dir', root]);
      assert.equal(inspectResult.code, 1, `${fixture.name}: ${inspectResult.stdout}`);
      assert.match(String(inspectResult.json?.error || ''), fixture.pattern);
      const cleanupResult = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-invalid-metadata']);
      assert.equal(cleanupResult.code, 1, `${fixture.name}: ${cleanupResult.stdout}`);
      assert.equal(existsSync(join(root, 'markdown/a.md')), true);
      assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testInvalidMaterializationDowngradesWithoutDeletingFiles() {
  const value = metadata([inventoryItem('a')]);
  value.collection.items[0].materialization = {
    status: 'materialized',
    markdownPath: 'raw/shared.md',
    sanitizedPath: null,
    pendingArtifactCleanup: ['raw/shared.md'],
    reason: null,
  };
  const root = await createSession(['a'], value);
  try {
    await writeFile(join(root, 'raw/shared.md'), '# Shared raw');
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.json.warnings.join('\n'), /materialization.*pending/);
    assert.match(result.json.warnings.join('\n'), /pendingArtifactCleanup/);
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.deepEqual(persisted.collection.items[0].materialization, {
      status: 'pending',
      markdownPath: null,
      sanitizedPath: null,
      pendingArtifactCleanup: [],
      reason: 'materialization-invalid',
    });
    assert.equal(existsSync(join(root, 'raw/shared.md')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const cleanupValue = metadata([inventoryItem('a')]);
  cleanupValue.collection.items[0].materialization.sanitizedPath = 'sanitized/items/missing.md';
  cleanupValue.postProcessing.runs.push(runRecord('invalid-materialization-cleanup', [['a', 'success']]));
  const cleanupRoot = await createSession(['a'], cleanupValue);
  try {
    const result = await runCli([
      'cleanup', '--session-dir', cleanupRoot, '--run-id', 'invalid-materialization-cleanup',
    ]);
    assert.equal(result.code, 1, result.stdout);
    assert.match(String(result.json?.error || ''), /重新物化/);
    assert.equal(existsSync(join(cleanupRoot, 'markdown/a.md')), true);
    assert.equal(existsSync(join(cleanupRoot, 'sanitized/items/a.md')), true);
    const persisted = await readJson(join(cleanupRoot, 'sanitized/metadata.json'));
    assert.equal(persisted.collection.items[0].materialization.status, 'pending');
    assert.equal(persisted.collection.items[0].materialization.markdownPath, null);
    assert.equal(persisted.collection.items[0].materialization.sanitizedPath, null);
  } finally {
    await rm(cleanupRoot, { recursive: true, force: true });
  }
}

async function testInvalidMaterializationKeepsCurrentPathFromPendingCleanup() {
  const root = await createSession(['a']);
  const value = metadata([inventoryItem('a')]);
  value.collection.items[0].sourceSkill = 'bycli';
  value.collection.items[0].materialization = {
    status: 'materialized',
    markdownPath: 'markdown/a.md',
    sanitizedPath: 'raw/shared.md',
    pendingArtifactCleanup: ['markdown/legacy.md'],
    reason: null,
  };
  await writeFile(join(root, 'raw/shared.md'), '# Shared raw');
  await writeFile(join(root, 'markdown/legacy.md'), '# Legacy markdown');
  await writeFile(join(root, 'markdown/a.md'), '# A refreshed');
  await writeFile(join(root, 'sanitized/items/a.md'), '# A sanitized');
  await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify(value));
  const result = await runCli(['inspect', '--session-dir', root]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const persisted = await readJson(join(root, 'sanitized/metadata.json'));
  assert.deepEqual(
    persisted.collection.items[0].materialization.pendingArtifactCleanup.sort(),
    ['markdown/legacy.md'],
  );
  assert.equal(existsSync(join(root, 'markdown/a.md')), true);
  assert.equal(existsSync(join(root, 'sanitized/items/a.md')), true);
}

async function testMarkMaterializedUsesSourceSkillIdentityWhenReplacingCanonical() {
  const sharedUrl = 'https://example.com/shared';
  const itemA = inventoryItem('a');
  itemA.sourceSkill = 'bycli';
  itemA.sourceUrl = sharedUrl;
  const itemB = inventoryItem('b');
  itemB.sourceSkill = 'dws';
  itemB.sourceUrl = sharedUrl;
  const root = await createSession(['a', 'b'], metadata([itemA, itemB]));
  try {
    await writeFile(join(root, 'collection-result.json'), JSON.stringify({
      schemaVersion: '1.0',
      title: 'Collection',
      source: 'public-internet',
      backend: 'bycli',
      url: 'https://example.com',
      filters: {},
      items: [
        {
          ...canonicalItem('a'),
          url: sharedUrl,
          markdown: 'sanitized/items/a.md',
          fileName: 'sanitized/items/a.md',
          sourceSkill: 'bycli',
        },
        {
          ...canonicalItem('b'),
          url: sharedUrl,
          markdown: 'sanitized/items/b.md',
          fileName: 'sanitized/items/b.md',
          sourceSkill: 'dws',
        },
      ],
    }));
    await writeFile(join(root, 'markdown/b-new.md'), '# B refreshed');
    await writeFile(join(root, 'sanitized/items/b-new.md'), '# B refreshed');
    const runFile = await writeRun(root, 'replace-b.json', {
      schemaVersion: '1.0',
      itemId: 'b',
      markdownPath: 'markdown/b-new.md',
      sanitizedPath: 'sanitized/items/b-new.md',
      canonicalItem: {
        ...canonicalItem('b'),
        url: sharedUrl,
        markdown: 'sanitized/items/b-new.md',
        fileName: 'sanitized/items/b-new.md',
      },
    });
    const recorded = await runCli(['mark-materialized', '--session-dir', root, '--item-json-file', runFile]);
    assert.equal(recorded.code, 0, recorded.stderr || recorded.stdout);
    const persisted = await readJson(join(root, 'collection-result.json'));
    assert.equal(persisted.items.length, 2);
    assert.equal(persisted.items.some((item) => item.fileName === 'sanitized/items/a.md'), true);
    assert.equal(persisted.items.some((item) => item.fileName === 'sanitized/items/b.md'), false);
    assert.equal(persisted.items.some((item) => item.fileName === 'sanitized/items/b-new.md'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testMixedLegacyPartialUsesNestedStatusAndNormalizesOnWrite() {
  const value = metadata([inventoryItem('a')]);
  value.partial = true;
  value.storageFallback = true;
  value.collection.status = 'complete';
  const root = await createSession(['a'], value);
  try {
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.metadata.collection.status, 'complete');
    assert.match(result.json.warnings.join('\n'), /旧扁平字段/);
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    assert.equal(Object.hasOwn(persisted, 'partial'), false);
    assert.equal(Object.hasOwn(persisted, 'storageFallback'), false);
    assert.equal(persisted.collection.status, 'complete');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testLegacyGlobalStageMigrationIsConservative() {
  const fixtures = [
    ['success', 'success', 'success'],
    ['build-success', 'success', 'success'],
    ['failed', 'failed', 'failed'],
    ['build-failed', 'failed', 'failed'],
    ['pending', 'pending', 'partial'],
    ['unknown', 'unknown', 'unknown'],
    ['build', 'unknown', 'unknown'],
    ['unexpected-stage', 'unknown', 'unknown'],
    [undefined, 'unknown', 'unknown'],
  ];
  for (const [legacyStage, expectedStage, expectedRunStatus] of fixtures) {
    const run = organizeRun(`legacy-${legacyStage ?? 'missing'}`, [['a', 'success']], {
      status: expectedRunStatus,
      sessionStatus: expectedRunStatus,
    });
    run.schemaVersion = '0.9';
    if (legacyStage === undefined) {
      delete run.globalStage;
    } else {
      run.globalStage = legacyStage;
    }
    const value = metadata([inventoryItem('a')]);
    value.postProcessing.runs.push(run);
    const root = await createSession(['a'], value);
    try {
      const result = await runCli([
        'inspect', '--session-dir', root,
        '--operation', 'organize',
        '--target-json', JSON.stringify({ kind: 'knowledge-organization', id: 'organizer-fixture' }),
      ]);
      assert.equal(result.code, 0, `${legacyStage}: ${result.stdout}`);
      const migrated = result.json.metadata.postProcessing.runs[0];
      assert.equal(migrated.globalStage.status, expectedStage, String(legacyStage));
      assert.equal(migrated.status, expectedRunStatus, String(legacyStage));
      assert.equal(
        result.json.requiresGlobalStageRetry,
        ['failed', 'pending', 'unknown'].includes(expectedStage),
        String(legacyStage),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  for (const operation of ['ingest', 'external']) {
    const run = runRecord(`legacy-${operation}`, [['a', 'success']], {
      operation,
      target: operation === 'ingest'
        ? { kind: 'knowledge-base', id: 'kb-1', path: '/imports' }
        : { kind: 'external', id: 'external-fixture' },
    });
    if (operation === 'external') {
      run.items[0].stage = 'completed';
    }
    run.schemaVersion = '0.9';
    run.globalStage = 'build';
    const value = metadata([inventoryItem('a')]);
    value.postProcessing.runs.push(run);
    const root = await createSession(['a'], value);
    try {
      const result = await runCli(['inspect', '--session-dir', root]);
      assert.equal(result.code, 0, `${operation}: ${result.stdout}`);
      assert.deepEqual(result.json.metadata.postProcessing.runs[0].globalStage, {
        name: null, required: false, status: 'not-required', reason: null,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testLegacyRunSelectionAndItemsFieldsAutoMigrateOnInspect() {
  const value = metadata([inventoryItem('a'), inventoryItem('b')]);
  value.postProcessing.runs.push({
    schemaVersion: '0.9',
    runId: 'legacy-run-migration',
    operation: 'ingest',
    target: { kind: 'knowledge-base', id: 'kb-legacy', path: '/legacy' },
    status: 'success',
    sessionStatus: 'success',
    // selection.mode、selection.discardUnselected、selection.discardUnselectedConfirmed 缺失
    selection: {
      itemIds: ['a', 'b'],
    },
    globalStage: 'build-success',
    items: [
      { itemId: 'a', status: 'success' },
      { itemId: 'b', status: 'failed', reason: 'bad payload' },
    ],
  });
  const root = await createSession(['a', 'b'], value);
  try {
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    const migrated = persisted.postProcessing.runs[0];
    assert.equal(migrated.schemaVersion, '1.0');
    assert.equal(migrated.selection.mode, 'all');
    assert.deepEqual(migrated.selection.itemIds, ['a', 'b']);
    assert.equal(migrated.selection.discardUnselected, false);
    assert.equal(migrated.selection.discardUnselectedConfirmed, false);
    const itemAMigration = migrated.items.find((item) => item.itemId === 'a');
    const itemBMigration = migrated.items.find((item) => item.itemId === 'b');
    assert.equal(itemAMigration.reason, null);
    assert.equal(itemAMigration.downstreamRef, null);
    assert.equal(itemAMigration.stage, 'build-submitted');
    assert.equal(itemBMigration.stage, 'upload');
    assert.equal(itemBMigration.downstreamRef, null);
    assert.deepEqual(itemBMigration.cleanedArtifacts, []);
    assert.equal(migrated.globalStage.status, 'not-required');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCurrentEnvelopeWithLegacyItemFieldsAutoMigratesOnInspect() {
  const value = metadata([inventoryItem('a')]);
  value.postProcessing.runs.push({
    schemaVersion: '1.0',
    runId: 'legacy-item-fields',
    operation: 'ingest',
    target: { kind: 'knowledge-base', id: 'kb-legacy', path: '/legacy' },
    status: 'success',
    sessionStatus: 'success',
    selection: { mode: 'all', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false },
    globalStage: { name: null, required: false, status: 'not-required', reason: null },
    items: [{ itemId: 'a', status: 'success' }],
  });
  const root = await createSession(['a'], value);
  try {
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const migrated = (await readJson(join(root, 'sanitized/metadata.json'))).postProcessing.runs[0].items[0];
    assert.equal(migrated.stage, 'build-submitted');
    assert.equal(migrated.reason, null);
    assert.equal(migrated.downstreamRef, null);
    assert.equal(migrated.cleanupStatus, 'not-started');
    assert.deepEqual(migrated.cleanedArtifacts, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testStaleLockRecoverySkipsIfLockChangedDuringRecovery() {
  const root = await createSession(['a']);
  const lockPath = join(root, '.knowledge-collection-post-processing.lock');
  await writeFile(lockPath, JSON.stringify({
    pid: 99999999,
    createdAt: new Date(0).toISOString(),
    ownerId: 'legacy-dead',
    command: 'cleanup',
  }));
  const preloadPath = join(root, 'replace-lock-between-reads.cjs');
  await writeFile(preloadPath, `
const fs = require('node:fs');
const originalReadFileSync = fs.readFileSync;
const lockPath = ${JSON.stringify(lockPath)};
let reads = 0;
const staleLock = JSON.stringify({
  pid: 99999999,
  createdAt: new Date(0).toISOString(),
  ownerId: 'legacy-dead',
  command: 'cleanup',
});
const liveLock = JSON.stringify({
  pid: process.pid,
  createdAt: new Date(0).toISOString(),
  ownerId: 'current-live',
  command: 'record-run',
});
fs.readFileSync = function readFileSyncPatched(path, ...rest) {
  if (path === lockPath) {
    reads += 1;
    if (reads === 1) {
      return staleLock;
    }
    return liveLock;
  }
    return originalReadFileSync.call(this, path, ...rest);
};
`);
  try {
    const result = await runCliWithPreload(preloadPath, ['inspect', '--session-dir', root]);
    assert.equal(result.code, 1, result.stdout);
    assert.match(String(result.json?.error || ''), /仍存活/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testFullScopeSuccessRemovesSession() {
  const root = await createSession();
  const runFile = await writeRun(root, 'run.json', runRecord('run-1', [['a', 'success'], ['b', 'success']]));
  await runCli(['record-run', '--session-dir', root, '--run-json-file', runFile]);
  const result = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.json.removedSession, true);
  assert.equal(existsSync(root), false);
}

async function testCleanupRejectsTraversalAndSymlinkEscape() {
  const root = await createSession();
  const outside = join(dirname(root), `${root.split('/').at(-1)}-outside.md`);
  try {
    await writeFile(outside, '# Outside');
    await symlink(outside, join(root, 'markdown/escape.md'));
    const persisted = await readJson(join(root, 'sanitized/metadata.json'));
    persisted.collection.items[0].materialization.markdownPath = 'markdown/escape.md';
    persisted.postProcessing.runs.push(runRecord('run-1', [['a', 'success']], {
      selection: {
        mode: 'items', itemIds: ['a'], discardUnselected: false, discardUnselectedConfirmed: false,
      },
      sessionStatus: 'partial',
    }));
    await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify(persisted));
    const result = await runCli(['cleanup', '--session-dir', root, '--run-id', 'run-1']);
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.match(String(result.json?.error || ''), /重新物化/);
    assert.equal(existsSync(outside), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
}

async function testLiveLockCannotBeStolen() {
  const root = await createSession(['a']);
  try {
    const lockPath = join(root, '.knowledge-collection-post-processing.lock');
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
      ownerId: 'live-owner',
      command: 'cleanup',
    }));
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 1, result.stdout);
    assert.match(String(result.json?.error || ''), /仍存活/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testLockWriteFailureRollsBackCreatedLock() {
  const root = await createSession(['a']);
  try {
    const preloadPath = join(root, 'fail-lock-write.cjs');
    await writeFile(preloadPath, `
const fs = require('node:fs');
const original = fs.writeFileSync;
let injected = false;
fs.writeFileSync = function patched(target, ...args) {
  if (!injected && Number.isInteger(target)) {
    injected = true;
    const error = new Error('fixture lock write failure');
    error.code = 'ENOSPC';
    throw error;
  }
  return original.call(this, target, ...args);
};
`);
    const failed = await runCliWithPreload(preloadPath, ['inspect', '--session-dir', root]);
    assert.equal(failed.code, 1, failed.stdout);
    assert.match(String(failed.json?.error || ''), /fixture lock write failure/);
    const lockPath = join(root, '.knowledge-collection-post-processing.lock');
    assert.equal(existsSync(lockPath), false);

    const retried = await runCli(['inspect', '--session-dir', root]);
    assert.equal(retried.code, 0, retried.stderr || retried.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testDeadProcessLockIsRecoveredAutomatically() {
  const root = await createSession(['a']);
  try {
    const lockPath = join(root, '.knowledge-collection-post-processing.lock');
    await writeFile(lockPath, JSON.stringify({
      pid: 99999999,
      createdAt: new Date(0).toISOString(),
      ownerId: 'dead-owner',
      command: 'record-run',
    }));
    const result = await runCli(['inspect', '--session-dir', root]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(existsSync(lockPath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testUnlockStaleRejectsMalformedLockAndRemovesDeadOwner() {
  const malformedRoot = await createSession(['a']);
  try {
    const lockPath = join(malformedRoot, '.knowledge-collection-post-processing.lock');
    await writeFile(lockPath, '{not-json');
    const result = await runCli(['unlock-stale', '--session-dir', malformedRoot]);
    assert.equal(result.code, 1, result.stdout);
    assert.match(String(result.json?.error || ''), /锁文件损坏/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    await rm(malformedRoot, { recursive: true, force: true });
  }

  const staleRoot = await createSession(['a']);
  try {
    const lockPath = join(staleRoot, '.knowledge-collection-post-processing.lock');
    await writeFile(lockPath, JSON.stringify({
      pid: 99999999,
      createdAt: new Date(0).toISOString(),
      ownerId: 'dead-owner',
      command: 'cleanup',
    }));
    const result = await runCli(['unlock-stale', '--session-dir', staleRoot]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.json.previousLock.ownerId, 'dead-owner');
    assert.equal(existsSync(lockPath), false);
  } finally {
    await rm(staleRoot, { recursive: true, force: true });
  }
}

await testInspectMigratesLegacyMetadataAndPreservesSourceFields();
await testMarkMaterializedUpdatesInventoryAndCanonicalView();
await testRecordRunAndInspectResumeScope();
await testSubsetSuccessRequiresResumeChoiceForUnselectedInventory();
await testDuplicateArticleIdentityIsRejected();
await testCrossSourceHttpContentIsGroupedWithoutDroppingProvenance();
await testNonHttpEnterpriseUrisAreNotMerged();
await testRecordRunRequiresExactSelectionSnapshot();
await testRecordRunRequiresPendingEntryForEverySelectedItem();
await testRecordRunValidatesDiscardConfirmationAndDerivedStatus();
await testRecordRunValidatesSelectionSessionAndFieldTypes();
await testOperationSpecificContractsProtectBaseFlows();
await testInspectExposesRequiredGlobalStageRetry();
await testExistingRunCannotChangeItsOperationTargetOrSelection();
await testPartialCleanupDeletesOnlySuccessfulWorkingCopies();
await testNewRunSupersedesOlderCleanupOwnership();
await testRecordRunPreservesExistingCompletedCleanupStatusForSameRunId();
await testCompletedCleanupDoesNotDeleteRematerializedCurrentFile();
await testPartialCleanupJournalsOnlyRemainingArtifacts();
await testSameUrlRematerializationReplacesOldWorkingCopies();
await testRematerializationJournalsAndRetriesOldWorkingCopyCleanup();
await testMarkMaterializedEnforcesSchemaDirectoriesAndIdentity();
await testPayloadFilesMustBePrivateSessionInputs();
await testSuccessfulPayloadIsDeletedAndHelpPublishesSchema();
await testSubsetSuccessKeepsSessionAndUnselectedItem();
await testRetentionPreventsCleanup();
await testRetentionCanBeUpdatedThroughStateCommand();
await testNewRunSupersedesSkippedRetentionCleanupOwnership();
await testMalformedMetadataFailsClosedBeforeCleanup();
await testInvalidMaterializationDowngradesWithoutDeletingFiles();
await testInvalidMaterializationKeepsCurrentPathFromPendingCleanup();
await testMarkMaterializedUsesSourceSkillIdentityWhenReplacingCanonical();
await testMixedLegacyPartialUsesNestedStatusAndNormalizesOnWrite();
await testLegacyGlobalStageMigrationIsConservative();
await testLegacyRunSelectionAndItemsFieldsAutoMigrateOnInspect();
await testCurrentEnvelopeWithLegacyItemFieldsAutoMigratesOnInspect();
await testStaleLockRecoverySkipsIfLockChangedDuringRecovery();
await testFullScopeSuccessRemovesSession();
await testCleanupRejectsTraversalAndSymlinkEscape();
await testLiveLockCannotBeStolen();
await testLockWriteFailureRollsBackCreatedLock();
await testDeadProcessLockIsRecoveredAutomatically();
await testUnlockStaleRejectsMalformedLockAndRemovesDeadOwner();
console.log('knowledge-collection post-processing tests passed');
