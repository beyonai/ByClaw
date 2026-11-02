import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolSandboxManager } from './catalog.ts'

const output = {
  schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
  render: (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }],
} as const

/** These are real model-visible tool calls; lifecycle facts come from the manager, not text inference. */
export function registerCatalogTools(ctx: Context, manager: ToolSandboxManager): void {
  ctx.tools.register(defineTool({
    name: 'sandbox_templates', description: 'List the current user-authorized self-built tool sandbox marketplace. Browser and media templates are separate execution environments. Operations always use private SSH. Acquire an enabled template to verify its actual runtime contract before execution.',
    parameters: {}, output, execute: async () => ({ json: JSON.stringify(manager.catalog()) }),
  }))
  ctx.tools.register(defineTool({
    name: 'sandbox_acquire', description: 'Create or reuse the selected self-built tool sandbox, perform its SSH contract handshake, and obtain a task-owned execution lease. Browser collection and video rendering must acquire their respective template keys. Keep separate leases to coordinate complex workflows. Return every lease with sandbox_release after work finishes. The real agent turn-end boundary also returns remaining leases automatically; use a new request_id for a later turn.',
    parameters: { template_key: { type: 'string', required: true }, request_id: { type: 'string', required: true, description: 'Idempotency key for this task acquisition; reuse only while its lease is active. Use a new key after release or turn end.' } }, output,
    execute: async (args, exec) => {
      exec.signal.throwIfAborted()
      const actor = String(exec.agent?.id ?? 'interactive')
      const lease = await manager.acquire(actor, args.template_key, args.request_id)
      if (exec.signal.aborted) { await manager.release(actor, lease.leaseId); exec.signal.throwIfAborted() }
      return { json: JSON.stringify(lease) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'sandbox_exec', description: 'Execute an argv array inside the environment selected by the lease, exclusively over private SSH. This never runs on the shared Harness host. Use browser leases for collection and media leases for voice/subtitle/video rendering. Files under /by are the same user AgenticFS storage, so one environment can consume another environment\'s authorized output. Reports real exit status and bounded stdout/stderr. Nonzero exit means the command failed.',
    parameters: { lease_id: { type: 'string', required: true }, argv: { type: 'array', items: { type: 'string' }, required: true }, cwd: { type: 'string' }, timeout_ms: { type: 'integer', description: 'Execution deadline in milliseconds, from 1000 to 900000.' } }, output,
    execute: async (args, exec) => {
      const timeout = args.timeout_ms ?? 300000
      if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 900000) throw new Error('INVALID_EXECUTION_TIMEOUT')
      return { json: JSON.stringify(await manager.execute(String(exec.agent?.id ?? 'interactive'), args.lease_id, args.argv, args.cwd, AbortSignal.any([exec.signal, AbortSignal.timeout(timeout)]))) }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'sandbox_release', description: 'Return only this task\'s execution lease. The last reference triggers real SSH connection and compute release; other templates or tasks keep their own environments. A failed release is an error and retains ownership for retry.',
    parameters: { lease_id: { type: 'string', required: true } }, output,
    execute: async (args, exec) => ({ json: JSON.stringify(await manager.release(String(exec.agent?.id ?? 'interactive'), args.lease_id)) }),
  }))
}

/** Infrastructure cleanup is a real lifecycle event, never a synthetic model tool call. */
export function registerCatalogLifecycle(ctx: Context, manager: ToolSandboxManager): void {
  ctx.on('agent/turn-stopping', async ({ agent }) => { await manager.releaseActor(String(agent.id)) })
  // Cancelled/failed turns skip turn-stopping. Idle means the driver is quiescent.
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') void manager.releaseActor(String(agent.id)).catch(() => {})
  })
  ctx.on('agent/disposed', ({ agent }) => { void manager.releaseActor(String(agent.id)).catch(() => {}) })
}
