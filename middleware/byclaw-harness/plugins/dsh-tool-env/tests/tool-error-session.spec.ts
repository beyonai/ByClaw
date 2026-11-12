import { Context } from '@deepseek-ai/cordis'
import { Socket } from 'node:net'
import { once } from 'node:events'
import { RemoteOperationError } from '@deepseek-ai/dsh-ssh/protocol'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ToolEnvBackend } from '../src/backend.ts'
import { ToolEnvConnection } from '../src/connection.ts'
import type { ToolEnvIdentity } from '../src/identity.ts'
import { registerLeaseWarnings } from '../src/transport-failure.ts'
import { registerPreparationRecovery } from '../src/preparation-recovery.ts'
import { SshFileSystem } from '@deepseek-ai/dsh-fs-ssh'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import { ToolSandboxManager } from '../src/catalog.ts'
import { registerCatalogTools } from '../src/catalog-tools.ts'
import {
  SuperAssistantPolicy, SUPER_ASSISTANT_POLICY, SUPER_ASSISTANT_TOOLS,
} from '../../byclaw-integration/src/super-assistant-policy.ts'

const text = (value: string) => [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: value },
  { type: 'block-end', index: 0, block: { type: 'text', text: value } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const call = (name = 'remote_command') => [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'tool-call-delta', index: 0, id: ToolCallId(name), name, argumentsDelta: '{}' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(name), name, arguments: '{}' } },
  { type: 'finish', reason: { kind: 'tool-calls' } },
]
class Script extends LlmAdapter {
  requests: any[] = []
  constructor(readonly responses: any[][]) { super() }
  async resolveModel(provider: string, id: string) { return { provider, id, name: id } }
  async *stream(request: any) {
    this.requests.push(request)
    const response = this.responses.shift()
    if (!response) throw new Error('script exhausted')
    yield* response
  }
}

async function harness(responses: any[][], setup?: (ctx: Context) => void) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  setup?.(ctx)
  registerLeaseWarnings(ctx)
  registerPreparationRecovery(ctx)
  const backend = { ensure: vi.fn().mockResolvedValue({ hostName: 'tool-b', port: 22 }),
    pause: vi.fn().mockResolvedValue(undefined), dispose: vi.fn().mockResolvedValue(undefined) } as unknown as ToolEnvBackend
  const ssh = new ToolEnvConnection(ctx, { ssh: {} as never, idleMs: 0,
    ptcLaunch: { kind: 'node-script', executable: 'node', bootstrapPath: '/helper.mjs' } }, backend,
  { writeClientConfig: vi.fn(), alias: 'tool-b' } as unknown as ToolEnvIdentity)
  const inner = { request: vi.fn().mockResolvedValue('ready'), connectStream: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined), ready: Promise.resolve({}), closed: false }
  vi.spyOn(ssh as any, 'connect').mockResolvedValue({ connection: inner, fiber: { dispose() {} } })
  let commands = 0
  ctx.tools.register(defineTool({ name: 'remote_command', description: 'Execute a remote test command.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (_args, exec) => { commands++; return ssh.request('spawn', {}, z.string(), exec.signal) },
  }))
  const adapter = new Script(responses)
  ctx.llm.registerAdapter(['script'], adapter)
  const errors: unknown[] = []
  ctx.on('agent/error', payload => { errors.push(payload.error) })
  const agent = await ctx.agentLoop.create(SessionId('recovery'), { provider: 'script', model: 'script' })
  const prompt = async (input: string) => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: input }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  return { ctx, ssh, backend, inner, adapter, agent, prompt, errors, commands: () => commands }
}

