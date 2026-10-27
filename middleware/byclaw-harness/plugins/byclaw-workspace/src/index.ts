/** Optional per-turn workspace records; Git preparation starts at the first tool, never at turn start. */
import { createRequire } from 'node:module'
import type { Context, Events } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subprocess'
import * as Upstream from '@deepseek-ai/dsh-workspace-changes'

/** Stable Loader identity for ByClaw's workspace policy. */
export const name = 'byclawWorkspace'
/** The upstream recorder's capabilities, without changing their provider. */
export const inject = ['subprocess', 'fs']

/** Statistics and Git discovery are independent opt-ins; recorder bounds use upstream defaults. */
export interface Config {
  changesEnabled: boolean
  gitEnabled: boolean
  recorder: Upstream.Config
}

/** Loader defaults keep automatic statistics and Git discovery off. */
export const Config: schema<Config> = schema.object({
  changesEnabled: schema.boolean().default(false),
  gitEnabled: schema.boolean().default(false),
  recorder: Upstream.Config.default({} as Upstream.Config),
})

/**
 * Mount the pinned upstream recorder with scoped preparation gates. No Session event,
 * root listener or real tool subprocess is replaced. Model-only turns never create a recorder.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.changesEnabled) {
    ctx.provide('workspaceChanges', {
      summary: () => undefined,
      diff: () => Promise.resolve(undefined),
    })
    return
  }
  const require = createRequire(import.meta.url)
  const version = (require('@deepseek-ai/dsh-workspace-changes/package.json') as { version: string }).version
  if (version !== '0.2.1-rc.2') throw new Error(`byclawWorkspace: unsupported workspace recorder ${version}; expected 0.2.1-rc.2`)

  const pending = new Map<Session, { turn: number; start(): void }>()
  ctx.effect(() => () => { pending.clear() })
  const on: Context['on'] = (event, listener, options) => {
    if (event === 'session/event') {
      // Context.on correlates the event key and callback; TypeScript does not narrow that generic pair.
      const observe = listener as Events['session/event']
      return ctx.on('session/event', function (session, record) {
        if (record.type === 'turn/start') {
          pending.set(session, { turn: record.data.turn, start: () => observe.call(this, session, record) })
          return
        }
        if (record.type === 'turn/end' && pending.get(session)?.turn === record.data.turn) pending.delete(session)
        observe.call(this, session, record)
      }, options)
    }
    if (event === 'tools/pre-execute') {
      const prepare = listener as Events['tools/pre-execute']
      return ctx.on('tools/execute', async function (exec, next) {
        if (exec.signal?.aborted) return next()
        const session = exec.agent?.session
        const deferred = session === undefined ? undefined : pending.get(session)
        if (session !== undefined && deferred !== undefined) {
          // Publish the recorder synchronously before any concurrent tool can pass its baseline wait.
          pending.delete(session)
          deferred.start()
        }
        const decision = await prepare.call(this, exec, () => Promise.resolve({ kind: 'allow' }))
        if (decision.kind !== 'allow') throw new Error('Workspace recorder refused tool preparation')
        // ToolRuntime normalizes an abort after this wait and still runs post-execute hooks.
        return next()
      }, options)
    }
    if (event === 'session/disposed') {
      const dispose = listener as Events['session/disposed']
      return ctx.on('session/disposed', function (session) {
        pending.delete(session)
        dispose.call(this, session)
      }, options)
    }
    return ctx.on(event, listener, options)
  }

  const subprocess = config.gitEnabled ? ctx.subprocess : new Proxy(ctx.subprocess, {
    get(target, key) {
      if (key === 'resolveExecutable') return async (...args: Parameters<typeof target.resolveExecutable>) => {
        if (args[0] === 'git') throw new Error('Automatic Git workspace discovery is disabled')
        return target.resolveExecutable(...args)
      }
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  // extend() creates a private adapter context; capabilities and hooks in every other plugin stay intact.
  Upstream.apply(ctx.extend({ on, subprocess }), config.recorder)
}
