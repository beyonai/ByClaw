import assert from 'node:assert/strict'
import {
  assertByClawLiveE2eTopology,
  buildByClawInboundExtraPayload,
  parseByClawLiveE2eArgs,
} from '../src/live-e2e-options.ts'

assertByClawLiveE2eTopology('direct-employee', {
  sessionId: 'root', answer: '我是梁远图', teamCards: [],
  sessionCards: [{ sessionId: 'root', parentSessionId: 'root', depth: 0 }],
})
assertByClawLiveE2eTopology('expert-team', {
  sessionId: 'team-root', answer: '蛋蛋、艾丽、懒懒分别做了自我介绍',
  sessionCards: [
    { sessionId: 'team-root', parentSessionId: 'team-root', depth: 0 },
    { sessionId: 'member-1', parentSessionId: 'team-root', depth: 1 },
    { sessionId: 'member-1', parentSessionId: 'team-root', depth: 1, eventKind: 'session.output', text: '我是蛋蛋' },
    { sessionId: 'member-2', parentSessionId: 'team-root', depth: 1 },
    { sessionId: 'member-2', parentSessionId: 'team-root', depth: 1, eventKind: 'session.output', text: '我是艾丽' },
    { sessionId: 'member-3', parentSessionId: 'team-root', depth: 1 },
    { sessionId: 'member-3', parentSessionId: 'team-root', depth: 1, eventKind: 'session.output', text: '我是懒懒' },
  ],
  teamCards: [{ team: { captainSessionId: 'team-root', members: [
    { id: 'member-1', name: '公众号运营助手-蛋蛋' },
    { id: 'member-2', name: '文章创作助手-艾丽' },
    { id: 'member-3', name: '社交媒体配图专家-懒懒' },
  ] } }],
}, ['蛋蛋', '艾丽', '懒懒'])
assert.throws(
  () => assertByClawLiveE2eTopology('expert-team', {
    sessionId: 'team-root', answer: '', sessionCards: [{ sessionId: 'team-root', depth: 0 }], teamCards: [],
  }),
  /requires E2E_EXPECT_TEAM_MEMBERS/u,
)
assert.throws(
  () => assertByClawLiveE2eTopology('expert-team', {
    sessionId: 'team-root', answer: '蛋蛋',
    sessionCards: [
      { sessionId: 'team-root', depth: 0 },
      { sessionId: 'member-1', parentSessionId: 'team-root', depth: 1, eventKind: 'session.output', text: '我是蛋蛋' },
      { sessionId: 'member-2', parentSessionId: 'team-root', depth: 1, eventKind: 'session.output', text: '我是艾丽' },
    ],
    teamCards: [{ team: { captainSessionId: 'team-root', members: [
      { id: 'member-1', name: '公众号运营助手-蛋蛋' },
      { id: 'member-2', name: '文章创作助手-艾丽' },
    ] } }],
  }, ['蛋蛋']),
  /complete roster/u,
)
try {
  assertByClawLiveE2eTopology('direct-employee', {
    sessionId: 'root', answer: '', teamCards: [],
    sessionCards: [{ sessionId: 'root', depth: 0 }, { sessionId: 'middleman', parentSessionId: 'root', depth: 1 }],
  })
  throw new Error('direct employee intermediary was not rejected')
} catch (error) {
  if (!String(error).includes('intermediary')) throw error
}

const parsed = parseByClawLiveE2eArgs([
  '--agent-id', '101',
  '请介绍自己',
  '再说一句',
])
if (parsed.main || parsed.targetAgentType !== 'BYCLAW_DSH_adminvip') throw new Error('agent target routing mismatch')
if (parsed.prompts.join('|') !== '请介绍自己|再说一句') throw new Error('prompt parsing mismatch')
const payload = buildByClawInboundExtraPayload('/tmp/workspace', parsed)
if (JSON.stringify(payload) !== JSON.stringify({ cwd: '/tmp/workspace', agent_id: '101' })) {
  throw new Error(`agent extra payload mismatch: ${JSON.stringify(payload)}`)
}

const main = parseByClawLiveE2eArgs(['--main', '回到主 Agent'])
if (!main.main || main.targetAgentType !== 'BYCLAW_DSH' || Object.keys(buildByClawInboundExtraPayload('', main)).length !== 0) {
  throw new Error('main target routing mismatch')
}

const structured = parseByClawLiveE2eArgs(['--agent-id', '123', '做自我介绍'])
if (JSON.stringify(buildByClawInboundExtraPayload('', structured)) !== JSON.stringify({ agent_id: '123' })) {
  throw new Error('structured target payload mismatch')
}

const isolated = parseByClawLiveE2eArgs(
  ['--agent-id', '123', '做自我介绍'],
  'adminvip',
  'BYCLAW_DSH_COMPAT_E2E',
)
if (isolated.targetAgentType !== 'BYCLAW_DSH_COMPAT_E2E') {
  throw new Error(`explicit E2E target AgentType mismatch: ${isolated.targetAgentType}`)
}

const coded = parseByClawLiveE2eArgs(['--agent-code', 'ARCHITECT', '--agent-name', '架构舵手', '分析架构'])
if (JSON.stringify(buildByClawInboundExtraPayload('', coded)) !== JSON.stringify({
  agent_code: 'ARCHITECT',
  agent_name: '架构舵手',
})) {
  throw new Error('structured code/name payload mismatch')
}

console.log('ByClaw live-e2e option checks passed')