it.each([false, true])('keeps redacted application timeouts distinct from transport errors: cleanup=%s', async cleanup => {
  const h = await harness([call(), text('远程应用请求超时。')])
  try {
    h.inner.request.mockRejectedValueOnce(new RemoteOperationError('fetch https://host/?token=secret failed: ETIMEDOUT', 'REMOTE_FETCH_TIMEOUT'))
    if (cleanup) h.backend.beginUse = vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error('release ECONNRESET')))
    await h.prompt('执行一次命令')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(2)
    const rendered = JSON.stringify(h.adapter.requests[1])
    expect(rendered).toContain('ETIMEDOUT')
    expect(rendered).not.toContain('secret')
    expect(rendered).not.toContain('TOOL_ENV_UNAVAILABLE')
    expect(rendered).not.toContain('TOOL_ENV_OUTCOME_UNKNOWN')
    if (cleanup) expect(rendered).toContain('release ECONNRESET')
    expect(h.inner.request).toHaveBeenCalledTimes(1)
  } finally { await h.ctx.fiber.dispose() }
})

it('returns failed stream establishment and lease release errors to the model', async () => {
  const h = await harness([call('stream_probe'), text('流连接失败，归还也失败。')])
  const finish = vi.fn().mockRejectedValue(new Error('stream release Authorization: Bearer secret failed'))
  try {
    h.backend.beginUse = vi.fn().mockResolvedValue(finish)
    h.inner.connectStream.mockRejectedValue(new Error('SSH helper disconnected'))
    h.ctx.tools.register(defineTool({ name: 'stream_probe', description: 'Test remote stream.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => { await h.ssh.connectStream({} as never, exec.signal); return 'ready' },
    }))
    await h.prompt('执行一次操作')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(2)
    const rendered = JSON.stringify(h.adapter.requests[1])
    expect(rendered).toContain('TOOL_ENV_OUTCOME_UNKNOWN')
    expect(rendered).toContain('SSH helper disconnected')
    expect(rendered).toContain('stream release Authorization: [redacted] failed')
    expect(rendered).not.toContain('secret')
    expect(finish).toHaveBeenCalledTimes(1)
    expect(h.inner.connectStream).toHaveBeenCalledTimes(1)
  } finally { await h.ctx.fiber.dispose() }
})

it('waits for a destroyed stream release and preserves the successful tool result', async () => {
  const h = await harness([call('stream_probe'), text('流操作完成，归还失败。')])
  const socket = new Socket()
  const started = Promise.withResolvers<void>()
  const released = Promise.withResolvers<void>()
  const finish = vi.fn(() => { started.resolve(); return released.promise })
  try {
    h.backend.beginUse = vi.fn().mockResolvedValue(finish)
    h.inner.connectStream.mockResolvedValue(socket)
    h.ctx.tools.register(defineTool({ name: 'stream_probe', description: 'Test remote stream.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        const stream = await h.ssh.connectStream({} as never, exec.signal)
        stream.destroy()
        return 'stream-completed'
      },
    }))
    const prompt = h.prompt('执行一次操作')
    await started.promise
    expect(h.adapter.requests).toHaveLength(1)
    released.reject(new Error('stream lease release failed'))
    await prompt
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(2)
    const rendered = JSON.stringify(h.adapter.requests[1])
    expect(rendered).toContain('stream-completed')
    expect(rendered).toContain('TOOL_ENV_LEASE_RELEASE_FAILED')
    expect(rendered).toContain('stream lease release failed')
    expect(rendered).not.toContain('操作已成功完成')
    expect(JSON.stringify(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result'))).not.toContain('"isError":true')
    expect(finish).toHaveBeenCalledTimes(1)
    expect(h.inner.connectStream).toHaveBeenCalledTimes(1)
  } finally { socket.destroy(); await h.ctx.fiber.dispose() }
})

it('queues late stream-release warnings to the owning agent without waking idle chat', async () => {
  const h = await harness([call('stream_probe'), text('流保持打开。'), text('已收到归还警告。')])
  const other = await harness([call('close_probe'), text('独立工具完成。')])
  const socket = new Socket()
  const finish = vi.fn().mockRejectedValue(new Error('late stream release Authorization: Bearer secret failed'))
  try {
    h.backend.beginUse = vi.fn().mockResolvedValue(finish)
    h.inner.connectStream.mockResolvedValue(socket)
    h.ctx.tools.register(defineTool({ name: 'stream_probe', description: 'Test remote stream.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => { await h.ssh.connectStream({} as never, exec.signal); return 'stream-open' },
    }))
    await h.prompt('执行一次操作')
    expect(finish).not.toHaveBeenCalled()
    expect(h.adapter.requests).toHaveLength(2)
    other.ctx.tools.register(defineTool({ name: 'close_probe', description: 'Test an independent close event.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => {
        const closed = once(socket, 'close')
        socket.destroy()
        await closed
        await new Promise(resolve => setImmediate(resolve))
        return 'independent-result'
      },
    }))
    await other.prompt('执行独立工具')
    expect(other.errors).toEqual([])
    expect(JSON.stringify(other.adapter.requests)).not.toContain('TOOL_ENV_LEASE_RELEASE_FAILED')
    expect(finish).toHaveBeenCalledTimes(1)
    expect(h.adapter.requests).toHaveLength(2)
    await h.prompt('继续聊聊')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(3)
    const rendered = JSON.stringify(h.adapter.requests[2])
    expect(rendered).toContain('late stream release Authorization: [redacted] failed')
    expect(rendered).not.toContain('secret')
    expect(rendered).toContain('byclaw-tool-env-warning')
    expect(h.inner.connectStream).toHaveBeenCalledTimes(1)
  } finally { socket.destroy(); await h.ctx.fiber.dispose(); await other.ctx.fiber.dispose() }
})

