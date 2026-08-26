import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const scriptPath = resolve(dirname(new URL(import.meta.url).pathname), 'knowledge-collection.mjs');

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

async function createCollectedSession() {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-collection-state-'));
  const initial = join(tmpdir(), `knowledge-collection-initial-${process.pid}-${Date.now()}.json`);
  await writeFile(initial, JSON.stringify({
    schemaVersion: '1.0',
    title: 'Collection',
    source: 'public-internet',
    backend: 'bycli',
    url: 'https://example.com',
    filters: {},
    items: [],
  }));
  const initialized = await runCli([
    'init', '--session-dir', root, '--query', 'collect example',
    '--collection-result-input-file', initial,
  ]);
  await unlink(initial);
  assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);

  await Promise.all([
    mkdir(join(root, 'markdown'), { recursive: true }),
    mkdir(join(root, 'sanitized/items'), { recursive: true }),
    mkdir(join(root, '.collection-inputs'), { recursive: true }),
  ]);
  await writeFile(join(root, 'markdown/paper.md'), '# Paper\n\nbody\n');
  await writeFile(join(root, 'sanitized/items/paper.md'), '# Paper\n\nbody\n');
  const payloadPath = join(root, '.collection-inputs/items.json');
  await writeFile(payloadPath, JSON.stringify({
    schemaVersion: '1.0',
    itemId: 'paper',
    markdownPath: 'markdown/paper.md',
    sanitizedPath: 'sanitized/items/paper.md',
    canonicalItem: {
      title: 'Paper',
      url: 'https://example.com/paper',
      author: '',
      publishTime: '',
      markdown: 'sanitized/items/paper.md',
      fileName: 'sanitized/items/paper.md',
    },
  }));
  const collected = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
  assert.equal(collected.code, 0, collected.stderr || collected.stdout);
  return root;
}

await (async () => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-collection-fresh-'));
  try {
    const initialized = await runCli([
      'init', '--session-dir', root, '--query', 'fresh collection',
      '--source-scope', '["public-internet"]', '--materialization-target', 'all',
    ]);
    assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);
    await Promise.all([
      mkdir(join(root, 'markdown'), { recursive: true }),
      mkdir(join(root, 'sanitized/items'), { recursive: true }),
      mkdir(join(root, '.collection-inputs'), { recursive: true }),
    ]);
    await writeFile(join(root, 'markdown/fresh.md'), '# Fresh\n');
    await writeFile(join(root, 'sanitized/items/fresh.md'), '# Fresh\n');
    const payloadPath = join(root, '.collection-inputs/fresh.json');
    await writeFile(payloadPath, JSON.stringify({
      schemaVersion: '1.0', itemId: 'fresh',
      source: 'public-internet', sourceSkill: 'bycli', backend: 'bycli',
      markdownPath: 'markdown/fresh.md', sanitizedPath: 'sanitized/items/fresh.md',
      canonicalItem: {
        title: 'Fresh', url: 'https://example.com/fresh', author: '', publishTime: '',
        markdown: 'sanitized/items/fresh.md', fileName: 'sanitized/items/fresh.md',
      },
    }));
    const collected = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
    assert.equal(collected.code, 0, collected.stderr || collected.stdout);
    const result = JSON.parse(await readFile(join(root, 'collection-result.json'), 'utf8'));
    assert.equal(result.source, 'public-internet');
    assert.equal(result.backend, 'bycli');
    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.json.collection.deliveryComplete, true);
    assert.equal(status.json.downstreamInput.files.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS fresh init can collect with per-item source identity');
})();

await (async () => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-collection-failed-'));
  try {
    const initialized = await runCli(['init', '--session-dir', root, '--query', 'failed collection']);
    assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);
    const sessionPath = join(root, 'session.json');
    const session = JSON.parse(await readFile(sessionPath, 'utf8'));
    session.collection.collection.status = 'failed';
    await writeFile(sessionPath, JSON.stringify(session));
    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(status.json.collection.deliveryComplete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS failed collection cannot report delivery complete');
})();

