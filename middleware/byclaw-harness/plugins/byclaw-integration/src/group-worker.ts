/** Execute an exact enterprise worker and return its result to a team task capability. */
import { EventType, SseReasonMessageType, GatewayClient, QueueNames, WorkerRegistry, type AgentContext, type MessageFile } from '@byclaw/by-framework'
import { GroupWorkerBlockedError, type GroupAgentScope, type GroupExternalRequest } from '@byclaw/dsh-agent-teams'
import { randomUUID } from 'node:crypto'

interface WorkerOrigin { context: AgentContext; userCode: string; userName?: string; extraPayload: Readonly<Record<string, unknown>>; content?: unknown; isCancelled: () => boolean }
interface WorkerEvent { session_id?: string; trace_id?: string; source_agent_type?: string; message_id?: string; parent_message_id?: string; event_type?: string; data?: { contentType?: string; choices?: Array<{ delta?: { content?: unknown } }> }; state_msg?: string }

export function externalWorkerEvent(value: unknown, identity: { sessionId: string; traceId: string; workerAgentType: string; messageId: string }): WorkerEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const event = value as WorkerEvent
  if (event.session_id !== identity.sessionId || event.trace_id !== identity.traceId
    || event.source_agent_type !== identity.workerAgentType
    || (event.message_id !== identity.messageId && event.parent_message_id !== identity.messageId)) return undefined
  return event
}

export function externalWorkerTarget(configured: string, userCode: string): string {
  if (/^(HARNESS|BYCLAW_DSH)(_|$)/i.test(configured)) throw new Error('A HARNESS employee must execute in its local Harness member session')
  for (const base of ['BYCLAW_CODE', 'BYCLAW_EXE']) {
    if (configured === base || configured.startsWith(`${base}_`)) return `${base}_${userCode}`
  }
  return configured
}

function eventText(event: WorkerEvent): string {
  return (event.data?.choices ?? []).map(choice => typeof choice.delta?.content === 'string' ? choice.delta.content : '').join('')
}

/** Remove root executor overrides and attached-resource references from a child worker payload. */
export function externalWorkerPayload(extra: Readonly<Record<string, unknown>>, employeeId: string, modelId?: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (/^(agent|employee|digitalEmployee|model|master_model|persona|template|source_agent|worker_agent|dsh_|byclaw_root|groupCoordination|groupTask|groupContextSnapshot|resource|attachment|file)/i.test(key)) continue
    if (['extParams','ext_params','metadata'].includes(key) && typeof value === 'string') continue
    if (['extParams','ext_params','metadata'].includes(key) && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = externalWorkerPayload(value as Record<string, unknown>, employeeId, modelId)
    } else result[key] = value
  }
  result['agent_id'] = employeeId
  result['agentId'] = employeeId
  if (modelId !== undefined) result['model_id'] = modelId
  return result
}

