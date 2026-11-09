#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const root = path.resolve(scriptDir, '../../../..');
const lockPath = path.join(scriptDir, 'desktop-viewer.lock.json');
const outputDir = path.join(scriptDir, 'v1');
const maximumBytes = 16 * 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safePath = (name) => typeof name === 'string' && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(name)
  && name.split('/').every((part) => part !== '.' && part !== '..');
const publicPath = (name) => safePath(name) && /^(?:core|vendor)\/.+\.js$/.test(name);
const assetPath = (name) => publicPath(name) || (safePath(name) && /^licenses\/[^/]+$/.test(name));

function octal(header, start, size) {
  const value = header.subarray(start, start + size).toString('ascii').replace(/[\0 ]+$/g, '').trim();
  assert.match(value, /^[0-7]+$/, 'Unsupported archive numeric field');
  const number = Number.parseInt(value, 8);
  assert.ok(Number.isSafeInteger(number), 'Invalid archive size');
  return number;
}

// Only the small, controlled regular-file USTAR subset is accepted. Nothing is extracted by tar or a shell.
function archiveFiles(compressed) {
  let bytes;
  try { bytes = gunzipSync(compressed, { maxOutputLength: maximumBytes }); }
  catch { throw new Error('Invalid or oversized approved source archive'); }
  assert.ok(bytes.length % 512 === 0, 'Invalid archive block size');
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      assert.ok(bytes.length - offset >= 1024 && bytes.subarray(offset).every((byte) => byte === 0), 'Invalid archive terminator');
      return files;
    }
    const text = (start, size) => {
      const field = header.subarray(start, start + size);
      assert.ok(field.every((byte) => byte < 128), 'Non-ASCII archive header');
      return field.toString('ascii').split('\0')[0];
    };
    assert.equal(text(257, 6), 'ustar', 'Only USTAR source archives are supported');
    assert.equal(text(263, 2), '00', 'Only USTAR source archives are supported');
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(octal(header, 148, 8), checksum, 'Invalid archive header checksum');
    const prefix = text(345, 155);
    const name = (prefix ? `${prefix}/` : '') + text(0, 100);
    assert.ok(safePath(name), `Unsafe archive path: ${name}`);
    assert.ok(!files.has(name), `Duplicate archive member: ${name}`);
    assert.ok(header[156] === 0 || header[156] === 48, `Unsupported archive member type: ${name}`);
    assert.equal(text(157, 100), '', 'Archive link targets are not permitted');
    const size = octal(header, 124, 12);
    assert.ok(size <= maximumBytes && offset + 512 + size <= bytes.length, 'Invalid archive member size');
    files.set(name, bytes.subarray(offset + 512, offset + 512 + size));
    assert.ok(files.size <= 256, 'Too many archive members');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Missing archive terminator');
}

