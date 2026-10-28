/** Bounded diagnostics for BE -> Worker -> DSH initiation; never log payloads or error messages. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

interface CommandIdentity {
  header: {
    sessionId: string
    traceId: string
    messageId: string
    userCode: string
    targetAgentType?: string
    metadata?: Readonly<Record<string, unknown>>
  }
  actionType: string
  extraPayload?: Readonly<Record<string, unknown>>
}
type Fields = Readonly<Record<string, string | number | boolean | undefined>>
type Result = 'ok' | 'failed' | 'cancelled' | 'running'
const current = new AsyncLocalStorage<ByClawChatChain>()
const scalar = (value: unknown): string => typeof value === 'string' || typeof value === 'number'
  ? String(value).replace(/[\r\n\t]/gu, '_').slice(0, 160) : ''
const id = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value) ? value : ''
const uuid = (value: unknown): string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value) ? value : ''
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const elapsed = (start: bigint): number => Number((process.hrtime.bigint() - start) / 1_000_000n)

export class ByClawChatChain {
  private readonly started = process.hrtime.bigint()
  private readonly fields: Fields
  private turnStarted = false
  private input: { sessionId: string; messageId: string } | undefined
  private readonly claims = new Map<string, { sessionId: string; turn: number }>()
  private sequence = 0
  private readonly published = new Map<string, number>()
  private readonly operations = new Map<string, bigint>()

  constructor(command: CommandIdentity, workerId: string, startupId = '') {
    const metadata = object(command.header.metadata)
    const chain = object(metadata['chatChain'])
    const backend = chain['schemaVersion'] === 1 && uuid(chain['invocationId']) !== '' && uuid(chain['dispatchId']) !== ''
    this.fields = {
      requestId: id(backend ? chain['requestId'] : metadata['requestId']) || id(command.extraPayload?.['requestId']),
      invocationId: backend ? uuid(chain['invocationId']) : '',
      ingressRequestId: backend ? id(chain['ingressRequestId']) : '',
      dispatchId: backend ? uuid(chain['dispatchId']) : '',
      identitySource: backend ? 'backend' : 'legacy',
      deliveryId: randomUUID(),
      startupId,
      attempt: backend && Number.isSafeInteger(chain['attempt']) && Number(chain['attempt']) > 0 ? Number(chain['attempt']) : undefined,
      scope: backend ? scalar(chain['scope']) : 'unknown',
      tenantId: backend ? scalar(chain['tenantId']) : '',
      userCode: scalar(command.header.userCode),
      sessionId: scalar(command.header.sessionId), traceId: scalar(command.header.traceId),
      messageId: scalar(command.header.messageId), targetAgentType: scalar(command.header.targetAgentType),
      workerId: scalar(workerId), actionType: scalar(command.actionType),
    }
  }

  point(stage: string, fields: Fields = {}): void {
    this.write(stage, 'point', 'ok', fields)
  }

  start(stage: string, fields: Fields = {}): (result?: Result, fields?: Fields) => void {
    const started = process.hrtime.bigint()
    this.write(stage, 'start', 'running', fields)
    let ended = false
    return (result = 'ok', endFields = {}) => {
      if (ended) return
      ended = true
      this.write(stage, 'end', result, { ...fields, ...endFields, durationMs: elapsed(started) })
    }
  }

  async measure<T>(stage: string, operation: () => Promise<T>, fields: Fields = {}): Promise<T> {
    const end = this.start(stage, fields)
    try {
      const result = await operation()
      end()
      return result
    } catch (error: unknown) {
      end('failed', { errorCode: 'INITIATION_STAGE_FAILED', errorType: error instanceof Error ? error.name : 'UnknownError' })
      throw error
    }
  }

  expectInput(sessionId: string, messageId: string): void {
    this.input = { sessionId, messageId }
    const claimed = this.claims.get(messageId)
    if (claimed) this.observeInputClaim(claimed.sessionId, messageId, claimed.turn)
  }

  /** Match the exact inbox message, including steering into an existing turn. */
  observeInputClaim(dshSessionId: string, inputMessageId: string, turn: number): void {
    if (this.turnStarted) return
    this.claims.set(inputMessageId, { sessionId: dshSessionId, turn })
    if (this.claims.size > 4) this.claims.delete(this.claims.keys().next().value!)
    if (this.input?.sessionId !== dshSessionId || this.input.messageId !== inputMessageId) return
    this.turnStarted = true
    this.claims.clear()
    this.point('harness.turn_started', { dshSessionId, inputMessageId, turn })
  }

  failInitiation(error: unknown): void {
    if (!this.turnStarted) this.write('harness.initiate', 'end', 'failed', {
      durationMs: elapsed(this.started), errorCode: 'HARNESS_INITIATION_FAILED',
      errorType: error instanceof Error ? error.name : 'UnknownError',
    })
  }

  async publishReply<T>(event: Record<string, unknown>, operation: (envelope: Record<string, unknown>) => Promise<T>): Promise<T> {
    const metadata = object(event['metadata'])
    const eventType = scalar(event['eventType'])
    const eventKind = scalar(metadata['event_kind'])
    const key = `${scalar(event['sessionId'])}:${scalar(metadata['external_session_id'] || event['messageId'])}:${eventType}`
    const now = Date.now()
    const checkpoint = !this.published.has(key) || now - (this.published.get(key) ?? 0) >= 30_000
      || ['finalAnswer', 'appStreamResponse', 'error'].includes(eventType)
    if (checkpoint) this.published.set(key, now)
    if (this.published.size > 128) this.published.delete(this.published.keys().next().value!)
    const envelope = { schemaVersion: 1, ...this.fields, replyEventId: randomUUID(),
      eventSequence: ++this.sequence, checkpoint, eventType,
      eventKind,
      eventSessionId: scalar(event['sessionId']), eventTraceId: scalar(event['traceId']),
      eventMessageId: scalar(event['messageId']), parentMessageId: scalar(event['parentMessageId']),
      externalSessionId: scalar(metadata['external_session_id']), sessionScope: scalar(metadata['session_scope']),
    }
    const details = Object.fromEntries(Object.entries(envelope).filter(([, value]) => value !== undefined)) as Fields
    const end = checkpoint ? this.start('harness.reply_publish', details) : undefined
    try {
      const result = await operation(envelope)
      end?.()
      return result
    } catch (error: unknown) {
      const failure = { ...details, errorCode: 'REPLY_PUBLISH_FAILED', errorType: error instanceof Error ? error.name : 'UnknownError' }
      if (end) end('failed', failure)
      else this.write('harness.reply_publish', 'point', 'failed', failure)
      throw error
    }
  }

  execution(stage: 'harness.step' | 'harness.tool', dshSessionId: string, operationId: string,
    phase: 'start' | 'end', fields: Fields = {}): void {
    const key = `${stage}:${dshSessionId}:${operationId}`
    if (phase === 'start') this.operations.set(key, process.hrtime.bigint())
    const started = this.operations.get(key)
    this.write(stage, phase, phase === 'start' ? 'running' : fields['failed'] ? 'failed' : 'ok', {
      dshSessionId, operationId, ...fields,
      ...(phase === 'end' && started !== undefined ? { durationMs: elapsed(started) } : {}),
    })
    if (phase === 'end') this.operations.delete(key)
    if (this.operations.size > 128) this.operations.delete(this.operations.keys().next().value!)
  }

  private write(stage: string, phase: string, result: Result, fields: Fields): void {
    try {
      const entry = {
        ...this.fields, time: Date.now(), service: 'harness',
        instance: `${process.pid}@${process.env['HOSTNAME'] || 'local'}`,
        stage, phase, result, elapsedMs: elapsed(this.started), ...fields,
      }
      const line = `chat_chain ${JSON.stringify(entry)}`
      if (result === 'failed') console.warn(line)
      else console.info(line)
    } catch { /* Diagnostics must never break dispatch or Agent event listeners. */ }
  }
}

export function chatChain(): ByClawChatChain | undefined { return current.getStore() }

export function runChatChain<T>(command: CommandIdentity, workerId: string, operation: () => Promise<T>, startupId = ''): Promise<T> {
  const chain = new ByClawChatChain(command, workerId, startupId)
  chain.point('harness.received')
  return current.run(chain, operation)
}

export function measureChatStage<T>(stage: string, operation: () => Promise<T>, fields: Fields = {}): Promise<T> {
  return chatChain()?.measure(stage, operation, fields) ?? operation()
}

/** End preparation immediately before input delivery, while keeping failure coverage before that point. */
export async function prepareChatTurn<T>(operation: (ready: (fields?: Fields) => void) => Promise<T>): Promise<T> {
  const end = chatChain()?.start('harness.prepare')
  try { return await operation(fields => end?.('ok', fields)) } catch (error: unknown) {
    end?.('failed', { errorCode: 'AGENT_PREPARATION_FAILED', errorType: error instanceof Error ? error.name : 'UnknownError' })
    throw error
  }
}
