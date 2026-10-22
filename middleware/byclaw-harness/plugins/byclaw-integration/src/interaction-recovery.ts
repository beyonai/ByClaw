import type { ByClawQuestion, ByClawQuestionAnswer } from './protocol.ts'

export type ByClawInteractionStatus = 'PENDING' | 'ANSWERED' | 'CONSUMED'

export interface ByClawInteractionRecord {
  schemaVersion: 1
  interactionId: string
  sessionId: string
  userCode: string
  agentSessionId: string
  parentAgentSessionId?: string
  questions: ByClawQuestion[]
  status: ByClawInteractionStatus
  createdAt: number
  updatedAt: number
  answer?: ByClawQuestionAnswer
}

export interface ByClawInteractionRedis {
  set(key: string, value: string): Promise<unknown>
  get(key: string): Promise<string | null>
  del(key: string): Promise<unknown>
  expire(key: string, seconds: number): Promise<unknown>
  zadd(key: string, score: number, member: string): Promise<unknown>
  zrange(key: string, start: number, end: number): Promise<string[]>
  zrem(key: string, member: string): Promise<unknown>
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>
}

export interface ByClawInteractionStoreOptions {
  prefix?: string
  ttlSeconds?: number
  now?: () => number
}

/** Persist the concrete DSH Session identity; Agent.id may be an external presentation identity. */
export function interactionAgentSessionId(agent: { session: { id: unknown } }): string {
  return String(agent.session.id)
}

interface ColdRecoveryTurnIdentity {
  contextSessionId: string
  userCode: string
  rootMessageId: string
}

/** Match only the reclaimed command that would occupy the cold recovery queue. */
export function isColdRecoveryBlockingTurn(
  turn: ColdRecoveryTurnIdentity,
  recovery: ColdRecoveryTurnIdentity,
): boolean {
  return turn.contextSessionId === recovery.contextSessionId
    && turn.userCode === recovery.userCode
    && turn.rootMessageId === recovery.rootMessageId
}

/** Stop an orphan replay before the cold Resume reconstructs the sole visible continuation. */
export async function releaseColdRecoveryBlockingTurn(
  turn: { rootMessageId: string; setStreamFinished(finished: boolean): void } | undefined,
  cancel: (messageId: string) => Promise<void>,
  resume: { setStreamFinished(finished: boolean): void },
): Promise<boolean> {
  if (turn !== undefined) {
    turn.setStreamFinished(true)
    await cancel(turn.rootMessageId)
  }
  // The reconstructed turn starts immediately after this helper returns.
  resume.setStreamFinished(false)
  return turn !== undefined
}

/** A rendered interaction must survive the process abort that accompanies sandbox release. */
export function shouldRetainInteractionAfterAskFailure(options: {
  requestEmitted: boolean
  signalAborted: boolean
}): boolean {
  return options.requestEmitted && options.signalAborted
}

const ANSWER_SCRIPT = `-- BYCLAW_INTERACTION_ANSWER
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.sessionId ~= ARGV[1] or record.userCode ~= ARGV[2] then return 0 end
if record.status == 'ANSWERED' and cjson.encode(record.answer) == cjson.encode(cjson.decode(ARGV[3])) then return 2 end
if record.status ~= 'PENDING' then return 0 end
record.status = 'ANSWERED'
record.answer = cjson.decode(ARGV[3])
record.updatedAt = tonumber(ARGV[4])
redis.call('SET', KEYS[1], cjson.encode(record))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
return 1`

const CONSUME_SCRIPT = `-- BYCLAW_INTERACTION_CONSUME
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local record = cjson.decode(raw)
if record.status ~= 'ANSWERED' or record.sessionId ~= ARGV[1] or record.userCode ~= ARGV[2] then return nil end
record.status = 'CONSUMED'
record.updatedAt = tonumber(ARGV[3])
redis.call('SET', KEYS[1], cjson.encode(record))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return raw`

