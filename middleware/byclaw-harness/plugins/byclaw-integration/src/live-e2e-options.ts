/** Parse and serialize the live ByClaw inbound smoke-test options. */

export interface ByClawLiveE2eOptions {
  main: boolean
  targetAgentType: string
  agentId?: string
  agentCode?: string
  agentName?: string
  prompts: string[]
}

export type ByClawLiveE2eTopology = 'direct-employee' | 'expert-team'

export interface ByClawLiveE2eObservation {
  sessionId: string
  answer: string
  sessionCards: Array<Record<string, unknown>>
  teamCards: Array<Record<string, unknown>>
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Fail a real-worker smoke when the observed DSH topology includes an intermediary. */
export function assertByClawLiveE2eTopology(
  topology: ByClawLiveE2eTopology,
  observation: ByClawLiveE2eObservation,
  expectedMembers: readonly string[] = [],
): void {
  const rootCards = observation.sessionCards.filter(card => String(card['sessionId']) === observation.sessionId)
  if (rootCards.length === 0 || rootCards.some(card => Number(card['depth']) !== 0)) {
    throw new Error(`inbound session ${observation.sessionId} was not observed as the depth-0 DSH root`)
  }
  const childCards = observation.sessionCards.filter(card => String(card['sessionId']) !== observation.sessionId)
  if (topology === 'direct-employee') {
    if (childCards.length !== 0) throw new Error('direct employee request created an intermediary or child Agent')
    if (observation.teamCards.length !== 0) throw new Error('direct employee request unexpectedly created an Agent Team')
    return
  }
  if (expectedMembers.length === 0) {
    throw new Error('expert-team topology verification requires E2E_EXPECT_TEAM_MEMBERS')
  }

  const snapshots = observation.teamCards
    .map(card => object(card['team']))
    .filter((team): team is Record<string, unknown> => team !== undefined)
  const snapshot = snapshots.sort((left, right) => (
    (Array.isArray(right['members']) ? right['members'].length : 0)
    - (Array.isArray(left['members']) ? left['members'].length : 0)
  ))[0]
  if (snapshot === undefined || String(snapshot['captainSessionId']) !== observation.sessionId) {
    throw new Error('expert team was not captained directly by the inbound DSH root')
  }
  const members = (Array.isArray(snapshot['members']) ? snapshot['members'] : [])
    .map(object)
    .filter((member): member is Record<string, unknown> => member !== undefined)
  if (expectedMembers.length !== members.length) {
    throw new Error(`E2E_EXPECT_TEAM_MEMBERS must cover the complete roster (${members.length} members)`)
  }
  const memberIds = new Set(members.map(member => String(member['id'] ?? '')).filter(Boolean))
  const childIds = new Set(childCards.map(card => String(card['sessionId'] ?? '')).filter(Boolean))
  if (childCards.some(card => Number(card['depth']) !== 1
    || String(card['parentSessionId']) !== observation.sessionId
    || !memberIds.has(String(card['sessionId'])))) {
    throw new Error('expert team created a non-member intermediary or invalid parent/depth lineage')
  }
  for (const id of memberIds) {
    if (!childIds.has(id)) throw new Error(`expert team member ${id} produced no DSH child lifecycle`)
  }
  const matchedMemberIds = new Set<string>()
  for (const expected of expectedMembers) {
    const matches = members.filter(candidate => {
      const name = String(candidate['name'] ?? '')
      return name === expected || name.includes(expected)
    })
    if (matches.length !== 1) {
      throw new Error(`expert team roster is missing ${expected}`)
    }
    const member = matches[0]!
    const memberId = String(member['id'] ?? '')
    if (matchedMemberIds.has(memberId)) {
      throw new Error(`E2E_EXPECT_TEAM_MEMBERS does not uniquely cover member ${memberId}`)
    }
    matchedMemberIds.add(memberId)
    const outputs = childCards.filter(card => (
      String(card['sessionId']) === memberId
      && card['eventKind'] === 'session.output'
      && String(card['text'] ?? '').trim() !== ''
    ))
    if (outputs.length === 0 || !outputs.some(card => String(card['text']).includes(expected))) {
      throw new Error(`expert team member ${expected} produced no matching session.output introduction`)
    }
    if (!observation.answer.includes(expected)) throw new Error(`expert team answer is missing ${expected}'s introduction`)
  }
  if (matchedMemberIds.size !== memberIds.size) {
    throw new Error('E2E_EXPECT_TEAM_MEMBERS did not cover every expert team member')
  }
}

function optionValue(argv: string[], index: number, option: string): { value: string; nextIndex: number } {
  const argument = argv[index]
  if (argument === undefined) throw new Error(`missing value for ${option}`)
  const inlinePrefix = `${option}=`
  if (argument.startsWith(inlinePrefix)) {
    const value = argument.slice(inlinePrefix.length).trim()
    if (value === '') throw new Error(`missing value for ${option}`)
    return { value, nextIndex: index }
  }
  const value = argv[index + 1]?.trim() ?? ''
  if (value === '' || value.startsWith('--')) throw new Error(`missing value for ${option}`)
  return { value, nextIndex: index + 1 }
}

/** Parse live-e2e flags while leaving all remaining arguments as prompts. */
export function parseByClawLiveE2eArgs(
  argv: readonly string[],
  userCode = process.env['USER_CODE']?.trim() || 'adminvip',
  targetAgentTypeOverride = process.env['E2E_TARGET_AGENT_TYPE']?.trim(),
): ByClawLiveE2eOptions {
  let main = false
  let agentId: string | undefined
  let agentCode: string | undefined
  let agentName: string | undefined
  const prompts: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') {
      prompts.push(...argv.slice(index + 1))
      break
    }
    if (argument === '--main') {
      main = true
      continue
    }
    let parsed: { value: string; nextIndex: number } | undefined
    if (argument === '--agent-id' || argument?.startsWith('--agent-id=')) {
      parsed = optionValue(argv as string[], index, '--agent-id')
      agentId = parsed.value
    } else if (argument === '--agent-code' || argument?.startsWith('--agent-code=')) {
      parsed = optionValue(argv as string[], index, '--agent-code')
      agentCode = parsed.value
    } else if (argument === '--agent-name' || argument?.startsWith('--agent-name=')) {
      parsed = optionValue(argv as string[], index, '--agent-name')
      agentName = parsed.value
    } else {
      if (argument?.startsWith('--')) throw new Error(`unsupported option: ${argument}`)
      prompts.push(argument ?? '')
      continue
    }
    index = parsed.nextIndex
  }
  if (prompts.length === 0) throw new Error('provide at least one prompt')
  if (main && (agentId !== undefined || agentCode !== undefined || agentName !== undefined)) {
    throw new Error('--main cannot be combined with a direct agent target')
  }
  return {
    main,
    targetAgentType: targetAgentTypeOverride || (main ? 'BYCLAW_DSH' : `BYCLAW_DSH_${userCode}`),
    ...agentId === undefined ? {} : { agentId },
    ...agentCode === undefined ? {} : { agentCode },
    ...agentName === undefined ? {} : { agentName },
    prompts,
  }
}

/** Build ByClaw's snake_case extra payload without putting routing flags in text. */
export function buildByClawInboundExtraPayload(
  cwd: string | undefined,
  options: ByClawLiveE2eOptions,
): Record<string, string> {
  return {
    ...cwd?.trim() === '' || cwd === undefined ? {} : { cwd: cwd.trim() },
    ...options.agentId === undefined ? {} : { agent_id: options.agentId },
    ...options.agentCode === undefined ? {} : { agent_code: options.agentCode },
    ...options.agentName === undefined ? {} : { agent_name: options.agentName },
  }
}