/** Freeze only user-submitted file/document references for a selected platform worker. */
export function externalTaskInputs(content: unknown, extra: Readonly<Record<string, unknown>>): {
  files: Array<Record<string, unknown>>; resources: Array<Record<string, unknown>>
} {
  const files = new Map<string, Record<string, unknown>>()
  const resources = new Map<string, Record<string, unknown>>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { for (const value of node) visit(value); return }
    if (typeof node !== 'object' || node === null) return
    for (const [key, entry] of Object.entries(node)) {
      if (/^(files|file_?list|attachments)$/i.test(key) && Array.isArray(entry)) for (const raw of entry) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        const file = Object.fromEntries(Object.entries(raw).filter(([field, value]) =>
          ['datasetId','sourceType','useType','fileId','fileName','fileUrl','filePath','fileSize','fileType'].includes(field)
          && (typeof value === 'string' || typeof value === 'number')))
        const reference = [file['fileId'], file['fileUrl'], file['filePath']].some(value =>
          (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isFinite(value) && value > 0))
        if (!reference) throw new GroupWorkerBlockedError('missing_user_input', 'The task attachment has no usable file reference; the user must supply the file again')
        files.set(JSON.stringify(file), file)
      }
      if (/^(resource_?list|resources)$/i.test(key) && Array.isArray(entry)) for (const raw of entry) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        const item = raw as Record<string, unknown>
        const type = String(item['resourceType'] ?? '').toUpperCase()
        if (['DIG_EMPLOYEE','EMPLOYEE_GROUP','GROUP','AGENT'].includes(type)) continue
        if (!['COMMON_FILE','KG_DOC_FILE','KG_DOC'].includes(type)) throw new GroupWorkerBlockedError('outside_scope', `Unsupported shared task resource type ${type}; the coordinator must explain the missing capability`)
        const resource = Object.fromEntries(Object.entries(item).filter(([field, value]) =>
          ['resourceId','resourceType','resourceName','resourceCode'].includes(field) && typeof value === 'string'))
        if (typeof resource['resourceId'] !== 'string' || resource['resourceId'].trim() === '') throw new GroupWorkerBlockedError('missing_user_input', 'The task resource has no usable resource ID; the user must supply the document again')
        resources.set(JSON.stringify(resource), resource)
      }
      if (['extParams','ext_params','metadata'].includes(key) && typeof entry === 'string') {
        try { visit(JSON.parse(entry)) } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error }
      } else if (['content','extParams','ext_params','metadata'].includes(key)) visit(entry)
    }
  }
  visit(content)
  visit(extra)
  return { files: [...files.values()], resources: [...resources.values()] }
}

export class ByClawExternalWorkerAdapter {
  private readonly client: Pick<GatewayClient, 'sendMessage' | 'cancelSession'>
  private readonly registry: Pick<WorkerRegistry, 'getExecutionByMessageId' | 'getRandomOnlineWorker'>
  constructor(private readonly redis: NonNullable<ConstructorParameters<typeof WorkerRegistry>[0]>,
    private readonly origin: (captainSessionId: string) => WorkerOrigin | undefined,
    ports?: { client: Pick<GatewayClient, 'sendMessage' | 'cancelSession'>; registry: Pick<WorkerRegistry, 'getExecutionByMessageId' | 'getRandomOnlineWorker'> }) {
    const registry = new WorkerRegistry(redis)
    this.registry = ports?.registry ?? registry
    this.client = ports?.client ?? new GatewayClient(registry, redis)
  }

