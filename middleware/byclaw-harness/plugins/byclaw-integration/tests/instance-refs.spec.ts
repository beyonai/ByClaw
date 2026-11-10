import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { validateStoredEvents } from '@deepseek-ai/dsh-session-persistence'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describeToolInstanceRefs, describeSessionToolInstanceRefs, onToolInstanceRefs, toolInstanceSourceSeq } from '../src/instance-refs.ts'
import { ByClawSessionMetadataStore, byClawSessionsDomainSpec } from '../src/session-metadata.ts'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@byclaw/by-framework', () => ({ EventType: { REASONING_LOG_DELTA: 'reasoning.log.delta', ANSWER_DELTA: 'answer.delta' } }))
// Root/instance storage does not use team policy; the offline tree lacks its built package.
vi.mock('../src/group-coordination.ts', () => ({ parseGroupCoordination: (value: unknown) => value }))
vi.mock('@byclaw/dsh-agent-teams', () => ({ groupScope: () => undefined }))
import { emitByClawProjection, toolCallProjection } from '../src/byclaw-presentation.ts'
const context = { sessionId: 'session', rootSessionId: 'session', externalParentSessionId: 'external', scope: 'parent' as const, depth: 0, sequence: 2, eventKind: 'tool.call' as const, parentMessageId: 'parent' }
describe('tool instance reference wire projection', () => {
  it('puts explicit empty and live refs only on the AnswerDelta root with stable orderId', async () => {
    const events: any[] = []
    const emitter = { emitEvent: async (event: any) => { events.push(event) }, emitChunk: vi.fn() }
    for (const instanceRefs of [[], [{ sandboxId: 'provider', mappingId: 'map', instance: 'desktop' }]]) {
      const projection = toolCallProjection({ phase: 'start', toolCallId: 'call', instanceRefs }, context)
      await emitByClawProjection(emitter as never, 'external', 'trace', projection, 'harness')
    }
    expect(events.map(event => event.data.instanceRefs)).toEqual([[], [{ sandboxId: 'provider', mappingId: 'map', instance: 'desktop' }]])
    expect(events.map(event => event.data.orderId)).toEqual(['call', 'call'])
    for (const event of events) {
      expect(JSON.parse(event.data.choices[0].delta.content)).not.toHaveProperty('instanceRefs')
    }
    expect(events[1].data.choices[0].delta.content).not.toContain('http')
    expect(emitter.emitChunk).not.toHaveBeenCalled()
  })
  it('restores refs from the existing domain without making the actual DSH persistence reader reject its log', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'byclaw-instance-refs-'))
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(directory)
    ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json' })
    ctx.provide('storageDomain', facility)
    // Upgrade an existing domain whose root record predates the new table.
    const legacy = await facility.open({ ...byClawSessionsDomainSpec, tables: { roots: byClawSessionsDomainSpec.tables.roots } })
    const root = { identity: { createdAt: 1 }, externalSessionId: 'external', binding: { kind: 'main' as const } }
    await legacy.table('roots').put('session', root)
    await legacy.close()
    const session = Session.create(SessionId('session'))
    let store = await ByClawSessionMetadataStore.open(ctx)
    const pending: Promise<unknown>[] = []
    const stop = onToolInstanceRefs(ctx, (source, data) => { pending.push(store.recordToolInstanceRefs(source, data)) })
    try {
      expect(store.get('session')).toEqual(root)
      session.append('tool/call', { turn: 1, step: 1, callId: 'long-call' as never, name: 'browser', arguments: '{}' })
      for (const instanceRefs of [[], [{ sandboxId: 'A', instance: 'browser' }], [{ sandboxId: 'B', instance: 'editor' }]]) {
        ctx.emit('byclaw/tool-instance-refs', session, { callId: 'long-call', sourceCallSeq: 0, instanceRefs })
      }
      await Promise.all(pending)
      const stored = JSON.parse(JSON.stringify(session.snapshotEvents()))
      const restored = Session.create(session.id, validateStoredEvents(session.header, stored), session.header)
      expect(stored.map((event: any) => event.type)).toEqual(['tool/call'])
      await store.close()
      store = await ByClawSessionMetadataStore.open(ctx)
      expect(store.get('session')).toEqual(root)
      const record = store.getToolInstanceRefs(restored, 'long-call', 0)!
      expect(record).toEqual({ callId: 'long-call', sourceCallSeq: 0, revision: 3, instanceRefs: [{ sandboxId: 'A', instance: 'browser' }, { sandboxId: 'B', instance: 'editor' }] })
      expect(store.getToolInstanceRefs(restored, 'legacy', 0)).toBeUndefined()
      expect(store.getToolInstanceRefs({ id: restored.id, header: { createdAt: restored.header.createdAt + 1 } }, 'long-call', 0)).toBeUndefined()
      const projection = toolCallProjection({ phase: 'start', toolCallId: record.callId, instanceRefs: record.instanceRefs }, context)
      const wire: any[] = []
      await emitByClawProjection({ emitChunk: vi.fn(), emitEvent: async event => { wire.push(event) } }, 'external', 'trace', projection, 'harness')
      expect(wire[0].data.instanceRefs).toEqual([{ sandboxId: 'A', instance: 'browser' }, { sandboxId: 'B', instance: 'editor' }])
      expect(JSON.parse(wire[0].data.choices[0].delta.content)).not.toHaveProperty('instanceRefs')
      await store.recordToolInstanceRefs(restored, { callId: 'long-call', sourceCallSeq: 0, instanceRefs: [] })
      await store.close()
      store = await ByClawSessionMetadataStore.open(ctx)
      expect(store.getToolInstanceRefs(restored, 'long-call', 0)).toEqual(record)
      const next = restored.append('tool/call', { turn: 2, step: 1, callId: 'long-call' as never, name: 'browser', arguments: '{}' })
      await store.recordToolInstanceRefs(restored, { callId: 'long-call', sourceCallSeq: next.seq, instanceRefs: [] })
      // An old callback arrives after the next turn starts with the same model call id.
      await store.recordToolInstanceRefs(restored, { callId: 'long-call', sourceCallSeq: 0, instanceRefs: [{ sandboxId: 'late-old', instance: 'editor' }] })
      await store.close()
      store = await ByClawSessionMetadataStore.open(ctx)
      expect(store.getToolInstanceRefs(restored, 'long-call', next.seq)?.instanceRefs).toEqual([])
      expect(store.getToolInstanceRefs(restored, 'long-call', 0)?.instanceRefs).toHaveLength(3)
    } finally {
      stop()
      await store.close()
      await backend.close()
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it.each(['success', 'error'] as const)('late metadata preserves terminal phase %s', terminal => {
    const description = describeToolInstanceRefs({ callId: 'finished', sourceCallSeq: 0, instanceRefs: [] }, terminal)
    expect(description.eventKind).toBe('tool.result')
    const projection = toolCallProjection({ phase: description.isError ? 'error' : 'success', toolCallId: description.toolCallId, instanceRefs: description.instanceRefs }, context)
    expect(projection.options.status).toBe(terminal === 'error' ? '_ERROR_' : '_DONE_')
    expect(projection.instanceRefs).toEqual([])
    expect(JSON.parse(projection.content)).not.toHaveProperty('instanceRefs')
  })

  it('restores roots when optional refs are damaged and replaces only the unusable display record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'byclaw-damaged-instance-refs-'))
    const ctx = new Context()
    await ctx.plugin(Storage)
    const backend = new JsonStorageBackend(directory)
    ctx.storage.backend.register('json', backend)
    const facility = new DomainFacility(ctx, { backend: 'json' })
    ctx.provide('storageDomain', facility)
    const session = Session.create(SessionId('session'))
    let store: ByClawSessionMetadataStore | undefined
    try {
      store = await ByClawSessionMetadataStore.open(ctx)
      const root = await store.ensureRoot('session', { createdAt: 1, externalSessionId: 'external', binding: { kind: 'main' } })
      await store.recordToolInstanceRefs(session, { callId: 'call', sourceCallSeq: 0, instanceRefs: [{ sandboxId: 'old', instance: 'browser' }] })
      await store.close()
      store = undefined
      const domain = await facility.open(byClawSessionsDomainSpec)
      const [key] = [...domain.table('tool_instances').entries()][0]
      await domain.table('tool_instances').put(key, { callId: 'call', sourceCallSeq: 0, revision: 1, instanceRefs: false } as never)
      await domain.close()

      store = await ByClawSessionMetadataStore.open(ctx)
      expect(store.get('session')).toEqual(root)
      expect(store.getToolInstanceRefs(session, 'call', 0)).toBeUndefined()
      await store.recordToolInstanceRefs(session, { callId: 'call', sourceCallSeq: 0, instanceRefs: [] })
      expect(store.getToolInstanceRefs(session, 'call', 0)).toEqual({ callId: 'call', sourceCallSeq: 0, revision: 1, instanceRefs: [] })
      await store.close()
      store = await ByClawSessionMetadataStore.open(ctx)
      expect(store.get('session')).toEqual(root)
      expect(store.getToolInstanceRefs(session, 'call', 0)?.instanceRefs).toEqual([])
    } finally {
      await store?.close()
      await backend.close()
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })
  it.each([[false, false], [false, true], [true, false], [true, true]])('keeps the exact terminal phase when a later turn reuses its id (PTC=%s, error=%s)', (ptc, isError) => {
    const session = Session.create(SessionId('session'))
    const start = () => ptc
      ? session.append('tool/ptc-dispatch-start', { rootCallId: 'root' as never, parentCallId: 'root' as never, subCallId: 'same' as never, name: 'browser', arguments: {} })
      : session.append('tool/call', { callId: 'same' as never, name: 'browser', arguments: '{}', turn: 1, step: 1 })
    const first = start()
    if (ptc) session.append('tool/ptc-dispatch', { rootCallId: 'root' as never, parentCallId: 'root' as never, subCallId: 'same' as never, name: 'browser', arguments: {}, isError, content: [] })
    else session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'same' as never, content: [], isError }) },
      { surfaceOp: 'append', sourceEventSeqs: [first.seq] })
    const second = start()
    const stored = validateStoredEvents(session.header, JSON.parse(JSON.stringify(session.snapshotEvents())))
    const restored = Session.create(session.id, stored, session.header)
    expect(describeSessionToolInstanceRefs(restored, { callId: 'same', sourceCallSeq: first.seq, instanceRefs: [] }))
      .toMatchObject({ eventKind: 'tool.result', isError })
    const next = describeSessionToolInstanceRefs(restored, { callId: 'same', sourceCallSeq: second.seq, instanceRefs: [] })
    expect(next.eventKind).toBe('tool.call')
    expect(next).not.toHaveProperty('isError')
    expect(toolInstanceSourceSeq(restored, 'same', first.seq)).toBe(first.seq)
    expect(toolInstanceSourceSeq(restored, 'same', second.seq)).toBe(second.seq)
  })

  it('recovers subsequent metadata writes after a display write fails', async () => {
    const records = new Map<string, any>()
    const table = { get: (key: string) => records.get(key), put: vi.fn(async (key: string, value: unknown) => { records.set(key, value) }) }
    table.put.mockRejectedValueOnce(new Error('display-disk-unavailable'))
    const store = new ByClawSessionMetadataStore({} as never, undefined, table as never)
    const session = Session.create(SessionId('session'))
    await expect(store.recordToolInstanceRefs(session, { callId: 'call', sourceCallSeq: 0, instanceRefs: [] })).rejects.toThrow('display-disk-unavailable')
    await store.recordToolInstanceRefs(session, { callId: 'call', sourceCallSeq: 0, instanceRefs: [{ sandboxId: 'provider', instance: 'vnc' }] })
    expect(store.getToolInstanceRefs(session, 'call', 0)?.instanceRefs).toEqual([{ sandboxId: 'provider', instance: 'vnc' }])
    await store.close()
  })
  it('keeps absent legacy references absent and uses the chunk emitter', async () => {
    const projection = toolCallProjection({ phase: 'success', toolCallId: 'legacy', output: 'done' }, context)
    expect(projection).not.toHaveProperty('instanceRefs')
    expect(JSON.parse(projection.content)).not.toHaveProperty('instanceRefs')
    const emitter = { emitChunk: vi.fn(), emitEvent: vi.fn() }
    await emitByClawProjection(emitter as never, 'external', 'trace', projection, 'harness')
    expect(emitter.emitChunk).toHaveBeenCalledExactlyOnceWith('external', 'trace', {
      content: JSON.stringify({ output: 'done', status: '_DONE_' }),
      metadata: expect.objectContaining({ event_source: 'dsh', event_sequence: '2' }),
    }, expect.objectContaining({ messageId: 'legacy', sourceAgentType: 'harness', status: '_DONE_' }))
    expect(emitter.emitEvent).not.toHaveBeenCalled()
  })
})
