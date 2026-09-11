import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, symlink, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute, parseArgs } from './iwhalecloud-mail.mjs';
import { runProcess } from './iwhalecloud/process.mjs';

const row = { emailId: 'mail-id', subject: 'Hello', fromName: 'Sender', fromEmail: 'sender@example.test', date: '2026-09-11T00:00:00Z', body: 'Complete text', bodyType: 'Text', attachments: [] };
const success = (value) => ({ code: 0, stdout: JSON.stringify(value), stderr: '' });
const failure = (code) => ({ code: 1, stdout: '', stderr: JSON.stringify({ok:false,error:{code,message:'private-secret',cause:'private-cookie'}}) });
const deps = (run) => ({ run, bootstrap: async () => ({ok:true}) });

test('check treats an authenticated empty mailbox as available', async () => {
  const result = await execute({operation:'check'}, deps(async () => failure('EMPTY_RESULT')));
  assert.equal(result.ok, true);
  assert.equal(result.identityVerified, false);
  assert.deepEqual(result.items, []);
});
test('list is bounded and does not claim complete mailbox coverage', async () => {
  const result = await execute({operation:'list',limit:1}, deps(async (bin,args) => {
    assert.equal(bin, 'bycli');
    assert.equal(args.includes('--trace'), true);
    assert.equal(args[args.indexOf('--trace')+1], 'off');
    return success([row]);
  }));
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.nextOffset, 1);
});
test('read preserves body but drops unknown auth fields and validates requested id', async () => {
  const result = await execute({operation:'read',message:'mail-id'}, deps(async () => success([{...row,cookie:'private-cookie'}])));
  assert.equal(result.items[0].body, row.body);
  assert.equal(JSON.stringify(result).includes('private-cookie'), false);
  assert.equal((await execute({operation:'read',message:'different'}, deps(async () => success([row])))).error.code, 'INVALID_RESPONSE');
});
test('truncated or missing body is never accepted as full text', async () => {
  for (const value of [{...row,body:undefined},{...row,bodyTruncated:true}]) {
    assert.equal((await execute({operation:'read',message:'mail-id'}, deps(async () => success([value])))).error.code,'INVALID_RESPONSE');
  }
});
test('errors are stable and do not expose CLI diagnostics', async () => {
  for (const code of ['AUTH_REQUIRED','BROWSER_CONNECT','UNKNOWN']) {
    const result = await execute({operation:'list'}, deps(async () => failure(code)));
    assert.equal(result.ok,false);
    assert.equal(JSON.stringify(result).includes('private-'),false);
  }
});
test('bridge terminal prevents bycli execution and is not recovered twice', async () => {
  const result = await execute({operation:'list'}, {bootstrap:async()=>({ok:false,code:'BRIDGE_RECOVERY_BUSY'}),run:()=>assert.fail('must not run')});
  assert.equal(result.error.code,'BRIDGE_RECOVERY_BUSY');
});
test('read-only whitelist and strict arguments reject before bridge startup', async () => {
  const options = {bootstrap:()=>assert.fail('must not bootstrap')};
  for (const operation of ['send','reply','delete','search']) assert.equal((await execute({operation},options)).error.code,'UNSUPPORTED');
  assert.equal((await execute({operation:'list',limit:10001},options)).error.code,'INVALID_REQUEST');
  assert.throws(()=>parseArgs(['list','--token','secret']));
  assert.throws(()=>parseArgs(['list','--limit','1','--limit','2']));
});
test('message values cannot inject shell or CLI flags', async () => {
  const message = '$(touch /tmp/not-created); quoted';
  const result = await execute({operation:'read',message},deps(async (bin,args)=>{
    assert.equal(args[2],message);
    return success([{...row,emailId:message}]);
  }));
  assert.equal(result.ok,true);
  assert.equal((await execute({operation:'read',message:'--help'}, {bootstrap:()=>assert.fail()})).error.code,'INVALID_REQUEST');
});
test('duplicate IDs and malformed output fail closed', async () => {
  for (const output of [success([row,row]),success({items:[row]}),{code:0,stdout:'not json'}]) {
    assert.equal((await execute({operation:'list'},deps(async()=>output))).error.code,'INVALID_RESPONSE');
  }
});