function validateLock(lock) {
  assert.equal(lock.schemaVersion, 2, 'Unsupported desktop source lock');
  assert.equal(lock.artifactVersion, 'v1'); assert.equal(lock.entry, 'core/rfb.js');
  assert.match(lock.image.manifestDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(lock.image.reference.endsWith(`@${lock.image.manifestDigest}`)
    && /^[A-Za-z0-9][A-Za-z0-9.:/_-]+@sha256:[a-f0-9]{64}$/.test(lock.image.reference), 'Immutable image digest required');
  assert.equal(lock.image.platform, 'linux/amd64'); assert.equal(lock.image.os, 'linux'); assert.equal(lock.image.architecture, 'amd64');
  assert.equal(lock.image.originalRoot, '/opt/byclaw/novnc'); assert.equal(lock.image.packageName, 'novnc');
  assert.equal(lock.image.packageStatusPath, '/var/lib/dpkg/status');
  assert.deepEqual(lock.image.copyrightSources, { 'licenses/copyright': '/usr/share/doc/novnc/copyright',
    'licenses/MPL-2.0': '/usr/share/common-licenses/MPL-2.0' });
  assert.ok(Object.keys(lock.files).length <= 128 && lock.files[lock.entry], 'Invalid locked asset list');
  for (const [name, expected] of Object.entries(lock.files)) {
    assert.ok(assetPath(name), `Unsafe locked asset: ${name}`); assert.match(expected.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(expected.bytes) && expected.bytes > 0 && expected.bytes <= maximumBytes);
  }
  assert.match(lock.approvedSourceArchive.sha256, /^[a-f0-9]{64}$/);
  assert.ok(lock.approvedSourceArchive.bytes > 0 && lock.approvedSourceArchive.bytes <= maximumBytes);
}

function validateFiles(files, lock) {
  assert.deepEqual([...files.keys()].sort(), [...Object.keys(lock.files), 'source.json'].sort(), 'Source inventory mismatch');
  const metadataBytes = files.get('source.json');
  assert.ok(metadataBytes.length === lock.sourceMetadata.bytes && sha256(metadataBytes) === lock.sourceMetadata.sha256,
    'Source metadata integrity mismatch');
  let metadata;
  try { metadata = JSON.parse(metadataBytes); } catch { throw new Error('Invalid source metadata'); }
  assert.deepEqual(metadata.image, lock.image, 'Source image metadata mismatch');
  assert.deepEqual(metadata, lock.sourceMetadata.value, 'Source receipt metadata mismatch');
  for (const [name, expected] of Object.entries(lock.files)) {
    const value = files.get(name);
    assert.ok(value.length === expected.bytes && sha256(value) === expected.sha256, `Source file integrity mismatch: ${name}`);
  }
}

function moduleClosure(files, lock) {
  assert.equal(typeof vm.SourceTextModule, 'function', 'Run node with --experimental-vm-modules');
  const names = Object.keys(lock.files).filter(publicPath).sort();
  const modules = new Map();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (const name of names) {
    const source = decoder.decode(files.get(name));
    assert.doesNotMatch(source,
      /\b(?:import\s*\(|require\s*\(|eval\s*\(|new\s+(?:Function|Worker|SharedWorker)\s*\(|WebAssembly\b)/,
      `Dynamic source loading is not supported: ${name}`);
    // Compilation only. Never evaluate code copied from an image while generating the artifact.
    modules.set(name, new vm.SourceTextModule(source, { identifier: name }));
  }
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    const module = modules.get(name); assert.ok(module, `Missing module: ${name}`); seen.add(name);
    for (const specifier of module.dependencySpecifiers) {
      assert.ok(/^\.\.?\//.test(specifier) && /^[A-Za-z0-9_./-]+\.js$/.test(specifier), `Unsafe module import: ${name}: ${specifier}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
      assert.ok(publicPath(target) && modules.has(target), `Missing or escaped module: ${name}: ${specifier}`);
      visit(target);
    }
  };
  visit(lock.entry);
  assert.deepEqual([...seen].sort(), names, 'Locked JS inventory is not the reachable module closure');
  return names;
}

async function regularTree(folder, prefix = '') {
  const result = new Map();
  const visit = async (current, relative) => {
    const metadata = await lstat(current);
    assert.ok(!metadata.isSymbolicLink(), `Symlink source is not permitted: ${relative}`);
    if (metadata.isDirectory()) {
      for (const name of (await readdir(current)).sort()) await visit(path.join(current, name), relative ? `${relative}/${name}` : name);
    } else {
      assert.ok(metadata.isFile() && metadata.nlink === 1 && metadata.size <= maximumBytes, `Non-regular or oversized source: ${relative}`);
      result.set(relative, await readFile(current));
    }
  };
  await visit(folder, prefix); return result;
}

function docker(args, encoding = 'utf8') {
  return execFileSync('docker', args, { encoding, timeout: 60000, maxBuffer: maximumBytes, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function dockerFiles(lock) {
  const inspected = JSON.parse(docker(['image', 'inspect', lock.image.reference]));
  assert.ok(Array.isArray(inspected) && inspected.length === 1, 'Image inspection failed');
  const image = inspected[0];
  assert.ok(Array.isArray(image.RepoDigests) && image.RepoDigests.includes(lock.image.reference), 'Image RepoDigest mismatch');
  assert.ok(image.Os === lock.image.os && image.Architecture === lock.image.architecture, 'Image platform mismatch');
  // Docker .Id differs between engine image stores. The fixed RepoDigest/platform and original file hashes are the identity/content checks.
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'desktop-fixed-image-'));
  let container;
  try {
    container = docker(['create', '--pull=never', '--network', 'none', '--platform', lock.image.platform, lock.image.reference]).trim();
    assert.match(container, /^[a-f0-9]{12,64}$/, 'Invalid created container identity');
    for (const name of ['core', 'vendor']) {
      const destination = path.join(temporary, name); await mkdir(destination);
      docker(['cp', `${container}:${lock.image.originalRoot}/${name}/.`, destination]);
    }
    await mkdir(path.join(temporary, 'licenses'));
    for (const [name, source] of Object.entries(lock.image.copyrightSources)) docker(['cp', `${container}:${source}`, path.join(temporary, name)]);
    docker(['cp', `${container}:${lock.image.packageStatusPath}`, path.join(temporary, 'package-status')]);
    const packageStatus = await readFile(path.join(temporary, 'package-status'), 'utf8');
    const packageEntry = packageStatus.split(/\r?\n\r?\n/).find((entry) => entry.split(/\r?\n/).includes('Package: novnc'));
    assert.ok(packageEntry && packageEntry.split(/\r?\n/).includes(`Version: ${lock.image.packageVersion}`)
      && packageEntry.split(/\r?\n/).includes('Status: install ok installed'), 'Image package version mismatch');
    const tree = await regularTree(temporary);
    const files = new Map();
    for (const name of Object.keys(lock.files)) {
      assert.ok(tree.has(name), `Missing source file in image: ${name}`); files.set(name, tree.get(name));
    }
    files.set('source.json', Buffer.from(`${JSON.stringify(lock.sourceMetadata.value, null, 2)}\n`));
    return files;
  } finally {
    try { if (container && /^[a-f0-9]{12,64}$/.test(container)) docker(['rm', '-v', container]); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
}

async function publish(files, check) {
  if (check) {
    const actual = await regularTree(outputDir);
    assert.deepEqual([...actual.keys()].sort(), [...files.keys()].sort(), 'Artifact inventory mismatch');
    for (const [name, bytes] of files) assert.deepEqual(actual.get(name), bytes, `Artifact differs: ${name}`);
    return;
  }
  const staging = await mkdtemp(path.join(scriptDir, '.desktop-extract-'));
  const candidate = path.join(staging, 'candidate'), previous = path.join(staging, 'previous');
  let moved = false;
  try {
    await mkdir(candidate);
    for (const [name, bytes] of files) {
      const filename = path.join(candidate, name); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes);
    }
    try {
      const metadata = await lstat(outputDir); assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink(), 'Invalid existing artifact directory');
      await rename(outputDir, previous); moved = true;
    } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    try { await rename(candidate, outputDir); }
    catch (failure) { if (moved) await rename(previous, outputDir); throw failure; }
  } finally { await rm(staging, { recursive: true, force: true }); }
}

async function main() {
  const options = { check: false };
  for (let index = 2; index < process.argv.length; index += 1) {
    const option = process.argv[index];
    if (option === '--check') options.check = true;
    else if (option === '--source-archive') {
      const value = process.argv[++index]; assert.ok(value && !value.startsWith('--'), 'Missing --source-archive path');
      options.archive = path.resolve(value);
    } else throw new Error(`Unknown argument: ${option}`);
  }
  const lockBytes = await readFile(lockPath); const lock = JSON.parse(lockBytes); validateLock(lock);
  let files;
  if (options.archive) {
    const metadata = await stat(options.archive);
    assert.ok(metadata.isFile() && metadata.size === lock.approvedSourceArchive.bytes && metadata.size <= maximumBytes,
      'Approved source archive integrity mismatch');
    const compressed = await readFile(options.archive);
    assert.equal(sha256(compressed), lock.approvedSourceArchive.sha256, 'Approved source archive integrity mismatch');
    files = archiveFiles(compressed);
  } else files = await dockerFiles(lock);
  validateFiles(files, lock);
  const publicAssets = moduleClosure(files, lock);
  const manifest = { schemaVersion: 2, artifactVersion: lock.artifactVersion, entry: lock.entry,
    publicAssets, files: lock.files,
    source: { image: lock.image, approvedSourceArchive: lock.approvedSourceArchive,
      controlledTransportArchive: lock.sourceMetadata.value.controlledTransportArchive,
      provenance: lock.sourceMetadata.value.provenance },
    generator: { path: path.relative(root, scriptPath).split(path.sep).join('/'), sha256: sha256(await readFile(scriptPath)),
      lockSha256: sha256(lockBytes), transformations: [] } };
  files.delete('source.json'); files.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  await publish(files, options.check);
  console.log(JSON.stringify({ action: options.check ? 'verified' : 'extracted', version: lock.artifactVersion,
    image: lock.image.reference, platform: lock.image.platform, modules: publicAssets.length, files: files.size }));
}

try { await main(); }
catch (failure) { console.error(failure.message); process.exitCode = 1; }
