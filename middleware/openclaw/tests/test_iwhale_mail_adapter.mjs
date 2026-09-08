import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { readFile, mkdtemp, writeFile, chmod, mkdir, lstat, stat, symlink, rename, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const adapterPath = join(root, 'bycli-adapters/mail.iwhalecloud.com/mail.js');
const run = promisify(execFile);

async function loadCommands() {
  const source = await readFile(adapterPath, 'utf8');
  globalThis.__iwhaleCommands = [];
  const transformed = source.replace(
    "import { cli, Strategy } from '@sovovs/bycli/registry';",
    "const Strategy = { COOKIE: 'cookie' }; const cli = (command) => globalThis.__iwhaleCommands.push(command);",
  ).replace(
    "import { ArgumentError } from '@sovovs/bycli/errors';",
    "class ArgumentError extends Error {};",
  );
  await import(`data:text/javascript;base64,${Buffer.from(transformed).toString('base64')}#${Date.now()}`);
  return new Map(globalThis.__iwhaleCommands.map((command) => [command.name, command]));
}

test('managed adapter uses the authoritative byCLI registry contract for probe and seven operations', async () => {
  const source = await readFile(adapterPath, 'utf8');
  assert.match(source, /@sovovs\/bycli\/registry/);
  assert.match(source, /@sovovs\/bycli\/errors/);
  assert.match(source, /\['probe', 'list', 'get', 'search', 'downloadAttachment', 'send', 'reply', 'delete'\]/);
  assert.match(source, /name:\s*operation/);
  assert.match(source, /access:\s*\['send', 'reply', 'delete'\]\.includes\(operation\)\s*\?\s*['"]write['"]/);
  assert.match(source, /navigateBefore:\s*['"]https:\/\/mail\.iwhalecloud\.com\/owa\/['"]/);
  assert.doesNotMatch(source, /--insecure|-k\b|cookie\s*:/i);
});

test('adapter restricts OWA calls to the fixed origin and does not serialize session material', async () => {
  const source = await readFile(adapterPath, 'utf8');
  assert.match(source, /https:\/\/mail\.iwhalecloud\.com\/owa\/service\.svc/);
  assert.doesNotMatch(source, /https?:\/\/["'`]\s*\+/);
  assert.match(source, /forbidden\s*=\s*\/cookie\|canary\|token/);
  assert.match(source, /document\.cookie/);
  assert.match(source, /openSync\(path, constants\.O_RDONLY \| constants\.O_NOFOLLOW\)/);
  assert.match(source, /fstatSync\(fd\)/);
  assert.match(source, /body\.getReader\(\)/);
  assert.match(source, /['"]X-OWA-CANARY['"]:\s*antiCsrf/);
  assert.doesNotMatch(source, /output\s*=\s*\{[^}]*antiCsrf/s);
});

test('adapter rejects nested session and credential material before browser dispatch', async () => {
  const commands = await loadCommands();
  const sandbox = await mkdtemp(join(tmpdir(), 'byclaw-iwhale-hostile-input-'));
  const input = join(sandbox, 'request.json');
  let evaluated = false;
  const page = { evaluate: async () => { evaluated = true; return {}; } };
  for (const hostile of [
    { draft: { metadata: { Password: 'secret' } } },
    { nested: [{ x_owa_canary: 'secret' }] },
    { nested: { authorizationToken: 'secret' } },
    { nested: { 'tоken': 'secret' } },
  ]) {
    await writeFile(input, JSON.stringify({ schemaVersion: 1, accountId: 'acct-1', folder: 'inbox', limit: 10, cursor: null, ...hostile }));
    await chmod(input, 0o600);
    await assert.rejects(commands.get('list').func(page, { input }), (error) => error?.constructor?.name === 'ArgumentError');
  }
  const symlinkInput = join(sandbox, 'request-link.json');
  await symlink(input, symlinkInput);
  await assert.rejects(commands.get('list').func(page, { input: symlinkInput }), (error) => error?.constructor?.name === 'ArgumentError');
  assert.equal(evaluated, false);
});

test('adapter fails closed when authenticated OWA mailbox does not match requested account', async () => {
  const commands = await loadCommands();
  const sandbox = await mkdtemp(join(tmpdir(), 'byclaw-iwhale-mailbox-mismatch-'));
  const input = join(sandbox, 'request.json');
  await writeFile(input, JSON.stringify({ schemaVersion: 1, accountId: 'account-b', accountEmail: 'b@example.test', folder: 'inbox', limit: 10, cursor: null }));
  await chmod(input, 0o600);
  const actions = [];
  const page = { evaluate: async (program) => Function('location', 'document', 'fetch', 'TextEncoder', 'TextDecoder', 'btoa', 'atob', `return ${program}`)(
    { origin: 'https://mail.iwhalecloud.com', pathname: '/owa/' }, { cookie: 'X-OWA-CANARY=private-canary' },
    async (_url, options) => {
      actions.push(options.headers.Action);
      const message = { __type: 'GetFolderResponseMessage:#Exchange', ResponseClass: 'Error', ResponseCode: 'ErrorNonPrimarySmtpAddress' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ Body: { ResponseMessages: { Items: [message] } } }) };
    }, TextEncoder, TextDecoder, btoa, atob) };
  assert.equal((await commands.get('list').func(page, { input })).error.code, 'AUTH_REQUIRED');
  assert.deepEqual(actions, ['GetFolder']);
});

test('production OWA response codes return sanitized stable JSON errors', async () => {
  const commands = await loadCommands();
  const sandbox = await mkdtemp(join(tmpdir(), 'byclaw-iwhale-errors-'));
  const input = join(sandbox, 'request.json');
  await writeFile(input, JSON.stringify({ schemaVersion: 1, accountId: 'acct-1', accountEmail: 'user@example.test', folder: 'inbox', limit: 10, cursor: null }));
  await chmod(input, 0o600);
  for (const [responseCode, expected, backoff] of [
    ['ErrorAccessDenied', 'PERMISSION_DENIED', null],
    ['ErrorServerBusy', 'RATE_LIMITED', 2500],
    ['ErrorMailboxStoreUnavailable', 'UPSTREAM_UNAVAILABLE', null],
    ['ErrorInvalidCredentials', 'AUTH_REQUIRED', null],
    ['ErrorPasswordExpired', 'AUTH_EXPIRED', null],
    ['ErrorSomethingNew', 'UPSTREAM_UNAVAILABLE', null],
  ]) {
    const page = { evaluate: async (program) => vm.runInNewContext(program, {
      location: { origin: 'https://mail.iwhalecloud.com', pathname: '/owa/' },
      document: { cookie: 'X-OWA-CANARY=private-canary' }, TextEncoder, TextDecoder, btoa, atob,
      fetch: async (_url, options) => {
        const action = options.headers.Action;
        const message = { __type: `${action}ResponseMessage:#Exchange`, ResponseClass: 'Error', ResponseCode: responseCode,
          MessageText: 'cookie=private-canary', BackOffMilliseconds: backoff };
        return { ok: true, status: 200, text: async () => JSON.stringify({ Body: { ResponseMessages: { Items: [message] } } }) };
      },
    }) };
    const result = await commands.get('list').func(page, { input });
    assert.equal(result.error.code, expected);
    assert.equal(JSON.stringify(result).includes('private-canary'), false);
    if (backoff) assert.equal(result.error.retryAfterMs, backoff);
  }
});

test('all seven commands issue fixed OWA service actions and normalize fixture results', async () => {
  const commands = await loadCommands();
  const sandbox = await mkdtemp(join(tmpdir(), 'byclaw-iwhale-adapter-'));
  const input = join(sandbox, 'request.json');
  const calls = [];
  let responseBody;
  const page = {
    evaluate(program) {
      return vm.runInNewContext(program, {
        location: { origin: 'https://mail.iwhalecloud.com', pathname: '/owa/' },
        document: { cookie: 'X-OWA-CANARY=private-canary' },
        TextEncoder, TextDecoder, btoa, atob,
        fetch: async (url, options) => {
          calls.push({ url, options });
          const action = options.headers.Action;
          let message = responseBody;
          if (action === 'GetFolder') message = { ResponseClass: 'Success', ResponseCode: 'NoError', Folders: [{ FolderId: { Id: 'root', ChangeKey: 'root-ck' } }] };
          else if (action === 'SendItem') message = { ResponseClass: 'Success', ResponseCode: 'NoError' };
          else if (action === 'GetItem' && responseBody.Attachments) message = { ResponseClass: 'Success', ResponseCode: 'NoError', Items: [{ ItemId: { Id: 'item-1', ChangeKey: 'ck-1' }, Attachments: [{ AttachmentId: { Id: 'att-1' } }] }] };
          message = { __type: `${action}ResponseMessage:#Exchange`, ...message };
          return { ok: true, status: 200, text: async () => JSON.stringify({ Body: { ResponseMessages: { Items: [message] } } }) };
        },
      });
    },
  };
  const invoke = async (operation, request, body) => {
    responseBody = { ResponseClass: 'Success', ResponseCode: 'NoError', ...body };
    await writeFile(input, JSON.stringify({ schemaVersion: 1, accountId: 'acct-1', accountEmail: 'user@example.test', ...request }));
    await chmod(input, 0o600);
    return commands.get(operation).func(page, { input });
  };
  const item = { ItemId: { Id: 'item-1', ChangeKey: 'ck-1' }, Subject: 'Subject', From: { Mailbox: { EmailAddress: 'sender@example.test' } }, HasAttachments: true };
  const listed = await invoke('list', { folder: 'inbox', limit: 10, cursor: null }, { RootFolder: { Items: [item], IncludesLastItemInRange: true } });
  assert.equal(listed.items.length, 1);
  const messageId = listed.items[0].messageId;
  await invoke('search', { query: 'from:sender@example.test', limit: 10, cursor: null }, { RootFolder: { Items: [item], IncludesLastItemInRange: true } });
  const got = await invoke('get', { messageId }, { Items: [{ ...item, Body: { BodyType: 'Text', Value: 'body' }, Attachments: [{ AttachmentId: { Id: 'att-1' }, Name: 'a.txt', Size: 7, ContentType: 'text/plain' }] }] });
  assert.equal(got.text, 'body');
  await invoke('downloadAttachment', { messageId, attachmentId: got.attachments[0].attachmentId }, { Attachments: [{ AttachmentId: { Id: 'att-1' }, Name: 'a.txt', ContentType: 'text/plain', Content: 'cGF5bG9hZA==' }] });
  const draft = { to: ['to@example.test'], cc: [], bcc: [], subject: 'S', text: 'B', html: null };
  const sent = await invoke('send', { draft }, { Items: [{ ItemId: { Id: 'draft-send', ChangeKey: 'send-ck' } }] });
  const replied = await invoke('reply', { messageId, draft }, { Items: [{ ItemId: { Id: 'draft-reply', ChangeKey: 'reply-ck' } }] });
  assert.equal(JSON.stringify(sent.messageId), JSON.stringify({ id: 'draft-send', changeKey: 'send-ck' }));
  assert.equal(JSON.stringify(replied.messageId), JSON.stringify({ id: 'draft-reply', changeKey: 'reply-ck' }));
  await invoke('delete', { messageId }, { Items: [{ ItemId: { Id: 'trash-1', ChangeKey: 'trash-ck' } }] });
  assert.deepEqual(calls.map((call) => call.options.headers.Action), [
    'GetFolder', 'FindItem', 'GetFolder', 'FindItem', 'GetFolder', 'GetItem',
    'GetFolder', 'GetItem', 'GetAttachment', 'GetFolder', 'CreateItem', 'SendItem',
    'GetFolder', 'CreateItem', 'SendItem', 'GetFolder', 'MoveItem',
  ]);
  const createBodies = calls.filter((call) => call.options.headers.Action === 'CreateItem').map((call) => JSON.parse(call.options.body).Body);
  assert.equal(createBodies.every((body) => body.MessageDisposition === 'SaveOnly'), true);
  assert.equal(calls.every((call) => call.url.startsWith('https://mail.iwhalecloud.com/owa/service.svc?')), true);
  assert.equal(calls.every((call) => call.options.headers['X-OWA-CANARY'] === 'private-canary'), true);
  assert.equal(JSON.stringify([listed, got]).includes('private-canary'), false);
  assert.equal(JSON.stringify(messageId), JSON.stringify({ id: 'item-1', changeKey: 'ck-1' }));
  assert.equal(got.attachments[0].attachmentId, 'att-1');
});

test('bootstrap installs only the managed adapter idempotently and rejects symlink target', async () => {
  const script = await readFile(join(root, 'start-opencli.sh'), 'utf8');
  assert.match(script, /"mail\.iwhalecloud\.com"/);
  assert.match(script, /"byclaw-mail\.js"/);
  assert.match(script, /bycli-adapters\/mail\.iwhalecloud\.com\/mail\.js/);
  assert.match(script, /os\.rename/);
  assert.match(script, /O_NOFOLLOW/);
  assert.match(script, /dir_fd/);
  assert.match(script, /BYCLI_TRUSTED_GID/);
  assert.match(script, /0o2770/);
  assert.doesNotMatch(script, /0o777|chmod a\+rwx/);
  assert.doesNotMatch(script, /rm\s+-rf/);
  const dockerfile = await readFile(join(root, 'Dockerfile.byclaw'), 'utf8');
  assert.match(dockerfile, /bycli-adapters\/mail\.iwhalecloud\.com\/mail\.js/);
});

test('bootstrap execution preserves unrelated adapters and installs the managed file privately', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'byclaw-iwhale-bootstrap-'));
  const config = join(sandbox, 'config');
  const bin = join(sandbox, 'bin');
  await mkdir(join(config, 'clis', 'other.example'), { recursive: true });
  await mkdir(bin);
  await writeFile(join(config, 'clis', 'other.example', 'keep.js'), 'keep');
  const fakeBycli = join(bin, 'bycli');
  await writeFile(fakeBycli, '#!/bin/sh\nif [ "$1" = "profile" ] && [ "$2" = "list" ]; then printf "x openclaw connected\\n"; fi\nexit 0\n');
  await chmod(fakeBycli, 0o700);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    OPENCLAW_BOOTSTRAPPED: '1',
    OPENCLAW_ENABLE_OPENCLI: 'true',
    OPENCLI_PROFILE_WATCH: 'false',
    BYCLI_CONFIG_DIR: config,
    BYCLAW_MAIL_ADAPTER_SOURCE: adapterPath,
  };
  const script = join(root, 'start-opencli.sh');
  await run(script, { env });
  await run(script, { env });
  const installed = join(config, 'clis', 'mail.iwhalecloud.com', 'byclaw-mail.js');
  assert.equal(await readFile(installed, 'utf8'), await readFile(adapterPath, 'utf8'));
  assert.equal((await stat(installed)).mode & 0o777, 0o640);
  assert.equal((await stat(join(config, 'clis'))).mode & 0o2777, 0o2770);
  assert.equal((await stat(join(config, 'clis', 'mail.iwhalecloud.com'))).mode & 0o2777, 0o2770);
  assert.equal(await readFile(join(config, 'clis', 'other.example', 'keep.js'), 'utf8'), 'keep');

  const victim = join(sandbox, 'victim');
  await writeFile(victim, 'untouched');
  const hostileConfig = join(sandbox, 'hostile');
  await mkdir(join(hostileConfig, 'clis', 'mail.iwhalecloud.com'), { recursive: true });
  await symlink(victim, join(hostileConfig, 'clis', 'mail.iwhalecloud.com', 'byclaw-mail.js'));
  await assert.rejects(run(script, { env: { ...env, BYCLI_CONFIG_DIR: hostileConfig } }));
  assert.equal(await readFile(victim, 'utf8'), 'untouched');

  const ancestorVictim = join(sandbox, 'ancestor-victim');
  await mkdir(ancestorVictim);
  const ancestorConfig = join(sandbox, 'ancestor-hostile');
  await mkdir(ancestorConfig);
  await symlink(ancestorVictim, join(ancestorConfig, 'clis'));
  await assert.rejects(run(script, { env: { ...env, BYCLI_CONFIG_DIR: ancestorConfig } }));
  await assert.rejects(stat(join(ancestorVictim, 'mail.iwhalecloud.com')));

  const rootLink = join(sandbox, 'config-root-link');
  await symlink(ancestorVictim, rootLink);
  await assert.rejects(run(script, { env: { ...env, BYCLI_CONFIG_DIR: rootLink } }));
  await assert.rejects(stat(join(ancestorVictim, 'clis')));
});

test('bootstrap remains anchored when configuration root is replaced during install', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'byclaw-iwhale-root-race-'));
  const config = join(sandbox, 'config');
  const parked = join(sandbox, 'parked-config');
  const victim = join(sandbox, 'victim');
  const bin = join(sandbox, 'bin');
  const largeSource = join(sandbox, 'managed.js');
  await mkdir(join(config, 'clis', 'mail.iwhalecloud.com'), { recursive: true });
  await mkdir(victim);
  await mkdir(bin);
  await writeFile(largeSource, Buffer.alloc(16 * 1024 * 1024, 0x61));
  const fakeBycli = join(bin, 'bycli');
  await writeFile(fakeBycli, '#!/bin/sh\nif [ "$1" = "profile" ] && [ "$2" = "list" ]; then printf "x openclaw connected\\n"; fi\nexit 0\n');
  await chmod(fakeBycli, 0o700);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, OPENCLAW_BOOTSTRAPPED: '1',
    OPENCLAW_ENABLE_OPENCLI: 'true', OPENCLI_PROFILE_WATCH: 'false', BYCLI_CONFIG_DIR: config,
    BYCLAW_MAIL_ADAPTER_SOURCE: largeSource };
  const running = run(join(root, 'start-opencli.sh'), { env });
  let swapped = false;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const entries = await readdir(join(config, 'clis', 'mail.iwhalecloud.com')).catch(() => []);
    if (entries.some((name) => name.startsWith('.byclaw-mail.'))) {
      await rename(config, parked);
      await symlink(victim, config);
      swapped = true;
      break;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
  }
  await running;
  assert.equal(swapped, true);
  assert.equal((await stat(join(parked, 'clis', 'mail.iwhalecloud.com', 'byclaw-mail.js'))).size, 16 * 1024 * 1024);
  await assert.rejects(stat(join(victim, 'clis')));
});
