import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile, mkdir, chmod, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const directory = path.dirname(fileURLToPath(import.meta.url));
const extractor = path.join(directory, 'extract-desktop-viewer.mjs');
const resources = path.join(directory, 'v1');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function tar(entries) {
  const chunks = [];
  for (const [name, bytes, type = '0', link = ''] of entries) {
    const header = Buffer.alloc(512);
    const octal = (value, width) => `${value.toString(8).padStart(width - 1, '0')}\0`;
    header.write(name, 0, 100); header.write(octal(0o644, 8), 100); header.write(octal(0, 8), 108);
    header.write(octal(0, 8), 116); header.write(octal(bytes.length, 12), 124); header.write(octal(0, 12), 136);
    header.fill(32, 148, 156); header.write(type, 156); header.write(link, 157, 100);
    header.write('ustar\0', 257); header.write('00', 263);
    const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
    chunks.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]), { level: 9 });
}

async function fixture(change = () => {}) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'desktop-image-extract-test-'));
  const folder = path.join(temporary, 'middleware/byclaw-harness/browser/desktop-viewer');
  await mkdir(folder, { recursive: true });
  await cp(extractor, path.join(folder, 'extract-desktop-viewer.mjs'));
  const lock = JSON.parse(await readFile(path.join(directory, 'desktop-viewer.lock.json'), 'utf8'));
  const entries = [];
  for (const name of Object.keys(lock.files)) entries.push([name, await readFile(path.join(resources, name))]);
  entries.push(['source.json', Buffer.from(`${JSON.stringify(lock.sourceMetadata.value, null, 2)}\n`)]);
  change(entries, lock);
  const archive = tar(entries);
  lock.approvedSourceArchive.sha256 = sha256(archive); lock.approvedSourceArchive.bytes = archive.length;
  await writeFile(path.join(folder, 'desktop-viewer.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  const archivePath = path.join(temporary, 'source.tgz'); await writeFile(archivePath, archive);
  const run = (options = [], env = {}) => spawnSync(process.execPath,
    ['--experimental-vm-modules', path.join(folder, 'extract-desktop-viewer.mjs'), ...options],
    { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, ...env } });
  return { temporary, folder, lock, archivePath, run, cleanup: () => rm(temporary, { recursive: true, force: true }) };
}

test('tampered source archive is rejected before changing packaged resources', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'desktop-image-tamper-'));
  try {
    const archive = path.join(temporary, 'invalid.tgz'); await writeFile(archive, 'changed-source');
    const before = await readFile(path.join(resources, 'manifest.json'));
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', extractor, '--source-archive', archive], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Approved source archive integrity mismatch/);
    assert.deepEqual(await readFile(path.join(resources, 'manifest.json')), before);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('original image assets and licenses match the fixed lock and versioned manifest', async () => {
  const manifest = JSON.parse(await readFile(path.join(resources, 'manifest.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(directory, 'desktop-viewer.lock.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.entry, 'core/rfb.js');
  assert.equal(manifest.source.image.reference, '192.168.0.81:8080/byclaw/byclaw-harness@sha256:1868e6a58ca1efce6b01740dd88439bc77e6d739a4afa82885b7dd3ef197446f');
  assert.equal(manifest.source.image.platform, 'linux/amd64');
  assert.equal(manifest.source.image.packageVersion, '1:1.6.0-2');
  assert.deepEqual(manifest.files, lock.files);
  assert.equal(manifest.publicAssets.length, 52);
  assert.deepEqual(manifest.publicAssets, Object.keys(lock.files).filter((name) => name.endsWith('.js')).sort());
  for (const [name, expected] of Object.entries(lock.files)) {
    const bytes = await readFile(path.join(resources, name));
    assert.equal(bytes.length, expected.bytes, name); assert.equal(sha256(bytes), expected.sha256, name);
  }
  assert.equal(lock.files['core/rfb.js'].sha256, '563a8c8469dfb55d1deee05262a311637d0e6fe8f65ae34c8222ee22e34e8a93');
  assert.deepEqual((await readdir(resources)).sort(), ['core', 'licenses', 'manifest.json', 'vendor']);
});

test('the complete original ESM graph links and evaluates to a real RFB constructor', async () => {
  const manifest = JSON.parse(await readFile(path.join(resources, 'manifest.json'), 'utf8'));
  const element = () => ({ style: {}, appendChild() {}, remove() {}, getContext: () => null,
    getBoundingClientRect: () => ({ width: 0, height: 0 }) });
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {}, debug() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    WebSocket: class { static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3; },
    setTimeout() {}, clearTimeout() {}, navigator: { platform: 'Linux', userAgent: 'desktop-image-test' },
    document: { documentElement: {}, body: element(), createElement: element },
    window: { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, isSecureContext: true } });
  const cache = new Map();
  for (const name of manifest.publicAssets) {
    const source = await readFile(path.join(resources, name), 'utf8');
    cache.set(name, new vm.SourceTextModule(source, { context, identifier: name,
      importModuleDynamically() { throw new Error('No dynamic source loading'); } }));
  }
  const entry = cache.get('core/rfb.js'); assert.ok(entry);
  await entry.link((specifier, parent) => {
    assert.match(specifier, /^\.\.?\//);
    const name = path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier), specifier));
    assert.ok(manifest.publicAssets.includes(name), `${parent.identifier}: ${specifier}`);
    return cache.get(name);
  });
  await entry.evaluate();
  assert.equal(typeof entry.namespace.default, 'function');
  assert.equal(typeof entry.namespace.default.prototype.disconnect, 'function');
  assert.equal(typeof entry.namespace.default.prototype.sendCredentials, 'function');
});

