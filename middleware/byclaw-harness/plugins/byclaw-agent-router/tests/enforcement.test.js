import { test } from 'node:test'
import assert from 'node:assert/strict'
import { enforceAgentDelegation, agentRouterBlocksDelegationTool, isSuperAssistantRoot, AgentRoutingSelections } from '../src/index.js'
const on = { BYCLAW_AGENT_ROUTER_ENABLED: 'true' }
const off = { BYCLAW_AGENT_ROUTER_ENABLED: 'false' }
const signal = new AbortController().signal

test('super-assistant delegation validates the earlier selection and preserves its ID', async () => {
  let calls = 0
  const actual = await enforceAgentDelegation('right', true, 'actual task', signal, async (task, passed) => {
    calls++; assert.equal(task,'actual task'); assert.equal(passed,signal)
    return { status:'selected',template_id:'right' }
  },on)
  assert.equal(actual,'right'); assert.equal(calls,1)
})
test('fallback and cancellation block dispatch', async () => {
  await assert.rejects(enforceAgentDelegation('wrong',true,'task',signal,async()=>({status:'fallback'}),on),/No employee was started/)
  const controller = new AbortController()
  await assert.rejects(enforceAgentDelegation('wrong',true,'task',controller.signal,async()=>{controller.abort();return {status:'selected',template_id:'right'}},on),/cancelled/)
})
test('switch off and child delegation retain existing target without requesting Jev', async () => {
  const unexpected = async()=>{throw Error('must not request')}
  assert.equal(await enforceAgentDelegation('existing',true,'task',signal,unexpected,off),'existing')
  assert.equal(await enforceAgentDelegation('existing',false,'task',signal,unexpected,on),'existing')
})
test('generic super-assistant spawning cannot bypass the gate, other orchestration remains available', () => {
  for(const name of ['subagent','subagent_fork','agent_teams_create','agent_teams_start','agent_teams_submit_task','agent_teams_send_message']) {
    assert.equal(agentRouterBlocksDelegationTool(name,true,on),true)
    assert.equal(agentRouterBlocksDelegationTool(name,true,off),false)
    assert.equal(agentRouterBlocksDelegationTool(name,false,on),false)
  }
  for(const name of ['byclaw_instantiate_template','byclaw_route_task','agent_teams_status','read_file']) assert.equal(agentRouterBlocksDelegationTool(name,true,on),false)
})

test('only trusted main roots and the current user super-assistant template enforce Jev', async () => {
  const cases = [
    [{ bindingKind: 'main' }, true],
    [{ bindingKind: 'template', employeeCode: 'user_main' }, true],
    [{ bindingKind: 'template', employeeCode: 'ordinary_employee' }, false],
    [{ bindingKind: 'template', employeeCode: 'other_main' }, false],
    [{ bindingKind: 'template' }, false],
    [{}, false],
    [{ bindingKind: 'main', parentSession: 'parent' }, false],
    [{ bindingKind: 'template', employeeCode: 'user_main', parentSession: 'parent' }, false],
  ]
  for (const [binding, expected] of cases) {
    const enforced = isSuperAssistantRoot({ userCode: 'user', ...binding })
    assert.equal(enforced, expected)
    let calls = 0
    const selected = await enforceAgentDelegation('requested', enforced, 'task', signal, async () => {
      calls++
      return { status: 'selected', template_id: 'requested' }
    }, on)
    assert.equal(calls, expected ? 1 : 0)
    assert.equal(selected, 'requested')
    for (const tool of ['spawn_agent', 'subagent', 'agent_teams_create']) {
      assert.equal(agentRouterBlocksDelegationTool(tool, enforced, on), expected)
    }
  }
})


test('Jev selections are task-bound, agent-bound, single-use and invalidated by failed re-selection', async () => {
  const store = new AgentRoutingSelections()
  const agent = {}, other = {}
  const chosen = { status: 'selected', template_id: 'right', next_action: 'dispatch' }
  const consume = async task => ({ ...store.consume(agent, task), next_action: 'route first' })
  await assert.rejects(enforceAgentDelegation('right', true, 'task', signal, consume, on), /byclaw_route_task/)
  store.remember(agent, 'task', chosen)
  assert.equal(store.consume(other, 'task').reason, 'selection_required')
  assert.equal(store.consume(agent, 'changed task').reason, 'selection_required')
  await assert.rejects(enforceAgentDelegation('wrong', true, 'task', signal, consume, on), /must match/)
  store.remember(agent, 'task', chosen)
  assert.equal(await enforceAgentDelegation('right', true, 'task', signal, consume, on), 'right')
  await assert.rejects(enforceAgentDelegation('right', true, 'task', signal, consume, on), /byclaw_route_task/)
  store.remember(agent, 'task', chosen)
  store.remember(agent, 'task', { status: 'fallback', reason: 'timeout' })
  assert.equal(store.consume(agent, 'task').reason, 'selection_required')
  store.remember(agent, 'task', chosen)
  store.remember(agent, 'new task', chosen)
  assert.equal(store.consume(agent, 'task').reason, 'selection_required')
  assert.equal(store.consume(agent, 'new task').template_id, 'right')
})