async function withWorkspace(fn) {
  const root = await realpath(await mkdtemp(join(tmpdir(),'mail-wrapper-')));
  try { await fn(root); } finally { await rm(root,{recursive:true,force:true}); }
}
function downloadDeps(root, overrides={}) {
  return { ...deps(async (bin,args) => {
    if (args[1]==='read') return success([{...row,attachments:[{attachmentId:'att',name:'report.txt',kind:'FileAttachment',size:4,contentType:'text/plain'}]}]);
    const path=join(args[args.indexOf('--output')+1],'report.txt');
    await writeFile(path,'data');
    return success([{emailId:'mail-id',attachmentId:'att',name:'report.txt',path,size:4,contentType:'text/plain'}]);
  }), roots:[root], ...overrides };
}
const downloadRequest = (root) => ({operation:'download',message:'mail-id',attachment:'att',sessionDir:root});
test('download publishes privately without overwriting and tracks cumulative session budget', async () => withWorkspace(async(root)=>{
  const a=await execute(downloadRequest(root),downloadDeps(root));
  const b=await execute(downloadRequest(root),downloadDeps(root));
  assert.equal(a.ok,true); assert.equal(b.ok,true);
  assert.equal(await readFile(a.items[0].path,'utf8'),'data');
  assert.equal((await stat(a.items[0].path)).mode & 0o777, 0o600);
  assert.notEqual(a.items[0].path,b.items[0].path);
  assert.equal((await execute(downloadRequest(root),downloadDeps(root,{maxSessionBytes:8}))).error.code,'DOWNLOAD_LIMIT');
}));
test('download rejects symlink directory and unbounded all selector', async()=>withWorkspace(async(root)=>{
  await mkdir(join(root,'real')); await symlink(join(root,'real'),join(root,'link'));
  assert.equal((await execute({...downloadRequest(root),sessionDir:join(root,'link')},downloadDeps(root))).error.code,'INVALID_REQUEST');
  assert.equal((await execute({...downloadRequest(root),attachment:'all'},downloadDeps(root))).error.code,'INVALID_REQUEST');
}));
test('download refuses oversized metadata and removes failed staging files',async()=>withWorkspace(async(root)=>{
  assert.equal((await execute(downloadRequest(root),downloadDeps(root,{maxFileBytes:3}))).error.code,'DOWNLOAD_LIMIT');
  const result=await execute(downloadRequest(root),downloadDeps(root,{run:async(bin,args)=>{
    if(args[1]==='read') return success([{...row,attachments:[{attachmentId:'att',name:'x',kind:'FileAttachment',size:1}]}]);
    await writeFile(join(args[args.indexOf('--output')+1],'partial'),'data');
    return failure('TIMEOUT');
  }}));
  assert.equal(result.ok,false);
  assert.deepEqual(await readdir(join(root,'mail-attachments')),[]);
}));
test('download rejects returned paths outside staging',async()=>withWorkspace(async(root)=>{
  const file=join(root,'outside');await writeFile(file,'data');
  const run=async(bin,args)=>args[1]==='read'
    ? success([{...row,attachments:[{attachmentId:'att',name:'x',kind:'FileAttachment',size:4}]}])
    : success([{emailId:'mail-id',attachmentId:'att',path:file,size:4}]);
  assert.equal((await execute(downloadRequest(root),downloadDeps(root,{run}))).error.code,'INVALID_RESPONSE');
  assert.equal(await readFile(file,'utf8'),'data');
}));
test('process runner enforces output and time budgets without echoing diagnostics',async()=>{
  const output=await runProcess(process.execPath,['-e','process.stdout.write("x".repeat(10000))'],{maxOutputBytes:100});
  assert.equal(output.failure,'OUTPUT_LIMIT');
  const timed=await runProcess(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeoutMs:40});
  assert.equal(timed.failure,'UPSTREAM_UNAVAILABLE');
});

test('process monitor cancels an active download before it finishes',async()=>withWorkspace(async(root)=>{
  const file=join(root,'stream');
  const result=await runProcess(process.execPath,['-e',`const fs=require('fs');setInterval(()=>fs.appendFileSync(process.argv[1],Buffer.alloc(1024)),5)`,file],{
    timeoutMs:2000,monitor:async()=>{ if((await stat(file).catch(()=>({size:0}))).size>4096) throw new Error('limit'); }
  });
  assert.equal(result.failure,'DOWNLOAD_LIMIT');
  assert.ok((await stat(file)).size<200000);
}));
test('download lock prevents concurrent tasks consuming the same session budget',async()=>withWorkspace(async(root)=>{
  await mkdir(join(root,'.mail-download.lock'));
  assert.equal((await execute(downloadRequest(root),downloadDeps(root))).error.code,'DOWNLOAD_BUSY');
}));
test('failed publication never follows a returned attachment symlink',async()=>withWorkspace(async(root)=>{
  const outside=join(root,'outside');await writeFile(outside,'secret');
  const run=async(bin,args)=>{
    if(args[1]==='read') return success([{...row,attachments:[{attachmentId:'att',name:'x',kind:'FileAttachment',size:6}]}]);
    const path=join(args[args.indexOf('--output')+1],'x');await symlink(outside,path);
    return success([{emailId:'mail-id',attachmentId:'att',path,size:6}]);
  };
  assert.equal((await execute(downloadRequest(root),downloadDeps(root,{run}))).ok,false);
  assert.equal(await readFile(outside,'utf8'),'secret');
}));
