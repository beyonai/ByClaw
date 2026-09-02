import assert from 'node:assert/strict';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { createArtifactWriter } from './artifact-writer.mjs';
import { copyResumeArtifacts, readResumeCandidates } from './resume.mjs';

test('readResumeCandidates accepts only selected pending candidates from a metadata-only source session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-resume-'));
  try {
    await mkdir(join(root, 'sanitized'));
    await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify({
      sourceMetadata: { source: 'dws', metadataOnly: true },
      collection: { items: [{ itemId: 'dws-one', sourceItemId: 'one', sourceUrl: 'dingtalk://doc/one', sourceType: 'file', materializationType: '', sourceRank: 1, title: 'One', rawArtifacts: ['raw/doc-search-1.json'], collectionFilters: { workspaceIds: ['space'] }, materialization: { status: 'pending' } }] },
    }));
    assert.deepEqual(await readResumeCandidates(root, 'dws', ['dws-one']), [{
      itemId: 'dws-one', sourceItemId: 'one', sourceUrl: 'dingtalk://doc/one', type: '', sourceType: 'file', sourceRank: 1, title: 'One', rawArtifacts: ['raw/doc-search-1.json'], collectionFilters: { workspaceIds: ['space'] }, resumeRoot: root,
    }]);
    await assert.rejects(readResumeCandidates(root, 'dws', ['absent']), /not candidates/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('readResumeCandidates keeps legacy DWS drive files on the converter materialization path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-resume-legacy-dws-'));
  try {
    await mkdir(join(root, 'sanitized'));
    await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify({
      sourceMetadata: { source: 'dws', metadataOnly: true },
      collection: { items: [{ itemId: 'drive-file', sourceItemId: 'file', sourceUrl: 'dingtalk://drive/file', sourceType: 'file', sourceRank: 1, title: 'File', rawArtifacts: [], collectionFilters: {}, materialization: { status: 'pending' } }] },
    }));
    const [candidate] = await readResumeCandidates(root, 'dws', ['drive-file']);
    assert.equal(candidate.type, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('copyResumeArtifacts rejects raw artifacts reached through a symlinked session directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'enterprise-resume-symlink-'));
  const outside = await mkdtemp(join(tmpdir(), 'enterprise-resume-outside-'));
  const output = join(root, 'output');
  try {
    await mkdir(join(root, 'sanitized'));
    await writeFile(join(outside, 'discovery.json'), '{"private":true}');
    await symlink(outside, join(root, 'raw'));
    await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify({
      sourceMetadata: { source: 'dws', metadataOnly: true },
      collection: { items: [{ itemId: 'escaped', sourceItemId: 'escaped', sourceUrl: 'dingtalk://doc/escaped', sourceType: 'doc', sourceRank: 1, title: 'Escaped', rawArtifacts: ['raw/discovery.json'], collectionFilters: {}, materialization: { status: 'pending' } }] },
    }));
    const candidates = await readResumeCandidates(root, 'dws', ['escaped']);
    const writer = await createArtifactWriter(output);
    await assert.rejects(copyResumeArtifacts(writer, candidates), /unsafe/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('copyResumeArtifacts rejects a session directory replaced after candidate selection', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'enterprise-resume-replaced-'));
  const root = join(parent, 'session');
  const replacement = join(parent, 'replacement');
  const output = join(parent, 'output');
  try {
    const metadata = {
      sourceMetadata: { source: 'dws', metadataOnly: true },
      collection: { items: [{ itemId: 'candidate', sourceItemId: 'candidate', sourceUrl: 'dingtalk://doc/candidate', sourceType: 'doc', sourceRank: 1, title: 'Candidate', rawArtifacts: ['raw/discovery.json'], collectionFilters: {}, materialization: { status: 'pending' } }] },
    };
    await mkdir(join(root, 'sanitized'), { recursive: true });
    await mkdir(join(root, 'raw'));
    await writeFile(join(root, 'sanitized/metadata.json'), JSON.stringify(metadata));
    await writeFile(join(root, 'raw/discovery.json'), '{"original":true}');
    const candidates = await readResumeCandidates(root, 'dws', ['candidate']);
    await mkdir(join(replacement, 'raw'), { recursive: true });
    await writeFile(join(replacement, 'raw/discovery.json'), '{"replacement":true}');
    await rename(root, join(parent, 'original-session'));
    await rename(replacement, root);
    await assert.rejects(copyResumeArtifacts(await createArtifactWriter(output), candidates), /replaced/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});
