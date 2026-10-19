import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureSessionSkeleton, newSession, persistSession, sessionPaths } from '../session.mjs';
import { resolveRoute, dispatchRoute, evaluateRoute } from './dispatcher.mjs';
import { loadSession } from './plan-store.mjs';
import { parseRequestJson } from './cli.mjs';
import { deliveryCompleteForSession } from '../delivery-state.mjs';
import { commandSchema } from '../knowledge-collection.mjs';

const request={schemaVersion:1,channel:'mail',operation:'discover',selector:{accountContextRef:'work'},criteria:{query:'contracts'},contentRequirement:'full-text',includeAttachments:false};
async function workspace(fn) {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'route-integration-')));
 ensureSessionSkeleton(root);fs.writeFileSync(path.join(root,'session.json'),'{}');const paths=sessionPaths(root);
 const session=newSession({query:'contracts',sourceScope:['mail'],materializationTarget:'selected',requiredContentGranularity:'full-text'});
 session.task.mailBindings=[{ref:'work',revision:'1',kind:'browser',providerHint:'iwhalecloud'}];persistSession(paths,session);
 try {await fn(paths);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
const row={emailId:'m1',subject:'contracts',body:'contracts complete text',contentGranularity:'full-text',date:'2026-09-11T00:00:00Z',attachments:[]};
const mailDependencies={runMail:async args=>args.operation==='list'?{items:[row],coverage:{endObserved:true}}:{items:[row]}};
test('mail discovery and bound materialization publish through the existing collection writer',()=>workspace(async paths=>{
 const discovery=await resolveRoute(paths,request);
 const receipt=await dispatchRoute(paths,discovery.planId,{mailDependencies});
 assert.equal(receipt.status,'complete',JSON.stringify(receipt));
 assert.equal(receipt.candidates.length,1);
 const ref=receipt.candidates.map(({skillItemId,revision})=>({skillItemId,revision}));
 const plan=await resolveRoute(paths,{...request,operation:'materialize',candidateRefs:ref});
 const result=await dispatchRoute(paths,plan.planId,{mailDependencies});
 assert.equal(result.status,'complete',JSON.stringify(result));
 const session=loadSession(paths);
 assert.equal(session.task.publicationStatus,'committed');
 assert.equal(session.collection.collection.items[0].sourceSkill,'mail');
 assert.equal(deliveryCompleteForSession(session),true);
 assert.equal(JSON.parse(fs.readFileSync(paths.collectionResult)).source,'mail');
}));
test('authentication failure commits a failed bundle and does not become empty success',()=>workspace(async paths=>{
 const plan=await resolveRoute(paths,request);
 const result=await dispatchRoute(paths,plan.planId,{mailDependencies:{runMail:async()=>({ok:false,error:{code:'AUTH_REQUIRED'}})}});
 assert.equal(result.status,'needs-user-action');
 assert.equal(loadSession(paths).collection.collection.status,'failed');
 assert.equal(deliveryCompleteForSession(loadSession(paths)),false);
}));
test('missing attachments remain partial and prevent delivery',()=>workspace(async paths=>{
 const plan=await resolveRoute(paths,{...request,includeAttachments:true});
 const result=await dispatchRoute(paths,plan.planId,{mailDependencies:{runMail:async args=>{
  const value={...row,attachments:[{attachmentId:'a1',name:'contract.pdf',size:10}]};
  if(args.operation==='list')return {items:[value],coverage:{endObserved:true}};
  if(args.operation==='read')return {items:[value]};
  return {ok:false,error:{code:'ATTACHMENT_NOT_FOUND'}};
 }}});
 assert.equal(result.status,'partial',JSON.stringify(result));
 assert.equal(deliveryCompleteForSession(loadSession(paths)),false);
}));
test('strict JSON rejects duplicate keys including escaped equivalents',()=>{
 assert.throws(()=>parseRequestJson('{"channel":"mail","chann\\u0065l":"ima"}'),/DUPLICATE/);
 assert.throws(()=>parseRequestJson('{"selector":{"x":1,"x":2}}'),/DUPLICATE/);
 assert.deepEqual(parseRequestJson('{"criteria":{"query":"a:b {x}"}}'),{criteria:{query:'a:b {x}'}});
});
test('source schema adds mail explicitly without changing defaults',()=>{
 const source=commandSchema().commands.init.properties['source-scope'];
 assert.deepEqual(source.default,['public-internet','cloud-knowledge']);assert.ok(source.items.enum.includes('mail'));
 assert.ok(commandSchema().commands['route-resolve']);
});
test('legacy facades reject unsupported strict budgets and preserve workflow ownership',async()=>{
 const session={task:{query:'contracts',sourceScope:['public-internet'],workflow:'public-collect',concurrency:2}};
 const q={schemaVersion:1,channel:'public-internet',operation:'discover',workflow:'public-collect',options:{'fallback-query':'contracts extra','requested-count':2}};
 assert.equal((await evaluateRoute(q,session)).capabilities.budgetOwner,'workflow');
 await assert.rejects(evaluateRoute({...q,budget:{maxScannedItems:10}},session),/UNSUPPORTED_BUDGET/);
 await assert.rejects(evaluateRoute({...q,workflow:'public-discover',options:{}},session),/WORKFLOW_OWNER/);
});

test('registered attachments publish with body and missing files invalidate delivery and receipts',()=>workspace(async paths=>{
 const { collectionStatus }=await import('../collection-state.mjs');
 const { cmdPublish }=await import('../publish-delivery.mjs');
 const value={...row,body:'contracts ![untrusted](../../other.txt)',attachments:[{attachmentId:'a1',name:'contract.txt',size:5}]};
 const deps={mailDependencies:{runMail:async args=>{
  if(args.operation==='list')return {items:[value],coverage:{endObserved:true}};
  if(args.operation==='read')return {items:[value]};
  const file=path.join(args.sessionDir,'verified.txt');fs.writeFileSync(file,'hello',{mode:0o600});
  return {items:[{path:file,size:5}]};
 }}};
 const discovery=await resolveRoute(paths,{...request,includeAttachments:true});
 const found=await dispatchRoute(paths,discovery.planId,deps);
 assert.equal(found.status,'partial');
 const plan=await resolveRoute(paths,{...request,operation:'materialize',includeAttachments:true,candidateRefs:found.candidates.map(({skillItemId,revision})=>({skillItemId,revision}))});
 const result=await dispatchRoute(paths,plan.planId,deps);
 assert.equal(result.status,'complete',JSON.stringify(result));
 assert.equal(collectionStatus(paths).deliveryComplete,true);
 const delivery=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'mail-delivery-')));
 fs.rmdirSync(delivery);
 try {
  cmdPublish(paths,{'delivery-dir':delivery});
  const assets=fs.readdirSync(delivery).find(name=>name.endsWith('-assets'));
  assert.equal(fs.readFileSync(path.join(delivery,assets,'attachments','0.bin'),'utf8'),'hello');
  const local=loadSession(paths).collection.collection.items[0].attachments[0].localPath;
  fs.unlinkSync(path.join(paths.root,local));
  assert.equal(collectionStatus(paths).deliveryComplete,false);
  await assert.rejects(dispatchRoute(paths,plan.planId,deps),/ROUTE_RECEIPT_STALE/);
 }finally{fs.rmSync(delivery,{recursive:true,force:true});}
}));
test('task scan allowance and deadline survive new attempts',()=>workspace(async paths=>{
 const first=await resolveRoute(paths,{...request,budget:{maxScannedItems:1,timeoutMs:30000}});
 await dispatchRoute(paths,first.planId,{mailDependencies});
 const next=await resolveRoute(paths,{...request,attempt:'explicit-refresh',budget:{maxScannedItems:100,timeoutMs:60000}});
 assert.equal(first.deadlineAt,next.deadlineAt);
 await assert.rejects(dispatchRoute(paths,next.planId,{mailDependencies}),/SCAN_BUDGET_EXHAUSTED/);
}));
test('projected list-only discovery fails before any get call',()=>workspace(async paths=>{
 const session=loadSession(paths);session.task.mailBindings=[{ref:'work',revision:'1',kind:'projected',accountId:'p',capabilities:['list']}];
 fs.writeFileSync(paths.session,JSON.stringify(session));
 await assert.rejects(resolveRoute(paths,{...request,contentRequirement:'any'}),/UNSUPPORTED_CAPABILITY/);
}));
test('dead execution owners become interrupted without starting another executor',()=>workspace(async paths=>{
 const { routeStatus }=await import('./dispatcher.mjs');
 const plan=await resolveRoute(paths,request);const file=path.join(paths.root,'.routing',`${plan.planId}.json`);
 fs.writeFileSync(file,JSON.stringify({...plan,state:'running',pid:2147483647,executionRef:plan.planId}));
 assert.equal(routeStatus(paths,plan.planId).state,'interrupted');
 await assert.rejects(dispatchRoute(paths,plan.planId,{execute:()=>assert.fail()}),/ROUTE_INTERRUPTED/);
}));