it.each([
  ['connection', 'tool environment bridge wss://host/?token=secret is not reachable', 'TOOL_ENV_UNAVAILABLE'],
  ['connection', 'Host key verification failed', 'Host key verification failed'],
  ['connection', 'TOOL_LEASE_INVALIDATED', 'TOOL_LEASE_INVALIDATED'],
  ['execution', 'SSH helper disconnected', 'TOOL_ENV_OUTCOME_UNKNOWN'],
  ['execution', 'permission denied', 'permission denied'],
  ['execution', 'ordinary application error', 'ordinary application error'],
  ['execution', 'ENOENT: missing file', 'ENOENT: missing file'],
])('returns %s failure to the model and preserves the next turn: %s', async (stage, message, reason) => {
  const h = await harness([call(), text('工具失败，已收到原因。'), text('继续之前的对话。')])
  try {
    if (stage === 'connection') vi.mocked(h.backend.ensure).mockRejectedValue(new Error(message))
    else h.inner.request.mockRejectedValueOnce(new Error(message))
    await h.prompt('保留任务上下文，执行一次命令')
    expect(h.errors).toEqual([])
    expect(h.commands()).toBe(1)
    expect(h.backend.ensure).toHaveBeenCalledTimes(1)
    expect(h.inner.request).toHaveBeenCalledTimes(stage === 'connection' ? 0 : 1)
    expect(h.adapter.requests).toHaveLength(2)
    const results = JSON.stringify(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result'))
    expect(results).toContain('"isError":true')
    expect(results).toContain(reason)
    expect(results).not.toContain('token=secret')
    expect(JSON.stringify(h.adapter.requests[1])).toContain(reason)
    expect(JSON.stringify(h.adapter.requests[1])).not.toContain('token=secret')
    expect(h.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).toBe('completed')
    vi.mocked(h.backend.ensure).mockResolvedValue({ hostName: 'replacement', port: 22 })
    h.inner.request.mockResolvedValue('ready')
    await h.prompt('继续之前的对话')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(3)
    expect(JSON.stringify(h.adapter.requests[2])).toContain('保留任务上下文')
    expect(h.commands()).toBe(1)
  } finally { await h.ctx.fiber.dispose() }
})

it('reports a disconnected operation once and reconnects only for the next requested tool', async () => {
  const h = await harness([call(), text('结果未知，暂时停止。'), call(), text('新操作成功。')])
  try {
    h.inner.request.mockImplementationOnce(async () => {
      h.inner.closed = true
      throw new Error('SSH helper disconnected')
    })
    await h.prompt('执行一次操作')
    expect(h.errors).toEqual([])
    expect(h.commands()).toBe(1)
    expect(h.inner.request).toHaveBeenCalledTimes(1)
    expect(h.backend.ensure).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(h.adapter.requests[1])).toContain('TOOL_ENV_OUTCOME_UNKNOWN')
    h.inner.closed = false
    h.inner.request.mockResolvedValue('ready')
    await h.prompt('重新执行一个新操作')
    expect(h.errors).toEqual([])
    expect(h.commands()).toBe(2)
    expect(h.inner.request).toHaveBeenCalledTimes(2)
    expect(h.backend.ensure).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(h.adapter.requests[3])).toContain('ready')
  } finally { await h.ctx.fiber.dispose() }
})

