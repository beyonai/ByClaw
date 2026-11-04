import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createWecomAdapter } from './wecom.mjs';

async function setup(t, program, options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'wecom-adapter-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const bin = join(root, 'wecom-cli');
    await writeFile(
        bin,
        `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
if (process.env.HOME !== process.env.WECOM_HOME) process.exit(96);
if (process.env.WECOM_CLI_CONFIG_DIR !== path.join(process.env.WECOM_HOME, '.config', 'wecom')) process.exit(95);
if (process.env.WECOM_CLI_ACCESS_TOKEN !== '') process.exit(94);
const args = process.argv.slice(2);
const jsonIndex = args.indexOf('--json');
if (jsonIndex < 1) process.exit(94);
const command = args.slice(0, jsonIndex).join(' ');
const request = JSON.parse(args[jsonIndex + 1]);
const outputDir = args[args.indexOf('--output-dir') + 1];
if (!outputDir || !path.resolve(outputDir).startsWith(process.cwd() + path.sep)) process.exit(93);
const out = (value) => console.log(JSON.stringify(value));
${program}
`,
        { mode: 0o700 },
    );
    await chmod(bin, 0o700);
    const outputDir = join(root, 'output');
    const adapter = createWecomAdapter({
        bin,
        env: {
            WECOM_HOME: join(root, 'home'),
            WECOM_CLI_CONFIG_DIR: '/foreign-config',
            WECOM_CLI_ACCESS_TOKEN: 'foreign-identity',
        },
        ...options,
    });
    return { root, bin, outputDir, adapter };
}
async function json(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

test('search stays unsupported and persists an inspectable bundle', async (t) => {
    const { adapter, outputDir } = await setup(t, 'process.exit(2);');
    assert.equal((await adapter.search({ query: 'plan', outputDir })).status, 'unsupported_capability');
    assert.deepEqual((await json(join(outputDir, 'collection-result.json'))).items, []);
});

test('doc reads 1.3.4 business JSON with docid and --json under the tenant HOME', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
if (command !== 'doc contents get' || request.docid !== 'abc' || request.content_type !== 'markdown' || request.url) process.exit(2);
out({content:'# Document\\n\\nBody'});
`,
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/doc/abc?scode=share', outputDir });
    assert.equal(result.status, 'complete', result.reason);
    assert.match(await readFile(join(outputDir, 'markdown/document.md'), 'utf8'), /# Document/);
    assert.equal((await json(join(outputDir, 'raw/get-doc-content.json'))).content, '# Document\n\nBody');
});

test('long doc text is read from the CLI output directory', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
fs.mkdirSync(outputDir,{recursive:true}); const file=path.join(outputDir,'content.md');
fs.writeFileSync(file,'# Long document'); out({file_path:file});
`,
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/doc/abc', outputDir });
    assert.equal(result.status, 'complete', result.reason);
    assert.match(await readFile(join(outputDir, 'markdown/document.md'), 'utf8'), /Long document/);
});

test('file paths and symlinks cannot escape the command output directory', async (t) => {
    for (const link of [false, true])
        await t.test(String(link), async (t) => {
            const { adapter, outputDir } = await setup(
                t,
                `
fs.mkdirSync(outputDir,{recursive:true}); const outside=path.join(process.cwd(),'..','private.txt');
fs.writeFileSync(outside,'must-not-collect'); const file=${link}?path.join(outputDir,'link.md'):outside;
if (${link}) fs.symlinkSync(outside,file); out({file_path:file});
`,
            );
            const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/doc/abc', outputDir });
            assert.equal(result.status, 'failed');
            assert.match(result.reason, /outside.*output|symbolic link/i);
            await assert.rejects(readFile(join(outputDir, 'markdown/document.md')));
        });
});

