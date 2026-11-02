import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
test('system parameter media catalog matches installed provider adapters and local logos', async () => {
  const rows = JSON.parse(await readFile(new URL('middleware/byclaw-harness/plugins/media-provider-catalog.json', root), 'utf8'));
  const migration = await readFile(new URL('deploy/migrations/versions/V0.6.0/V0.6.0__dml.sql', root), 'utf8');
  const registryFiles = { IMAGE_GENERATION: 'byclaw-image/src/adapters.js', TTS: 'byclaw-tts/src/adapters.js', ASR: 'byclaw-asr/src/adapters.js' };
  for (const row of rows) {
    assert.ok(row.adapter && row.modelProtocol && typeof row.apiEndpoint === 'string' && row.providerName);
    const source = await readFile(new URL(`middleware/byclaw-harness/plugins/${registryFiles[row.type]}`, root), 'utf8');
    assert.match(source, new RegExp(`\\b${row.providerName}\\s*:`));
    assert.ok(migration.includes(`SYSTEM_MODEL_${row.type}_PROVIDER_NAME`));
    assert.ok(migration.includes(JSON.stringify(row.modelProtocol)));
    await access(new URL(`byclaw-fe/public${row.logo}`, root));
  }
  assert.equal(new Set(rows.map(row => `${row.type}:${row.providerName}`)).size, rows.length);
});