it('lets an independent tool execute while the failed sandbox stays unavailable', async () => {
  const h = await harness([call(), call('local_probe'), text('远程命令失败，本地查询已完成。')])
  const probe = vi.fn(async () => 'local result')
  try {
    h.ctx.tools.register(defineTool({ name: 'local_probe', description: 'Test an independent service.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: probe,
    }))
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    await h.prompt('远程失败后继续独立查询')
    expect(h.errors).toEqual([])
    expect(h.commands()).toBe(1)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(h.backend.ensure).toHaveBeenCalledTimes(1)
    expect(h.adapter.requests).toHaveLength(3)
    expect(JSON.stringify(h.adapter.requests[2])).toContain('local result')
  } finally { await h.ctx.fiber.dispose() }
})

it('stops when the user cancels during tool execution', async () => {
  const h = await harness([call()])
  try {
    h.inner.request.mockImplementation(async (method: string) => {
      if (method === 'spawn') {
        h.agent.cancel({ kind: 'user' } as never)
        throw new Error('permission denied')
      }
      return 'ready'
    })
    await h.prompt('执行命令')
    expect(h.commands()).toBe(1)
    expect(h.adapter.requests).toHaveLength(1)
    expect(h.agent.session.snapshotEvents().filter(e => e.type === 'turn/end').at(-1)?.data.reason.kind).not.toBe('completed')
  } finally { await h.ctx.fiber.dispose() }
})

it('preserves a successful tool result and sends the lease warning to the model', async () => {
  const h = await harness([call(), text('操作已完成，租约归还失败。')])
  try {
    h.backend.beginUse = vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error('release wss://host/?token=secret ETIMEDOUT')))
    await h.prompt('执行一次命令')
    expect(h.errors).toEqual([])
    expect(h.commands()).toBe(1)
    expect(h.adapter.requests).toHaveLength(2)
    const request = JSON.stringify(h.adapter.requests[1])
    expect(request).toContain('ready')
    expect(request).toContain('TOOL_ENV_LEASE_RELEASE_FAILED')
    expect(request).not.toContain('token=secret')
    const results = h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
    expect(JSON.stringify(results)).toContain('ready')
    expect(JSON.stringify(results)).not.toContain('"isError":true')
  } finally { await h.ctx.fiber.dispose() }
})

it('returns both operation and lease release errors in the model-visible tool failure', async () => {
  const h = await harness([call(), text('操作结果未知，租约归还也失败。')])
  try {
    h.backend.beginUse = vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error('release Authorization: Bearer secret ETIMEDOUT')))
    h.inner.request.mockImplementation(async (method: string) => {
      if (method === 'spawn') throw new Error('SSH helper disconnected')
      return 'ready'
    })
    await h.prompt('执行一次命令')
    expect(h.errors).toEqual([])
    expect(h.commands()).toBe(1)
    const results = JSON.stringify(h.agent.session.snapshotEvents().filter(event => event.type === 'tool/result'))
    expect(results).toContain('TOOL_ENV_OUTCOME_UNKNOWN')
    expect(results).toContain('SSH helper disconnected')
    expect(results).toContain('租约归还失败')
    expect(results).toContain('ETIMEDOUT')
    expect(results).toContain('"isError":true')
    expect(results).not.toContain('secret')
    expect(JSON.stringify(h.adapter.requests[1])).toContain('租约归还失败')
  } finally { await h.ctx.fiber.dispose() }
})

