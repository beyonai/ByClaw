/** BYCLAW_DSH wire helpers and user-interaction correlation. */

import { createHash, randomUUID } from 'node:crypto'
import type { AskUserEvent, ResumeCommand } from '@byclaw/by-framework'

export const BYCLAW_DSH_AGENT_TYPE = 'BYCLAW_DSH'
export const DEFAULT_BYCLAW_BE_BASE_URL = 'http://123.56.153.229:8080'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Extract the latest user text accepted by the by-framework content variants. */
export function extractByClawUserText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const item = record(value[index])
      if (item?.['role'] === 'user') return extractByClawUserText(item['content'])
    }
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const candidate = extractByClawUserText(value[index])
      if (candidate !== '') return candidate
    }
    return ''
  }
  const item = record(value)
  if (item === undefined) return ''
  if (typeof item['text'] === 'string') return item['text'].trim()
  return extractByClawUserText(item['content'])
}

/** Payload used to render a DSH todo snapshot as a ByClaw task card. */
export function taskPlanCard(todos: ReadonlyArray<{ content: string; status: string }>): {
  contentType: '2008'
  content: string
} {
  return {
    contentType: '2008',
    content: JSON.stringify({
      source: 'DSH',
      schemaVersion: 1,
      planId: createHash('sha256').update(JSON.stringify(todos)).digest('hex').slice(0, 24),
      updatedAt: new Date().toISOString(),
      files: [],
      task_description: 'DSH 任务计划',
      steps: [{
        step_topic: '任务计划',
        collapsed: false,
        sub_steps: todos.map((todo, index) => ({
          id: String(index + 1),
          step_name: `步骤 ${index + 1}`,
          reference_steps: [],
          step_description: todo.content,
          input_files: [],
          output_path: '',
          tool: '',
          tool_metadata: { status: todo.status },
          updateDesc: '',
          updateTag: false,
          invalidErrors: [],
        })),
      }],
      status: 0,
    }),
  }
}

export interface ByClawQuestion {
  id: string
  question: string
  header?: string
  options?: Array<{ label: string; description?: string }>
  multiSelect?: boolean
}

/** Payload used by the current ByClaw FE structured ask-user renderer. */
export function askUserQuestionsCard(
  questions: readonly ByClawQuestion[],
  interactionId?: string,
  session?: { sessionId: string; parentSessionId?: string; depth: number },
): {
  contentType: '3014'
  content: string
} {
  return {
    contentType: '3014',
    content: JSON.stringify({
      source: 'DSH',
      schemaVersion: 1,
      interactionId: interactionId ?? '',
      eventId: `ask:${interactionId ?? ''}`,
      ...(session ?? {}),
      formStatus: 0,
      questions: questions.map((question, index) => ({
        id: question.id,
        question: question.question,
        header: question.header?.trim() || `问题 ${index + 1}`,
        options: (question.options ?? []).map(option => ({
          label: option.label,
          description: option.description ?? '',
        })),
        multiSelect: question.multiSelect === true,
      })),
    }),
  }
}

export interface ByClawQuestionAnswer {
  answers: Array<{ id: string; selected: string[]; custom?: string; skipped?: boolean }>
}

/** Versioned structured answer sent by the ByClaw DSH composer. */
export interface DshInteractionResponse extends ByClawQuestionAnswer {
  source: 'DSH'
  schemaVersion: 1
  interactionId: string
  outcome: 'answered' | 'cancelled'
}

export type DshSessionEventKind =
  | 'session.created'
  | 'session.status'
  | 'session.output'
  | 'session.plan'
  | 'context'
  | 'think'
  | 'plan'
  | 'tool.call'
  | 'tool.result'
  | 'agent-teams/snapshot'
  | 'session.runtime'
  | 'session.error'

export type DshSessionStatus = 'ready' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

/** One durable DSH event projected into the ByClaw conversation. */
export interface DshSessionEventPayload {
  eventId: string
  eventKind: DshSessionEventKind
  sessionId: string
  parentSessionId?: string
  depth: number
  label?: string
  task?: string
  status: DshSessionStatus
  occurredAt: string
  summary: string
  text?: string
  toolName?: string
  toolCallId?: string
  arguments?: string
  result?: string
  isError?: boolean
  contextSource?: string
  plan?: ReadonlyArray<{ content: string; status: string }>
}

/** Serialize one DSH session event with an explicit frontend protocol version. */
export function dshSessionEventCard(payload: DshSessionEventPayload): {
  contentType: '3015'
  content: string
} {
  return {
    contentType: '3015',
    content: JSON.stringify({ source: 'DSH', schemaVersion: 1, ...payload }),
  }
}

interface TeamSnapshotLike {
  teamId: string
  captainSessionId: string
}

/** Keep only AgentTeams snapshots captained by the active DSH session tree. */
export function selectOwnedTeamSnapshots<T extends TeamSnapshotLike>(
  snapshots: readonly T[],
  ownsCaptain: (sessionId: string) => boolean,
): T[] {
  return snapshots.filter(snapshot => ownsCaptain(snapshot.captainSessionId))
}

