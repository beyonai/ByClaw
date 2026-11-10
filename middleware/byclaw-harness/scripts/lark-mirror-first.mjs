import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The pinned upstream installer downloads from GitHub before trying npmmirror.
// Adjust the source list while retaining host checks, SHA-256 and extraction.
export function mirrorFirst(source, { mirrorOnly = false } = {}) {
  const original = 'const downloadUrls = [GITHUB_URL, ...mirrorUrls];';
  if (source.split(original).length !== 2) {
    throw new Error('Lark installer changed; review download order before upgrading');
  }
  const downloadUrls = mirrorOnly ? 'mirrorUrls' : '[...mirrorUrls, GITHUB_URL]';
  return source.replace(original, `const downloadUrls = ${downloadUrls};`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , file, mode] = process.argv;
  writeFileSync(file, mirrorFirst(readFileSync(file, 'utf8'), { mirrorOnly: mode === '--mirror-only' }));
}
