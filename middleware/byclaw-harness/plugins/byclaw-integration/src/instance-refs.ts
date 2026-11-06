import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

/** Execution-adapter metadata, never parsed from model input or output. */
export interface SandboxInstanceRef { sandboxId: string; instance: string; mappingId?: string }
export interface ToolInstanceRefsEvent { callId: string; sourceCallSeq: number; instanceRefs: SandboxInstanceRef[] }
const identifier = z.string().min(1).refine(value => value === value.trim())
export const toolInstanceRefsSchema = z.object({
  callId: identifier,
  sourceCallSeq: z.number().int().nonnegative(),
  instanceRefs: z.array(z.object({ sandboxId: identifier, instance: identifier, mappingId: identifier.optional() }).strict()),
}).strict()

declare module '@deepseek-ai/cordis' {
  interface Events {
    'byclaw/tool-instance-refs'(session: Session, data: ToolInstanceRefsEvent): void
  }
}

/** Listen outside the DSH log: unknown required log events prevent session recovery. */
export function onToolInstanceRefs(ctx: Context, listener: (session: Session, data: ToolInstanceRefsEvent) => void) {
  return ctx.root.on('byclaw/tool-instance-refs', (session, raw) => {
    const parsed = toolInstanceRefsSchema.safeParse(raw)
    if (!parsed.success || !session || typeof session.id !== 'string'
      || !Number.isSafeInteger(session.header?.createdAt)) return
    const call = session.eventAt(parsed.data.sourceCallSeq as never)
    if (call?.type === 'tool/call' && String(call.data.callId) === parsed.data.callId
      || call?.type === 'tool/ptc-dispatch-start' && String(call.data.subCallId) === parsed.data.callId) listener(session, parsed.data)
  })
}

export function describeToolInstanceRefs(data: ToolInstanceRefsEvent, terminal?: 'success' | 'error') {
  return { eventKind: terminal === undefined ? 'tool.call' as const : 'tool.result' as const, status: terminal === 'error' ? 'failed' as const : 'running' as const, summary: 'Tool instance target',
    toolCallId: data.callId, instanceRefs: data.instanceRefs, ...(terminal === undefined ? {} : { isError: terminal === 'error' }) }
}

/** Resolve at publication time so queued metadata cannot reopen an already finished call. */
export function describeSessionToolInstanceRefs(session: Pick<Session, 'snapshotEvents'>, data: ToolInstanceRefsEvent) {
  let terminal: 'success' | 'error' | undefined
  for (const event of session.snapshotEvents()) {
    if (event.seq <= data.sourceCallSeq) continue
    if ((event.type === 'tool/call' && String(event.data.callId) === data.callId)
      || (event.type === 'tool/ptc-dispatch-start' && String(event.data.subCallId) === data.callId)) break
    if (event.type === 'tool/result' && String(event.data.message.toolCallId) === data.callId
      && (event.sourceEventSeqs === undefined || event.sourceEventSeqs.includes(data.sourceCallSeq as never))) {
      terminal = event.data.error !== undefined || event.data.message.isError ? 'error' : 'success'
    }
    if (event.type === 'tool/ptc-dispatch' && String(event.data.subCallId) === data.callId) terminal = event.data.isError ? 'error' : 'success'
  }
  return describeToolInstanceRefs(data, terminal)
}

/** Find the precise call occurrence paired with a native or PTC transcript event. */
export function toolInstanceSourceSeq(session: Pick<Session, 'snapshotEvents'>, callId: string, beforeSeq = Infinity): number | undefined {
  return [...session.snapshotEvents()].reverse().find(event => event.seq <= beforeSeq && (
    (event.type === 'tool/call' && String(event.data.callId) === callId)
    || (event.type === 'tool/ptc-dispatch-start' && String(event.data.subCallId) === callId)))?.seq
}