test('smartpage reads structure then each page including file-backed content', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
if(command!=='smartpage pages get'||request.docid!=='b1_abc')process.exit(2);
if(!request.page_id)out({pages:[{page_id:'p1',page_title:'First'},{page_id:'p2',page_title:'Second',parent_id:'p1'}]});
else if(request.page_id==='p1')out({pages:[{page_id:'p1',content_file_inner:'First body'}]});
else{fs.mkdirSync(outputDir,{recursive:true});const file=path.join(outputDir,'page.md');fs.writeFileSync(file,'Second body');out({pages:[{page_id:'p2',file_path:file}]});}
`,
    );
    const result = await adapter.collectResource({
        url: 'https://page.weixin.qq.com/smartpage/p/b1_abc?scode=share',
        outputDir,
    });
    assert.equal(result.status, 'complete', result.reason);
    const content = await readFile(join(outputDir, 'markdown/document.md'), 'utf8');
    assert.match(content, /First body/);
    assert.match(content, /Second body/);
});

test('smartpage partial preserves completed pages and resumes by rereading the URL', async (t) => {
    const { root, bin, adapter, outputDir } = await setup(
        t,
        `
if(!request.page_id)out({pages:[{page_id:'one',page_title:'One'},{page_id:'two',page_title:'Two'}]});
else if(request.page_id==='one')out({pages:[{page_id:'one',content_file_inner:'Collected first page'}]});
else out({error:{code:'DENIED',message:'denied'}});
`,
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/smartpage/a1_abc', outputDir });
    assert.equal(result.status, 'partial', result.reason);
    assert.match(await readFile(join(outputDir, 'markdown/document.md'), 'utf8'), /Collected first page/);
    await writeFile(
        bin,
        '#!/usr/bin/env node\nconsole.log(JSON.stringify({pages:[{page_id:"one",page_title:"One",content_file_inner:"Resumed"}]}));\n',
    );
    const resumed = await adapter.resumeResource({ sessionDir: outputDir, outputDir: join(root, 'resumed') });
    assert.equal(resumed.status, 'complete', resumed.reason);
});

test('sheet collects each subsheet as CSV with the released 1.3.4 commands', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
if(command==='sheet get')out({sheets:[{sheet_id:'one',title:'Sheet one',data_range:'A1:B2'},{sheet_id:'two',title:'Sheet two',data_range:'A1:A1'}]});
else if(command==='sheet ranges get'&&request.mode==='csv'){
if(!['one','two'].includes(request.sheet_id))process.exit(2);
out({content:request.sheet_id==='one'?'Name,Value\\nAda,1':'Last sheet'});
}else process.exit(2);
`,
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/sheet/abc', outputDir });
    assert.equal(result.status, 'complete', result.reason);
    const content = await readFile(join(outputDir, 'markdown/document.md'), 'utf8');
    assert.match(content, /Sheet two/);
    assert.match(content, /Ada,1/);
    assert.match(content, /Last sheet/);
});

test('sheet errors preserve earlier subsheet content as partial', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
if(command==='sheet get')out({sheets:[{sheet_id:'one',title:'One'},{sheet_id:'two',title:'Two'}]});
else if(request.sheet_id==='one')out({content:'Collected first sheet'});
else out({errcode:93001,errmsg:'denied'});
`,
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/sheet/abc', outputDir });
    assert.equal(result.status, 'partial');
    assert.match(await readFile(join(outputDir, 'markdown/document.md'), 'utf8'), /first sheet/);
});

test('smartsheet uses titles, pages fields and records and sizes the record limit', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
if(request.docid!=='s3_abc'||request.url||request.sheet_id)process.exit(2);
if(command==='smartsheet sheets list')out({sheets:[{sheet_id:'one',title:'Tasks',type:'smartsheet'},{sheet_id:'chart',title:'Chart',type:'dashboard'}]});
else if(command==='smartsheet fields list'){
if(request.sheet_title!=='Tasks'||!request.limit)process.exit(3);
out({fields:request.cursor?[{field_title:'Last',field_type:'text'}]:Array.from({length:10},(_,i)=>({field_title:'F'+i,field_type:'text'})),next_cursor:request.cursor?'':'fields-next'});
}else if(command==='smartsheet records list'){
if(request.sheet_title!=='Tasks'||request.limit*11>=10000)process.exit(4);
out({errcode:0,records:[{values:{F0:request.cursor?'Second row':'First row',Last:'tail'}}],next_cursor:request.cursor?'':'records-next'});
}else process.exit(2);
`,
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/smartsheet/s3_abc', outputDir });
    assert.equal(result.status, 'complete', result.reason);
    const content = await readFile(join(outputDir, 'markdown/document.md'), 'utf8');
    assert.match(content, /First row/);
    assert.match(content, /Second row/);
    assert.match(content, /Last/);
});

