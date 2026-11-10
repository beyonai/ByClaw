import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');

test('parent skill pins auth recovery and tenant configuration to the released CLI', async () => {
  const source = await read('SKILL.md');
  assert.match(source, /1\.3\.4/);
  assert.match(source, /auth init --noninteractive --no-browser/);
  assert.match(source, /auth show --status/);
  assert.match(source, /WECOM_CLI_CONFIG_DIR/);
  assert.match(source, /connector-auth-sync\.mjs/);
  assert.doesNotMatch(source, /wecom-cli init|--no-open/);
});

test('contacts require explicit keywords and do not promise a full directory', async () => {
  const source = await read('wecomcli-contact/SKILL.md');
  assert.match(source, /contact users search --json/);
  assert.match(source, /keywords/);
  assert.doesNotMatch(source, /wecom-cli contact get_userlist/);
});

test('message routing distinguishes aibot access from enterprise-restricted chat history', async () => {
  const source = await read('wecomcli-msg/SKILL.md');
  assert.match(source, /message aibot sessions list/);
  assert.match(source, /message aibot send/);
  assert.match(source, /853006/);
  assert.match(source, /chat messages list/);
  assert.match(source, /WebSocket/);
  assert.match(source, /不是历史消息/);
  assert.match(source, /不得.*扫码/);
  assert.doesNotMatch(await read('SKILL.md'), /1\.3\.4 不提供.*消息历史接口/);
});

test('published 1.3.4 sheet commands are used, not unreleased main commands', async () => {
  assert.match(await read('wecomcli-sheet/SKILL.md'), /wecom-cli sheet get --json/);
  assert.match(await read('wecomcli-sheet/references/sheet-ranges-get.md'), /wecom-cli sheet ranges get --json/);
  const source = await read('wecomcli-shared/SKILL.md');
  assert.doesNotMatch(source, /npm install -g @wecom\/cli\s*$/m);
});

test('every copied skill inherits the ByClaw parent contract and has local reference targets', async () => {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('wecomcli-')) continue;
    const source = await read(`${entry.name}/SKILL.md`);
    assert.match(source, /\.\.\/SKILL\.md/, entry.name);
    for (const [, target] of source.matchAll(/\]\((references\/[^)#]+)(?:#[^)]*)?\)/g)) {
      assert.ok((await read(`${entry.name}/${target}`)).length, `${entry.name}/${target}`);
    }
  }
});
