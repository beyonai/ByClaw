/** Validated, non-retried BE requests for user-confirmed group publication cards. */

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { publicationIdSchema } from './ids.ts'

/** Immutable task and user identity supplied by the host session adapter. */
export interface GroupTaskPublicationBinding {
  readonly taskId: string
  readonly userCode: string
}

const inputSchema = z.object({
  text: z.string().max(100_000).optional(),
  sourcePaths: z.array(z.string().min(1).max(4096)).max(100).optional(),
}).strict().refine(value => (value.text?.trim().length ?? 0) > 0 || (value.sourcePaths?.length ?? 0) > 0)

const publicationSchema = z.object({
  taskId: publicationIdSchema,
  pendingPublicationId: publicationIdSchema,
  text: z.string().nullable(),
  sourcePaths: z.array(z.string()),
  createTime: z.string().min(1),
})

/** Canonical BE card data; IDs remain strings and attachment-only text may be null. */
export type Publication = z.infer<typeof publicationSchema>

const UNCERTAIN = '准备待发布内容的结果不确定，不能声称已准备好或已经发布。请查询当前待发布内容核实；查询结果可能来自并发修改，勿自动重试或覆盖。'

/** Report only fixed diagnostic labels, never response values or transport exception messages. */
function uncertain(reason: string): Error {
  return new Error(`${reason}。${UNCERTAIN}`)
}

// BE deployments may serialize Integer fields as strings. Only 0 and "0" mean success.
const envelopeSchema = z.object({
  code: z.union([z.number().int(), z.string().regex(/^-?\d+$/u)]),
  msg: z.string().nullish(),
  data: z.unknown().optional(),
})

// Only known domain failures reach the model; BE messages can contain credentials or internal details.
const BUSINESS_ERRORS: Readonly<Record<string, string>> = {
  'Task is not active': '当前群任务不是 ACTIVE 状态。',
  'Group task not found': '当前群任务不存在。',
  'User is not a group member': '当前用户已不是来源群成员。',
  'User is not authenticated': 'BE 用户认证不可用。',
  'Only task initiator can access unpublished task content': '只有任务发起人可以准备待发布卡片。',
  'Pending publication requires text or files': '正文和文件至少提供一项。',
  "File must be an absolute /by/ path in the current user's workspace": '附件必须是当前用户工作区内的 /by/ 绝对文件路径。',
}

/** Keep diagnostic response fields while excluding publication content and unknown credentials. */
function responseForLog(payload: unknown, headers: Headers): unknown {
  const secrets: string[] = []
  headers.forEach(value => {
    if (value.length > 0) secrets.push(value)
  })
  const redact = (value: string): string => {
    let result = value
    for (const secret of secrets) result = result.split(secret).join('[REDACTED]')
    return result.replace(/((?:[\w-]*(?:token|authorization|password|secret|cookie)[\w-]*)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;<>]+)/giu, '$1[REDACTED]')
      .replace(/Bearer\s+[^\s,;"'<>]+/giu, 'Bearer [REDACTED]').slice(0, 1024)
  }
  const scalar = (value: unknown): unknown => typeof value === 'string' ? redact(value)
    : value === null || typeof value === 'number' || typeof value === 'boolean' ? value
      : { type: Array.isArray(value) ? 'array' : typeof value }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return scalar(payload)
  const envelope = payload as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of ['code', 'msg']) if (key in envelope) result[key] = scalar(envelope[key])
  const data = envelope['data']
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const fields = data as Record<string, unknown>
    const summary: Record<string, unknown> = {}
    for (const key of ['taskId', 'pendingPublicationId', 'createTime']) if (key in fields) summary[key] = scalar(fields[key])
    if ('text' in fields) summary['text'] = typeof fields['text'] === 'string' ? { redacted: true, length: fields['text'].length } : scalar(fields['text'])
    if ('sourcePaths' in fields) summary['sourcePaths'] = Array.isArray(fields['sourcePaths']) ? { redacted: true, count: fields['sourcePaths'].length } : { type: fields['sourcePaths'] === null ? 'null' : typeof fields['sourcePaths'] }
    result['data'] = summary
  } else if ('data' in envelope) result['data'] = scalar(data)
  return result
}