test('enterprise discovery executes original parser with operation-specific paths',()=>workspace(async paths=>{
 const session=loadSession(paths);session.task.sourceScope=['dingtalk'];session.task.concurrency=2;fs.writeFileSync(paths.session,JSON.stringify(session));
 let calls=0;
 const plan=await resolveRoute(paths,{schemaVersion:1,channel:'dingtalk',operation:'discover',options:{limit:3,concurrency:1}});
 const result=await dispatchRoute(paths,plan.planId,{enterpriseOptions:{adapters:{dingtalk:{connector:'dws',search:async args=>{
  calls++;assert.equal(args.query,'contracts');assert.equal(args.limit,3);assert.equal(args.outputDir,paths.root);
  return {status:'failed',reasonCode:'AUTH_REQUIRED'};
 }}}}});
 assert.equal(calls,1);assert.equal(result.status,'failed',JSON.stringify(result));
}));
test('legacy paused and unavailable outcomes retain their failure semantics',async()=>{
 const {normalizeWorkflowStatus}=await import('./workflows.mjs');
 assert.equal(normalizeWorkflowStatus({status:'paused-user-action',ok:true}),'needs-user-action');
 assert.equal(normalizeWorkflowStatus({status:'infrastructure-blocked',ok:true}),'needs-user-action');
 assert.equal(normalizeWorkflowStatus({status:'unavailable'}),'failed');
});

test('a successful second mailbox cannot erase the first mailbox failure',()=>workspace(async paths=>{
 const session=loadSession(paths);session.task.mailBindings.push({...session.task.mailBindings[0],ref:'other'});fs.writeFileSync(paths.session,JSON.stringify(session));
 const first=await resolveRoute(paths,request);
 await dispatchRoute(paths,first.planId,{mailDependencies:{runMail:async()=>({ok:false,error:{code:'AUTH_REQUIRED'}})}});
 const second=await resolveRoute(paths,{...request,selector:{accountContextRef:'other'}});
 assert.equal((await dispatchRoute(paths,second.planId,{mailDependencies})).status,'complete');
 const published=loadSession(paths);
 assert.equal(published.collection.collection.status,'partial');
 assert.equal(deliveryCompleteForSession(published),false);
 assert.equal(published.collection.sourceMetadata.mail.outcomes.length,2);
 const retry=await resolveRoute(paths,{...request,attempt:'confirmed-login'});
 await dispatchRoute(paths,retry.planId,{mailDependencies});
 assert.equal(loadSession(paths).collection.collection.status,'complete');
}));
