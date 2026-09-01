'use strict';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_BUILD_ID = /^[a-z0-9][a-z0-9._:+/@-]{0,159}$/i;
const INCLUDED_EXTENSIONS = new Set(['.md', '.json', '.mjs']);

function runtimeFiles(directory = SKILL_ROOT, relativeRoot = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = path.posix.join(relativeRoot, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Skill 运行时文件不能是符号链接: ${relative}`);
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures') continue;
      files.push(...runtimeFiles(absolute, relative));
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith('.test.mjs')
      || relative === 'references/performance-validation.md'
      || !INCLUDED_EXTENSIONS.has(path.extname(entry.name))) continue;
    files.push({ absolute, relative });
  }
  return files;
}

function contentFingerprint() {
  const digest = crypto.createHash('sha256');
  for (const file of runtimeFiles()) {
    digest.update(file.relative);
    digest.update('\0');
    digest.update(fs.readFileSync(file.absolute));
    digest.update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
}

export function resolveBuildIdentity(environment = process.env) {
  const injected = typeof environment.KNOWLEDGE_COLLECTION_BUILD_ID === 'string'
    ? environment.KNOWLEDGE_COLLECTION_BUILD_ID.trim() : '';
  if (injected) {
    if (!SAFE_BUILD_ID.test(injected)) {
      throw new Error('KNOWLEDGE_COLLECTION_BUILD_ID 格式无效');
    }
    return { buildId: injected, buildIdSource: 'environment' };
  }
  return { buildId: contentFingerprint(), buildIdSource: 'content-fingerprint' };
}