/** Dependencies of a publication request; authentication is resolved afresh on each call. */
export interface GroupTaskPublicationClientOptions {
  baseUrl: string
  userCode: string
  /** Resolve fresh login headers for the configured user; never use a group context token. */
  resolveAuthHeaders(): Promise<Record<string, string>>
  /** Map a validated virtual /by/ path into the current user's mounted root. */
  resolveSourcePath(source: string): string
  byRoot: string
  timeoutMs: number
  fetchImpl?: typeof fetch
  /**
   * The user tree's files when they live in the tool environment rather than on
   * this host (the shared DSH host): attachments are checked there.
   */
  userFiles?: {
    realpath(path: string): Promise<string>
    lstat(path: string): Promise<{ type: string } | undefined>
  }
}

/** Verify a readable regular file in the user's mounted ByClaw filesystem without uploading it. */
async function validateFile(source: string, options: GroupTaskPublicationClientOptions, signal: AbortSignal): Promise<void> {
  if (!source.startsWith('/by/') || source.endsWith('/') || /[\\\u0000]/u.test(source)
    || source.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('附件必须是当前用户工作区内的 /by/ 绝对文件路径。')
  }
  signal.throwIfAborted()
  try {
    const files = options.userFiles
    const root = await (files ?? { realpath }).realpath(resolve(options.byRoot))
    const file = await (files ?? { realpath }).realpath(options.resolveSourcePath(source))
    const suffix = relative(root, file)
    if (suffix === '' || suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) {
      throw new Error('outside-user-root')
    }
    if (files !== undefined) {
      if ((await files.lstat(file))?.type !== 'file') throw new Error('not-a-file')
    } else {
      // Nonblocking open prevents a FIFO from stalling validation before the regular-file check.
      const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
      try {
        if (!(await handle.stat()).isFile()) throw new Error('not-a-file')
      } finally {
        await handle.close()
      }
    }
  } catch {
    throw new Error('附件不存在、不可读取，或不是当前用户 /by/ 工作区内的普通文件。')
  }
  signal.throwIfAborted()
}

/** BE client with one POST attempt and no publication, upload, or completion side effects. */
export class GroupTaskPublicationClient {
  constructor(private readonly options: GroupTaskPublicationClientOptions) {}

  /** Prepare one replacement and return only the validated BE data object. */
  async prepare(binding: GroupTaskPublicationBinding, args: unknown, signal: AbortSignal): Promise<Publication> {
    const requestId = randomUUID()
    const startedAt = Date.now()
    let stage = 'prepare.start'
    const log = (event: string, details: Record<string, unknown> = {}) => {
      stage = event
      console.info('[group-task-publication]', JSON.stringify({ requestId, event, elapsedMs: Date.now() - startedAt, ...details }))
    }
    log('prepare.start', { taskId: binding.taskId })
    try {
      const result = await this.perform(binding, args, signal, log)
      log('prepare.success', { taskId: result.taskId, pendingPublicationId: result.pendingPublicationId })
      return result
    } catch (error) {
      log('prepare.failed', { failedStage: stage })
      throw error
    }
  }

