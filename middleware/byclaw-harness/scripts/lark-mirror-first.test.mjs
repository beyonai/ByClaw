import assert from 'node:assert/strict';
import { mirrorFirst } from './lark-mirror-first.mjs';

const source = 'assertAllowedHost(url);\nconst downloadUrls = [GITHUB_URL, ...mirrorUrls];\nverifyChecksum(archivePath, expectedHash);';
assert.equal(mirrorFirst(source), source.replace('[GITHUB_URL, ...mirrorUrls]', '[...mirrorUrls, GITHUB_URL]'));
assert.throws(() => mirrorFirst('new upstream installer'), /installer changed/);
assert.throws(() => mirrorFirst(source + source), /installer changed/);
console.log('Lark mirror order and upstream drift verification passed');