// Native assembly must retain the production routing and role policies.
it.each(['employee', 'super-assistant'])('keeps native routing and role policies after a tool connection failure: %s', async role => {
  const manager = new ToolSandboxManager([
    { templateKey: 'browser', serviceKey: 'browser', capabilities: ['browser.automation'], enabled: true },
  ], async () => { throw new Error('must not acquire a sandbox') })
  const policy = new SuperAssistantPolicy()
  const h = await harness([call(role === 'employee' ? 'remote_command' : 'image_generate'), text('工具连接失败。')], ctx => {
    registerCatalogTools(ctx, manager)
    if (role === 'super-assistant') ctx.on('agent/created', ({ agent }) => { policy.bind(agent.ctx, agent) })
  })
  try {
    h.ctx.tools.register(defineTool({ name: 'image_generate', description: 'Test a permitted media tool.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => h.ssh.request('spawn', {}, z.string(), exec.signal),
    }))
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    await h.prompt('执行任务')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(2)
    expect(h.backend.ensure).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(h.adapter.requests[1])).toContain('TOOL_ENV_UNAVAILABLE')
    for (const request of h.adapter.requests) {
      const rendered = JSON.stringify(request)
      expect(rendered).toContain('工具沙箱执行路由')
      expect(rendered).toContain('不得用普通 bash/browser/web_fetch 或通用环境替代专用模板')
      const names = request.tools.map((tool: { name: string }) => tool.name)
      if (role === 'super-assistant') {
        expect(rendered).toContain(JSON.stringify(SUPER_ASSISTANT_POLICY).slice(1, -1))
        expect(names).toContain('image_generate')
        expect(names.every((name: string) => SUPER_ASSISTANT_TOOLS.has(name))).toBe(true)
      } else expect(names).toContain('sandbox_exec')
    }
  } finally { await h.ctx.fiber.dispose(); await manager.dispose() }
})

it('preserves native dispatch order, listener snapshots and terminal continuation', async () => {
  const h = await harness([])
  const seen: string[] = []
  try {
    const remove = h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      seen.push('original:before')
      const result = await next()
      seen.push('original:after')
      return result
    })
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      seen.push('outer:before')
      remove()
      h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        seen.push('replacement')
        return next()
      })
      const result = await next()
      seen.push('outer:after')
      return result
    }, { prepend: true })
    const assembly = { sections: [], contexts: [], tools: [], variables: {} }
    const terminal = vi.fn(async () => {
      seen.push('terminal')
      return { ...assembly, variables: { provider: 'terminal-provider' } }
    })
    const result = await h.ctx.waterfall('system-prompt/assemble', assembly, { agent: h.agent }, terminal)
    expect(terminal).toHaveBeenCalledTimes(1)
    expect(result.variables.provider).toBe('terminal-provider')
    expect(seen).toEqual(['outer:before', 'original:before', 'terminal', 'original:after', 'outer:after'])
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['SSH helper disconnected', 'Host key verification failed', 'permission denied', 'ordinary application error'])('continues ordinary chat after remote preparation fails: %s', async message => {
  const h = await harness([text('普通聊天仍然可以继续。'), text('沙箱已恢复。')])
  try {
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      await h.ssh.request('fs.stat', {}, z.string())
      return next()
    })
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error(`${message}; Authorization: Bearer secret`))
    await h.prompt('你好，聊聊天')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(1)
    expect(JSON.stringify(h.adapter.requests[0])).toContain(message)
    expect(JSON.stringify(h.adapter.requests[0])).not.toContain('secret')
    expect(h.commands()).toBe(0)
    expect(h.backend.ensure).toHaveBeenCalledTimes(1)
    vi.mocked(h.backend.ensure).mockResolvedValue({ hostName: 'tool-b', port: 22 })
    await h.prompt('再聊一句')
    expect(h.adapter.requests).toHaveLength(2)
    const currentContext = h.adapter.requests[1].messages.filter((entry: any) => entry.source?.kind === 'runtime-context').at(-1)
    expect(JSON.stringify(currentContext)).not.toContain('工具沙箱准备失败')
    expect(JSON.stringify(currentContext)).toContain('Earlier runtime-context snapshots no longer apply')
  } finally { await h.ctx.fiber.dispose() }
})