/** Build a content-stable identity for one AgentTeams snapshot. */
export function dshAgentTeamsSnapshotEventId<T extends TeamSnapshotLike>(team: T, archived: boolean): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ archived, team }))
    .digest('hex')
    .slice(0, 24)
  return `${team.teamId}:${digest}`
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) return undefined
  return value.map(item => item.trim()).filter(item => item !== '')
}

/** Parse a versioned structured ask response at the ByClaw wire boundary. */
export function parseDshInteractionResponse(command: ResumeCommand): DshInteractionResponse | undefined {
  const value = record(record(command.extraPayload)?.['dshInteraction'])
  if (value?.['source'] !== 'DSH' || value['schemaVersion'] !== 1) return undefined
  const interactionId = typeof value['interactionId'] === 'string' ? value['interactionId'].trim() : ''
  const outcome = value['outcome']
  if (interactionId === '' || (outcome !== 'answered' && outcome !== 'cancelled')) return undefined
  if (!Array.isArray(value['answers'])) return undefined
  const answers: DshInteractionResponse['answers'] = []
  for (const item of value['answers']) {
    const answer = record(item)
    const id = typeof answer?.['id'] === 'string' ? answer['id'].trim() : ''
    const selected = stringArray(answer?.['selected'])
    if (id === '' || selected === undefined) return undefined
    const custom = answer?.['custom']
    const skipped = answer?.['skipped']
    if (custom !== undefined && typeof custom !== 'string') return undefined
    if (skipped !== undefined && typeof skipped !== 'boolean') return undefined
    answers.push({
      id,
      selected,
      ...typeof custom === 'string' && custom.trim() !== '' ? { custom: custom.trim() } : {},
      ...skipped === true ? { skipped: true } : {},
    })
  }
  return { source: 'DSH', schemaVersion: 1, interactionId, outcome, answers }
}

interface PendingQuestion {
  id: string
  questions: ByClawQuestion[]
  resolve: (answer: ByClawQuestionAnswer) => void
  reject: (error: Error) => void
}

interface DurableQuestionStore {
  create(input: {
    interactionId: string
    sessionId: string
    userCode: string
    agentSessionId: string
    parentAgentSessionId?: string
    questions: ByClawQuestion[]
  }): Promise<void>
  get(interactionId: string): Promise<{
    sessionId: string
    userCode: string
    questions: ByClawQuestion[]
  } | undefined>
  answer(input: {
    interactionId: string
    sessionId: string
    userCode: string
    answer: ByClawQuestionAnswer
  }): Promise<boolean>
  consumeAnswered(
    sessionId: string,
    userCode: string,
    questions?: readonly Pick<ByClawQuestion, 'id'>[],
  ): Promise<{ answer?: ByClawQuestionAnswer } | undefined>
  consume(interactionId: string, sessionId: string, userCode: string): Promise<{ answer?: ByClawQuestionAnswer } | undefined>
  remove(record: { interactionId: string; sessionId: string; userCode: string }): Promise<void>
}

function plainQuestionAnswer(questions: ByClawQuestion[], response: string): ByClawQuestionAnswer {
  const lines = response.split(/\r?\n/u)
  return {
    answers: questions.map((question, questionIndex) => {
      const line = lines[questionIndex] ?? (questionIndex === 0 ? response : '')
      const separator = Math.max(line.indexOf(':'), line.indexOf('：'))
      const answerText = separator < 0 ? line : line.slice(separator + 1)
      const candidate = answerText.split(/[,，]/u).map(value => value.trim()).filter(Boolean)
      const labels = new Set(question.options?.map(option => option.label) ?? [])
      const selected = candidate.filter(value => labels.has(value))
      const custom = candidate.filter(value => !labels.has(value)).join(', ')
      return { id: question.id, selected, ...custom === '' ? {} : { custom } }
    }),
  }
}

function structuredQuestionAnswer(questions: ByClawQuestion[], response: DshInteractionResponse): ByClawQuestionAnswer {
  const byId = new Map(response.answers.map(answer => [answer.id, answer]))
  return {
    answers: questions.map(question => {
      const answer = byId.get(question.id)
      if (response.outcome === 'cancelled' || answer === undefined) return { id: question.id, selected: [], skipped: true }
      const labels = new Set(question.options?.map(option => option.label) ?? [])
      return {
        id: question.id,
        selected: answer.selected.filter(value => labels.has(value)),
        ...answer.custom === undefined ? {} : { custom: answer.custom },
        ...answer.skipped === true ? { skipped: true } : {},
      }
    }),
  }
}

/** Hot in-memory rendezvous with an optional Redis hand-off across sandbox processes. */
export class ByClawQuestionBroker {
  private readonly pending = new Map<string, PendingQuestion[]>()

  constructor(private readonly durable?: DurableQuestionStore) {}

