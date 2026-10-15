import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

test('cross-skill resolution survives either container layout and spaces in paths', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'builtin relocation ')));
  try {
    for (const layout of ['app/skills', 'opt/byclaw/dsh-managed/skills']) {
      const target = path.join(root, layout);
      await cp(fileURLToPath(new URL('../builtin/skills', import.meta.url)), target, { recursive: true });
      const context = await import(pathToFileURL(path.join(target, 'knowledge-collection/scripts/unified-search.mjs')));
      const cloud = await import(pathToFileURL(path.join(target, 'knowledge-collection/scripts/enterprise/adapters/cloud-knowledge.mjs')));
      assert.equal(context.resolveProjectContextScript({ env: {} }), path.join(target, 'project-context/scripts/project-context.mjs'));
      assert.equal(cloud.resolveCloudKnowledgeScript({ env: {} }), path.join(target, 'project-cloud-knowledge/scripts/project_cloud_knowledge.py'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