it('continues chat through the real SSH filesystem and working-directory preparation providers', async () => {
  const h = await harness([text('可以继续聊天。')])
  try {
    new SshFileSystem(h.ctx)
    new WorkingDirectory(h.ctx, { defaultDirectory: '/remote-project' })
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    await h.prompt('你好')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(1)
    expect(JSON.stringify(h.adapter.requests[0])).toContain('SSH helper disconnected')
    expect(h.commands()).toBe(0)
  } finally { await h.ctx.fiber.dispose() }
})

it('does not hide unrelated preparation errors', async () => {
  const h = await harness([])
  try {
    h.agent.ctx.on('system-prompt/assemble', async () => { throw new Error('policy configuration invalid') })
    await h.prompt('你好')
    expect(h.adapter.requests).toHaveLength(0)
    expect(h.errors).toHaveLength(1)
    expect(String(h.errors[0])).toContain('policy configuration invalid')
  } finally { await h.ctx.fiber.dispose() }
})

it('reports remote preparation failures even when the provider handles them locally', async () => {
  const h = await harness([text('继续普通聊天。')])
  try {
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      await h.ssh.request('fs.stat', {}, z.string()).catch(() => {})
      return next()
    })
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    await h.prompt('你好')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(1)
    expect(JSON.stringify(h.adapter.requests[0])).toContain('SSH helper disconnected')
  } finally { await h.ctx.fiber.dispose() }
})

it('reports preparation lease-release warnings without discarding successful context', async () => {
  const h = await harness([text('继续普通聊天。'), text('已恢复。')])
  const finish = vi.fn().mockRejectedValue(new Error('release Authorization: Bearer secret failed'))
  try {
    h.backend.beginUse = vi.fn().mockResolvedValue(finish)
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const value = await h.ssh.request('fs.stat', {}, z.string())
      const result = await next()
      return { ...result, contexts: [...result.contexts, { name: 'successful-read', text: value }] }
    })
    await h.prompt('你好')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(1)
    const request = JSON.stringify(h.adapter.requests[0])
    expect(request).toContain('ready')
    expect(request).toContain('TOOL_ENV_LEASE_RELEASE_FAILED')
    expect(request).toContain('release Authorization: [redacted] failed')
    expect(request).not.toContain('secret')
    expect(request).not.toContain('未能读取的远程上下文不可用')
    expect(h.inner.request).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledTimes(1)
    finish.mockResolvedValue(undefined)
    await h.prompt('再聊一句')
    const current = h.adapter.requests[1].messages.filter((entry: any) => entry.source?.kind === 'runtime-context').at(-1)
    expect(JSON.stringify(current)).not.toContain('TOOL_ENV_LEASE_RELEASE_FAILED')
  } finally { await h.ctx.fiber.dispose() }
})

