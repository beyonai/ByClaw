import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ByClawGroupCoordinationRuntime, parseGroupCoordination, groupScopedPersona } from '../lib/group-coordination.js'
import { writeAgentTemplate } from '../lib/agent-template.js'
import { byClawInboundTurnContextDeclaration, buildByClawInboundTurnContext } from '../lib/inbound-context.js'
import { ByClawExternalWorkerAdapter, externalWorkerEvent, externalWorkerPayload, externalWorkerTarget } from '../lib/group-worker.js'
import { ByClawAsyncTeamGate } from '../lib/session-runtime.js'
import { prepareGroupAssistanceReturn } from '@byclaw/dsh-agent-teams'
import { registerAgentTeamsTool } from '../../agent-teams/lib/tools.js'

const coordination = { schemaVersion: 'byclaw.group-coordination/v1', mode: 'COORDINATED', groupSessionId: 'g', taskSessionId: 't', coordinatorAgentId: 'leader', allowedAgentIds: ['b', 'a', 'a'] }
assert.deepEqual(parseGroupCoordination(coordination).allowedAgentIds, ['a', 'b'])
assert.equal(parseGroupCoordination(undefined), undefined)
assert.throws(() => parseGroupCoordination({ ...coordination, mode: 'bad' }))
assert.deepEqual(parseGroupCoordination({ ...coordination, mode: 'DIRECT', allowedAgentIds: [] }).allowedAgentIds, [])
assert.throws(() => parseGroupCoordination({ ...coordination, allowedAgentIds: [] }))
const catalogDir = await mkdtemp(join(tmpdir(), 'byclaw-group-'))
try {
  const employees = ['leader','a','b','c'].map(id => ({ id, name: id, code: id, description: '', capabilities: '', persona: '', workerAgentType: id === 'b' ? 'BYCLAW_CODE' : 'BYCLAW_EXE', skills: [] }))
  for (const employee of employees) await writeAgentTemplate(catalogDir, { schemaVersion: 'dsh.agent-template/v1', id: `byclaw-employee-${employee.id}`, kind: 'agent', name: employee.name, description: '', persona: 'Own role', skills: [], source: { system: 'byclaw', resourceId: employee.id, resourceCode: employee.code, workerAgentType: employee.workerAgentType, directlyAuthorized: true } })
  const resources = { employees, groups: [], directEmployeeIds: employees.map(e=>e.id), authorization: { resourceIds: employees.map(e => e.id) } }
  const runtime = new ByClawGroupCoordinationRuntime({ resources: () => resources, catalogDir, supportedWorkerTypes: ['BYCLAW_EXE'], resolveModel: async () => ({ provider: 'fake', model: 'fake' }), executeExternal: async () => ({ output: 'external' }) })
  const parsed = parseGroupCoordination(coordination)
  await runtime.validate(parsed)
  const routed = parseGroupCoordination({ ...coordination, effectiveWorkerAgentTypes: { leader: 'BYCLAW_DSH_u', a: 'BYCLAW_DSH_u', b: 'BYCLAW_CODE_u' } })
  const routedEmployees = { ...resources, employees: employees.map(employee => employee.id === 'a' ? { ...employee, workerAgentType: 'BYCLAW_EXE' } : employee) }
  const routedRuntime = new ByClawGroupCoordinationRuntime({ resources: () => routedEmployees, catalogDir, supportedWorkerTypes: ['BYCLAW_DSH_u'], resolveModel: async () => ({ provider: 'fake', model: 'fake' }), executeExternal: async (_request, _scope, type) => ({ output: type }) })
  await routedRuntime.validate(routed)
  routedRuntime.bind('routed-captain', 'leader', undefined, routed)
  const routedRoster = await routedRuntime.template('routed-captain')
  assert.equal(routedRoster.members.find(member => member.source.employeeId === 'a').source.workerAgentType, 'BYCLAW_DSH_u')
  assert.equal(routedRoster.members.find(member => member.source.employeeId === 'b').source.workerAgentType, 'BYCLAW_CODE_u')
  assert.equal(routedEmployees.employees.find(employee => employee.id === 'a').workerAgentType, 'BYCLAW_EXE')
  assert.throws(() => parseGroupCoordination({ ...coordination, effectiveWorkerAgentTypes: { leader: 'BYCLAW_DSH_u' } }), /route/)
  assert.throws(() => parseGroupCoordination({ ...routed, effectiveWorkerAgentTypes: { ...routed.effectiveWorkerAgentTypes, c: 'BYCLAW_DSH_u' } }), /outside/)
  runtime.bind('captain','leader',undefined,parsed)
  runtime.bind('worker-a','a','captain')
  assert.deepEqual([...runtime.visibleEmployeeIds('worker-a')], ['leader'])
  assert.deepEqual((await runtime.template('captain')).members.map(m => m.name), ['a','b'])
  assert.equal(runtime.isLocalWorker('HARNESS'),true)
  assert.equal(runtime.isLocalWorker('HARNESS_u'),true)
  assert.equal(runtime.isLocalWorker('BYCLAW_DSH'),true)
  for(const integrationType of ['INTERFACE','A2A']) {
    const metadata={...employees.find(employee=>employee.id==='b'),createType:'FROM_THIRD',integrationType}
    const unsupported=new ByClawGroupCoordinationRuntime({resources:()=>({...resources,employees:[...employees.filter(employee=>employee.id!=='b'),metadata]}),catalogDir,supportedWorkerTypes:['BYCLAW_EXE'],resolveModel:async()=>({provider:'fake',model:'fake'}),executeExternal:async()=>({output:'must not execute'})})
    await assert.rejects(()=>unsupported.validate(parsed),new RegExp(integrationType+' integration route'))
  }
  assert.throws(() => runtime.bind('worker-c','c','captain'))
  assert.throws(() => runtime.bind('worker-a','b','captain'))
  assert.throws(() => runtime.assertTemplate({ id: 'captain' }, 'byclaw-employee-c'))
  assert.throws(() => runtime.assertTemplate({ id: 'captain' }, 'byclaw-employee-b'), /external worker/)
  const next = { ...parsed, taskSessionId: 't2', allowedAgentIds: ['a','c'] }
  runtime.bind('captain2','leader',undefined,next)
  assert.notEqual(runtime.get('captain').templateId,runtime.get('captain2').templateId)
  assert.deepEqual((await runtime.template('captain2')).members.map(m => m.name), ['a','c'])
  const directPreparations = []
  const coldDirect = new ByClawGroupCoordinationRuntime({ resources: () => resources, catalogDir,
    supportedWorkerTypes: ['BYCLAW_EXE'], resolveModel: async () => ({ provider: 'fake', model: 'fake' }),
    prepareEmployee: async id => { directPreparations.push(id) }, executeExternal: async () => ({ output: 'external' }) })
  const directScope = { ...parsed, mode: 'DIRECT' }
  await coldDirect.validate(directScope)
  assert.deepEqual(directPreparations, ['leader'], 'ordinary DIRECT conversation must not eagerly prepare members')
  coldDirect.bind('cold-direct', 'leader', undefined, directScope)
  await coldDirect.prepareTeam('cold-direct')
  assert.deepEqual(directPreparations, ['leader', 'a', 'b'], 'team use prepares its allowed dependencies before catalog admission')
  await assert.rejects(coldDirect.prepareSelected(directScope, 'byclaw-employee-c'), /outside/)
  const privateLoads=[]
  const emptyResources={...resources,employees:[],directEmployeeIds:[]}
  const privateRuntime=new ByClawGroupCoordinationRuntime({resources:()=>emptyResources,catalogDir,supportedWorkerTypes:['BYCLAW_EXE'],resolveModel:async()=>({provider:'fake',model:'fake'}),executeExternal:async()=>({output:'external'}),loadScopedEmployee:async (_scope,id)=>{
    privateLoads.push(id)
    const employee=employees.find(e=>e.id===id)
    return {employee,template:{id:`byclaw-employee-${id}`,persona:'private',skills:[],source:{resourceId:id,workerAgentType:employee.workerAgentType}}}
  }})
  await privateRuntime.validate(parsed)
  privateRuntime.bind('private-captain','leader',undefined,parsed)
  assert.deepEqual((await privateRuntime.template('private-captain')).members.map(m=>m.name),['a','b'])
  assert.deepEqual(privateLoads.sort(),['a','b','leader'])
  assert.equal(privateRuntime.resourcesFor('unscoped').employees.length,0,'scoped fallback must not expand ordinary resource discovery')
  await assert.rejects(()=>privateRuntime.resolveTemplate(parsed,'byclaw-employee-c'))
  assert.match(groupScopedPersona(runtime.get('worker-a'), 'Own role'), /group_request_assistance/)
  assert.match(groupScopedPersona(runtime.get('captain'), 'Own role'), /This task is GROUP_TASK/)
  runtime.bind('direct-helper','leader',undefined,{...parsed,mode:'DIRECT'})
  const directPersona=groupScopedPersona(runtime.get('direct-helper'),'Own role')
  assert.match(directPersona,/Follow the configured CHAT\/TASK classification protocol/)
  assert.equal(directPersona.includes('do not classify it as CHAT'),false)
  const assistancePersona=groupScopedPersona(runtime.get('direct-helper'),'Own role','assistance')
  assert.match(assistancePersona,/already assigned task/)
  assert.match(assistancePersona,/Do not classify CHAT\/TASK again/)
  assert.equal(assistancePersona.includes('Follow the configured CHAT/TASK'),false)
  const context = buildByClawInboundTurnContext({ header: { messageId: 'm' }, extraPayload: { groupCoordination: parsed, resource_list: employees.map(e => ({ resourceType: 'DIG_EMPLOYEE', resourceId: e.id, resourceName: e.name })) } })
  const text = byClawInboundTurnContextDeclaration(context, runtime.get('worker-a'))
  assert.match(text,/leader/)
  assert.equal(text.includes('"resourceId":"b"'), false)
  let executed = 0
  const tools = new Map()
  registerAgentTeamsTool({ get: () => runtime, effect: op => op(), tools: { register: def => tools.set(def.name,def) } }, { name: 'agent_teams_list_templates', execute: async () => { executed++; return {} } })
  await assert.rejects(() => tools.get('agent_teams_list_templates').execute({}, { agent: { id: 'worker-a' } }))
  assert.equal(executed,0)
} finally { await rm(catalogDir,{recursive:true,force:true}) }