  async ask(options: {
    sessionId: string
    userCode?: string
    agentSessionId?: string
    parentAgentSessionId?: string
    questions: ByClawQuestion[]
    emit(event: AskUserEvent): Promise<void>
    signal?: AbortSignal
  }): Promise<ByClawQuestionAnswer> {
    if (options.questions.length === 0) throw new Error('ask_user_question requires at least one question')
    if (this.durable !== undefined && options.userCode !== undefined) {
      const recovered = await this.durable.consumeAnswered(options.sessionId, options.userCode, options.questions)
      if (recovered?.answer !== undefined) return recovered.answer
    }
    const id = randomUUID()
    let pending!: PendingQuestion
    const answer = new Promise<ByClawQuestionAnswer>((resolve, reject) => {
      pending = { id, questions: options.questions, resolve, reject }
    })
    const queue = this.pending.get(options.sessionId) ?? []
    queue.push(pending)
    this.pending.set(options.sessionId, queue)
    const prompt = options.questions.map((question, index) => {
      const choices = question.options?.map(option => option.label).join(' / ')
      return `${index + 1}. ${question.header === undefined ? '' : `${question.header}: `}${question.question}${choices === undefined ? '' : ` [${choices}]`}`
    }).join('\n')
    const onAbort = () => {
      this.remove(options.sessionId, id)
      pending.reject(new Error('ByClaw ask_user interaction was aborted'))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (this.durable !== undefined) {
        if (options.userCode === undefined || options.agentSessionId === undefined) {
          throw new Error('Durable ask_user_question requires userCode and agentSessionId')
        }
        await this.durable.create({
          interactionId: id,
          sessionId: options.sessionId,
          userCode: options.userCode,
          agentSessionId: options.agentSessionId,
          ...options.parentAgentSessionId === undefined ? {} : { parentAgentSessionId: options.parentAgentSessionId },
          questions: options.questions,
        })
      }
      await options.emit({ prompt, metadata: { interaction_id: id, questions: options.questions } })
      return await answer
    } catch (error) {
      this.remove(options.sessionId, id)
      if (this.durable !== undefined && options.userCode !== undefined) {
        await this.durable.remove({ interactionId: id, sessionId: options.sessionId, userCode: options.userCode }).catch(() => undefined)
      }
      throw error
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  /** Resolve the matching interaction, or the oldest pending interaction for that session. */
  async resume(sessionId: string, userCode: string, response: string, interactionId?: string): Promise<'hot' | 'cold' | false> {
    const queue = this.pending.get(sessionId)
    const index = queue === undefined ? -1 : interactionId === undefined ? 0 : queue.findIndex(item => item.id === interactionId)
    const pending = index < 0 ? undefined : queue?.[index]
    const persisted = pending === undefined && interactionId !== undefined ? await this.durable?.get(interactionId) : undefined
    const questions = pending?.questions ?? persisted?.questions
    if (questions === undefined || (persisted !== undefined && (persisted.sessionId !== sessionId || persisted.userCode !== userCode))) return false
    const answer = plainQuestionAnswer(questions, response)
    if (this.durable !== undefined && interactionId !== undefined) {
      if (!await this.durable.answer({ interactionId, sessionId, userCode, answer })) return false
      if (pending !== undefined && await this.durable.consume(interactionId, sessionId, userCode) === undefined) return false
    }
    if (pending !== undefined && queue !== undefined) {
      queue.splice(index, 1)
      if (queue.length === 0) this.pending.delete(sessionId)
      pending.resolve(answer)
    }
    return pending === undefined ? 'cold' : 'hot'
  }

  /** Resolve exactly one pending interaction from a versioned structured response. */
  async resumeStructured(sessionId: string, userCode: string, response: DshInteractionResponse): Promise<'hot' | 'cold' | false> {
    const queue = this.pending.get(sessionId)
    const index = queue?.findIndex(item => item.id === response.interactionId) ?? -1
    const pending = index < 0 ? undefined : queue?.[index]
    const persisted = pending === undefined ? await this.durable?.get(response.interactionId) : undefined
    const questions = pending?.questions ?? persisted?.questions
    if (questions === undefined || (persisted !== undefined && (persisted.sessionId !== sessionId || persisted.userCode !== userCode))) return false
    const answer = structuredQuestionAnswer(questions, response)
    if (this.durable !== undefined) {
      if (!await this.durable.answer({ interactionId: response.interactionId, sessionId, userCode, answer })) return false
      if (pending !== undefined && await this.durable.consume(response.interactionId, sessionId, userCode) === undefined) return false
    }
    if (pending !== undefined && queue !== undefined) {
      queue.splice(index, 1)
      if (queue.length === 0) this.pending.delete(sessionId)
      pending.resolve(answer)
    }
    return pending === undefined ? 'cold' : 'hot'
  }

  cancelSession(sessionId: string, reason: string): void {
    const queue = this.pending.get(sessionId) ?? []
    this.pending.delete(sessionId)
    for (const pending of queue) pending.reject(new Error(reason))
  }

  private remove(sessionId: string, id: string): void {
    const queue = this.pending.get(sessionId)
    if (queue === undefined) return
    const next = queue.filter(item => item.id !== id)
    if (next.length === 0) this.pending.delete(sessionId)
    else this.pending.set(sessionId, next)
  }
}