it.each([false, true])('recovers remote preparation aggregates but propagates mixed failures: mixed=%s', async mixed => {
  const h = await harness([text('继续普通聊天。')])
  try {
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      try { await h.ssh.request('fs.stat', {}, z.string()) }
      catch (error) {
        const errors: Error[] = [new AggregateError([error], 'remote cleanup failed')]
        if (mixed) errors.push(new Error('policy configuration invalid'))
        throw new AggregateError(errors, 'provider preparation failed')
      }
      return next()
    })
    await h.prompt('你好')
    if (mixed) {
      expect(h.errors).toHaveLength(1)
      expect(h.adapter.requests).toHaveLength(0)
    } else {
      expect(h.errors).toEqual([])
      expect(h.adapter.requests).toHaveLength(1)
      expect(JSON.stringify(h.adapter.requests[0])).toContain('SSH helper disconnected')
      expect(JSON.stringify(h.adapter.requests[0])).toContain('remote cleanup failed')
      expect(JSON.stringify(h.adapter.requests[0])).toContain('provider preparation failed')
    }
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['aggregate', 'stream'])('still denies unauthorized super-assistant execution after a preparation failure: %s', async failure => {
  const policy = new SuperAssistantPolicy()
  const h = await harness([text('你好。')], ctx => {
    ctx.on('agent/created', ({ agent }) => { policy.bind(agent.ctx, agent) })
  })
  try {
    if (failure === 'aggregate') vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    else {
      h.inner.connectStream.mockRejectedValue(new Error('SSH helper disconnected'))
      h.backend.beginUse = vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error('stream lease release failed')))
    }
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      if (failure === 'stream') await h.ssh.connectStream({} as never)
      else {
        try { await h.ssh.request('fs.stat', {}, z.string()) }
        catch (error) { throw new AggregateError([error], 'remote preparation failed') }
      }
      return next()
    })
    await h.prompt('你好')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(1)
    expect(JSON.stringify(h.adapter.requests[0])).toContain(JSON.stringify(SUPER_ASSISTANT_POLICY).slice(1, -1))
    const result = await h.ctx.tools.execute({ name: 'remote_command', arguments: {},
      callId: ToolCallId('unauthorized'), agent: h.agent, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('SUPER_ASSISTANT_EXECUTION_DENIED')
    expect(h.commands()).toBe(0)
    expect(h.inner.request).not.toHaveBeenCalled()
    expect(h.inner.connectStream).toHaveBeenCalledTimes(failure === 'stream' ? 1 : 0)
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['before', 'after'])('continues the native listener snapshot exactly once after a %s-next remote failure', async stage => {
  const h = await harness([])
  const seen: string[] = []
  try {
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    const remove = h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      seen.push('original')
      const result = await next()
      return { ...result, variables: { ...result.variables, original: 'retained' } }
    })
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      seen.push('remote')
      remove()
      h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        seen.push('replacement')
        return next()
      })
      if (stage === 'after') await next()
      await h.ssh.request('fs.stat', {}, z.string())
      return next()
    }, { prepend: true })
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      seen.push('policy:before')
      const result = await next()
      seen.push('policy:after')
      return { ...result, variables: { ...result.variables, policy: 'retained' } }
    })
    const assembly = { sections: [], contexts: [], tools: [], variables: {} }
    const terminal = vi.fn(async () => { seen.push('terminal'); return assembly })
    const result = await h.ctx.waterfall('system-prompt/assemble', assembly, { agent: h.agent }, terminal)
    expect(terminal).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['remote', 'original', 'policy:before', 'terminal', 'policy:after'])
    expect(result.variables).toEqual({ original: 'retained', policy: 'retained' })
    expect(JSON.stringify(result.contexts)).toContain('SSH helper disconnected')
  } finally { await h.ctx.fiber.dispose() }
})

it.each(['employee', 'super-assistant'].flatMap(role => ['direct', 'aggregate', 'lease-warning', 'stream-close', 'stream-failure'].map(failure => ({ role, failure }))))('keeps production routing and role policy during preparation: $role $failure', async ({ role, failure }) => {
  const manager = new ToolSandboxManager([
    { templateKey: 'browser', serviceKey: 'browser', capabilities: ['browser.automation'], enabled: true },
  ], async () => { throw new Error('must not acquire a sandbox') })
  const policy = new SuperAssistantPolicy()
  const h = await harness([text('普通对话继续。')], ctx => {
    registerCatalogTools(ctx, manager)
    if (role === 'super-assistant') ctx.on('agent/created', ({ agent }) => { policy.bind(agent.ctx, agent) })
  })
  const socket = new Socket()
  try {
    h.inner.connectStream.mockImplementation(async () => {
      if (failure === 'stream-failure') throw new Error('SSH helper disconnected')
      return socket
    })
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      try {
        if (failure.startsWith('stream-')) {
          const stream = await h.ssh.connectStream({} as never)
          stream.destroy()
        } else await h.ssh.request('fs.stat', {}, z.string())
      }
      catch (error) {
        if (failure === 'aggregate') throw new AggregateError([error], 'remote preparation failed')
        throw error
      }
      return next()
    }, { prepend: true })
    if (failure === 'lease-warning' || failure.startsWith('stream-')) h.backend.beginUse = vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error('lease release failed')))
    else vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    await h.prompt('你好')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(1)
    const request = h.adapter.requests[0]
    expect(JSON.stringify(request)).toContain('工具沙箱执行路由')
    expect(JSON.stringify(request)).toContain('不得用普通 bash/browser/web_fetch 或通用环境替代专用模板')
    expect(JSON.stringify(request)).toContain(failure === 'lease-warning' || failure === 'stream-close' ? 'TOOL_ENV_LEASE_RELEASE_FAILED' : '工具沙箱准备失败')
    if (role === 'super-assistant') {
      expect(JSON.stringify(request)).toContain(JSON.stringify(SUPER_ASSISTANT_POLICY).slice(1, -1))
      expect(request.tools.every((tool: { name: string }) => SUPER_ASSISTANT_TOOLS.has(tool.name))).toBe(true)
    } else expect(request.tools.some((tool: { name: string }) => tool.name === 'sandbox_exec')).toBe(true)
  } finally { socket.destroy(); await h.ctx.fiber.dispose(); await manager.dispose() }
})