const REOPEN_SCRIPT = `-- BYCLAW_INTERACTION_REOPEN
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.status ~= 'CONSUMED' or record.sessionId ~= ARGV[1] or record.userCode ~= ARGV[2] then return 0 end
record.status = 'ANSWERED'
record.updatedAt = tonumber(ARGV[3])
redis.call('SET', KEYS[1], cjson.encode(record))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return 1`

function safePart(value: string): string {
  return encodeURIComponent(value)
}

export function interactionRecordKey(prefix: string, interactionId: string): string {
  return `${prefix}:interaction:${safePart(interactionId)}`
}

function sessionIndexKey(prefix: string, sessionId: string, userCode: string): string {
  return `${prefix}:session:${safePart(userCode)}:${safePart(sessionId)}`
}

function parseRecord(raw: string | null): ByClawInteractionRecord | undefined {
  if (raw === null) return
  try {
    const value = JSON.parse(raw) as Partial<ByClawInteractionRecord>
    if (value.schemaVersion !== 1 || typeof value.interactionId !== 'string'
      || typeof value.sessionId !== 'string' || typeof value.userCode !== 'string'
      || typeof value.agentSessionId !== 'string' || !Array.isArray(value.questions)
      || !['PENDING', 'ANSWERED', 'CONSUMED'].includes(String(value.status))) return
    return value as ByClawInteractionRecord
  } catch {
    return
  }
}

export function buildRecoveredAskPayload(record: Pick<
  ByClawInteractionRecord,
  'sessionId' | 'agentSessionId' | 'parentAgentSessionId' | 'questions' | 'answer'
> & { externalSessionId?: string }): {
  text: string
  extraPayload: Record<string, string>
} {
  if (record.answer === undefined) throw new Error('Recovered ask_user_question has no answer')
  const byId = new Map(record.answer.answers.map(answer => [answer.id, answer]))
  const lines = record.questions.map(question => {
    const answer = byId.get(question.id)
    const values = [...(answer?.selected ?? [])]
    if (answer?.custom !== undefined && answer.custom.trim() !== '') values.push(answer.custom.trim())
    return `${question.question.replace(/[?？\s]+$/u, '')}：${answer?.skipped === true || values.length === 0 ? '已跳过' : values.join('、')}`
  })
  return {
    text: `用户已回答之前的 ask_user_question，请根据回答继续原任务。\n${lines.join('\n')}`,
    extraPayload: {
      byclaw_root_session_id: record.externalSessionId ?? record.sessionId,
      // Early recovery records used the external root id as agentSessionId. Omitting the
      // target lets the reconstructed deterministic root receive those answers safely.
      ...(record.agentSessionId === record.sessionId ? {} : {
        dsh_target_session_id: record.agentSessionId,
      }),
      ...(record.agentSessionId === record.sessionId || record.parentAgentSessionId === undefined ? {} : {
        dsh_parent_session_id: record.parentAgentSessionId,
      }),
    },
  }
}

/** Redis-backed hand-off between an ask tool call and a later sandbox process. */
export class ByClawInteractionStore {
  private readonly redis: ByClawInteractionRedis
  private readonly prefix: string
  private readonly ttlSeconds: number
  private readonly now: () => number

  constructor(redis: ByClawInteractionRedis, options: ByClawInteractionStoreOptions = {}) {
    this.redis = redis
    this.prefix = options.prefix ?? 'byclaw:dsh:ask-user:v1'
    this.ttlSeconds = options.ttlSeconds ?? 24 * 60 * 60
    this.now = options.now ?? Date.now
  }

