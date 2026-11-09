import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfiguration } from '../src/config.js';

const projection = JSON.stringify({ schemaVersion: 1, connectorCode: 'volcengine-digital-human', enabled: true,
  accessKeyId: 'fixture-ak', secretAccessKey: 'fixture-sk' });

// The structural fs surface used by devflow: resolve/lstat/stat/readText, without readBytes.
function textProvider() {
  return {
    async lstat() { return { type: 'file', size: Buffer.byteLength(projection) }; },
    async resolve() { return { targetKey: {}, displayPath: 'remote://configuration' }; },
    async stat() { return { type: 'file', size: Buffer.byteLength(projection) }; },
    async readText() { return projection; },
  };
}

test('reads a connector through the text-only filesystem surface used by devflow', async () => {
  const value = await readConfiguration(textProvider(), '/config');
  assert.equal(value.accessKeyId, 'fixture-ak');
});

test('missing file and filesystem access denial retain distinct safe diagnostics', async () => {
  const missing = textProvider(); missing.lstat = async () => undefined;
  await assert.rejects(readConfiguration(missing, '/config'), { code: 'DIGITAL_HUMAN_CONFIGURATION_REQUIRED', stage: 'lstat', reason: 'FILE_NOT_FOUND' });
  const denied = textProvider(); denied.readText = async () => { throw Object.assign(new Error('fixture-sk'), { code: 'FS_PERMISSION_DENIED' }); };
  await assert.rejects(readConfiguration(denied, '/config'), (error) => {
    assert.equal(error.stage, 'read');
    assert.equal(error.reason, 'FS_PERMISSION_DENIED');
    assert.doesNotMatch(error.message + JSON.stringify(error), /fixture-sk/);
    return true;
  });
});

test('streaming fallback is bounded, closes on overflow and preserves cancellation', async () => {
  const fs = textProvider();
  let closed = false;
  fs.streamText = async () => (async function* () {
    try { yield 'x'.repeat(16385); throw new Error('must not read another chunk'); }
    finally { closed = true; }
  })();
  await assert.rejects(readConfiguration(fs, '/config'), { stage: 'read', reason: 'FILE_TOO_LARGE' });
  assert.equal(closed, true);
  const controller = new AbortController();
  fs.streamText = async () => (async function* () { controller.abort(); yield projection; })();
  await assert.rejects(readConfiguration(fs, '/config', controller.signal), { name: 'AbortError' });
});

test('text-only fallback rejects unknown size and a file that grew beyond the limit', async () => {
  const unknown = textProvider(); unknown.lstat = async () => ({ type: 'file' });
  unknown.readText = async () => { throw new Error('must not read unknown-size content'); };
  await assert.rejects(readConfiguration(unknown, '/config'), { stage: 'read', reason: 'BOUNDED_READ_UNAVAILABLE' });
  const growing = textProvider(); growing.readText = async () => 'x'.repeat(16385);
  await assert.rejects(readConfiguration(growing, '/config'), { stage: 'read', reason: 'FILE_TOO_LARGE' });
});

test('successful stream reads and missing provider have explicit outcomes', async () => {
  const fs = textProvider();
  fs.streamText = async () => (async function* () { yield projection.slice(0, 40); yield projection.slice(40); })();
  assert.equal((await readConfiguration(fs, '/config')).accessKeyId, 'fixture-ak');
  await assert.rejects(readConfiguration(undefined, '/config'), { stage: 'provider', reason: 'FILESYSTEM_UNAVAILABLE' });
});