  private async perform(
    binding: GroupTaskPublicationBinding, args: unknown, signal: AbortSignal,
    log: (event: string, details?: Record<string, unknown>) => void,
  ): Promise<Publication> {
    log('validation.start')
    const parsed = inputSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error('参数无效：只允许 text（最多 100000 字符）和 sourcePaths（最多 100 项，每项 1–4096 字符）；正文去掉首尾空白后非空，或附件列表非空。')
    }
    if (binding.userCode !== this.options.userCode) throw new Error('当前运行环境没有该用户可用的 BE 认证能力。')
    signal.throwIfAborted()
    log('authentication.start')
    let headers: Headers
    try {
      headers = new Headers(await this.options.resolveAuthHeaders())
      if (!headers.get('Beyond-Token')?.trim()) throw new Error('missing-login-token')
      headers.set('content-type', 'application/json')
    } catch {
      throw new Error('当前运行环境的 BE 用户认证不可用，请恢复登录后再操作。')
    }
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)])
    log('files.validate', { sourcePathCount: parsed.data.sourcePaths?.length ?? 0 })
    for (const path of parsed.data.sourcePaths ?? []) await validateFile(path, this.options, requestSignal)
    log('endpoint.resolve')
    const url = new URL(this.options.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      throw new Error('BE 服务地址配置无效。')
    }
    const prefix = url.pathname.replace(/\/+$/u, '') || '/byaiService'
    url.pathname = `${prefix}/group-chat/tasks/${encodeURIComponent(binding.taskId)}/pending-publication`
    requestSignal.throwIfAborted()
    log('request.send', { method: 'POST', url: url.toString(), timeoutMs: this.options.timeoutMs, textLength: parsed.data.text?.length ?? 0, sourcePathCount: parsed.data.sourcePaths?.length ?? 0 })
    let response: Response
    let payload: unknown
    try {
      response = await (this.options.fetchImpl ?? fetch)(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: parsed.data.text ?? '', sourcePaths: parsed.data.sourcePaths ?? [] }),
        signal: requestSignal,
        redirect: 'manual',
      })
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined
      log('request.failed', { aborted: requestSignal.aborted, callerAborted: signal.aborted, transportCode: typeof code === 'string' && /^(?:E[A-Z]+|UND_ERR_[A-Z_]+)$/u.test(code) ? code : undefined })
      // The server may have committed even when the connection was lost.
      throw uncertain(requestSignal.aborted ? '请求已超时或被取消' : '未收到 BE 响应（网络或连接失败）')
    }
    log('response.headers', { status: response.status, contentType: response.headers.get('content-type')?.slice(0, 256) })
    const unauthorized = response.status === 401 || response.status === 403
    try {
      const body = await response.text()
      try {
        payload = JSON.parse(body)
      } catch {
        // Non-JSON pages can reflect request headers; log their size rather than their contents.
        log('response.invalid-json', { status: response.status, bodyLength: body.length })
        throw new Error('invalid-json')
      }
      log('response.body', { status: response.status, body: responseForLog(payload, headers) })
    } catch {
      log('response.read-failed', { status: response.status, aborted: requestSignal.aborted })
      if (unauthorized) throw new Error('BE 拒绝认证或授权，请确认登录身份、任务发起人及群成员资格。')
      throw uncertain(`BE 响应不是有效 JSON 或响应体未完整读取（HTTP ${response.status}）`)
    }
    if (unauthorized) throw new Error('BE 拒绝认证或授权，请确认登录身份、任务发起人及群成员资格。')
    if (!response.ok) {
      throw uncertain(`BE 返回 HTTP ${response.status}`)
    }
    log('response.validate-envelope')
    const envelope = envelopeSchema.safeParse(payload)
    if (!envelope.success) {
      log('response.invalid-envelope')
      throw uncertain('BE 响应不符合 ResponseUtil 协议（code 或 msg 类型无效）')
    }
    if (envelope.data.code !== 0 && envelope.data.code !== '0') {
      log('response.business-error')
      throw new Error(BUSINESS_ERRORS[envelope.data.msg ?? ''] ?? 'BE 拒绝准备待发布卡片；请确认任务状态、登录权限及附件路径。')
    }
    log('response.validate-data')
    const result = publicationSchema.safeParse(envelope.data.data)
    if (!result.success) {
      const fields = ['taskId', 'pendingPublicationId', 'text', 'sourcePaths', 'createTime']
        .filter(field => result.error.issues.some(issue => issue.path[0] === field))
      log('response.invalid-data', { fields: fields.length === 0 ? ['data'] : fields })
      throw uncertain(`BE 成功响应的 data 校验失败（${fields.length === 0 ? 'data' : fields.join(', ')}）`)
    }
    if (result.data.taskId !== binding.taskId) {
      log('response.task-mismatch')
      throw uncertain('BE 返回的 taskId 与当前业务会话不一致')
    }
    return result.data
  }
}
