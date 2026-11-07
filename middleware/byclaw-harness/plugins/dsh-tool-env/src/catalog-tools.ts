import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { SandboxInstanceRef } from './instance-context.ts'
import type { ToolSandboxManager } from './catalog.ts'

function markInstanceTool(tool: ToolDefinition): ToolDefinition {
  if (process.env.BYCLAW_INSTANCE_REFS_ENABLED === 'false') return tool
  return Object.assign(tool, { byclawInstanceRefsVersion: 1 })
}

const sourceCalls = new WeakMap<ToolRunContext, number | undefined>()
function reportInstances(ctx: Context, exec: ToolRunContext, instanceRefs: SandboxInstanceRef[]): void {
  if (process.env.BYCLAW_INSTANCE_REFS_ENABLED === 'false') return
  // Display observers are optional and must not interrupt actual tool execution.
  try {
    const session = exec.agent?.session
    if (!session) return
    if (!sourceCalls.has(exec)) {
      const call = [...(session.snapshotEvents?.() ?? [])].reverse().find(event => (
        (event.type === 'tool/call' && String(event.data.callId) === String(exec.callId))
        || (event.type === 'tool/ptc-dispatch-start' && String(event.data.subCallId) === String(exec.callId))))
      sourceCalls.set(exec, call?.seq)
    }
    const sourceCallSeq = sourceCalls.get(exec)
    if (sourceCallSeq === undefined) return
    const events = ctx.root as unknown as { emit(type: string, session: unknown, data: unknown): void }
    events.emit('byclaw/tool-instance-refs', session, { callId: String(exec.callId), sourceCallSeq, instanceRefs })
  } catch { /* display only */ }
}

const output = {
  schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
  render: (_args: unknown, value: { json: string }) => [{ type: 'text' as const, text: value.json }],
} as const

