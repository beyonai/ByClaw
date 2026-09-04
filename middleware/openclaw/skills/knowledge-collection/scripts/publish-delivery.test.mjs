import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync,
  symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'knowledge-collection.mjs');

function runCli(args, env = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
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

function tempRoot() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'kc-publish-test-')));
}

async function setupCollectedSession(root, {
  query = 'DeepSeek article', nested = false, sessionDir: explicitSessionDir,
  extraInitArgs = [], env = {},
} = {}) {
  const sessionDir = explicitSessionDir || join(root, 'internal-session');
  const init = await runCli([
    'init', '--session-dir', sessionDir, '--query', query,
    '--source-scope', '["public-internet"]', '--materialization-target', 'selected',
    '--direct-urls', '["https://example.com/deepseek","https://example.com/another","https://example.com/second"]',
    ...extraInitArgs,
  ], env);
  assert.equal(init.code, 0, init.stderr || init.stdout);

  const sanitizedRelative = nested ? 'sanitized/items/post-01/index.md' : 'sanitized/items/post-01.md';
  const markdownRelative = nested ? 'markdown/post-01/index.md' : 'markdown/post-01.md';
  const imageRelative = nested
    ? 'sanitized/items/post-01/assets/cover.jpg'
    : 'sanitized/items/post-01-images/cover.jpg';
  const imageLink = nested ? 'assets/cover.jpg' : 'post-01-images/cover.jpg';
  const unreferencedRelative = nested
    ? 'sanitized/items/post-01/assets/unused.jpg'
    : 'sanitized/items/post-01-images/unused.jpg';

  for (const relative of [sanitizedRelative, markdownRelative, imageRelative, unreferencedRelative]) {
    mkdirSync(dirname(join(sessionDir, relative)), { recursive: true });
  }
  const markdown = `# DeepSeek\n\n![cover](${imageLink})\n\n正文。\n`;
  writeFileSync(join(sessionDir, sanitizedRelative), markdown);
  writeFileSync(join(sessionDir, markdownRelative), markdown);
  writeFileSync(join(sessionDir, imageRelative), 'image-bytes');
  writeFileSync(join(sessionDir, unreferencedRelative), 'unused-image');
  writeFileSync(join(sessionDir, 'raw/process.json'), '{"internal":true}\n');
  writeFileSync(join(sessionDir, 'collection-result.json'), `${JSON.stringify({
    schemaVersion: '1.0',
    title: query,
    source: 'public-internet',
    backend: 'bycli',
    url: 'https://example.com/deepseek',
    filters: {},
    items: [{
      title: 'DeepSeek',
      url: 'https://example.com/deepseek',
      author: 'Author',
      publishTime: '2026-09-01T00:00:00Z',
      markdown: sanitizedRelative,
      fileName: sanitizedRelative,
    }],
  }, null, 2)}\n`);
  const payloadPath = join(sessionDir, '.collection-inputs', 'items.json');
  writeFileSync(payloadPath, `${JSON.stringify({
    schemaVersion: '1.0',
    items: [{
      itemId: 'post-01',
      markdownPath: markdownRelative,
      sanitizedPath: sanitizedRelative,
      canonicalItem: {
        title: 'DeepSeek',
        url: 'https://example.com/deepseek',
        author: 'Author',
        publishTime: '2026-09-01T00:00:00Z',
        markdown: sanitizedRelative,
        fileName: sanitizedRelative,
      },
    }],
  }, null, 2)}\n`);
  const collect = await runCli(['collect', '--session-dir', sessionDir, '--item-json-file', payloadPath]);
  assert.equal(collect.code, 0, collect.stderr || collect.stdout);
  return {
    sessionDir, sanitizedRelative, imageRelative, unreferencedRelative, initResult: init,
  };
}

/** 在 init 阶段绑定交付目标，返回可用于 publish --delivery-handle 的会话。 */
async function setupBoundSession(root, { query = 'DeepSeek article', deliveryDir } = {}) {
  const sessionsRoot = join(root, 'by', '.sessions');
  const sessionRoot = join(sessionsRoot, 'bound-session');
  const sessionDir = join(sessionRoot, '.collection-runs', 'run-001');
  const env = { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: sessionsRoot };
  const target = deliveryDir || join(root, '00-collection');
  const session = await setupCollectedSession(root, {
    query,
    sessionDir,
    env,
    extraInitArgs: [
      '--session-root', sessionRoot,
      '--delivery-requested', 'true',
      '--delivery-dir', target,
    ],
  });
  return {
    ...session,
    env,
    sessionRoot,
    deliveryDir: target,
    handle: session.initResult.json.task.deliveryTarget.handle,
  };
}