const team = { tasks: [{ id: 'task', attemptId: 'attempt', waitingAssistance: 'request', status: 'in_progress' }], assistanceRequests: [{ id: 'request', taskId: 'task', attemptId: 'attempt', requesterId: 'worker', status: 'pending' }] }
assert.throws(() => prepareGroupAssistanceReturn(team,'request','another','result'))
assert.match(prepareGroupAssistanceReturn(team,'request','worker','result'), /same task/)
assert.equal(team.tasks[0].attemptId,'attempt')
assert.equal(team.tasks[0].waitingAssistance,undefined)
assert.throws(() => prepareGroupAssistanceReturn(team,'request','worker','duplicate'))
const stale = { tasks: [{ id: 'task', attemptId: 'new', status:'in_progress' }], assistanceRequests: [{ id:'request',taskId:'task',attemptId:'old',requesterId:'worker',status:'pending' }] }
assert.throws(() => prepareGroupAssistanceReturn(stale,'request','worker','late'))

const gate = new ByClawAsyncTeamGate(1000,10)
gate.observe({ type: 'tool/ptc-dispatch-start', data: { name:'group_request_assistance',subCallId:'assist' } })
assert.equal(gate.waiting,true)
gate.observe({type:'tool/ptc-dispatch',data:{name:'group_request_assistance',subCallId:'assist',isError:true}})
gate.observe({type:'turn/end',data:{reason:{kind:'completed'}}})
assert.equal(gate.waiting,false)