/** These are real model-visible tool calls; lifecycle facts come from the manager, not text inference. */
export function registerCatalogTools(ctx: Context, manager: ToolSandboxManager): void {
  // Delegated scopes inherit this contract. Coordinators retain their own tool restrictions.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next()
    try { await manager.refreshCatalog() }
    catch {
      return { ...result, sections: [...result.sections, { name: 'byclaw:tool-sandbox-routing',
        text: '工具沙箱目录暂时无法读取。执行依赖工具沙箱的任务前必须调用 sandbox_templates 重试；若仍失败，如实报告，不能用其他执行环境绕过目录准入。',
      }] }
    }
    const templates = manager.catalog().filter(template => template.enabled)
    if (templates.length === 0) return result
    return { ...result, sections: [...result.sections, {
      name: 'byclaw:tool-sandbox-routing',
      text: `工具沙箱执行路由（适用于当前会话及全部子代理）：
当前用户已配置专用工具沙箱：${JSON.stringify(templates.map(({ templateKey, capabilities }) => ({ templateKey, capabilities })))}。
先按业务需要匹配模板能力，调用 sandbox_templates 查看配置，再用 sandbox_acquire 申请。available=true 表示可申请，不代表实例已启动；not-yet-verified 表示冷启动后需要握手验证，不能据此跳过申请或报告不可用。真实申请失败必须如实报告，不得用旧产物冒充成功。
需要网页真实访问、正文采集、截图时，使用 browser.automation 对应模板；视频制作、FFmpeg 渲染使用 media.render 对应模板。跨能力任务必须分别申请对应模板的独立租约，再通过各自 sandbox_exec 协同执行；不要求用户指定工具名称、模板、命令或 request_id。所需的多个模板应在开始业务执行前申请，执行结果以真实退出码和产物校验为准。
已配置匹配模板的业务执行，不得用普通 bash/browser/web_fetch 或通用环境替代专用模板。技能中的命令示例应转换为对应租约的 sandbox_exec argv；脚本创建和业务命令也在对应环境执行。各模板共享用户授权工作区，可直接交接产物，路径以租约的 workspaceRoot 为准。read_image/present 可用于检查和交付真实产物，不替代采集或渲染。
超级助手保持调度角色：把上述按能力使用专用工具沙箱及验收要求传给授权执行员工，不自行绕过权限执行，也不能把派发成功当作完成。执行员工和子代理必须遵守同一协议；返回来源、产物及校验证据后才能汇总完成。任务结束自动归还执行租约；全部会话租约归还或过期后，按闲时超时回收物理沙箱（默认5分钟，可配置）。任务完成也可调用 sandbox_release 归还本会话租约，默认不立即销毁；仅用户明确要求立即销毁时传 destroy:true。其他会话仍持有租约时只归还本会话租约。`,
    }] }
  })
  ctx.tools.register(defineTool({
    name: 'sandbox_templates', description: 'List the current user-authorized self-built tool sandbox marketplace. Browser and media templates are separate execution environments. Operations always use private SSH. Enabled cold templates are available for acquisition even when verification is not-yet-verified. Acquire the template to start it and verify its actual runtime contract; do not treat a cold template as unavailable.',
    parameters: {}, output, execute: async () => { await manager.refreshCatalog(); return { json: JSON.stringify(manager.catalog()) } },
  }))
  ctx.tools.register(markInstanceTool(defineTool({
    name: 'sandbox_acquire', description: 'Acquire a session lease over private SSH and verify the selected template. Turn end returns leases; Platform reclaims idle compute after the configured timeout (default 5 min). Use a new request_id after release or turn end.',
    parameters: { template_key: { type: 'string', required: true }, request_id: { type: 'string', required: true, description: 'Idempotency key for this task acquisition; reuse only while its lease is active. Use a new key after release or turn end.' } }, output,
    execute: async (args, exec) => {
      reportInstances(ctx, exec, [])
      exec.signal.throwIfAborted()
      const actor = String(exec.agent?.id ?? 'interactive')
      const lease = await manager.acquire(actor, args.template_key, args.request_id)
      if (exec.signal.aborted) { await manager.release(actor, lease.leaseId, 'task-end'); exec.signal.throwIfAborted() }
      reportInstances(ctx, exec, manager.instanceRefs(actor, lease.leaseId))
      const { instanceContext: _privateContext, ...publicLease } = lease
      return { json: JSON.stringify(publicLease) }
    },
  })))
  ctx.tools.register(markInstanceTool(defineTool({
    name: 'sandbox_exec', description: 'Execute an argv array inside the environment selected by the lease, exclusively over private SSH. This never runs on the shared Harness host. Use browser leases for collection and media leases for voice/subtitle/video rendering. Files under /by are the same user AgenticFS storage, so one environment can consume another environment\'s authorized output. Reports real exit status and bounded stdout/stderr. Nonzero exit means the command failed.',
    parameters: { lease_id: { type: 'string', required: true }, argv: { type: 'array', items: { type: 'string' }, required: true }, cwd: { type: 'string' }, timeout_ms: { type: 'integer', description: 'Execution deadline in milliseconds, from 1000 to 900000.' } }, output,
    execute: async (args, exec) => {
      reportInstances(ctx, exec, [])
      reportInstances(ctx, exec, manager.instanceRefs(String(exec.agent?.id ?? 'interactive'), args.lease_id))
      const timeout = args.timeout_ms ?? 300000
      if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 900000) throw new Error('INVALID_EXECUTION_TIMEOUT')
      return { json: JSON.stringify(await manager.execute(String(exec.agent?.id ?? 'interactive'), args.lease_id, args.argv, args.cwd, AbortSignal.any([exec.signal, AbortSignal.timeout(timeout)]))) }
    },
  })))
  ctx.tools.register(defineTool({
    name: 'sandbox_release', description: 'Return this lease for idle reclamation (default 5 min). Set destroy=true only for explicit user-requested immediate destruction; other sessions remain protected. Failed returns retain ownership for retry.',
    parameters: { lease_id: { type: 'string', required: true }, destroy: { type: 'boolean', default: false, description: 'Default false: return the lease for idle reclamation. True requests immediate removal only with explicit user intent and no other active leases.' } }, output,
    execute: async (args, exec) => ({ json: JSON.stringify(await manager.release(String(exec.agent?.id ?? 'interactive'), args.lease_id, 'tool', args.destroy === true)) }),
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