test('offline extraction and check work from another working directory without Docker', async () => {
  const state = await fixture();
  try {
    const built = state.run(['--source-archive', state.archivePath]); assert.equal(built.status, 0, built.stderr);
    const checked = state.run(['--check', '--source-archive', state.archivePath]); assert.equal(checked.status, 0, checked.stderr);
    await writeFile(path.join(state.folder, 'v1', 'extra.html'), '<script>untrusted</script>');
    const extra = state.run(['--check', '--source-archive', state.archivePath]);
    assert.equal(extra.status, 1); assert.match(extra.stderr, /Artifact inventory mismatch/);
  } finally { await state.cleanup(); }
});

async function fakeDocker(state, options = {}) {
  const bin = path.join(state.temporary, 'bin'); await mkdir(bin);
  const source = path.join(state.temporary, 'docker-source'); await cp(resources, source, { recursive: true });
  await writeFile(path.join(source, 'package-status'), `Package: novnc\nStatus: install ok installed\nVersion: ${options.version || state.lock.image.packageVersion}\n\n`);
  if (options.symlink) await symlink('/outside-root.js', path.join(source, 'core/unselected-link.js'));
  const log = path.join(state.temporary, 'docker-calls.jsonl');
  const image = { RepoDigests: [state.lock.image.reference], Os: 'linux', Architecture: 'amd64',
    Id: `sha256:${'a'.repeat(64)}`, ...options.image };
  const executable = path.join(bin, 'docker');
  await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path'); const args = process.argv.slice(2);
fs.appendFileSync(process.env.DESKTOP_FIXTURE_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'image' && args[1] === 'inspect') {
  if (process.env.DESKTOP_FIXTURE_MISSING) { console.error('No such image'); process.exit(1); }
  process.stdout.write(JSON.stringify([JSON.parse(process.env.DESKTOP_FIXTURE_IMAGE)]));
} else if (args[0] === 'create') process.stdout.write('c'.repeat(64));
else if (args[0] === 'cp') {
  if (process.env.DESKTOP_FIXTURE_FAIL_CP) { console.error('fixture copy failed'); process.exit(2); }
  const absolute = args[1].slice(args[1].indexOf(':') + 1);
  let source;
  if (absolute.startsWith('/opt/byclaw/novnc/')) source = path.join(process.env.DESKTOP_FIXTURE_ROOT, absolute.slice('/opt/byclaw/novnc/'.length).replace(/\\/\\.$/, ''));
  else if (absolute === '/usr/share/doc/novnc/copyright') source = path.join(process.env.DESKTOP_FIXTURE_ROOT, 'licenses/copyright');
  else if (absolute === '/usr/share/common-licenses/MPL-2.0') source = path.join(process.env.DESKTOP_FIXTURE_ROOT, 'licenses/MPL-2.0');
  else if (absolute === '/var/lib/dpkg/status') source = path.join(process.env.DESKTOP_FIXTURE_ROOT, 'package-status');
  else throw new Error('Unexpected Docker source: ' + absolute);
  fs.cpSync(source, args[2], { recursive: true, dereference: false });
} else if (args[0] !== 'rm') throw new Error('Unexpected Docker operation: ' + args.join(' '));
`);
  await chmod(executable, 0o755);
  return { env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, DESKTOP_FIXTURE_ROOT: source,
    DESKTOP_FIXTURE_LOG: log, DESKTOP_FIXTURE_IMAGE: JSON.stringify(image),
    DESKTOP_FIXTURE_FAIL_CP: options.failCopy ? '1' : '', DESKTOP_FIXTURE_MISSING: options.missing ? '1' : '' },
    calls: async () => (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)) };
}

test('Docker extraction uses only the pinned stopped image and removes its container', async () => {
  const state = await fixture();
  try {
    const docker = await fakeDocker(state); const result = state.run([], docker.env);
    assert.equal(result.status, 0, result.stderr);
    const calls = await docker.calls();
    assert.deepEqual(calls[0], ['image', 'inspect', state.lock.image.reference]);
    assert.deepEqual(calls[1], ['create', '--pull=never', '--network', 'none', '--platform', 'linux/amd64', state.lock.image.reference]);
    assert.deepEqual(calls.at(-1), ['rm', '-v', 'c'.repeat(64)]);
    assert.ok(calls.every((args) => !['pull', 'run', 'start'].includes(args[0])));
    assert.equal(JSON.parse(await readFile(path.join(state.folder, 'v1/manifest.json'))).publicAssets.length, 52);
  } finally { await state.cleanup(); }
});

for (const [label, options, message, created] of [
  ['wrong RepoDigest', { image: { RepoDigests: ['registry.invalid/image@sha256:' + '0'.repeat(64)] } }, /Image RepoDigest mismatch/, false],
  ['wrong architecture', { image: { Architecture: 'arm64' } }, /Image platform mismatch/, false],
  ['missing fixed image', { missing: true }, /No such image/, false],
  ['copy failure', { failCopy: true }, /fixture copy failed/, true],
  ['source symlink', { symlink: true }, /Symlink source is not permitted/, true],
  ['wrong package version', { version: 'unapproved' }, /Image package version mismatch/, true],
]) {
  test(`Docker source rejects ${label} without pulling or starting a container`, async () => {
    const state = await fixture();
    try {
      const docker = await fakeDocker(state, options); const result = state.run([], docker.env);
      assert.equal(result.status, 1); assert.match(result.stderr, message);
      const calls = await docker.calls();
      assert.ok(calls.every((args) => !['pull', 'run', 'start'].includes(args[0])));
      assert.equal(calls.some((args) => args[0] === 'create'), created);
      if (created) assert.deepEqual(calls.at(-1), ['rm', '-v', 'c'.repeat(64)]);
      await assert.rejects(readFile(path.join(state.folder, 'v1/manifest.json')), { code: 'ENOENT' });
    } finally { await state.cleanup(); }
  });
}

for (const [label, mutate, message] of [
  ['traversal', (entries) => entries.push(['../outside.js', Buffer.from('no')]), /Unsafe archive path/],
  ['absolute', (entries) => entries.push(['/outside.js', Buffer.from('no')]), /Unsafe archive path/],
  ['duplicate', (entries) => entries.push([...entries[0]]), /Duplicate archive member/],
  ['symlink', (entries) => entries.push(['core/link.js', Buffer.alloc(0), '2', '../outside']), /Unsupported archive member type/],
  ['hardlink', (entries) => entries.push(['core/link.js', Buffer.alloc(0), '1', 'core/rfb.js']), /Unsupported archive member type/],
  ['PAX', (entries) => entries.push(['extended', Buffer.from('path=outside'), 'x']), /Unsupported archive member type/],
  ['sparse', (entries) => entries.push(['sparse', Buffer.alloc(0), 'S']), /Unsupported archive member type/],
  ['missing module', (entries) => entries.splice(entries.findIndex(([name]) => name === 'core/rfb.js'), 1), /Source inventory mismatch/],
  ['modified module', (entries) => { entries.find(([name]) => name === 'core/rfb.js')[1] = Buffer.from('export default class Evil {}'); }, /Source file integrity mismatch/],
  ['oversized decoded archive', (entries) => entries.push(['bomb', Buffer.alloc(17 * 1024 * 1024)]), /Invalid or oversized approved source archive/],
  ['changed image metadata', (entries, lock) => {
    const entry = entries.find(([name]) => name === 'source.json'); const metadata = JSON.parse(entry[1]);
    metadata.image.reference = 'registry.invalid/other@sha256:' + '0'.repeat(64); entry[1] = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
    lock.sourceMetadata.sha256 = sha256(entry[1]); lock.sourceMetadata.bytes = entry[1].length;
  }, /Source image metadata mismatch/],
]) {
  test(`approved malformed fixture rejects ${label} before publishing resources`, async () => {
    const state = await fixture(mutate);
    try {
      const result = state.run(['--source-archive', state.archivePath]);
      assert.equal(result.status, 1); assert.match(result.stderr, message);
      await assert.rejects(readFile(path.join(state.folder, 'v1/manifest.json')), { code: 'ENOENT' });
    } finally { await state.cleanup(); }
  });
}

for (const [label, source, expected] of [
  ['remote import', "import client from 'https://outside.invalid/rfb.js'; export default client;", /Unsafe module import/],
  ['escaped import', "import client from '../../../outside.js'; export default client;", /Missing or escaped module/],
  ['missing import', "import client from './missing.js'; export default client;", /Missing or escaped module/],
  ['dynamic loading', "export default () => import('./other.js');", /Dynamic source loading is not supported/],
]) {
  test(`approved module fixture rejects ${label}`, async () => {
    const state = await fixture((entries, lock) => {
      const entry = entries.find(([name]) => name === 'core/rfb.js'); entry[1] = Buffer.from(source);
      lock.files['core/rfb.js'] = { sha256: sha256(entry[1]), bytes: entry[1].length };
    });
    try {
      const result = state.run(['--source-archive', state.archivePath]);
      assert.equal(result.status, 1); assert.match(result.stderr, expected);
      await assert.rejects(readFile(path.join(state.folder, 'v1/manifest.json')), { code: 'ENOENT' });
    } finally { await state.cleanup(); }
  });
}