  async create(input: Omit<ByClawInteractionRecord, 'schemaVersion' | 'status' | 'createdAt' | 'updatedAt'>): Promise<void> {
    const timestamp = this.now()
    const record: ByClawInteractionRecord = {
      schemaVersion: 1,
      ...input,
      status: 'PENDING',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const recordKey = interactionRecordKey(this.prefix, input.interactionId)
    const indexKey = sessionIndexKey(this.prefix, input.sessionId, input.userCode)
    await this.redis.set(recordKey, JSON.stringify(record))
    await this.redis.expire(recordKey, this.ttlSeconds)
    await this.redis.zadd(indexKey, timestamp, input.interactionId)
    await this.redis.expire(indexKey, this.ttlSeconds)
  }

  async get(interactionId: string): Promise<ByClawInteractionRecord | undefined> {
    return parseRecord(await this.redis.get(interactionRecordKey(this.prefix, interactionId)))
  }

  async answer(input: {
    interactionId: string
    sessionId: string
    userCode: string
    answer: ByClawQuestionAnswer
  }): Promise<boolean> {
    const result = await this.redis.eval(
      ANSWER_SCRIPT,
      1,
      interactionRecordKey(this.prefix, input.interactionId),
      input.sessionId,
      input.userCode,
      JSON.stringify(input.answer),
      String(this.now()),
      String(this.ttlSeconds),
    )
    return Number(result) === 1 || Number(result) === 2
  }

  async consumeAnswered(
    sessionId: string,
    userCode: string,
    questions?: readonly Pick<ByClawQuestion, 'id'>[],
  ): Promise<ByClawInteractionRecord | undefined> {
    const indexKey = sessionIndexKey(this.prefix, sessionId, userCode)
    const interactionIds = await this.redis.zrange(indexKey, 0, -1)
    console.info(
      `[ASK_USER_QUESTION_RECOVERY_TRACE] REDIS_SCAN_ANSWERED session=${sessionId} candidates=${interactionIds.length} question_ids=${questions?.map(question => question.id).join(',') ?? '-'}`,
    )
    for (const interactionId of interactionIds) {
      if (questions !== undefined) {
        const candidate = await this.get(interactionId)
        if (candidate === undefined || candidate.questions.length !== questions.length
          || candidate.questions.some((question, index) => question.id !== questions[index]?.id)) {
          console.info(
            `[ASK_USER_QUESTION_RECOVERY_TRACE] REDIS_SKIP_ANSWERED interaction=${interactionId} status=${candidate?.status ?? 'missing'} stored_question_ids=${candidate?.questions.map(question => question.id).join(',') ?? '-'} requested_question_ids=${questions.map(question => question.id).join(',')}`,
          )
          continue
        }
      }
      const record = await this.consume(interactionId, sessionId, userCode)
      if (record !== undefined) {
        console.info(
          `[ASK_USER_QUESTION_RECOVERY_TRACE] REDIS_CONSUMED_ANSWERED interaction=${interactionId} session=${sessionId}`,
        )
        return record
      }
    }
    console.info(`[ASK_USER_QUESTION_RECOVERY_TRACE] REDIS_NO_ANSWERED_MATCH session=${sessionId}`)
    return
  }

  async consume(interactionId: string, sessionId: string, userCode: string): Promise<ByClawInteractionRecord | undefined> {
    const raw = await this.redis.eval(
      CONSUME_SCRIPT,
      1,
      interactionRecordKey(this.prefix, interactionId),
      sessionId,
      userCode,
      String(this.now()),
      String(this.ttlSeconds),
    )
    if (typeof raw !== 'string') return
    await this.redis.zrem(sessionIndexKey(this.prefix, sessionId, userCode), interactionId)
    return parseRecord(raw)
  }

  async reopen(interactionId: string, sessionId: string, userCode: string): Promise<boolean> {
    const timestamp = this.now()
    const result = await this.redis.eval(
      REOPEN_SCRIPT,
      1,
      interactionRecordKey(this.prefix, interactionId),
      sessionId,
      userCode,
      String(timestamp),
      String(this.ttlSeconds),
    )
    if (Number(result) !== 1) return false
    const indexKey = sessionIndexKey(this.prefix, sessionId, userCode)
    await this.redis.zadd(indexKey, timestamp, interactionId)
    await this.redis.expire(indexKey, this.ttlSeconds)
    return true
  }

  async remove(record: Pick<ByClawInteractionRecord, 'interactionId' | 'sessionId' | 'userCode'>): Promise<void> {
    await this.redis.del(interactionRecordKey(this.prefix, record.interactionId))
    await this.redis.zrem(sessionIndexKey(this.prefix, record.sessionId, record.userCode), record.interactionId)
  }
}