  async execute(request: GroupExternalRequest, scope: GroupAgentScope, workerAgentType: string): Promise<{ output: string }> {
    const origin = this.origin(request.captainSessionId)
    if (origin === undefined) throw new Error('The original group task execution is no longer active')
    const sharedInputs = externalTaskInputs(origin.content, origin.extraPayload)
    workerAgentType = externalWorkerTarget(workerAgentType, origin.userCode)
    if (request.execution !== undefined && request.execution.workerAgentType !== workerAgentType) throw new Error('The frozen external task worker cannot change on resume')
    const sessionId = request.execution?.sessionId ?? `group-worker-${randomUUID()}`
    const messageId = request.execution?.messageId ?? randomUUID()
    const traceId = request.execution?.traceId ?? randomUUID()
    const identity = { sessionId, messageId, traceId, workerAgentType }
    // Child executions have independent output streams and no source callback.
    // They cannot start a new BE group task or impersonate the coordinator.
    const childScope = { ...scope.coordination, mode: 'DIRECT' as const, taskSessionId: sessionId }
    await request.onDispatched(identity)
    const previous = request.execution === undefined ? undefined : await this.registry.getExecutionByMessageId(messageId, sessionId)
    const needsDispatch = previous === undefined || previous === null
    const targetWorkerId = needsDispatch ? await this.registry.getRandomOnlineWorker(workerAgentType) : undefined
    if (needsDispatch && targetWorkerId == null) throw new Error(`No online worker exists for the employee's configured engine ${workerAgentType}; an engine fallback is not permitted`)
    // BE's existing file wire contract permits opaque string IDs and ID-only references.
    // The SDK declares numeric IDs/full fields but serializes this content unchanged; never coerce snowflake IDs.
    const response = needsDispatch ? await this.client.sendMessage({
      targetWorkerId: targetWorkerId ?? undefined, targetAgentType: workerAgentType, sourceAgentType: '', sessionId, messageId, traceId,
      userCode: origin.userCode, userName: origin.userName, requireOnlineWorker: true,
      content: [{ role: 'user', content: { text: `You are executing the assigned employee's task. Return the completed result or a precise missing-input failure. An @ mention is display only and must not dispatch a peer.\n\n${request.prompt}`, files: sharedInputs.files as unknown as MessageFile[] } }],
      extraPayload: { ...externalWorkerPayload(origin.extraPayload, request.employeeId, request.modelId), groupCoordination: childScope,
        groupTask: { parentTaskSessionId: scope.coordination.taskSessionId, groupSessionId: scope.coordination.groupSessionId,
          employeeId: request.employeeId, teamTaskId: request.taskId, attemptId: request.attemptId },
        resource_list: sharedInputs.resources, byclaw_root_session_id: undefined, dsh_target_session_id: undefined, dsh_parent_session_id: undefined },
      metadata: { group_task_session_id: scope.coordination.taskSessionId, group_employee_id: request.employeeId,
        group_team_task_id: request.taskId, group_attempt_id: request.attemptId },
    }) : { success: true, status: 'RESUMED', error: undefined, error_code: undefined }
    if (!response.success) throw new Error(`Worker ${workerAgentType} rejected the task: ${response.error_code ?? response.status} ${response.error ?? ''}`)
    let cursor = '0-0'
    let final: string | undefined
    let deltas = ''
    let streamEnded = false
    let missingInput = ''
    const reader = this.redis.duplicate()
    const cancel = async (reason: string): Promise<void> => {
      await this.client.cancelSession({ sessionId, targetAgentType: workerAgentType, reason, cancelMode: 'graceful' })
    }
    try {
      while (true) {
        if (request.signal.aborted || origin.isCancelled() || !await request.isCurrent()) {
          await cancel('The original group task attempt was cancelled or replaced')
          throw new Error('The original group task attempt was cancelled or replaced')
        }
        const raw = await reader.xread('COUNT', 100, 'BLOCK', 500, 'STREAMS', QueueNames.session_data_stream(sessionId), cursor) as Array<[string, Array<[string, string[]]>]> | null
        for (const [, entries] of raw ?? []) for (const [id, fields] of entries) {
          cursor = id
          const dataIndex = fields.indexOf('data')
          if (dataIndex < 0 || fields[dataIndex + 1] === undefined) continue
          let decoded: unknown
          try { decoded = JSON.parse(fields[dataIndex + 1]!) } catch { continue }
          const event = externalWorkerEvent(decoded, identity)
          if (event === undefined) continue
          if (String(event.data?.contentType) === SseReasonMessageType.task_user_input) missingInput = eventText(event)
          if (event.event_type === EventType.FINAL_ANSWER) final = eventText(event)
          else if (event.event_type === EventType.ANSWER_DELTA && ['1002', 'text'].includes(String(event.data?.contentType))) deltas += eventText(event)
          if (event.event_type === EventType.APP_STREAM_RESPONSE) streamEnded = true
        }
        const execution = await this.registry.getExecutionByMessageId(messageId, sessionId)
        if (execution !== null && String(execution['trace_id'] ?? '') !== traceId) throw new Error('External execution identity does not match the original task attempt')
        const status = String(execution?.['status'] ?? '').split(':')[0]!.toUpperCase()
        if (status === 'FAILED' || status === 'CANCELLED') throw new Error(`Worker ${workerAgentType} ${status.toLowerCase()}: ${String(execution?.['error'] ?? execution?.['error_message'] ?? 'no result')}`)
        if (status === 'WAITING_USER') {
          await cancel('The delegated employee requires missing user input; return it to the coordinator')
          throw new GroupWorkerBlockedError('missing_user_input', `The delegated employee requires user input; the coordinator must obtain it before assigning the task again. ${missingInput}`)
        }
        if (status === 'COMPLETED' && (streamEnded || raw === null)) {
          const output = final ?? deltas
          if (output.trim() === '') throw new Error('The employee worker completed without a result')
          return { output }
        }
      }
    } catch (error: unknown) {
      await cancel('External employee execution could not finish').catch(() => undefined)
      throw error
    } finally { reader.disconnect() }
  }
}
