import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateRoute, resolveRoute, dispatchRoute } from './dispatcher.mjs';
import { channels, legacyChannel } from './channels.mjs';

const request={schemaVersion:1,channel:'mail',operation:'discover',selector:{accountContextRef:'work'},criteria:{query:'contracts'},budget:{maxScannedItems:20,maxReturnedItems:5,timeoutMs:10000,maxDownloadedBytes:1000},contentRequirement:'any',includeAttachments:false};
const session={schemaVersion:'2.0',task:{query:'contracts',sourceScope:['mail'],materializationTarget:'selected',requiredContentGranularity:'any',mailBindings:[{ref:'work',revision:'1',kind:'browser',providerHint:'test'}],status:'initialized',startedAt:'2026-09-11T00:00:00Z'}};
async function workspace(fn){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'routing-test-')));fs.writeFileSync(path.join(root,'session.json'),JSON.stringify(session));try{await fn({root,session:path.join(root,'session.json')});}finally{fs.rmSync(root,{recursive:true,force:true});}}
const describe=async()=>({status:'complete',capabilities:{list:'supported',boundedLocalScan:'supported',readFullText:'supported'},bindingRevision:'1',identityBinding:'context-only'});
const result={ok:true,status:'complete',items:[],coverage:{complete:true},errors:[]};
test('registry has skill channels only and legacy commands preserve owners',()=>{
 assert.deepEqual(Object.keys(channels),['public-internet','dingtalk','feishu','wecom','ima','cloud-knowledge','mail']);
 assert.equal(legacyChannel('public-collect'),'public-internet');
 assert.equal(legacyChannel('unified-search'),'public-internet');
 assert.equal(JSON.stringify(channels).includes('iwhalecloud'),false);
});
test('evaluate writes no plan and rejects scope widening or unknown args',async()=>workspace(async paths=>{
 const before=fs.readdirSync(paths.root);
 assert.equal((await evaluateRoute(request,session,{describe})).channel,'mail');
 assert.deepEqual(fs.readdirSync(paths.root),before);
 await assert.rejects(evaluateRoute({...request,channel:'ima'},session),/SOURCE_NOT_AUTHORIZED/);
 await assert.rejects(evaluateRoute({...request,command:'curl'},session),/INVALID_REQUEST/);
}));
test('resolve is idempotent and retains original deadline',async()=>workspace(async paths=>{
 const a=await resolveRoute(paths,request,{describe});
 const b=await resolveRoute(paths,request,{describe});
 assert.equal(a.planId,b.planId);assert.equal(a.deadlineAt,b.deadlineAt);
}));
test('dispatch executes once then reuses committed receipt',async()=>workspace(async paths=>{
 const plan=await resolveRoute(paths,request,{describe});let count=0;
 const deps={describe,execute:async()=>{count++;return result;}};
 assert.equal((await dispatchRoute(paths,plan.planId,deps)).status,'complete');
 assert.equal((await dispatchRoute(paths,plan.planId,deps)).status,'complete');assert.equal(count,1);
}));
test('dispatch rejects changed authorization and account binding',async()=>workspace(async paths=>{
 const plan=await resolveRoute(paths,request,{describe});
 const updated=structuredClone(session);updated.task.mailBindings[0].revision='2';fs.writeFileSync(paths.session,JSON.stringify(updated));
 await assert.rejects(dispatchRoute(paths,plan.planId,{describe,execute:()=>assert.fail()}),/CONTEXT_CHANGED/);
}));
test('concurrent dispatch cannot start a second executor',async()=>workspace(async paths=>{
 const plan=await resolveRoute(paths,request,{describe});let release,started;
 const waitStarted=new Promise(r=>started=r);
 const one=dispatchRoute(paths,plan.planId,{describe,execute:async()=>{started();await new Promise(r=>release=r);return result;}});
 await waitStarted;
 await assert.rejects(dispatchRoute(paths,plan.planId,{describe,execute:()=>assert.fail()}),/ROUTE_IN_PROGRESS/);
 release();await one;
}));
test('executor failure persists safe interrupted receipt without exposing error',async()=>workspace(async paths=>{
 const plan=await resolveRoute(paths,request,{describe});
 const output=await dispatchRoute(paths,plan.planId,{describe,execute:async()=>{throw new Error('password=private');}});
 assert.equal(output.status,'interrupted');assert.equal(JSON.stringify(output).includes('private'),false);
 await assert.rejects(dispatchRoute(paths,plan.planId,{describe,execute:()=>assert.fail()}),/ROUTE_INTERRUPTED/);
}));
test('path escape and symlink control directories are rejected',async()=>workspace(async paths=>{
 await assert.rejects(dispatchRoute(paths,'../outside'),/INVALID_PLAN_ID/);
 fs.symlinkSync(os.tmpdir(),path.join(paths.root,'.routing'));
 await assert.rejects(resolveRoute(paths,request,{describe}),/UNSAFE_ROUTE_PATH/);
}));
test('materialization candidates must reference a committed discovery',async()=>workspace(async paths=>{
 await assert.rejects(resolveRoute(paths,{...request,operation:'materialize',candidateRefs:[{skillItemId:'made-up',revision:'1'}]},{describe}),/CANDIDATE_NOT_AUTHORIZED/);
}));
