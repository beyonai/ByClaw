import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The pinned upstream installer downloads from GitHub before trying npmmirror.
// Change only source order; keep its host checks, SHA-256 check and extraction.
export function mirrorFirst(source) {
  const original = 'const downloadUrls = [GITHUB_URL, ...mirrorUrls];';
  if (source.split(original).length !== 2) {
    throw new Error('Lark installer changed; review download order before upgrading');
  }
  return source.replace(original, 'const downloadUrls = [...mirrorUrls, GITHUB_URL];');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  writeFileSync(file, mirrorFirst(readFileSync(file, 'utf8')));
}
