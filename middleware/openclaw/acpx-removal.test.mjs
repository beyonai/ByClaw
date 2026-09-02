import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const targetFiles = [
  'Dockerfile',
  'Dockerfile.byclaw',
  'runtime-bootstrap.sh',
];

const forbiddenMarkers = [
  /@openclaw\/acpx/,
  /dist\/extensions\/acpx/,
  /OPENCLAW_(?:FIX_ACPX|ACPX_NPM)/,
  /sanitize_acpx_npm_plugin_candidates/,
];

for (const fileName of targetFiles) {
  test(`${fileName} does not install or repair the official ACPX plugin`, async () => {
    const contents = await readFile(new URL(fileName, import.meta.url), 'utf8');

    for (const marker of forbiddenMarkers) {
      assert.doesNotMatch(contents, marker);
    }
  });
}
