import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWecomAdapter } from './wecom.mjs';

const testWecomHome = join(tmpdir(), 'wecom-adapter-home');
process.env.WECOM_HOME = testWecomHome;

async function fixture(root, program) {
  const bin = join(root, 'wecom-cli');
  await writeFile(bin, `#!/usr/bin/env node\nif (process.env.HOME !== process.env.WECOM_HOME) process.exit(96);\n${program}\n`, { mode: 0o700 });
  await chmod(bin, 0o700);
  return bin;
}

function envelope(business, options = {}) {
  return JSON.stringify({
    jsonrpc: '2.0',
    result: { content: [{ type: 'text', text: JSON.stringify(business) }] },
    isError: options.isError ?? false,
  });
}

async function output(root, name) {
  return join(root, name);
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('search is unsupported but persists an inspectable empty bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const outputDir = await output(root, 'search');
    const result = await createWecomAdapter().search({ query: 'quarterly plan', outputDir });
    assert.equal(result.status, 'unsupported_capability');
    assert.equal(result.continuable, true);
    assert.deepEqual((await json(join(outputDir, 'collection-result.json'))).items, []);
    assert.equal((await json(join(outputDir, 'sanitized/metadata.json'))).collection.status, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('doc content polls get_doc_content through task completion and materializes markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const callsPath = join(root, 'doc-calls.jsonl');
    const bin = await fixture(root, `
const { appendFileSync, readFileSync } = require('node:fs');
const command = process.argv[3];
const request = JSON.parse(process.argv[4]);
const out = ${envelope.toString()};
if (command !== 'get_doc_content') process.exit(2);
appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(request) + '\\n');
if (!request.task_id) console.log(out({ errcode: 0, task_id: 'doc-task' }));
else console.log(out({ errcode: 0, task_done: true, content: '# Document\\n\\nBody' }));
`);
    const outputDir = await output(root, 'doc');
    const result = await createWecomAdapter({ bin }).collectResource({
      url: 'https://doc.weixin.qq.com/doc/abc', outputDir,
    });
    assert.equal(result.status, 'complete');
    assert.match(await readFile(join(outputDir, 'markdown/document.md'), 'utf8'), /# Document/);
    const metadata = await json(join(outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.items[0].sourceSkill, 'wecomcli');
    assert.deepEqual(metadata.collection.items[0].rawArtifacts, [
      'raw/get-doc-content.json', 'raw/poll-1.json', 'raw/metadata.json',
    ]);
    assert.deepEqual((await readFile(callsPath, 'utf8')).trim().split('\n').map(JSON.parse), [
      { url: 'https://doc.weixin.qq.com/doc/abc', type: 2 },
      { url: 'https://doc.weixin.qq.com/doc/abc', type: 2, task_id: 'doc-task' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('sheet resource uses get_doc_content type 2 and materializes markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const bin = await fixture(root, `
const request = JSON.parse(process.argv[4]);
if (process.argv[3] !== 'get_doc_content' || request.type !== 2) process.exit(2);
console.log(${JSON.stringify(envelope({ errcode: 0, content: '# Sheet content' }))});
`);
    const outputDir = await output(root, 'sheet');
    const result = await createWecomAdapter({ bin }).collectResource({
      url: 'https://doc.weixin.qq.com/sheet/abc', outputDir,
    });
    assert.equal(result.status, 'complete');
    assert.match(await readFile(join(outputDir, 'sanitized/items/document.md'), 'utf8'), /Sheet content/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('smartsheet materializes each sheet with fields and cursor-paginated records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const bin = await fixture(root, `
const command = process.argv[3]; const request = JSON.parse(process.argv[4]);
const out = ${envelope.toString()};
if (command === 'smartsheet_get_sheet') console.log(out({ errcode: 0, sheets: [{ sheet_id: 'one', title: 'One' }, { sheet_id: 'two', title: 'Two' }] }));
else if (command === 'smartsheet_get_fields') console.log(out({ errcode: 0, fields: [{ field_id: 'name', title: 'Name' }, { field_id: 'meta', title: 'Meta' }] }));
else if (command === 'smartsheet_get_records' && request.sheet_id === 'one' && !request.cursor) console.log(out({ errcode: 0, records: [{ values: { name: 'Ada', meta: { tags: ['x'] } } }], next_cursor: 'next' }));
else if (command === 'smartsheet_get_records' && request.sheet_id === 'one') console.log(out({ errcode: 0, records: [{ values: { name: 'Grace', meta: ['a', 'b'] } }], next_cursor: '' }));
else if (command === 'smartsheet_get_records') console.log(out({ errcode: 0, records: [{ values: { name: 'Lin', meta: { ok: true } } }], next_cursor: null }));
else process.exit(2);
`);
    const outputDir = await output(root, 'smartsheet');
    const result = await createWecomAdapter({ bin }).collectResource({
      url: 'https://doc.weixin.qq.com/smartsheet/abc', outputDir,
    });
    assert.equal(result.status, 'complete');
    const markdown = await readFile(join(outputDir, 'markdown/document.md'), 'utf8');
    assert.match(markdown, /## One/);
    assert.match(markdown, /## Two/);
    assert.match(markdown, /Name/);
    assert.match(markdown, /{"tags":\["x"\]}/);
    const records = await json(join(outputDir, 'raw/records-one-1.json'));
    assert.equal(records.result.content[0].type, 'text');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('smartpage export polls result and preserves the legacy resource type', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const bin = await fixture(root, `
const command = process.argv[3]; const request = JSON.parse(process.argv[4]); const out = ${envelope.toString()};
if (command === 'smartpage_export_task') console.log(out({ errcode: 0, task_id: 'page-task' }));
else if (command === 'smartpage_get_export_result' && request.task_id === 'page-task') console.log(out({ errcode: 0, task_done: true, content: '# Page' }));
else process.exit(2);
`);
    const outputDir = await output(root, 'smartpage');
    const result = await createWecomAdapter({ bin }).collectResource({
      url: 'https://doc.weixin.qq.com/smartpage/abc', outputDir,
    });
    assert.equal(result.status, 'complete');
    assert.equal((await json(join(outputDir, 'sanitized/metadata.json'))).collection.items[0].sourceItemId, 'page-task');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('resumes a partial WeCom document export from its persisted task ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const pollPath = join(root, 'resume-polls');
    const bin = await fixture(root, `
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const command = process.argv[3]; const request = JSON.parse(process.argv[4]); const out = ${envelope.toString()};
if (command !== 'get_doc_content') process.exit(2);
if (!request.task_id) console.log(out({ errcode: 0, task_id: 'resume-task' }));
else if (request.task_id === 'resume-task') {
  const count = existsSync(${JSON.stringify(pollPath)}) ? Number(readFileSync(${JSON.stringify(pollPath)}, 'utf8')) : 0;
  writeFileSync(${JSON.stringify(pollPath)}, String(count + 1));
  console.log(out(count === 0 ? { errcode: 0, task_done: false } : { errcode: 0, task_done: true, content: '# Resumed' }));
}
else process.exit(2);
`);
    const adapter = createWecomAdapter({ bin, maxPolls: 1 });
    const partialDir = await output(root, 'partial');
    const partial = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/doc/abc', outputDir: partialDir });
    assert.equal(partial.status, 'partial');
    const resumedDir = await output(root, 'resumed');
    const resumed = await adapter.resumeResource({ sessionDir: partialDir, outputDir: resumedDir });
    assert.equal(resumed.status, 'complete');
    assert.match(await readFile(join(resumedDir, 'sanitized/items/document.md'), 'utf8'), /Resumed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('refuses a WeCom resume session whose source metadata was replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const bin = await fixture(root, `process.exit(2);`);
    const partialDir = await output(root, 'partial');
    await mkdir(join(partialDir, 'sanitized'), { recursive: true });
    await writeFile(join(partialDir, 'sanitized/metadata.json'), JSON.stringify({
      sourceMetadata: { source: 'dws', resourceKind: 'doc', taskId: 'foreign-task' },
      collection: {
        status: 'partial',
        items: [{ sourceUrl: 'https://doc.weixin.qq.com/doc/abc', sourceItemId: 'foreign-task', materialization: { status: 'pending' } }],
      },
    }));
    const result = await createWecomAdapter({ bin }).resumeResource({
      sessionDir: partialDir,
      outputDir: await output(root, 'resumed'),
    });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /not a resumable WeCom/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSON-RPC and business errors become failed metadata without markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const bin = await fixture(root, `console.log(${JSON.stringify(envelope({ errcode: 93001, errmsg: 'denied' }))});`);
    const outputDir = await output(root, 'failed');
    const result = await createWecomAdapter({ bin }).collectResource({ url: 'https://doc.weixin.qq.com/doc/a', outputDir });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /errcode 93001/);
    const metadata = await json(join(outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'failed');
    await assert.rejects(readFile(join(outputDir, 'markdown/document.md')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid business JSON inside a valid JSON-RPC envelope fails without markdown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const bin = await fixture(root, "console.log(JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: 'not business json' }] } }));");
    const outputDir = await output(root, 'invalid-inner');
    const result = await createWecomAdapter({ bin }).collectResource({ url: 'https://doc.weixin.qq.com/doc/a', outputDir });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /business JSON/);
    await assert.rejects(readFile(join(outputDir, 'markdown/document.md')));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy smartpage poll errors persist partial metadata and honor environment max polls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const callsPath = join(root, 'poll-calls');
    const bin = await fixture(root, `
const { appendFileSync } = require('node:fs');
const command = process.argv[3]; const out = ${envelope.toString()};
if (command === 'smartpage_export_task') console.log(out({ errcode: 0, task_id: 'page-task' }));
else if (command === 'smartpage_get_export_result') { appendFileSync(${JSON.stringify(callsPath)}, 'poll\\n'); console.log(out({ errcode: 93001 })); }
else process.exit(2);
`);
    const outputDir = await output(root, 'partial');
    const result = await createWecomAdapter({
      bin,
      env: { KNOWLEDGE_COLLECTION_MAX_WECOM_POLLS: '1' },
    }).collectResource({
      url: 'https://doc.weixin.qq.com/smartpage/a', outputDir, legacyMode: true,
    });
    assert.equal(result.status, 'partial');
    assert.equal((await json(join(outputDir, 'sanitized/metadata.json'))).collection.status, 'partial');
    assert.equal((await readFile(callsPath, 'utf8')).trim().split('\n').length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('smartsheet cursor pagination stops at the configured page limit with auditable partial metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const callsPath = join(root, 'record-calls');
    const bin = await fixture(root, `
const { appendFileSync, readFileSync } = require('node:fs');
const command = process.argv[3]; const request = JSON.parse(process.argv[4]); const out = ${envelope.toString()};
if (command === 'smartsheet_get_sheet') console.log(out({ errcode: 0, sheets: [{ sheet_id: 'one', title: 'One' }] }));
else if (command === 'smartsheet_get_fields') console.log(out({ errcode: 0, fields: [{ field_id: 'name', title: 'Name' }] }));
else if (command === 'smartsheet_get_records') { appendFileSync(${JSON.stringify(callsPath)}, request.cursor + '\\n'); if (readFileSync(${JSON.stringify(callsPath)}, 'utf8').trim().split('\\n').length > 3) process.exit(9); console.log(out({ errcode: 0, records: [{ values: { name: request.cursor || 'first' } }], next_cursor: 'cursor-' + (request.cursor || '0') })); }
else process.exit(2);
`);
    const outputDir = await output(root, 'limited-pages');
    const result = await createWecomAdapter({
      bin,
      maxPages: -1,
      env: { KNOWLEDGE_COLLECTION_MAX_WECOM_PAGES: '2' },
    }).collectResource({
      url: 'https://doc.weixin.qq.com/smartsheet/a', outputDir,
    });
    assert.equal(result.status, 'partial');
    assert.equal((await readFile(callsPath, 'utf8')).trim().split('\n').length, 2);
    const rawMetadata = await json(join(outputDir, 'raw/metadata.json'));
    assert.equal(rawMetadata.pagesCollected, 2);
    assert.equal(rawMetadata.lastCursor, 'cursor-cursor-0');
    assert.equal(rawMetadata.partialContent, undefined);
    assert.match(await readFile(join(outputDir, 'sanitized/items/document.md'), 'utf8'), /first/);
    const metadata = await json(join(outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'partial');
    assert.equal(metadata.collection.items[0].materialization.status, 'materialized');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('direct smartpage poll errors are partial and preserve task context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const bin = await fixture(root, `
const command = process.argv[3]; const out = ${envelope.toString()};
if (command === 'smartpage_export_task') console.log(out({ errcode: 0, task_id: 'task-direct' }));
else console.log(out({ errcode: 93001, errmsg: 'denied' }));
`);
    const outputDir = await output(root, 'direct-partial');
    const result = await createWecomAdapter({ bin }).collectResource({
      url: 'https://doc.weixin.qq.com/smartpage/a', outputDir,
    });
    assert.equal(result.status, 'partial');
    const metadata = await json(join(outputDir, 'sanitized/metadata.json'));
    assert.equal(metadata.collection.status, 'partial');
    assert.equal(metadata.collection.items[0].sourceItemId, 'task-direct');
    assert.equal(metadata.sourceMetadata.taskId, 'task-direct');
    assert.equal(metadata.sourceMetadata.lastPoll, 1);
    assert.equal(metadata.sourceMetadata.stage, 'poll');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI and business failures persist sanitized response evidence', async (t) => {
  const scenarios = [
    ['nonzero', "process.stderr.write('token=cli-secret'); process.exit(3);"],
    ['errcode', `console.log(${JSON.stringify(envelope({ errcode: 93001, access_token: 'business-secret' }))});`],
  ];
  for (const [name, program] of scenarios) {
    await t.test(name, async () => {
      const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
      try {
        const bin = await fixture(root, program);
        const outputDir = await output(root, name);
        const result = await createWecomAdapter({ bin }).collectResource({ url: 'https://doc.weixin.qq.com/doc/a', outputDir });
        assert.equal(result.status, 'failed');
        const rawNames = await import('node:fs/promises').then(({ readdir }) => readdir(join(outputDir, 'raw')));
        const evidence = rawNames.find((entry) => entry.startsWith('failed-'));
        assert.ok(evidence);
        assert.doesNotMatch(await readFile(join(outputDir, 'raw', evidence), 'utf8'), /cli-secret|business-secret/);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
});

test('empty content, missing task, repeated cursor, malformed response, and route conflicts are structured failures', async (t) => {
  const scenarios = [
    ['empty', "console.log(JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify({ errcode: 0, content: '' }) }] } }));", 'https://doc.weixin.qq.com/doc/a'],
    ['missing-task', `console.log(${JSON.stringify(envelope({ errcode: 0 }))});`, 'https://doc.weixin.qq.com/smartpage/a'],
    ['malformed', "console.log('not json');", 'https://doc.weixin.qq.com/doc/a'],
    ['repeat-cursor', `
const command = process.argv[3]; const out = ${envelope.toString()};
if (command === 'smartsheet_get_sheet') console.log(out({ errcode: 0, sheets: [{ sheet_id: 'one' }] }));
else if (command === 'smartsheet_get_fields') console.log(out({ errcode: 0, fields: [] }));
else console.log(out({ errcode: 0, records: [], next_cursor: 'again' }));`, 'https://doc.weixin.qq.com/smartsheet/a'],
  ];
  for (const [name, program, url] of scenarios) {
    await t.test(name, async () => {
      const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
      try {
        const bin = await fixture(root, program);
        const outputDir = await output(root, 'out');
        const result = await createWecomAdapter({ bin }).collectResource({ url, outputDir });
        assert.ok(['failed', 'partial'].includes(result.status));
        assert.equal(result.continuable, true);
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
  const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
  try {
    const result = await createWecomAdapter().collectResource({
      url: 'https://doc.weixin.qq.com/doc/a', resourceKind: 'smartpage', outputDir: await output(root, 'conflict'),
    });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /conflicts/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});
