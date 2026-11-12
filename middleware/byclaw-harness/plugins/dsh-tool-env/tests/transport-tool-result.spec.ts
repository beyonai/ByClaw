import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { expect, it } from 'vitest'
import { toolTransportError } from '../src/transport-failure.ts'

it.each(['SSH helper disconnected; outcome is unknown', 'ByClaw BE POST /sandbox/removeSandbox -> 403 forbidden', 'ENOENT: missing file', 'Host key verification failed', 'ordinary application error'].flatMap(message => [
  { message, classified: false }, { message, classified: true },
]))('returns tool failure and accepts the next tool: $message (classified: $classified)', async ({ message, classified }) => {
  const ctx = new Context()
  ctx.provide('systemPrompt', { tools() {} } as never)
  const tools = new ToolRuntime(ctx)
  const session = Session.create(SessionId('transport-recovery'))
  let calls = 0
  tools.register(defineTool({
    name: 'transport_probe', description: 'Test connection recovery.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async () => {
      if (++calls === 1) {
        const error = new Error(message)
        throw classified ? toolTransportError(error, true) : error
      }
      return 'continued'
    },
  }))
  try {
    const input = { name: 'transport_probe', arguments: {}, signal: new AbortController().signal,
      agent: { id: 'transport-recovery', session } as never }
    const failed = await tools.execute({ ...input, callId: 'first' as never })
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed)).toContain(message)
    const next = await tools.execute({ ...input, callId: 'second' as never })
    expect(next.isError).toBe(false)
    expect(JSON.stringify(next)).toContain('continued')
  } finally { await ctx.fiber.dispose() }
})
