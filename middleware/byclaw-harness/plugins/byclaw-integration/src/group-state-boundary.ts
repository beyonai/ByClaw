/** Scoped member file/tool access; command execution uses the existing backend unchanged. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { canonicalRuntimePath, isPathWithin, teamStateRuntime, type GroupAgentScope, type TeamStateRuntime } from '@byclaw/dsh-agent-teams'
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { privateGenerationRoot } from './generation-paths.ts'
import { activeMemberSkillRoots, memberSkillProjectionRoot, memberSkillRoot, resolveByClawDshHome } from './group-skill-resources.ts'

type MemberActor = { agent: Agent; scope: GroupAgentScope }
type RecordLike = Record<string, unknown>
const BLOCKED_MEMBER_TOOLS = new Set(['run_code', 'session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read', 'lsp'])

export class GroupStateBoundary {
  readonly actors = new AsyncLocalStorage<MemberActor>()
  private readonly roots: string[]
  private readonly installed = new WeakSet<object>()

  constructor(private readonly options: {
    privateRoots: readonly string[]
    getScope: (agentId: string) => GroupAgentScope | undefined
    /** This context's DSH home (its `sessions`, `storages`, `runtime` stay private); defaults to `DSH_HOME`. */
    dshHome?: string
    /** This context's AgentTeams state runtime, resolved per use (default: the process-wide runtime). */
    stateRuntime?: () => TeamStateRuntime
  }) {
    const home = resolveByClawDshHome(options.dshHome)
    const legacyGenerationCopies = options.privateRoots.flatMap(root => {
      const parent = dirname(resolve(root))
      if (!existsSync(parent)) return []
      return readdirSync(parent, { withFileTypes: true }).filter(entry =>
        entry.isDirectory() && (['.byclaw-agent-generation-', '.byclaw-team-generation-', '.byclaw-skill-generation-'].some(prefix => entry.name.startsWith(prefix))
          || entry.name.startsWith(`${basename(root)}.byclaw-backup-`) || entry.name.startsWith(`${basename(root)}.byclaw-failed-`)))
        .map(entry => join(parent, entry.name))
    })
    const roots = [...new Set([join(home, 'sessions'), join(home, 'storages'), join(home, 'runtime'),
      ...legacyGenerationCopies, ...options.privateRoots.flatMap(root => [root, privateGenerationRoot(root)])].map(canonicalRuntimePath))]
    this.roots = roots.filter(root => !roots.some(parent => parent !== root && isPathWithin(root, parent)))
  }

  private stateRuntime(): TeamStateRuntime {
    return this.options.stateRuntime?.() ?? teamStateRuntime()
  }

  member(agent: Agent | undefined): MemberActor | undefined {
    const scope = agent === undefined ? undefined : this.options.getScope(String(agent.id))
    return scope?.role === 'member' ? { agent: agent!, scope } : undefined
  }

  assertPath(path: string, access: 'read' | 'write' = 'read'): void {
    const actor = this.actors.getStore()
    if (actor === undefined) return
    const runtime = this.stateRuntime()
    const absolute = runtime.workspacePath(resolve(runtime.workspaceOf(actor.agent), path))
    const projection = memberSkillProjectionRoot(this.options.dshHome)
    const ownSkill = memberSkillRoot(String(actor.agent.id), this.options.dshHome)
    const allowedSkill = absolute === ownSkill || activeMemberSkillRoots(String(actor.agent.id)).some(root => isPathWithin(absolute, root))
    if ((isPathWithin(absolute, projection) && (access === 'write' || !allowedSkill))
      || this.roots.some(root => isPathWithin(absolute, root)) || isPathWithin(absolute, runtime.runtimeRoot())) {
      throw new Error('GROUP_MEMBER_PRIVATE_STATE_DENIED: use your task/context tools; employee catalogs, other sessions and full team state are private runtime data')
    }
  }

  deniedTool(name: string): boolean { return BLOCKED_MEMBER_TOOLS.has(name) }

  /** Native tool presentation keeps business tools usable without an arbitrary in-process code bridge. */
  bindMember(agentCtx: Context, agent?: Agent): () => void {
    const actor = this.member(agent ?? (agentCtx as Context & { agent?: Agent }).agent)
    if (actor === undefined) return () => undefined
    const tools = (typeof agentCtx.get === 'function' ? agentCtx.get('tools') : agentCtx.tools) as typeof agentCtx.tools & { presentAs?: (mode: 'native') => () => void }
    if (typeof tools.presentAs !== 'function') throw new Error('Group members require native tool presentation; unsafe code-only tool execution cannot substitute it')
    return tools.presentAs('native')
  }

  install(ctx: Context): () => void {
    const disposers: Array<() => void> = []
    const tools = ctx.get('tools') as unknown as { guard?: (check: (exec: { agent?: Agent; name: string }) => string | undefined) => () => void } | undefined
    if (typeof tools?.guard === 'function') disposers.push(tools.guard(exec =>
      this.member(exec.agent) !== undefined && this.deniedTool(exec.name)
        ? 'Group member execution denies arbitrary code and unscoped private-state tools' : undefined))
    disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
      if (this.member(exec.agent) !== undefined && this.deniedTool(exec.name)) {
        return { kind: 'deny', reason: 'Group members use native scoped tools. Arbitrary in-process code, cross-session queries and unscoped language-server access cannot read private coordination state.' }
      }
      return next()
    }))
    disposers.push(ctx.on('tools/execute', async (exec, next) => {
      const actor = this.member(exec.agent)
      return actor === undefined ? next() : this.actors.run(actor, next)
    }))

    const installServices = (): void => {
      const fs = ctx.get('fs') as unknown as RecordLike | undefined
      if (fs !== undefined && !this.installed.has(fs)) {
        this.installed.add(fs)
        const processPath = fs['processPath']
        for (const name of ['resolve', 'lstat', 'processPath', 'processPathFromHostPath', 'stat', 'readText', 'streamText', 'readBytes', 'readByteRange', 'watch', 'listDir', 'writeText', 'editText']) {
          const original = fs[name]
          if (typeof original !== 'function') continue
          const boundary = this
          const wrapped = function (this: unknown, ...args: unknown[]): unknown {
            const raw = args[0]
            const path = typeof raw === 'string' ? raw : (raw as RecordLike | undefined)?.['displayPath']
            if (typeof path === 'string') boundary.assertPath(path, name === 'writeText' || name === 'editText' ? 'write' : 'read')
            // A target's display spelling is not necessarily its backend identity.
            if (raw !== null && typeof raw === 'object' && typeof processPath === 'function') {
              boundary.assertPath(processPath.call(fs, raw), name === 'writeText' || name === 'editText' ? 'write' : 'read')
            }
            const result = original.apply(this, args)
            if (name !== 'resolve' && name !== 'listDir') return result
            const actor = boundary.actors.getStore()
            return Promise.resolve(result).then(value => {
              if (actor === undefined) return value
              if (name === 'resolve') {
                const target = value as RecordLike
                const resolved = target['displayPath']
                if (typeof resolved === 'string') boundary.assertPath(resolved)
                return value
              }
              if (!Array.isArray(value) || typeof path !== 'string') return value
              return value.filter(entry => {
                try { boundary.assertPath(join(path, String((entry as RecordLike)['name'] ?? ''))); return true } catch { return false }
              })
            })
          }
          fs[name] = wrapped
          disposers.push(() => { if (fs[name] === wrapped) fs[name] = original })
        }
      }

    }
    installServices()
    disposers.push(ctx.on('internal/service', name => {
      if (name === 'fs') installServices()
    }))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }
}