it('keeps the failure visible with a complete prompt and optional runtime context suppressed', async () => {
  const h = await harness([text('普通对话继续。')])
  try {
    h.ctx.systemPrompt.section({ name: 'complete', order: 0, complete: true, text: 'Complete policy.' })
    h.ctx.systemPrompt.suppressRuntimeContext()
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      await h.ssh.request('fs.stat', {}, z.string())
      return next()
    })
    vi.mocked(h.backend.ensure).mockRejectedValue(new Error('SSH helper disconnected'))
    await h.prompt('你好')
    expect(h.errors).toEqual([])
    expect(h.adapter.requests).toHaveLength(1)
    expect(JSON.stringify(h.adapter.requests[0])).toContain('Complete policy.')
    expect(JSON.stringify(h.adapter.requests[0])).toContain('SSH helper disconnected')
  } finally { await h.ctx.fiber.dispose() }
})

it('honors user cancellation during remote preparation', async () => {
  const h = await harness([])
  try {
    h.agent.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      await h.ssh.request('fs.stat', {}, z.string(), context.signal)
      return next()
    })
    vi.mocked(h.backend.ensure).mockImplementationOnce(async () => {
      h.agent.cancel({ kind: 'user' } as never)
      throw new Error('SSH helper disconnected')
    })
    await h.prompt('你好')
    expect(h.adapter.requests).toHaveLength(0)
  } finally { await h.ctx.fiber.dispose() }
})

it('isolates concurrent preparation failures between agents', async () => {
  const h = await harness([])
  try {
    h.inner.request.mockImplementation(async (_method: string, params: { key: string }) => {
      await Promise.resolve()
      throw new Error(`remote failure ${params.key}`)
    })
    h.ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      await h.ssh.request('fs.stat', { key: context.agent!.id }, z.string())
      return next()
    })
    const contexts = ['alpha', 'beta'].map(id => ({ agent: { id } as never, signal: new AbortController().signal }))
    const results = await Promise.all(contexts.map(context => {
      const assembly = { sections: [], contexts: [], tools: [], variables: {} }
      return h.ctx.waterfall('system-prompt/assemble', assembly, context, async () => assembly)
    }))
    for (const [index, result] of results.entries()) {
      const refreshed = h.ctx.systemPrompt.refreshContext(result, contexts[index])
      expect(JSON.stringify(refreshed)).toContain(`remote failure ${index === 0 ? 'alpha' : 'beta'}`)
      expect(JSON.stringify(refreshed)).not.toContain(`remote failure ${index === 0 ? 'beta' : 'alpha'}`)
    }
  } finally { await h.ctx.fiber.dispose() }
})

it('restores native dispatch when the recovery plugin is unloaded', async () => {
  const ctx = new Context()
  const original = ctx.events.dispatch
  const fiber = await ctx.plugin({ name: 'preparation-recovery-test', apply: registerPreparationRecovery })
  try {
    expect(ctx.events.dispatch).not.toBe(original)
    await fiber.dispose()
    expect(ctx.events.dispatch).toBe(original)
  } finally { await ctx.fiber.dispose() }
})
