import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTeamStateRoot, assistanceFingerprint, requestGroupMemberAssistance, prepareGroupAssistanceReturn,
  setGroupTaskSummary, validateGroupTaskSummary, groupTaskSummaryOutcome, finalizeGroupTaskSummary, assertGroupTaskAdmission,
  GroupWorkerBlockedError } from '@byclaw/dsh-agent-teams'
import { createTeamDir, readTeam, writeTeam, readMailbox, appendMailbox, createMessage, claimMailboxDelivery } from '../../agent-teams/lib/state.js'
import { beginGroupAssistanceResultDelivery } from '../../agent-teams/lib/group-assistance.js'
import { registerAgentTeamsTools } from '../../agent-teams/lib/tools.js'
import { installTeamScheduler } from '../../agent-teams/lib/scheduler.js'
import { requestSoloAssistance, resolveSoloAssistance, soloAssistanceForChild } from '../lib/group-assistance-ledger.js'
import { registerAgentTemplateRuntime } from '../lib/template-runtime.js'
import { ByClawSessionWorkspaceRegistry } from '../lib/session-workspace.js'
import { ByClawAsyncTeamGate } from '../lib/session-runtime.js'
import { deliverSubagentPrompt } from '@deepseek-ai/dsh-subagent/internal'

const workspace = await mkdtemp(join(tmpdir(), 'byclaw-group-robustness-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = join(workspace, 'runtime-home')
const businessWorkspace = join(workspace, 'business')
const stateRoot = resolveTeamStateRoot(businessWorkspace, '.agent-teams')
const scope = { schemaVersion:'byclaw.group-coordination/v1', mode:'COORDINATED', groupSessionId:'g', taskSessionId:'task', coordinatorAgentId:'helper', allowedAgentIds:['a','b'] }
const task = (id,assignee,status='pending') => ({ id,subject:id,description:id,assignee,status,dependencies:[],acceptanceCriteria:'actual output',requiredTools:[],createdAt:0,updatedAt:0,inputRevision:'user-1' })
const member = (id,name=id) => ({ id,name,status:'idle',joinedAt:0,source:{employeeId:name,workerAgentType:'HARNESS'} })
const team = (id,tasks) => ({ id,name:id,captainSessionId:'captain',createdAt:0,taskSeq:tasks.length,members:[member('member','a'),member('member-b','b')],tasks,groupCoordination:scope,inputRevision:'user-1',controlledWorkflow:true,lifecycle:'running' })
let revision='user-1'
const scopes=new Map([['captain',{coordination:scope,role:'coordinator',employeeId:'helper',templateId:'scoped'}],['member',{coordination:scope,role:'member',employeeId:'a',templateId:'scoped'}]])
const notifications=[]
const captain={id:'captain',status:'idle',session:{header:{cwd:businessWorkspace},events:[],append(){}},steer(message){notifications.push(message)},whenIdle(){return Promise.resolve()}}
const employee={id:'member',status:'idle',session:{header:{cwd:businessWorkspace},events:[],append(){}},steer(){},whenIdle(){return Promise.resolve()}}
const agents=new Map([['captain',captain],['member',employee]])
const definitions=new Map()
const ctx={get:()=>policy,effect:fn=>fn(),on:()=>()=>{},agents:{get:id=>agents.get(id),withoutInitiator:fn=>fn()},
  subagents:{registerContinuableSetup(){},listChildren:async()=>[],listDescendants:async()=>[],[deliverSubagentPrompt]:async()=>'accepted',getProvider:()=>({prepareContinuable(){},capabilities:{persona:true}})},
  tools:{register:def=>definitions.set(def.name,def)},logger:{warn(){},debug(){}},llm:{resolveCallConfig:async value=>value}}
const policy={get:id=>scopes.get(id),inputRevision:()=>revision,getContext:()=>undefined,isLocalWorker:()=>true}
const signal=new AbortController().signal
const exec={agent:captain,signal,concludeTurn(){}}
try {
  // Completed caches do not depend on tool-generated inputs or cosmetic objective whitespace.
  const t=team('assistance',[{...task('t1','a','in_progress'),attemptId:'attempt'}])
  await createTeamDir(stateRoot,t)
  const first=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','  Find SCRIPT  ','facts')
  const repeat=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','find script','changed model wording')
  assert.equal(repeat.requestId,first.requestId);assert.equal(repeat.reused,true)
  let current=await readTeam(stateRoot,t.id)
  assert.equal(current.assistanceRequests.length,1)
  prepareGroupAssistanceReturn(current,first.requestId,employee.id,'the actual script',{inputRevision:revision})
  await writeTeam(stateRoot,current)
  const cached=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','find script')
  assert.equal(cached.status,'completed');assert.equal(cached.result,'the actual script');assert.equal(cached.reused,true)
  const phase2=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','Find video materials','script obtained')
  assert.notEqual(phase2.requestId,first.requestId,'different legitimate gaps have no collaboration-count limit')
  current=await readTeam(stateRoot,t.id)
  prepareGroupAssistanceReturn(current,phase2.requestId,employee.id,'Upload your product images',{status:'blocked',blockingReason:'missing_user_input',inputRevision:revision})
  await writeTeam(stateRoot,current)
  const blocked=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','Reworded materials request')
  assert.equal(blocked.status,'blocked');assert.equal(blocked.requestId,phase2.requestId)
  assert.throws(()=>assertGroupTaskAdmission(current,revision,current.tasks[0]),/waiting for user/)
  revision='user-2'
  prepareGroupAssistanceReturn(current,phase2.requestId,employee.id,'the newly supplied product images',{inputRevision:revision})
  assert.equal(current.tasks[0].attemptId,'attempt');assert.equal(current.tasks[0].inputRevision,revision,'new inputs resume the original attempt with the actual new input revision')
  await writeTeam(stateRoot,current)
  const revisedResult=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','Find video materials')
  assert.equal(revisedResult.status,'completed');assert.equal(revisedResult.result,'the newly supplied product images');assert.equal(revisedResult.requestId,phase2.requestId)
  const newInputs=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','Prepare the video editing timeline','new uploaded image')
  assert.notEqual(newInputs.requestId,phase2.requestId)
  // Recover the write-team/append-mailbox crash window with one stable message identity.
  await rm(join(stateRoot,t.id,'inbox','captain.jsonl'),{force:true})
  const coldRequestScheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:999})
  await coldRequestScheduler.kickTeam(businessWorkspace,t.id,captain)
  assert.equal((await readMailbox(stateRoot,t.id,'captain')).length,1,'cold scheduler reconstructs the original pending request outbox without a model retry')
  const recovered=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','Prepare the video editing timeline')
  assert.equal(recovered.requestId,newInputs.requestId)
  const recoveredMail=await readMailbox(stateRoot,t.id,'captain')
  assert.equal(recoveredMail.length,1);assert.equal(recoveredMail[0].id,`group-assistance:${newInputs.requestId}`)
  await rm(join(stateRoot,t.id),{recursive:true})

  // Initial metadata comes from explicit captain inputs; outcomes come from actual task state.
  revision='user-1'
  const plan=team('summary',[])
  setGroupTaskSummary(plan,{title:'Product video',goal:'Create a product video',deliverables:['video'],assignments:[]},revision)
  assert.equal(groupTaskSummaryOutcome(plan,revision).status,'blocked');assert.ok(validateGroupTaskSummary(plan).length)
  plan.tasks=[task('t1','a'),task('t2','b')]
  setGroupTaskSummary(plan,{title:'Product video',goal:'Create a product video',deliverables:['video'],assignments:[{task_id:'t1',deliverable:'video'},{task_id:'t2',deliverable:'video'}]},revision)
  assert.deepEqual(validateGroupTaskSummary(plan),[])
  plan.tasks[0].status='in_progress';plan.tasks[0].waitingUser={reason:'missing_user_input',message:'need images',inputRevision:revision}
  plan.tasks[1].status='in_progress'
  assert.equal(groupTaskSummaryOutcome(plan,revision).status,'running');assert.throws(()=>finalizeGroupTaskSummary(plan,revision),/still running/)
  plan.tasks[1].status='pending';plan.tasks[1].dependencies=['t1']
  assert.equal(finalizeGroupTaskSummary(plan,revision).status,'blocked')
  delete plan.tasks[0].waitingUser
  plan.tasks[0].status='completed';plan.tasks[0].output='script';plan.tasks[0].outputInputRevision=revision
  plan.tasks[1].status='in_progress'
  assert.equal(groupTaskSummaryOutcome(plan,'new-user-input').status,'running','running external dependents do not stop merely because an upstream output is old')
  plan.tasks[1].status='completed';plan.tasks[1].output='video';plan.tasks[1].outputInputRevision=revision
  assert.equal(finalizeGroupTaskSummary(plan,revision).completed.length,2)
  assert.equal(groupTaskSummaryOutcome(plan,'new-user-input').status,'blocked')
  plan.tasks[1].output='';assert.equal(groupTaskSummaryOutcome(plan,revision).status,'blocked');plan.tasks[1].output='video'
  plan.tasks[1].assignee='a';assert.ok(validateGroupTaskSummary(plan).some(error=>error.includes('actual assignee')));plan.tasks[1].assignee='b'

  // Tool admission is authoritative; a model cannot reassign/restart a blocked task.
  await createTeamDir(stateRoot,plan)
  registerAgentTeamsTools(ctx,{stateDir:'.agent-teams',memberProvider:'fake',maxTaskAttempts:999,controlledWorkflow:true})
  let ledger=await readTeam(stateRoot,plan.id)
  ledger.tasks[0].status='in_progress';ledger.tasks[0].attemptId='reply-attempt';ledger.tasks[0].waitingAssistance='reply-request'
  ledger.assistanceRequests=[{id:'reply-request',taskId:'t1',attemptId:'reply-attempt',requesterId:'member',requesterName:'a',objective:'images',inputRevision:revision,status:'pending'}]
  prepareGroupAssistanceReturn(ledger,'reply-request','member','actual images',{inputRevision:revision})
  await writeTeam(stateRoot,ledger) // crash before append of the original result mailbox
  const replay=await definitions.get('agent_teams_send_message').execute({to:'a',assistance_request_id:'reply-request',content:'actual images'},exec)
  assert.match(replay.message_id,/group-assistance-result:reply-request/)
  const deliveredAgain=await definitions.get('agent_teams_send_message').execute({to:'a',assistance_request_id:'reply-request',content:'actual images'},exec)
  assert.equal(deliveredAgain.delivered,'deduplicated');assert.equal((await readMailbox(stateRoot,plan.id,'a')).length,1)
  ledger=await readTeam(stateRoot,plan.id)
  ledger.tasks[0].status='in_progress';ledger.tasks[0].waitingUser={reason:'missing_user_input',message:'upload images',inputRevision:revision};ledger.tasks[0].attemptId='original'
  await writeTeam(stateRoot,ledger)
  await assert.rejects(()=>definitions.get('agent_teams_delete').execute({},exec),/model-side deletion/ )
  for (const [name,args] of [['agent_teams_reassign_task',{task_id:'t1',assignee:'a'}],['agent_teams_remove_member',{name:'a'}],['agent_teams_start',{}],['agent_teams_create_task',{subject:'replacement',description:'replacement',assignee:'b',dependencies:[],required_tools:[],acceptance_criteria:'output'}]]) {
    await assert.rejects(()=>definitions.get(name).execute(args,exec),/waiting for user/)
  }
  ledger.tasks[0].status='completed';delete ledger.tasks[0].waitingUser;ledger.tasks[0].output='script';ledger.tasks[0].outputInputRevision=revision
  await writeTeam(stateRoot,ledger);revision='user-2'
  await definitions.get('agent_teams_update_task').execute({task_id:'t1',confirm_output_for_current_input:true},exec)
  ledger=await readTeam(stateRoot,plan.id)
  assert.equal(ledger.tasks[0].attemptId,'original');assert.equal(ledger.tasks[0].outputInputRevision,'user-2');assert.equal(ledger.tasks[0].outputOriginalInputRevision,'user-1')
  await definitions.get('agent_teams_update_task').execute({task_id:'t2',confirm_output_for_current_input:true},exec)
  const final=await definitions.get('agent_teams_finalize_summary').execute({},exec)
  assert.equal(final.final.status,'completed');assert.match(final.display,/已完成/)
  ledger=await readTeam(stateRoot,plan.id)
  assert.equal(ledger.inputRevision,'user-2','manual finalize persists the same trusted revision as its final outcome')
  const originalSummaryAttempts=ledger.tasks.map(task=>task.attemptId)
  // Crash after saving manual final but before the final summary outbox exists.
  await rm(join(stateRoot,plan.id,'inbox','captain.jsonl'),{force:true})
  const summaryRevisionMethod=policy.inputRevision;policy.inputRevision=()=>undefined
  const notificationCount=notifications.length
  const coldFinalScheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:999})
  await coldFinalScheduler.kickTeam(businessWorkspace,plan.id,captain)
  const summaryMail=await readMailbox(stateRoot,plan.id,'captain')
  assert.equal(summaryMail.length,1);assert.match(summaryMail[0].id,/^group-summary:/);assert.match(summaryMail[0].content,/已完成/)
  assert.ok(summaryMail[0].readAt);assert.equal(notifications.length,notificationCount+1)
  const anotherFinalScheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:999})
  await anotherFinalScheduler.kickTeam(businessWorkspace,plan.id,captain)
  await coldFinalScheduler.kickTeam(businessWorkspace,plan.id,captain)
  ledger=await readTeam(stateRoot,plan.id)
  assert.equal(ledger.inputRevision,'user-2');assert.equal(ledger.summary.final.inputRevision,'user-2')
  assert.deepEqual(ledger.tasks.map(task=>task.attemptId),originalSummaryAttempts)
  assert.equal((await readMailbox(stateRoot,plan.id,'captain')).length,1);assert.equal(notifications.length,notificationCount+1)
  // Legacy final records without a team revision recover the stored final revision.
  delete ledger.inputRevision;await writeTeam(stateRoot,ledger)
  await rm(join(stateRoot,plan.id,'inbox','captain.jsonl'),{force:true})
  await anotherFinalScheduler.kickTeam(businessWorkspace,plan.id,captain)
  assert.equal((await readTeam(stateRoot,plan.id)).inputRevision,'user-2')
  assert.equal((await readMailbox(stateRoot,plan.id,'captain'))[0].id,summaryMail[0].id)
  policy.inputRevision=summaryRevisionMethod
  await rm(join(stateRoot,plan.id),{recursive:true})

  // WAITING_USER from an external worker does not become an automatic retry loop.
  revision='user-1';let dispatched=0
  policy.executeExternal=async()=>{dispatched++;throw new GroupWorkerBlockedError('missing_user_input','Upload source images')}
  const external=team('external',[task('external-task','b')])
  external.members=[{...member('external-b','b'),runtime:'byclaw-worker',source:{employeeId:'b',workerAgentType:'BYCLAW_CODE'}}]
  setGroupTaskSummary(external,{title:'Video',goal:'Create video',deliverables:['video'],assignments:[{task_id:'external-task',deliverable:'video'}]},revision)
  await createTeamDir(stateRoot,external)
  const scheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:999})
  await scheduler.kickTeam(businessWorkspace,external.id,captain)
  for(let i=0;i<50 && !(await readTeam(stateRoot,external.id)).tasks[0].waitingUser;i++) await new Promise(resolve=>setTimeout(resolve,5))
  for(let i=0;i<3;i++) await scheduler.kickTeam(businessWorkspace,external.id,captain)
  ledger=await readTeam(stateRoot,external.id)
  assert.equal(dispatched,1);assert.equal(ledger.tasks[0].waitingUser.reason,'missing_user_input');assert.equal(ledger.summary.final.status,'blocked')
  await rm(join(stateRoot,external.id),{recursive:true})

  // A ledger-only completed result is recovered before lost-turn handling:
  // the original task attempt and persisted user revision remain unchanged.
  const coldTeam=team('cold-result',[{...task('cold-task','a','in_progress'),attemptId:'cold-original-attempt'}])
  coldTeam.assistanceRequests=[{id:'cold-request',taskId:'cold-task',attemptId:'cold-original-attempt',requesterId:'member',requesterName:'a',objective:'cold inputs',inputRevision:'user-1',resolutionInputRevision:'user-1',status:'completed',result:'cold actual inputs',requestKey:assistanceFingerprint('cold-task','cold-original-attempt','member','cold inputs','user-1')}]
  await createTeamDir(stateRoot,coldTeam)
  const oldRevisionMethod=policy.inputRevision;policy.inputRevision=()=>undefined
  const coldCached=await requestGroupMemberAssistance(ctx,employee,'.agent-teams','cold inputs')
  assert.equal(coldCached.status,'completed');assert.equal(coldCached.result,'cold actual inputs')
  const oldFollowup=ctx.subagents[deliverSubagentPrompt];let continuedOriginal=0
  ctx.subagents[deliverSubagentPrompt]=async (_parent,id)=>{assert.equal(id,'member');continuedOriginal++;employee.status='running';return 'accepted'}
  const coldScheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:999})
  await coldScheduler.kickTeam(businessWorkspace,coldTeam.id,captain)
  ledger=await readTeam(stateRoot,coldTeam.id)
  assert.equal(continuedOriginal,1);assert.equal(ledger.tasks[0].attemptId,'cold-original-attempt');assert.equal(ledger.inputRevision,'user-1')
  assert.equal((await readMailbox(stateRoot,coldTeam.id,'a')).length,1)
  await rm(join(stateRoot,coldTeam.id),{recursive:true})
  employee.status='idle';continuedOriginal=0
  const leasedTeam={...coldTeam,id:'cold-leased-result',name:'cold-leased-result'}
  await createTeamDir(stateRoot,leasedTeam)
  const returnId='group-assistance-result:cold-request:user-1:completed'
  await appendMailbox(stateRoot,leasedTeam.id,'a',{...createMessage('captain','a','Original inputs for the same cold-original-attempt'),id:returnId})
  await claimMailboxDelivery(stateRoot,leasedTeam.id,'a',[returnId])
  // A live result delivery keeps its lease and prevents a lost-turn reattempt.
  const releaseLiveDelivery=beginGroupAssistanceResultDelivery(stateRoot,leasedTeam.id,'cold-request')
  assert.ok(releaseLiveDelivery)
  const liveResultScheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:999})
  await liveResultScheduler.kickTeam(businessWorkspace,leasedTeam.id,captain)
  assert.equal(continuedOriginal,0);assert.equal((await readTeam(stateRoot,leasedTeam.id)).tasks[0].attemptId,'cold-original-attempt')
  releaseLiveDelivery()
  // After a process dies there is no runtime owner: release only its stable
  // result lease and deliver the existing message before considering retries.
  const leasedResultScheduler=installTeamScheduler(ctx,{stateDir:'.agent-teams',maxTaskAttempts:999})
  await leasedResultScheduler.kickTeam(businessWorkspace,leasedTeam.id,captain)
  await liveResultScheduler.kickTeam(businessWorkspace,leasedTeam.id,captain)
  ledger=await readTeam(stateRoot,leasedTeam.id)
  const leasedMail=await readMailbox(stateRoot,leasedTeam.id,'a')
  assert.equal(continuedOriginal,1);assert.equal(ledger.tasks[0].attemptId,'cold-original-attempt')
  assert.equal(leasedMail.length,1);assert.equal(leasedMail[0].id,returnId);assert.ok(leasedMail[0].readAt);assert.equal(leasedMail[0].deliveryClaimedAt,undefined)
  policy.inputRevision=oldRevisionMethod;ctx.subagents[deliverSubagentPrompt]=oldFollowup;employee.status='idle'
  await rm(join(stateRoot,leasedTeam.id),{recursive:true})

  // DIRECT requests use the same durable child/result protocol and support multiple phases.
  const soloInput={parentId:'solo',taskSessionId:'direct-task',coordinatorAgentId:'helper',objective:'find script',inputRevision:'user-1'}
  const solo1=await requestSoloAssistance(stateRoot,soloInput)
  assert.equal(soloAssistanceForChild(stateRoot,'solo',solo1.record.childId).id,solo1.record.id)
  await resolveSoloAssistance(stateRoot,'solo',solo1.record.childId,'actual script','completed')
  assert.equal((await requestSoloAssistance(stateRoot,{...soloInput,inputs:'model changed text'})).record.result,'actual script')
  assert.equal((await requestSoloAssistance(stateRoot,{...soloInput,inputRevision:undefined})).record.id,solo1.record.id,'cold solo cache uses its persisted true user revision')
  const solo2=await requestSoloAssistance(stateRoot,{...soloInput,objective:'find materials'})
  assert.equal(solo2.reused,false)
  await resolveSoloAssistance(stateRoot,'solo',solo2.record.childId,'Need user product images','blocked','missing_user_input')
  assert.equal((await requestSoloAssistance(stateRoot,{...soloInput,objective:'rephrase missing images'})).record.status,'blocked')
  assert.equal((await requestSoloAssistance(stateRoot,{...soloInput,objective:'find materials',inputRevision:'user-2'})).reused,false)

  const directScope={...scope,mode:'DIRECT',taskSessionId:'direct-runtime'}
  const directParent={id:'direct',status:'idle',session:{header:{cwd:businessWorkspace},events:[]}}
  agents.set('direct',directParent);scopes.set('direct',{coordination:directScope,role:'member',employeeId:'a',templateId:'scoped'})
  const helperTemplate={id:'byclaw-employee-helper',kind:'agent',persona:'helper',skills:[],source:{resourceId:'helper',workerAgentType:'HARNESS',directlyAuthorized:true}}
  policy.resolveTemplate=async()=>helperTemplate
  policy.bind=(id,employee,parent)=>scopes.set(id,{coordination:scopes.get(parent).coordination,employeeId:employee,role:'coordinator',templateId:'scoped'})
  let starts=0;let concludes=0
  ctx.sessionPersistence={list:async()=>[],stat:async()=>undefined}
  ctx.subagents.startActivation=async ({childId,request,delivery})=>{
    assert.equal(delivery,'parent')
    starts++;const child={id:childId,status:'running',session:{header:{cwd:businessWorkspace,parentSession:request.parent.id},events:[]}}
    agents.set(childId,child);policy.bind(childId,'helper',request.parent.id);return{childId,result:new Promise(()=>{}),dispose:async()=>{}}
  }
  const registry=new ByClawSessionWorkspaceRegistry()
  const directRuntime=registerAgentTemplateRuntime(ctx,{catalogDir:workspace,subagentProvider:'fake',resolveModel:async()=>({provider:'fake',model:'fake'}),groupCoordination:policy,workspaceRegistry:registry})
  const directExec={agent:directParent,signal,concludeTurn(){concludes++}}
  await assert.rejects(()=>definitions.get('byclaw_instantiate_template').execute({template_id:'byclaw-employee-helper',task:'bypass'},{agent:directParent,signal}),/scoped AgentTeams task ledger/)
  const requestTool=definitions.get('group_request_assistance')
  const started=await requestTool.execute({objective:'find script'},directExec)
  await definitions.get('group_resolve_assistance').execute({status:'completed',result:'actual script'},{agent:agents.get(started.instance_session_id),signal})
  const same=await requestTool.execute({objective:'find script'},directExec)
  assert.equal(same.status,'completed');assert.equal(same.result,'actual script');assert.equal(starts,1);assert.equal(concludes,1,'synchronous result must not conclude and wait forever')
  const other=await requestTool.execute({objective:'find materials'},directExec)
  assert.equal(starts,2)
  await definitions.get('group_resolve_assistance').execute({status:'blocked',result:'Upload product images',blocking_reason:'missing_user_input'},{agent:agents.get(other.instance_session_id),signal})
  const missing=await requestTool.execute({objective:'get images again'},directExec)
  assert.equal(missing.status,'blocked');assert.equal(starts,2);assert.equal(concludes,2)
  const coldParent={...directParent,id:'cold-direct'};agents.set(coldParent.id,coldParent);scopes.set(coldParent.id,{coordination:directScope,role:'member',employeeId:'a',templateId:'scoped'})
  const cold=await requestSoloAssistance(stateRoot,{parentId:coldParent.id,taskSessionId:directScope.taskSessionId,coordinatorAgentId:'helper',objective:'recover original',inputRevision:revision})
  const resumed=await requestTool.execute({objective:'recover original'},{...directExec,agent:coldParent})
  assert.equal(resumed.request_id,cold.record.id);assert.equal(resumed.instance_session_id,cold.record.childId);assert.equal(starts,3)

  // Both native and Code Mode cached returns settle the async gate with no child report.
  for (const status of ['completed','blocked']) for (const mode of ['native','code']) {
    const gate=new ByClawAsyncTeamGate(1000,5)
    gate.observe({type:'turn/start',data:{turn:1}})
    if(mode==='native'){
      gate.observe({type:'tool/call',data:{name:'group_request_assistance',callId:'cached'}})
      gate.observe({type:'tool/result',data:{message:{role:'tool',source:{kind:'tool',callId:'cached'},toolCallId:'cached',content:[{type:'text',text:`Assistance status: ${status}\nactual return`}]},meta:{byclaw_assistance_status:status}}})
    }else{
      gate.observe({type:'tool/ptc-dispatch-start',data:{name:'group_request_assistance',subCallId:'cached'}})
      gate.observe({type:'tool/ptc-dispatch',data:{name:'group_request_assistance',subCallId:'cached',isError:false,content:[{type:'text',text:`Assistance status: ${status}\nactual return`}]}})
    }
    gate.observe({type:'turn/end',data:{turn:1,reason:{kind:'completed'}}})
    assert.equal(gate.waiting,false,`${mode} ${status} must settle without a new child`)
  }
  assert.equal(assistanceFingerprint('t','a','r',' FIND   SCRIPT ','u'),assistanceFingerprint('t','a','r','find script','u'))
  console.log('Group assistance/summary verification passed: original task correlation, completed caches, unlimited distinct phases, wait-user admission, crash recovery, stable final outbox, orphan result lease recovery, external WAITING_USER, truthful final persistence, native/code cached gates.')
} finally {
  if(previousHome===undefined) delete process.env.DSH_HOME;else process.env.DSH_HOME=previousHome
  await rm(workspace,{recursive:true,force:true})
}