test('smartsheet page limit preserves collected records as partial content', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
if(command==='smartsheet sheets list')out({sheets:[{sheet_id:'one',title:'One',type:'smartsheet'}]});
else if(command==='smartsheet fields list')out({fields:[{field_title:'Name'}]});
else out({records:[{values:{Name:'First'}}],next_cursor:'next'});
`,
        { maxPages: 1 },
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/smartsheet/a', outputDir });
    assert.equal(result.status, 'partial');
    assert.match(await readFile(join(outputDir, 'markdown/document.md'), 'utf8'), /First/);
});

test('smartsheet stops on has_more false even when a terminal cursor is returned', async (t) => {
    const { adapter, outputDir } = await setup(
        t,
        `
if (request.cursor) throw new Error('must not fetch past the last page');
if (command === 'smartsheet sheets list') out({sheets:[{sheet_id:'one',title:'One'}]});
else if (command === 'smartsheet fields list') out({fields:[{field_title:'Name'}],has_more:false,next_cursor:'last-field'});
else out({records:[{values:{Name:'Only row'}}],has_more:false,next_cursor:'last-record'});
`,
    );
    const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/smartsheet/a', outputDir });
    assert.equal(result.status, 'complete', result.reason);
    const content = await readFile(join(outputDir, 'markdown/document.md'), 'utf8');
    assert.equal(content.match(/Only row/g)?.length, 1);
});

test('smartsheet does not report complete for missing records or an unusable continuation', async (t) => {
    for (const response of [{}, { records: [], has_more: true }, { records: [], has_more: 'false' }]) {
        await t.test(JSON.stringify(response), async (t) => {
            const { adapter, outputDir } = await setup(
                t,
                `
if (command === 'smartsheet sheets list') out({sheets:[{sheet_id:'one',title:'One'}]});
else if (command === 'smartsheet fields list') out({fields:[{field_title:'Name'}]});
else out(${JSON.stringify(response)});
`,
            );
            const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/smartsheet/a', outputDir });
            assert.equal(result.status, 'partial', result.reason);
        });
    }
});

test('malformed, CLI and business errors produce failed metadata without leaking secrets', async (t) => {
    for (const [name, program] of [
        ['invalid-json', "console.log('not json');"],
        ['old-rpc', "out({jsonrpc:'2.0',result:{content:[]}});"],
        ['business', "out({errcode:93001,access_token:'business-secret'});"],
        ['cli', "out({error:{code:'UNAUTHORIZED',message:'token=cli-secret'}});process.exit(1);"],
        ['empty', 'out({content:""});'],
    ])
        await t.test(name, async (t) => {
            const { adapter, outputDir } = await setup(t, program);
            const result = await adapter.collectResource({ url: 'https://doc.weixin.qq.com/doc/abc', outputDir });
            assert.equal(result.status, 'failed');
            await assert.rejects(readFile(join(outputDir, 'markdown/document.md')));
            assert.doesNotMatch(
                await readFile(join(outputDir, 'sanitized/metadata.json'), 'utf8'),
                /business-secret|cli-secret/,
            );
        });
});

test('foreign hosts fail before invoking a CLI', async (t) => {
    const { adapter, outputDir } = await setup(t, "throw new Error('should not run');");
    const result = await adapter.collectResource({ url: 'https://evil.example/doc/abc', outputDir });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /unsupported.*URL/);
});

test('legacy task resume requires recollection instead of sending a deleted command', async (t) => {
    const { adapter, root, outputDir } = await setup(t, "throw new Error('should not run');");
    const sessionDir = join(root, 'old');
    await mkdir(join(sessionDir, 'sanitized'), { recursive: true });
    await writeFile(
        join(sessionDir, 'sanitized/metadata.json'),
        JSON.stringify({
            sourceMetadata: { source: 'wecom', resourceKind: 'doc', taskId: 'legacy-task' },
            collection: {
                status: 'partial',
                items: [{ sourceUrl: 'https://doc.weixin.qq.com/doc/abc', materialization: { status: 'pending' } }],
            },
        }),
    );
    const result = await adapter.resumeResource({ sessionDir, outputDir });
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /recollect|重新采集/);
});
