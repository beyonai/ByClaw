/** Task-manager proposals use trusted host identity and never confirm tasks on the user's behalf. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import { publicationIdSchema } from './ids.ts'

const id = z.string().regex(/^[1-9]\d*$/u)
const item = z.object({
  itemKey: z.string().min(1).max(128), title: z.string().max(512).optional(), content: z.string().max(100_000).optional(),
  assigneeUserId: id.optional(), deadline: z.string().datetime({ offset: true }).optional(),
  acceptanceCriteria: z.string().max(100_000).optional(),
}).strict()
const input = z.object({
  batchId: id.optional(), expectedRevision: z.number().int().nonnegative().optional(),
  items: z.array(item).min(1).max(100),
}).strict().refine(value => (value.batchId === undefined) === (value.expectedRevision === undefined))

export interface HumanTaskBinding {
  sourceTaskSessionId: string
  userCode: string
  messageId: string
  enterpriseId?: string
}

/** Eligibility is intentionally not inferred from an employee's mutable display name. */
export function resolveHumanTaskBinding(command: {
  header: { sessionId: string | number; userCode: string; messageId?: string | number }
  extraPayload: Record<string, unknown>
}, taskManagerAgentIds: string[]): HumanTaskBinding | undefined {
  const group = z.object({ childSessionId: publicationIdSchema, conversationKey: publicationIdSchema,
    targetAgentId: publicationIdSchema, enterpriseId: id.optional() }).safeParse(command.extraPayload['groupChat'])
  if (!group.success || !taskManagerAgentIds.includes(group.data.targetAgentId)) return undefined
  const sessionId = publicationIdSchema.parse(command.header.sessionId)
  if (group.data.childSessionId !== sessionId) throw new Error('任务提案上下文与当前会话不一致。')
  const enterpriseId = id.optional().parse(command.extraPayload['enterpriseId'] ?? group.data.enterpriseId)
  return { sourceTaskSessionId: sessionId, userCode: command.header.userCode,
    messageId: publicationIdSchema.parse(command.header.messageId), ...(enterpriseId && { enterpriseId }) }
}

export interface HumanTaskClientOptions {
  baseUrl: string
  userCode: string
  timeoutMs: number
  resolveAuthHeaders(): Promise<Record<string, string>>
  fetchImpl?: typeof fetch
}
export const HUMAN_TASK_DESCRIPTION = '用户要求在当前群中派待办给真人时，整理一项或多项待办提案。创建或整体替换草稿，缺少负责人或内容时可留空供发起人补充。必须等待发起人确认；不创建正式待办、不代替确认，不声称已派发。更新已有提案须提供其 batchId 和最新 expectedRevision。'

export class GroupHumanTaskTools {
  private readonly mounted = new WeakMap<Context, { binding: HumanTaskBinding; dispose?: () => void }>()
  constructor(private readonly options: HumanTaskClientOptions) {}

  mount(ctx: Context, binding: HumanTaskBinding, owner?: Context): void {
    const previous = this.mounted.get(ctx)
    if (previous) {
      if (previous.binding.userCode !== binding.userCode || previous.binding.sourceTaskSessionId !== binding.sourceTaskSessionId) {
        throw new Error('任务提案工具与当前会话身份不一致。')
      }
      previous.binding = binding
      return
    }
    const session: { binding: HumanTaskBinding; dispose?: () => void } = { binding }
    const tool: ToolDefinition = {
      name: 'prepare_group_human_tasks', description: HUMAN_TASK_DESCRIPTION,
      parameters: {
        type: 'object', additionalProperties: false, required: ['items'],
        properties: {
          batchId: { type: 'string', pattern: '^[1-9][0-9]*$', description: '更新已有草稿时填写，创建时省略。' },
          expectedRevision: { type: 'integer', minimum: 0, description: '更新草稿时必须提供最新版本号，与 batchId 同时填写。' },
          items: { type: 'array', minItems: 1, maxItems: 100, description: '完整待办列表；更新时整体替换，不增量合并。', items: {
            type: 'object', additionalProperties: false, required: ['itemKey'], properties: {
              itemKey: { type: 'string', minLength: 1, maxLength: 128, description: '提案内稳定且唯一的条目标识，编辑时保留。' },
              title: { type: 'string', maxLength: 512 }, content: { type: 'string', maxLength: 100000 },
              assigneeUserId: { type: 'string', pattern: '^[1-9][0-9]*$', description: '当前群真人用户 ID；不确定时省略，不得编造。' },
              deadline: { type: 'string', format: 'date-time', description: '带时区的 ISO 8601 截止时间；未知时省略。' },
              acceptanceCriteria: { type: 'string', maxLength: 100000 },
            },
          } },
        },
      },
      output: { schema: { type: 'object', required: ['batchId', 'revision'], properties: {
        batchId: { type: 'string' }, revision: { type: 'integer' },
      } }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
      execute: (args, exec) => this.prepare(session.binding, args, exec.signal),
    }
    const register = () => {
      const dispose = ctx.tools.register(tool)
      return () => { dispose(); this.mounted.delete(ctx) }
    }
    if (owner) {
      const dispose = owner.effect(register)
      session.dispose = dispose
      ctx.effect(() => () => dispose())
    } else {
      session.dispose = ctx.effect(register)
    }
    this.mounted.set(ctx, session)
  }

  /** A reused Agent context must lose this capability when the trusted employee scope changes. */
  unmount(ctx: Context): void {
    this.mounted.get(ctx)?.dispose?.()
    this.mounted.delete(ctx)
  }

  private async prepare(binding: HumanTaskBinding, args: unknown, signal: AbortSignal): Promise<{ batchId: string; revision: number }> {
    const parsed = input.parse(args)
    if (binding.userCode !== this.options.userCode) throw new Error('当前运行环境的用户身份不一致。')
    if (new Set(parsed.items.map(value => value.itemKey)).size !== parsed.items.length) throw new Error('条目标识不能重复。')
    const headers = new Headers(await this.options.resolveAuthHeaders())
    if (!headers.get('Beyond-Token')?.trim()) throw new Error('当前运行环境的 BE 用户认证不可用。')
    if (binding.enterpriseId) headers.set('X-Enterprise-Id', binding.enterpriseId)
    headers.set('Content-Type', 'application/json')
    const url = new URL(this.options.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('BE 服务地址配置无效。')
    const prefix = url.pathname.replace(/\/+$/u, '') || '/byaiService'
    url.pathname = `${prefix}/group-human-task-proposals${parsed.batchId ? `/${parsed.batchId}` : ''}`
    // Stable per trusted input and draft content: transport retries cannot create another batch.
    const requestId = createHash('sha256').update(JSON.stringify([binding, parsed])).digest('hex')
    const body = parsed.batchId ? { expectedRevision: parsed.expectedRevision, items: parsed.items }
      : { sourceTaskSessionId: binding.sourceTaskSessionId, requestId, items: parsed.items }
    const response = await (this.options.fetchImpl ?? fetch)(url.toString(), { method: parsed.batchId ? 'PATCH' : 'POST',
      headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]) })
    const envelope = z.object({ code: z.union([z.number(), z.string()]), data: z.unknown().optional() }).safeParse(await response.json())
    if (!response.ok || !envelope.success || ![0, '0'].includes(envelope.data.code)) {
      throw new Error('提案保存未成功，请核对当前提案状态与版本；不能声称已派发，也不要自动覆盖。')
    }
    return z.object({ batchId: id, revision: z.number().int().nonnegative() }).parse(envelope.data.data)
  }
}