test('publish delivers only validated Markdown and referenced local images to an empty target', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root);
    const deliveryDir = join(root, '00-collection');
    mkdirSync(deliveryDir);

    const published = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir,
    ]);
    assert.equal(published.code, 0, published.stderr || published.stdout);
    assert.equal(published.json.ok, true);
    assert.equal(published.json.delivery.requestedDirectory, deliveryDir);
    assert.equal(published.json.delivery.actualDirectory, deliveryDir);
    assert.deepEqual(published.json.delivery.files, [join(deliveryDir, 'post-01.md')]);
    assert.deepEqual(published.json.deliveryInput, {
      schemaVersion: '1.0',
      directory: deliveryDir,
      files: [join(deliveryDir, 'post-01.md')],
    });
    assert.equal(readFileSync(join(deliveryDir, 'post-01.md'), 'utf8').includes('post-01-images/cover.jpg'), true);
    assert.equal(readFileSync(join(deliveryDir, 'post-01-images/cover.jpg'), 'utf8'), 'image-bytes');
    assert.equal(existsSync(join(deliveryDir, 'post-01-images', 'unused.jpg')), false);
    assert.equal(existsSync(join(deliveryDir, 'session.json')), false);
    assert.equal(existsSync(join(deliveryDir, 'raw')), false);

    const status = await runCli(['status', '--session-dir', sessionDir]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.deepEqual(status.json.deliveryInput, published.json.deliveryInput);
    assert.equal(status.json.delivery, undefined);
    const session = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'));
    assert.equal(session.delivery.schemaVersion, '1.0');
    assert.equal(session.delivery.status, 'published');
    assert.match(session.delivery.planHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(session.delivery.actualDirectory, deliveryDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('legacy public sessions cannot publish for the first time but keep an unchanged published receipt idempotent', async () => {
  const root = tempRoot();
  try {
    const first = await setupCollectedSession(root);
    const firstSessionPath = join(first.sessionDir, 'session.json');
    const legacy = JSON.parse(readFileSync(firstSessionPath, 'utf8'));
    legacy.task.discoveryGate.schemaVersion = '1.0';
    delete legacy.task.discoveryGate.topicContract;
    for (const candidate of legacy.task.discoveryGate.candidates) delete candidate.topicRelevance;
    writeFileSync(firstSessionPath, `${JSON.stringify(legacy, null, 2)}\n`);
    const blockedTarget = join(root, 'legacy-first-publish');

    const blocked = await runCli([
      'publish', '--session-dir', first.sessionDir, '--delivery-dir', blockedTarget,
    ]);
    assert.equal(blocked.code, 1);
    assert.match(blocked.json.error, /DISCOVERY_RELEVANCE_MIGRATION_REQUIRED/);
    assert.equal(existsSync(blockedTarget), false);

    const secondRoot = join(root, 'already-published');
    mkdirSync(secondRoot);
    const second = await setupCollectedSession(secondRoot);
    const publishedTarget = join(root, 'legacy-existing-delivery');
    const published = await runCli([
      'publish', '--session-dir', second.sessionDir, '--delivery-dir', publishedTarget,
    ]);
    assert.equal(published.code, 0, published.stderr || published.stdout);
    const secondSessionPath = join(second.sessionDir, 'session.json');
    const publishedLegacy = JSON.parse(readFileSync(secondSessionPath, 'utf8'));
    publishedLegacy.task.discoveryGate.schemaVersion = '1.0';
    delete publishedLegacy.task.discoveryGate.topicContract;
    for (const candidate of publishedLegacy.task.discoveryGate.candidates) delete candidate.topicRelevance;
    writeFileSync(secondSessionPath, `${JSON.stringify(publishedLegacy, null, 2)}\n`);

    const idempotent = await runCli([
      'publish', '--session-dir', second.sessionDir, '--delivery-dir', publishedTarget,
    ]);
    assert.equal(idempotent.code, 0, idempotent.stderr || idempotent.stdout);
    assert.equal(idempotent.json.delivery.actualDirectory, publishedTarget);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nested index layout is flattened with a companion assets directory', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root, { nested: true });
    writeFileSync(join(sessionDir, 'sanitized/items/post-01/index.md'), [
      '# DeepSeek',
      '',
      '![cover][hero]',
      '![cover]',
      '<picture><source srcset="assets/cover.jpg 1x"><img src=assets/cover.jpg></picture>',
      '<audio src=assets/audio.mp3></audio>',
      '`![inline-example](https://example.com/inline.png)`',
      '<!-- ![comment-example](https://example.com/comment.png) -->',
      '```markdown',
      '![fenced-example](https://example.com/fenced.png)',
      '<img src=https://example.com/fenced-html.png>',
      '```',
      '    ![indented-example](https://example.com/indented.png)',
      '> ```markdown',
      '> ![quoted-example](https://example.com/quoted.png)',
      '> ```',
      '- ```markdown',
      '  ![listed-example](https://example.com/listed.png)',
      '  ```',
      '',
      '[hero]: assets/cover.jpg',
      '[cover]: assets/cover.jpg',
      '',
    ].join('\n'));
    writeFileSync(join(sessionDir, 'sanitized/items/post-01/assets/audio.mp3'), 'audio-bytes');
    const deliveryDir = join(root, 'delivery');
    const published = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(published.code, 0, published.stderr || published.stdout);
    const deliveredMarkdown = readFileSync(join(deliveryDir, 'post-01.md'), 'utf8');
    assert.equal(deliveredMarkdown.includes('[hero]: post-01-assets/cover.jpg'), true);
    assert.equal(deliveredMarkdown.includes('[cover]: post-01-assets/cover.jpg'), true);
    assert.equal(deliveredMarkdown.includes('srcset="post-01-assets/cover.jpg 1x"'), true);
    assert.equal(deliveredMarkdown.includes('src=post-01-assets/cover.jpg'), true);
    assert.equal(deliveredMarkdown.includes('src=post-01-assets/audio.mp3'), true);
    assert.equal(deliveredMarkdown.includes('![fenced-example](https://example.com/fenced.png)'), true);
    assert.equal(deliveredMarkdown.includes('![comment-example](https://example.com/comment.png)'), true);
    assert.equal(deliveredMarkdown.includes('![quoted-example](https://example.com/quoted.png)'), true);
    assert.equal(deliveredMarkdown.includes('![listed-example](https://example.com/listed.png)'), true);
    assert.equal(readFileSync(join(deliveryDir, 'post-01-assets/cover.jpg'), 'utf8'), 'image-bytes');
    assert.equal(readFileSync(join(deliveryDir, 'post-01-assets/audio.mp3'), 'utf8'), 'audio-bytes');
    assert.equal(existsSync(join(deliveryDir, 'post-01-assets/unused.jpg')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('non-empty requested directories get a stable collision-safe child and never lose existing content', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root, {
      query: '采集一篇关于 OpenClaw 的高质量文章，架构、使用、介绍、技术文档均可，输出到用户目录',
    });
    const requested = join(root, 'by');
    mkdirSync(requested);
    writeFileSync(join(requested, 'keep.txt'), 'keep');
    const shortRunId = crypto.createHash('sha256').update(realpathSync(sessionDir)).digest('hex').slice(0, 8);
    const occupiedName = `deepseek-collection-${shortRunId}`;
    mkdirSync(join(requested, occupiedName));
    writeFileSync(join(requested, occupiedName, 'unknown.txt'), 'unknown');

    const first = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', requested]);
    assert.equal(first.code, 0, first.stderr || first.stdout);
    assert.equal(first.json.delivery.requestedDirectory, requested);
    assert.notEqual(first.json.delivery.actualDirectory, requested);
    assert.equal(basename(first.json.delivery.actualDirectory), `${occupiedName}-2`);
    assert.equal(readFileSync(join(requested, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(readFileSync(join(requested, occupiedName, 'unknown.txt'), 'utf8'), 'unknown');
    const firstPublishedAt = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8')).delivery.publishedAt;

    const second = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', requested]);
    assert.equal(second.code, 0, second.stderr || second.stdout);
    assert.equal(second.json.delivery.actualDirectory, first.json.delivery.actualDirectory);
    assert.equal(readdirSync(requested).filter((name) => name !== 'keep.txt').length, 2);
    assert.equal(JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8')).delivery.publishedAt, firstPublishedAt);

    const unknownEmptyDirectory = join(first.json.delivery.actualDirectory, 'user-empty-directory');
    mkdirSync(unknownEmptyDirectory);
    const directoryDrift = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', requested]);
    assert.equal(directoryDrift.code, 1);
    assert.match(directoryDrift.json.error, /漂移|修改/);
    assert.equal(existsSync(unknownEmptyDirectory), true);
    rmSync(unknownEmptyDirectory, { recursive: true });

    writeFileSync(join(first.json.delivery.actualDirectory, 'post-01.md'), 'user changed this');
    const drifted = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', requested]);
    assert.equal(drifted.code, 1);
    assert.match(drifted.json.error, /漂移|修改/);
    assert.equal(readdirSync(requested).filter((name) => name !== 'keep.txt').length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source changes make status stale and can be republished only over an unchanged owned target', async () => {
  const root = tempRoot();
  try {
    const { sessionDir, sanitizedRelative } = await setupCollectedSession(root);
    const deliveryDir = join(root, 'delivery');
    const first = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(first.code, 0, first.stderr || first.stdout);

    writeFileSync(join(sessionDir, sanitizedRelative), '# DeepSeek\n\nupdated\n');
    const stale = await runCli(['status', '--session-dir', sessionDir]);
    assert.equal(stale.code, 0, stale.stderr || stale.stdout);
    assert.equal(stale.json.delivery, undefined);
    assert.equal(stale.json.deliveryInput, undefined);
    assert.ok(stale.json.warnings.some((warning) => /变化|publish/.test(warning)));
    assert.deepEqual(stale.json.downstreamInput.files, [realpathSync(join(sessionDir, sanitizedRelative))]);

    const republished = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(republished.code, 0, republished.stderr || republished.stdout);
    assert.equal(readFileSync(join(deliveryDir, 'post-01.md'), 'utf8'), '# DeepSeek\n\nupdated\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relative destinations resolve from Session Root and unsafe destination types are rejected', async () => {
  const root = tempRoot();
  try {
    const sessionsRoot = join(root, 'by', '.sessions');
    const sessionRoot = join(sessionsRoot, '20037048');
    mkdirSync(sessionRoot, { recursive: true });
    const { sessionDir } = await setupCollectedSession(sessionRoot);
    const env = { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: sessionsRoot };

    const relative = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-dir', '00-collection', '--session-root', sessionRoot,
    ], env);
    assert.equal(relative.code, 0, relative.stderr || relative.stdout);
    assert.equal(relative.json.delivery.actualDirectory, join(sessionRoot, '00-collection'));

    const rootTarget = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', '/']);
    assert.equal(rootTarget.code, 1);

    const fileTarget = join(root, 'file-target');
    writeFileSync(fileTarget, 'occupied');
    const fileResult = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', fileTarget]);
    assert.equal(fileResult.code, 1);
    assert.match(fileResult.json.error, /目录/);

    const linkTarget = join(root, 'link-target');
    symlinkSync(join(root, 'linked-content'), linkTarget);
    const linkResult = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', linkTarget]);
    assert.equal(linkResult.code, 1);
    assert.match(linkResult.json.error, /符号链接/);

    const realParent = join(root, 'real-parent');
    const linkedParent = join(root, 'linked-parent');
    mkdirSync(realParent);
    symlinkSync(realParent, linkedParent);
    const ancestorLinkResult = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-dir', join(linkedParent, 'new-delivery'),
    ]);
    assert.equal(ancestorLinkResult.code, 1);
    assert.match(ancestorLinkResult.json.error, /符号链接/);
    assert.equal(existsSync(join(realParent, 'new-delivery')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status and republish reject a destination whose ancestor becomes a symlink after publication', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root);
    const safeParent = join(root, 'safe-parent');
    const movedParent = join(root, 'moved-parent');
    const deliveryDir = join(safeParent, 'delivery');
    mkdirSync(safeParent);
    const first = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(first.code, 0, first.stderr || first.stdout);

    renameSync(safeParent, movedParent);
    symlinkSync(movedParent, safeParent);
    const status = await runCli(['status', '--session-dir', sessionDir]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(status.json.deliveryInput, undefined);
    assert.ok(status.json.warnings.some((warning) => /修改|停用/.test(warning)));

    const republish = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(republish.code, 1);
    assert.match(republish.json.error, /符号链接/);
    assert.equal(existsSync(join(movedParent, 'delivery', 'post-01.md')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish refuses sessions that have not passed collection delivery validation', async () => {
  const root = tempRoot();
  try {
    const sessionDir = join(root, 'session');
    const init = await runCli(['init', '--session-dir', sessionDir, '--query', 'not ready']);
    assert.equal(init.code, 0, init.stderr || init.stdout);
    const deliveryDir = join(root, 'delivery');
    const result = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(result.code, 1);
    assert.match(result.json.error, /deliveryComplete|validated Markdown/);
    assert.equal(existsSync(deliveryDir), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('remote images and symlinked asset path components fail before creating a delivery', async () => {
  const root = tempRoot();
  try {
    const remote = await setupCollectedSession(join(root, 'remote'));
    writeFileSync(
      join(remote.sessionDir, remote.sanitizedRelative),
      '# DeepSeek\n\n![remote](https://example.com/image.jpg)\n',
    );
    const remoteDelivery = join(root, 'remote-delivery');
    const remoteResult = await runCli([
      'publish', '--session-dir', remote.sessionDir, '--delivery-dir', remoteDelivery,
    ]);
    assert.equal(remoteResult.code, 1);
    assert.match(remoteResult.json.error, /远程|本地图片/);
    assert.equal(existsSync(remoteDelivery), false);

    const linked = await setupCollectedSession(join(root, 'linked'));
    const itemsDir = join(linked.sessionDir, 'sanitized', 'items');
    const companion = join(itemsDir, 'post-01-images');
    const realImages = join(itemsDir, 'real-images');
    rmSync(companion, { recursive: true, force: true });
    mkdirSync(realImages);
    writeFileSync(join(realImages, 'cover.jpg'), 'image-bytes');
    symlinkSync(realImages, companion);
    const linkedDelivery = join(root, 'linked-delivery');
    const linkedResult = await runCli([
      'publish', '--session-dir', linked.sessionDir, '--delivery-dir', linkedDelivery,
    ]);
    assert.equal(linkedResult.code, 1);
    assert.match(linkedResult.json.error, /符号链接/);
    assert.equal(existsSync(linkedDelivery), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two sessions publishing to one empty directory both succeed without sharing a target', async () => {
  const root = tempRoot();
  try {
    const firstSession = await setupCollectedSession(join(root, 'first'), { query: 'First article' });
    const secondSession = await setupCollectedSession(join(root, 'second'), { query: 'Second article' });
    const requested = join(root, 'shared-delivery');
    mkdirSync(requested);

    const [first, second] = await Promise.all([
      runCli(['publish', '--session-dir', firstSession.sessionDir, '--delivery-dir', requested]),
      runCli(['publish', '--session-dir', secondSession.sessionDir, '--delivery-dir', requested]),
    ]);
    assert.equal(first.code, 0, first.stderr || first.stdout);
    assert.equal(second.code, 0, second.stderr || second.stdout);
    assert.notEqual(first.json.delivery.actualDirectory, second.json.delivery.actualDirectory);
    assert.equal(
      [first.json.delivery.actualDirectory, second.json.delivery.actualDirectory].filter((value) => value === requested).length,
      1,
    );
    for (const result of [first, second]) {
      assert.equal(lstatSync(result.json.delivery.actualDirectory).isDirectory(), true);
      assert.equal(existsSync(result.json.delivery.files[0]), true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a persisted planned delivery recovers when the target already matches the plan', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root);
    const deliveryDir = join(root, 'delivery');
    const first = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(first.code, 0, first.stderr || first.stdout);
    const sessionPath = join(sessionDir, 'session.json');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
    session.delivery.status = 'planned';
    session.delivery.publishedAt = null;
    writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);

    const recovered = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(recovered.code, 0, recovered.stderr || recovered.stdout);
    assert.equal(recovered.json.delivery.actualDirectory, deliveryDir);
    const recoveredSession = JSON.parse(readFileSync(sessionPath, 'utf8'));
    assert.equal(recoveredSession.delivery.status, 'published');
    assert.equal(typeof recoveredSession.delivery.planHash, 'string');
    assert.equal(typeof recoveredSession.delivery.publishedAt, 'string');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a recoverable failed delivery can be retried after a pre-commit failure', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root);
    const deliveryDir = join(root, 'delivery');
    const first = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(first.code, 0, first.stderr || first.stdout);

    const sessionPath = join(sessionDir, 'session.json');
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'));
    session.delivery.status = 'failed';
    session.delivery.failurePhase = 'recoverable';
    session.delivery.reason = 'simulated-pre-commit-failure';
    rmSync(deliveryDir, { recursive: true });
    writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);

    const retried = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(retried.code, 0, retried.stderr || retried.stdout);
    assert.equal(readFileSync(join(deliveryDir, 'post-01.md'), 'utf8').startsWith('# DeepSeek'), true);
    const recovered = JSON.parse(readFileSync(sessionPath, 'utf8'));
    assert.equal(recovered.delivery.status, 'published');
    assert.equal(recovered.delivery.failurePhase, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an old malformed destination lock is recovered safely', async () => {
  const root = tempRoot();
  let lockPath;
  try {
    const { sessionDir } = await setupCollectedSession(root);
    const deliveryDir = join(root, 'delivery');
    const lockRoot = join(tmpdir(), 'knowledge-collection-publish-locks');
    mkdirSync(lockRoot, { recursive: true });
    lockPath = join(lockRoot, `${crypto.createHash('sha256').update(resolve(deliveryDir)).digest('hex')}.lock`);
    writeFileSync(lockPath, '{}');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);

    const published = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(published.code, 0, published.stderr || published.stdout);
    assert.equal(existsSync(join(deliveryDir, 'post-01.md')), true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    if (lockPath) rmSync(lockPath, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('collect marks a published delivery stale and status preserves only the internal handoff', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root);
    const deliveryDir = join(root, 'delivery');
    const published = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(published.code, 0, published.stderr || published.stdout);

    const sanitizedRelative = 'sanitized/items/post-02.md';
    const markdownRelative = 'markdown/post-02.md';
    writeFileSync(join(sessionDir, sanitizedRelative), '# Second\n\ncontent\n');
    writeFileSync(join(sessionDir, markdownRelative), '# Second\n\ncontent\n');
    const payload = join(sessionDir, '.collection-inputs', 'post-02.json');
    writeFileSync(payload, `${JSON.stringify({
      schemaVersion: '1.0',
      items: [{
        itemId: 'post-02',
        markdownPath: markdownRelative,
        sanitizedPath: sanitizedRelative,
        canonicalItem: {
          title: 'Second',
          url: 'https://example.com/second',
          author: '',
          publishTime: '',
          markdown: sanitizedRelative,
          fileName: sanitizedRelative,
        },
      }],
    }, null, 2)}\n`);
    const collected = await runCli(['collect', '--session-dir', sessionDir, '--item-json-file', payload]);
    assert.equal(collected.code, 0, collected.stderr || collected.stdout);
    const session = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf8'));
    assert.equal(session.delivery.status, 'stale');

    const status = await runCli(['status', '--session-dir', sessionDir]);
    assert.equal(status.code, 0, status.stderr || status.stdout);
    assert.equal(status.json.deliveryInput, undefined);
    assert.equal(status.json.downstreamInput.files.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate output basenames receive stable suffixes with correctly paired assets', async () => {
  const root = tempRoot();
  try {
    const { sessionDir } = await setupCollectedSession(root, { nested: true });
    const deliveryDir = join(root, 'delivery');
    const initial = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(initial.code, 0, initial.stderr || initial.stdout);
    assert.deepEqual(initial.json.delivery.files, [join(deliveryDir, 'post-01.md')]);

    const sanitizedRelative = 'sanitized/items/group/post-01/index.md';
    const markdownRelative = 'markdown/group/post-01/index.md';
    const assetRelative = 'sanitized/items/group/post-01/assets/cover.jpg';
    mkdirSync(dirname(join(sessionDir, sanitizedRelative)), { recursive: true });
    mkdirSync(dirname(join(sessionDir, markdownRelative)), { recursive: true });
    mkdirSync(dirname(join(sessionDir, assetRelative)), { recursive: true });
    writeFileSync(join(sessionDir, sanitizedRelative), '# Another\n\n![cover](assets/cover.jpg)\n');
    writeFileSync(join(sessionDir, markdownRelative), '# Another\n\n![cover](assets/cover.jpg)\n');
    writeFileSync(join(sessionDir, assetRelative), 'second-image');
    const payload = join(sessionDir, '.collection-inputs', 'duplicate-name.json');
    writeFileSync(payload, `${JSON.stringify({
      schemaVersion: '1.0',
      items: [{
        itemId: 'post-duplicate',
        markdownPath: markdownRelative,
        sanitizedPath: sanitizedRelative,
        canonicalItem: {
          title: 'Another',
          url: 'https://example.com/another',
          author: '',
          publishTime: '',
          markdown: sanitizedRelative,
          fileName: sanitizedRelative,
        },
      }],
    }, null, 2)}\n`);
    const collected = await runCli(['collect', '--session-dir', sessionDir, '--item-json-file', payload]);
    assert.equal(collected.code, 0, collected.stderr || collected.stdout);

    const published = await runCli(['publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir]);
    assert.equal(published.code, 0, published.stderr || published.stdout);
    const markdownNames = published.json.delivery.files.map((filePath) => basename(filePath)).sort();
    assert.deepEqual(markdownNames, ['post-01-post-duplicate.md', 'post-01.md']);
    for (const filePath of published.json.delivery.files) {
      const stem = basename(filePath, '.md');
      const content = readFileSync(filePath, 'utf8');
      assert.equal(content.includes(`${stem}-assets/cover.jpg`), true);
      assert.equal(existsSync(join(deliveryDir, `${stem}-assets`, 'cover.jpg')), true);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish resolves the delivery target from a handle bound at init', async () => {
  const root = tempRoot();
  try {
    const { sessionDir, deliveryDir, handle, env } = await setupBoundSession(root);
    mkdirSync(deliveryDir, { recursive: true });

    const published = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', handle,
    ], env);
    assert.equal(published.code, 0, published.stderr || published.stdout);
    assert.equal(published.json.delivery.requestedDirectory, deliveryDir);
    assert.equal(published.json.delivery.actualDirectory, deliveryDir);
    assert.deepEqual(published.json.delivery.files, [join(deliveryDir, 'post-01.md')]);

    // 幂等重发:同一 actualDirectory,不触发漂移检测
    const again = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', handle,
    ], env);
    assert.equal(again.code, 0, again.stderr || again.stdout);
    assert.equal(again.json.delivery.actualDirectory, deliveryDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish rejects an unknown or unbound delivery handle and still requires one form', async () => {
  const root = tempRoot();
  try {
    const { sessionDir, handle, env } = await setupBoundSession(root);

    const unknown = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', 'delivery-deadbeef',
    ], env);
    assert.equal(unknown.code, 1);
    assert.match(unknown.json.error, /delivery-deadbeef|DELIVERY_HANDLE_UNKNOWN/);
    assert.notEqual(handle, 'delivery-deadbeef');

    const neither = await runCli(['publish', '--session-dir', sessionDir], env);
    assert.equal(neither.code, 1);
    assert.match(neither.json.error, /--delivery-dir|--delivery-handle/);

    // 未绑定交付目标的会话:handle 形式必须报 DELIVERY_TARGET_NOT_BOUND
    const unboundRoot = tempRoot();
    try {
      const unbound = await setupCollectedSession(unboundRoot);
      const res = await runCli([
        'publish', '--session-dir', unbound.sessionDir, '--delivery-handle', handle,
      ]);
      assert.equal(res.code, 1);
      assert.match(res.json.error, /DELIVERY_TARGET_NOT_BOUND/);
      assert.match(res.json.error, /--delivery-dir/);
    } finally {
      rmSync(unboundRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish accepts both flags only when they resolve to the same directory', async () => {
  const root = tempRoot();
  try {
    const { sessionDir, deliveryDir, handle, env } = await setupBoundSession(root);
    mkdirSync(deliveryDir, { recursive: true });

    const divergent = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', handle,
      '--delivery-dir', join(root, 'other-target'),
    ], env);
    assert.equal(divergent.code, 1);
    assert.match(divergent.json.error, /不一致|一致/);

    const agreeing = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', handle,
      '--delivery-dir', deliveryDir,
    ], env);
    assert.equal(agreeing.code, 0, agreeing.stderr || agreeing.stdout);
    assert.equal(agreeing.json.delivery.actualDirectory, deliveryDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the two publish forms share one receipt, one lock and one recovery path', async () => {
  const root = tempRoot();
  try {
    const { sessionDir, deliveryDir, handle, env } = await setupBoundSession(root);
    mkdirSync(deliveryDir, { recursive: true });

    // --delivery-dir 先发布,再用 --delivery-handle 重发:必须复用 receipt,不得另建子目录
    const byDir = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir,
    ], env);
    assert.equal(byDir.code, 0, byDir.stderr || byDir.stdout);
    assert.equal(byDir.json.delivery.actualDirectory, deliveryDir);

    const byHandle = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', handle,
    ], env);
    assert.equal(byHandle.code, 0, byHandle.stderr || byHandle.stdout);
    assert.equal(byHandle.json.delivery.actualDirectory, deliveryDir,
      'handle 形式必须复用既有 receipt,而非分配 <slug>-collection-<hash> 子目录');
    assert.equal(byHandle.json.delivery.requestedDirectory, byDir.json.delivery.requestedDirectory);
    assert.deepEqual(readdirSync(deliveryDir).filter((e) => e.includes('-collection-')), []);

    // 反向顺序:handle 先发布,--delivery-dir 重发同样复用
    const reverseRoot = tempRoot();
    try {
      const reverse = await setupBoundSession(reverseRoot);
      mkdirSync(reverse.deliveryDir, { recursive: true });
      const h = await runCli([
        'publish', '--session-dir', reverse.sessionDir, '--delivery-handle', reverse.handle,
      ], reverse.env);
      assert.equal(h.code, 0, h.stderr || h.stdout);
      const d = await runCli([
        'publish', '--session-dir', reverse.sessionDir, '--delivery-dir', reverse.deliveryDir,
      ], reverse.env);
      assert.equal(d.code, 0, d.stderr || d.stdout);
      assert.equal(d.json.delivery.actualDirectory, h.json.delivery.actualDirectory);
    } finally {
      rmSync(reverseRoot, { recursive: true, force: true });
    }

    // 两种形式对同一目标必须映射到同一把锁
    const lockRoot = join(tmpdir(), 'knowledge-collection-publish-locks');
    const expectedLock = `${crypto.createHash('sha256').update(resolve(deliveryDir)).digest('hex')}.lock`;
    assert.equal(existsSync(join(lockRoot, expectedLock)), false, '锁必须在发布结束后释放');
    assert.equal(
      crypto.createHash('sha256').update(resolve(byDir.json.delivery.requestedDirectory)).digest('hex'),
      crypto.createHash('sha256').update(resolve(byHandle.json.delivery.requestedDirectory)).digest('hex'),
      '两种形式的 requestedDirectory 必须逐字节一致,否则锁键分裂',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('publish --delivery-handle recovers a planned receipt written by the --delivery-dir form', async () => {
  const root = tempRoot();
  try {
    const { sessionDir, deliveryDir, handle, env } = await setupBoundSession(root);
    mkdirSync(deliveryDir, { recursive: true });

    const published = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-dir', deliveryDir,
    ], env);
    assert.equal(published.code, 0, published.stderr || published.stdout);

    // 模拟被中断的发布:receipt 退回 planned(由 --delivery-dir 形式写入)
    const sessionFile = join(sessionDir, 'session.json');
    const state = JSON.parse(readFileSync(sessionFile, 'utf8'));
    state.delivery.status = 'planned';
    writeFileSync(sessionFile, `${JSON.stringify(state, null, 2)}\n`);

    const recovered = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', handle,
    ], env);
    assert.equal(recovered.code, 0, recovered.stderr || recovered.stdout);
    assert.equal(recovered.json.delivery.actualDirectory, deliveryDir);
    assert.equal(
      JSON.parse(readFileSync(sessionFile, 'utf8')).delivery.status,
      'published',
      'handle 形式必须把 --delivery-dir 写下的 planned receipt 恢复为 published',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the delivery-path redaction is scoped to task.deliveryTarget and never suppresses the handoff', async () => {
  const root = tempRoot();
  try {
    const { sessionDir, deliveryDir, handle, env } = await setupBoundSession(root);
    mkdirSync(deliveryDir, { recursive: true });

    // 发布前:status 不得泄露交付路径
    const before = await runCli(['status', '--session-dir', sessionDir], env);
    assert.equal(before.code, 0, before.stderr || before.stdout);
    assert.equal(before.stdout.includes(deliveryDir), false, '发布前 status 不得包含交付路径');
    assert.equal(before.json.task.deliveryTarget.handle, handle);

    const published = await runCli([
      'publish', '--session-dir', sessionDir, '--delivery-handle', handle,
    ], env);
    assert.equal(published.code, 0, published.stderr || published.stdout);

    // 发布后:receipt 与 deliveryInput 必须照常披露路径,过度脱敏会破坏 SKILL.md 要求的交接
    assert.equal(published.json.delivery.requestedDirectory, deliveryDir);
    assert.equal(published.json.deliveryInput.directory, deliveryDir);

    const after = await runCli(['status', '--session-dir', sessionDir], env);
    assert.equal(after.code, 0, after.stderr || after.stdout);
    assert.equal(after.json.deliveryInput.directory, deliveryDir);
    assert.equal(after.json.task.deliveryTarget.requestedDirectory, undefined,
      'task.deliveryTarget 的脱敏在发布后仍然生效');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