const sanitized=externalWorkerPayload({agent_id:'leader',agent_code:'captain-code',employeeId:'leader',digitalEmployeeId:'leader',model_id:'captain-model',persona:'captain',cwd:'/by',resource_list:[{resourceType:'COMMON_FILE',resourceId:'file'}],files:[{fileId:'file'}],extParams:{dsh_target_session_id:'old',modelId:'old',attachments:[{fileId:'nested'}]}},'b','worker-model')
assert.equal(sanitized.agent_id,'b')
assert.equal(sanitized.model_id,'worker-model')
assert.equal(sanitized.agent_code,undefined)
assert.equal(sanitized.persona,undefined)
assert.equal(sanitized.employeeId,undefined)
assert.equal(sanitized.digitalEmployeeId,undefined)
assert.equal(sanitized.resource_list,undefined)
assert.equal(sanitized.files,undefined)
assert.equal(sanitized.extParams.attachments,undefined)
assert.equal(sanitized.extParams.dsh_target_session_id,undefined)
assert.equal(sanitized.extParams.modelId,undefined)
assert.equal(externalWorkerPayload({metadata:JSON.stringify({resourceList:[{resourceType:'COMMON_FILE',resourceId:'video'}]})},'b').metadata,undefined)

// SDK execution state and exact root event identity jointly determine completion.
async function bridge(statuses, options = {}, originExtra = {}, originContent) {
  let sent
  let reads=0
  let disconnected=0
  const cancels=[]
  const dispatches=[]
  const fakeRedis={ duplicate: () => ({ async xread() {
    reads++
    const event = { session_id:sent.sessionId,trace_id:sent.traceId,source_agent_type:sent.targetAgentType,message_id:sent.messageId,data:{contentType:'1002',choices:[{delta:{content:'final result'}}]} }
    if(reads>1) return null
    return [[ 'stream', [['1-0',['data',JSON.stringify({...event,trace_id:'other',event_type:'finalAnswer'})]],['2-0',['data',JSON.stringify({...event,event_type:'finalAnswer'})]],['3-0',['data',JSON.stringify({...event,event_type:'appStreamResponse'})]]]]]
  }, disconnect(){ disconnected++ } }) }
  const ports={client:{async sendMessage(params){sent=params;return {success:true}},async cancelSession(params){cancels.push(params);return {success:true}}},registry:{async getRandomOnlineWorker(){return 'exact-employee-worker'},async getExecutionByMessageId(){ return { trace_id:sent.traceId,status: statuses.shift() ?? 'COMPLETED' } }}}
  const adapter = new ByClawExternalWorkerAdapter(fakeRedis,()=>({ context:{},userCode:'u',extraPayload:{byclaw_root_session_id:'old',dsh_target_session_id:'old-child',...originExtra},content:originContent,isCancelled:()=>false }),ports)
  const request={captainSessionId:'captain',employeeId:'b',workerAgentType:'BYCLAW_CODE',taskId:'task',attemptId:'attempt',prompt:'work',signal:new AbortController().signal,isCurrent:async()=>true,onDispatched:async record=>dispatches.push(record),...options}
  const scope={coordination:parseGroupCoordination(coordination),role:'coordinator',employeeId:'leader'}
  const result=await adapter.execute(request,scope,'BYCLAW_CODE')
  return {result,sent,reads,disconnected,cancels,dispatches}
}
const success=await bridge(['RUNNING','COMPLETED'])
assert.equal(success.result.output,'final result')
assert.equal(success.reads,2,'stream end before execution completion must not finish the task')
assert.equal(success.sent.sourceAgentType,'')
assert.equal(success.sent.targetAgentType,'BYCLAW_CODE_u')
assert.equal(success.sent.targetWorkerId,'exact-employee-worker','SDK direct worker routing must bypass cross-engine availability fallback')
assert.equal(success.dispatches[0].workerAgentType,'BYCLAW_CODE_u')
assert.equal(externalWorkerTarget('BYCLAW_EXE_other','u'),'BYCLAW_EXE_u')
assert.equal(externalWorkerTarget('BY_SUPER','u'),'BY_SUPER')
assert.throws(()=>externalWorkerTarget('HARNESS','u'),/local Harness/)
assert.equal(success.sent.extraPayload.agent_id,'b')
assert.equal(success.sent.extraPayload.byclaw_root_session_id,undefined)
assert.equal(success.sent.extraPayload.dsh_target_session_id,undefined)
assert.equal(success.sent.extraPayload.groupCoordination.mode,'DIRECT')
assert.equal(success.disconnected,1)
await assert.rejects(()=>bridge(['FAILED']),/failed/)
await assert.rejects(()=>bridge(['WAITING_USER']),/requires user input/)
const attached = await bridge(['COMPLETED'], {}, {resource_list:[{resourceType:'COMMON_FILE',resourceId:'video'},{resourceType:'DIG_EMPLOYEE',resourceId:'leader'}]}, [{files:[{fileId:'video',fileName:'input.mp4'}]}])
assert.deepEqual(attached.sent.content[0].content.files,[{fileId:'video',fileName:'input.mp4'}])
assert.deepEqual(attached.sent.extraPayload.resource_list,[{resourceType:'COMMON_FILE',resourceId:'video'}])
assert.equal(attached.sent.extraPayload.agent_id,'b')
const camel=await bridge(['COMPLETED'],{}, {metadata:JSON.stringify({fileList:[{fileId:'video'}],resourceList:[{resourceType:'KG_DOC_FILE',resourceId:'kg'}]})})
assert.deepEqual(camel.sent.content[0].content.files,[{fileId:'video'}])
assert.deepEqual(camel.sent.extraPayload.resource_list,[{resourceType:'KG_DOC_FILE',resourceId:'kg'}])
const historyOnly = await bridge(['COMPLETED'], {}, {groupContextSnapshot:{messages:[{attachments:[{fileId:'old-history-file'}],resourceList:[{resourceType:'COMMON_FILE',resourceId:'old-history-file'}]}]}})
assert.deepEqual(historyOnly.sent.content[0].content.files,[])
assert.deepEqual(historyOnly.sent.extraPayload.resource_list,[])
assert.equal(historyOnly.sent.extraPayload.groupContextSnapshot,undefined,'external tasks get their explicit assigned context rather than the raw root snapshot')
const snowflakeFile=await bridge(['COMPLETED'],{}, {},[{content:{files:[{fileId:'8000000000000000123',fileName:'video.mp4'}]}}])
assert.equal(snowflakeFile.sent.content[0].content.files[0].fileId,'8000000000000000123','opaque BE file IDs retain exact wire precision')
await assert.rejects(()=>bridge([],{}, {},[{files:[{fileName:'lost-reference.mp4'}]}]),/no usable file reference/)
await assert.rejects(()=>bridge([],{}, {resource_list:[{resourceType:'KG_DOC_DIR',resourceId:'folder'}]}),/Unsupported shared task resource type KG_DOC_DIR/)
assert.equal(externalWorkerEvent({session_id:'s',trace_id:'x',source_agent_type:'B',message_id:'m'}, {sessionId:'s',traceId:'t',workerAgentType:'B',messageId:'m'}),undefined)
// Exact task attempts own background external worker dispatch and cold resumes.
import { installTeamScheduler } from '../../agent-teams/lib/scheduler.js'
import { beginTaskAttempt, createTeamDir, readTeam, writeTeam } from '../../agent-teams/lib/state.js'
import { resolveTeamStateRoot } from '../../agent-teams/lib/runtime-state.js'
const stateWorkspace = await mkdtemp(join(tmpdir(),'byclaw-group-scheduler-'))
try {
  const stateRoot=resolveTeamStateRoot(stateWorkspace,'.agent-teams')
  const messages=[]
  let jobs=[]
  let resolveExternal
  const externalResult=new Promise(resolve=>resolveExternal=resolve)
  const captain={id:'captain',status:'idle',session:{header:{cwd:stateWorkspace}},steer(message){messages.push(message)}}
  const policy={get(){return undefined},async executeExternal(request){jobs.push(request); await request.onDispatched({sessionId:'sdk-child',messageId:'sdk-message',traceId:'sdk-trace',workerAgentType:'BYCLAW_CODE'}); return externalResult}}
  const ctx={get(){return policy},effect(fn){return fn()},on(){return ()=>{}},agents:{get(id){return id==='captain'?captain:undefined}},logger:{warn(){}}}
  const team={id:'group',name:'group',captainSessionId:'captain',createdAt:0,taskSeq:1,
    members:[{id:'external',name:'b',runtime:'byclaw-worker',source:{employeeId:'b',workerAgentType:'BYCLAW_CODE'},status:'idle',joinedAt:0}],
    tasks:[{id:'task',subject:'work',assignee:'b',status:'pending',dependencies:[],createdAt:0,updatedAt:0}]}
  await createTeamDir(stateRoot,team)
  const scheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:1})
  await scheduler.kickTeam(stateWorkspace,team.id,captain)
  await scheduler.kickTeam(stateWorkspace,team.id,captain)
  assert.equal(jobs.length,1,'concurrent kicks must not redispatch an active attempt')
  let current=await readTeam(stateRoot,team.id)
  const originalAttempt=current.tasks[0].attemptId
  assert.equal(current.tasks[0].externalExecution.sessionId,'sdk-child')
  resolveExternal({output:'result'})
  for(let i=0;i<50 && (await readTeam(stateRoot,team.id)).tasks[0].status!=='completed';i++) await new Promise(resolve=>setTimeout(resolve,5))
  current=await readTeam(stateRoot,team.id)
  assert.equal(current.tasks[0].status,'completed')
  assert.equal(current.tasks[0].attemptId,originalAttempt)
  assert.equal(current.tasks[0].output,'result')
  for(let i=0;i<50 && messages.length===0;i++) await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(messages.length,1)
  // A new scheduler represents a process restart; it resumes the stored SDK
  // execution using the same attempt instead of inventing another request.
  current.tasks[0].status='claimed';current.members[0].status='working'
  await writeTeam(stateRoot,current)
  jobs=[]
  const restarted=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:1})
  await restarted.kickTeam(stateWorkspace,team.id,captain)
  assert.equal(jobs.length,1)
  assert.equal(jobs[0].attemptId,originalAttempt)
  assert.equal(jobs[0].execution.messageId,'sdk-message')
  for(let i=0;i<50 && (await readTeam(stateRoot,team.id)).tasks[0].status!=='completed';i++) await new Promise(resolve=>setTimeout(resolve,5))
  // A suspended assistance attempt must not be classified as a lost turn.
  current=await readTeam(stateRoot,team.id)
  current.tasks[0].status='in_progress';current.tasks[0].waitingAssistance='req';current.members[0].status='idle'
  await writeTeam(stateRoot,current);jobs=[]
  await restarted.kickTeam(stateWorkspace,team.id,captain)
  assert.equal(jobs.length,0)
  const retry={...current.tasks[0]}
  beginTaskAttempt(retry,'b')
  assert.equal(retry.externalExecution,undefined)
  assert.equal(retry.waitingAssistance,undefined)
  assert.notEqual(retry.attemptId,originalAttempt)
} finally { await rm(stateWorkspace,{recursive:true,force:true}) }

console.log('PASS group scope, task-isolated roster, constrained tools, linked assistance, SDK worker identity/terminal/cancellation policies')