await (async () => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-collection-source-alias-'));
  try {
    const initialized = await runCli([
      'init', '--session-dir', root, '--query', 'feishu collection',
      '--source-scope', '["feishu"]', '--materialization-target', 'all',
    ]);
    assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);
    await writeFile(join(root, 'markdown/feishu.md'), '# Feishu\n');
    await writeFile(join(root, 'sanitized/items/feishu.md'), '# Feishu\n');
    const payloadPath = join(root, '.collection-inputs/feishu.json');
    await writeFile(payloadPath, JSON.stringify({
      schemaVersion: '1.0', itemId: 'feishu', source: 'fws', sourceSkill: 'fws', backend: 'lark-cli',
      markdownPath: 'markdown/feishu.md', sanitizedPath: 'sanitized/items/feishu.md',
      canonicalItem: {
        title: 'Feishu', url: 'https://example.feishu.cn/doc/1', author: '', publishTime: '',
        markdown: 'sanitized/items/feishu.md', fileName: 'sanitized/items/feishu.md',
      },
    }));
    const collected = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
    assert.equal(collected.code, 0, collected.stderr || collected.stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS logical enterprise source maps to authorized source scope');
})();

await (async () => {
  const schema = await runCli(['command-schema']);
  assert.equal(schema.json.commands.collect.properties['item-json-file'].format, 'collection-input-file');
  assert.deepEqual(Object.keys(schema.json.commands.inspect.properties).sort(), ['full', 'session-dir']);
  for (const flag of ['--operation', '--target-json', '--drain-pending']) {
    const result = await runCli(['inspect', '--session-dir', '/tmp/not-used', flag, 'x']);
    assert.equal(result.code, 1);
    assert.match(result.json.error, /未知参数/);
  }
  console.log('PASS collection-only command schema');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    const session = JSON.parse(await readFile(join(root, 'session.json'), 'utf8'));
    assert.deepEqual(Object.keys(session.collection).sort(), ['collection', 'schemaVersion', 'storage']);

    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(status.json.collection.materialized, 1);
    assert.deepEqual(status.json.collection.contentGranularity, {
      'full-text': 0, excerpt: 0, abstract: 0, unknown: 1,
    });
    assert.deepEqual(status.json.collection.mediaCovers, {
      notPresent: 0, materialized: 0, unavailable: 0, unknown: 1,
    });
    assert.equal(status.json.collection.runs, undefined);
    assert.equal(status.json.collection.retention, undefined);
    const realRoot = await realpath(root);
    assert.deepEqual(status.json.downstreamInput, {
      schemaVersion: '1.0',
      directory: join(realRoot, 'sanitized/items'),
      files: [join(realRoot, 'sanitized/items/paper.md')],
    });
    assert.equal(status.json.collection.downstreamInput, undefined);

    const fullStatus = await runCli(['status', '--session-dir', root, '--full']);
    assert.equal(fullStatus.code, 0, fullStatus.stderr || fullStatus.stdout);
    assert.equal(fullStatus.json.collection.deliveryComplete, true);
    assert.equal(fullStatus.json.collection.collection.items.length, 1);
    assert.equal(
      fullStatus.json.collection.collection.items[0].materialization.contentGranularity,
      'unknown',
    );
    assert.equal(fullStatus.json.collection.collection.items[0].media.coverStatus, 'unknown');

    const beforeInspect = await readFile(join(root, 'session.json'), 'utf8');
    const inspected = await runCli(['inspect', '--session-dir', root]);
    assert.equal(inspected.code, 0, inspected.stderr || inspected.stdout);
    assert.equal(await readFile(join(root, 'session.json'), 'utf8'), beforeInspect);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS validated downstream handoff');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    const payloadPath = join(root, '.collection-inputs/granularity.json');
    await writeFile(payloadPath, JSON.stringify({
      schemaVersion: '1.0', itemId: 'paper',
      contentGranularity: 'excerpt',
      media: {
        coverStatus: 'unavailable', coverCount: 2, materializedCoverCount: 0,
        reason: 'approved-cover-downloader-unavailable',
      },
      markdownPath: 'markdown/paper.md', sanitizedPath: 'sanitized/items/paper.md',
      canonicalItem: {
        title: 'Paper', url: 'https://example.com/paper', author: '', publishTime: '',
        markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
      },
    }));
    const collected = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
    assert.equal(collected.code, 0, collected.stderr || collected.stdout);
    assert.equal(collected.json.items[0].materialization.contentGranularity, 'excerpt');
    const status = await runCli(['status', '--session-dir', root, '--full']);
    assert.deepEqual(status.json.collection.contentGranularity, {
      'full-text': 0, excerpt: 1, abstract: 0, unknown: 0,
    });
    assert.deepEqual(status.json.collection.mediaCovers, {
      notPresent: 0, materialized: 0, unavailable: 1, unknown: 0,
    });

    const updateWithoutMediaPath = join(root, '.collection-inputs/update-without-media.json');
    await writeFile(updateWithoutMediaPath, JSON.stringify({
      schemaVersion: '1.0', itemId: 'paper', contentGranularity: 'excerpt',
      markdownPath: 'markdown/paper.md', sanitizedPath: 'sanitized/items/paper.md',
      canonicalItem: {
        title: 'Paper', url: 'https://example.com/paper', author: '', publishTime: '',
        markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
      },
    }));
    const updated = await runCli([
      'collect', '--session-dir', root, '--item-json-file', updateWithoutMediaPath,
    ]);
    assert.equal(updated.code, 0, updated.stderr || updated.stdout);
    const statusAfterUpdate = await runCli(['status', '--session-dir', root, '--full']);
    assert.equal(
      statusAfterUpdate.json.collection.collection.items[0].media.coverStatus,
      'unavailable',
    );

    const invalidPath = join(root, '.collection-inputs/invalid-granularity.json');
    await writeFile(invalidPath, JSON.stringify({
      schemaVersion: '1.0', itemId: 'paper', contentGranularity: 'full',
      markdownPath: 'markdown/paper.md', sanitizedPath: 'sanitized/items/paper.md',
      canonicalItem: {
        title: 'Paper', url: 'https://example.com/paper', author: '', publishTime: '',
        markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
      },
    }));
    const rejected = await runCli(['collect', '--session-dir', root, '--item-json-file', invalidPath]);
    assert.equal(rejected.code, 1);
    assert.match(rejected.json.error, /contentGranularity/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS collect preserves valid content and media state and rejects invalid granularity');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    const sessionPath = join(root, 'session.json');
    const session = JSON.parse(await readFile(sessionPath, 'utf8'));
    const item = session.collection.collection.items[0];
    delete item.materialization.contentGranularity;
    delete item.media;
    item.coverUrls = ['https://img.test/cover-1.png', 'https://img.test/cover-2.png'];
    await writeFile(sessionPath, JSON.stringify(session));
    const beforeStatus = await readFile(sessionPath, 'utf8');

    const status = await runCli(['status', '--session-dir', root, '--full']);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.deepEqual(status.json.collection.mediaCovers, {
      notPresent: 0, materialized: 0, unavailable: 0, unknown: 1,
    });
    assert.deepEqual(status.json.collection.collection.items[0].media, {
      coverStatus: 'unknown', coverCount: 2, materializedCoverCount: 0,
      reason: 'legacy-media-state-unknown',
    });
    assert.equal(await readFile(sessionPath, 'utf8'), beforeStatus);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS status reads legacy media conservatively without rewriting the session');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    const sessionPath = join(root, 'session.json');
    const session = JSON.parse(await readFile(sessionPath, 'utf8'));
    const item = session.collection.collection.items[0];
    item.materialization.contentGranularity = 'full';
    item.media = { coverStatus: 'downloaded', coverCount: 1, materializedCoverCount: 1 };
    await writeFile(sessionPath, JSON.stringify(session));
    const recovered = await runCli(['status', '--session-dir', root]);
    assert.equal(recovered.code, 0, recovered.stderr || recovered.stdout);
    assert.equal(recovered.json.warnings.some((warning) => /contentGranularity/.test(warning)), true);
    assert.equal(recovered.json.warnings.some((warning) => /media/.test(warning)), true);
    const status = await runCli(['status', '--session-dir', root, '--full']);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(
      status.json.collection.collection.items[0].materialization.contentGranularity,
      'unknown',
    );
    assert.equal(status.json.collection.collection.items[0].media.coverStatus, 'unknown');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS legacy invalid content and media state recover conservatively');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    await unlink(join(root, 'sanitized/items/paper.md'));
    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(status.json.collection.materialized, 0);
    assert.equal(status.json.collection.pending, 1);
    assert.deepEqual(status.json.downstreamInput.files, []);
    assert.equal(existsSync(join(root, 'session.json')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS missing sanitized file is never handed off');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    const relocated = join(root, 'relocated-items');
    await rename(join(root, 'sanitized/items'), relocated);
    await symlink(relocated, join(root, 'sanitized/items'), 'dir');
    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.code, 1);
    assert.match(status.json.error, /sanitized\/items/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS symlinked sanitized directory is rejected');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    const outsideDir = join(root, 'outside-inputs');
    await mkdir(outsideDir);
    const outsidePayload = join(outsideDir, 'items.json');
    await writeFile(outsidePayload, JSON.stringify({
      schemaVersion: '1.0',
      itemId: 'paper',
      markdownPath: 'markdown/paper.md',
      sanitizedPath: 'sanitized/items/paper.md',
      canonicalItem: {
        title: 'Paper', url: 'https://example.com/paper', author: '', publishTime: '',
        markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
      },
    }));
    await symlink(outsideDir, join(root, '.collection-inputs/link'), 'dir');
    const collected = await runCli([
      'collect', '--session-dir', root, '--item-json-file', join(root, '.collection-inputs/link/items.json'),
    ]);
    assert.equal(collected.code, 1);
    assert.equal(existsSync(outsidePayload), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS collect rejects symlink-parent input payloads');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    await writeFile(join(root, 'markdown/paper-new.md'), '# Paper new\n');
    await writeFile(join(root, 'sanitized/items/paper-new.md'), '# Paper new\n');
    const payloadPath = join(root, '.collection-inputs/rematerialize.json');
    await writeFile(payloadPath, JSON.stringify({
      schemaVersion: '1.0',
      items: [
        {
          itemId: 'paper', markdownPath: 'markdown/paper-new.md', sanitizedPath: 'sanitized/items/paper-new.md',
          canonicalItem: {
            title: 'Paper new', url: 'https://example.com/paper', author: '', publishTime: '',
            markdown: 'sanitized/items/paper-new.md', fileName: 'sanitized/items/paper-new.md',
          },
        },
        {
          itemId: 'paper-copy', markdownPath: 'markdown/paper.md', sanitizedPath: 'sanitized/items/paper.md',
          canonicalItem: {
            title: 'Paper copy', url: 'https://example.com/paper-copy', author: '', publishTime: '',
            markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
          },
        },
      ],
    }));
    const collected = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
    assert.equal(collected.code, 0, collected.stderr || collected.stdout);
    assert.equal(existsSync(join(root, 'markdown/paper.md')), true);
    assert.equal(existsSync(join(root, 'sanitized/items/paper.md')), true);
    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.json.collection.materialized, 2);
    assert.equal(status.json.downstreamInput.files.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS cleanup never removes another current work copy');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    const payloadPath = join(root, '.collection-inputs/update.json');
    await writeFile(payloadPath, JSON.stringify({
      schemaVersion: '1.0', itemId: 'paper',
      markdownPath: 'markdown/paper.md', sanitizedPath: 'sanitized/items/paper.md',
      canonicalItem: {
        title: 'Updated paper', url: 'https://example.com/paper', author: 'Ada', publishTime: '2026-08-24',
        markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
      },
    }));
    const collected = await runCli(['collect', '--session-dir', root, '--item-json-file', payloadPath]);
    assert.equal(collected.code, 0, collected.stderr || collected.stdout);
    const view = JSON.parse(await readFile(join(root, 'collection-result.json'), 'utf8'));
    assert.deepEqual(view.items[0], {
      title: 'Updated paper', url: 'https://example.com/paper', author: 'Ada', publishTime: '2026-08-24',
      markdown: 'sanitized/items/paper.md', fileName: 'sanitized/items/paper.md',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS collect persists current canonical metadata');
})();

await (async () => {
  const root = await createCollectedSession();
  try {
    await chmod(join(root, 'sanitized/items/paper.md'), 0o000);
    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(status.json.collection.pending, 1);
    assert.deepEqual(status.json.downstreamInput.files, []);
  } finally {
    await chmod(join(root, 'sanitized/items/paper.md'), 0o600).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
  console.log('PASS unreadable Markdown is never handed off');
})();

await (async () => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-collection-empty-'));
  const outside = await mkdtemp(join(tmpdir(), 'knowledge-collection-outside-'));
  try {
    const initialized = await runCli(['init', '--session-dir', root, '--query', 'empty']);
    assert.equal(initialized.code, 0, initialized.stderr || initialized.stdout);
    await rm(join(root, 'sanitized/items'), { recursive: true });
    await symlink(outside, join(root, 'sanitized/items'), 'dir');
    const status = await runCli(['status', '--session-dir', root]);
    assert.equal(status.code, 1);
    assert.doesNotMatch(status.stdout, new RegExp(outside.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
  console.log('PASS empty handoff rejects a symlinked sanitized directory');
})();

console.log('ALL COLLECTION STATE TESTS PASSED');
