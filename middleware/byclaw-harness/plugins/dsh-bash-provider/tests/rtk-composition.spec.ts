import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxMode, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { ForwardingSandboxBashExecutor } from '../src/index.ts'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-bash-provider-rtk-composition-spec-'))

/** A passthrough wrap: the caller's argv unchanged, asserted full. */
const passthrough = (argv: readonly string[]): ConfinedArgv =>
  ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] })

// ForwardingSandboxBashExecutor's constructor registers a 5s Redis-refresh
// ctx.effect(); disposing every context created in a test keeps that timer
// from outliving the test.
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(config: { mode?: SandboxMode } = {}) {
  const { mode, ...execConfig } = config
  const calls: { argv: string[]; policy: SandboxPolicy }[] = []
  class FakeSandboxProvider extends SandboxProvider {
    confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
      calls.push({ argv: [...argv], policy })
      return passthrough(argv)
    }
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService, { ...mode !== undefined ? { mode } : {} })
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(ForwardingSandboxBashExecutor, { graceMs: 200, rtkAvailable: true, ...execConfig })
  const bash = ctx.shell as ForwardingSandboxBashExecutor
  return { ctx, bash, calls }
}

describe('ForwardingSandboxBashExecutor rtk composition', () => {
  it('registers as ctx.shell', async () => {
    const { bash } = await setup()
    expect(bash).toBeInstanceOf(ForwardingSandboxBashExecutor)
  })

  it('wraps eligible commands before the sandbox confines them', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await (await bash.execute(bash.resolve({ command: 'git status' }))).result()
    expect(calls).toEqual([{
      argv: ['bash', '-c', 'rtk git status'],
      policy: { mode: 'read-only', workspaceRoot: resolve(process.cwd()) },
    }])
  })

  it('leaves complex commands unchanged before confinement', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await (await bash.execute(bash.resolve({ command: 'git status | grep x' }))).result()
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'git status | grep x'])
  })

  it('leaves non-whitelisted commands unchanged before confinement', async () => {
    const { bash, calls } = await setup({ mode: 'read-only' })
    await (await bash.execute(bash.resolve({ command: 'ls -la' }))).result()
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'ls -la'])
  })

  it('stamps sandbox facts on the result', async () => {
    const { bash } = await setup({ mode: 'read-only' })
    const result = await (await bash.execute(bash.resolve({ command: 'echo hi' }))).result()
    expect(result.sandbox).toEqual({ mode: 'read-only', denied: false, enforcement: 'full' })
  })

  it('composes host-environment forwarding with the rtk command wrap', async () => {
    const { bash } = await setup()
    const marker = 'dsh-bash-provider-rtk-composition-test'
    process.env['DSH_ENV_FORWARD_RTK_COMPOSITION_TEST'] = marker
    try {
      const spec = bash.resolve({ command: 'git status', env: { CALLER_ONLY: 'caller-value' } })
      // rtk half: eligible command rewritten.
      expect(spec.command).toBe('rtk git status')
      // env-forward half: the host process env and the caller's explicit
      // override both land in the resolved spec — the two transforms touch
      // disjoint ShellExecSpec fields and neither drops the other's work.
      expect(spec.env?.['DSH_ENV_FORWARD_RTK_COMPOSITION_TEST']).toBe(marker)
      expect(spec.env?.['CALLER_ONLY']).toBe('caller-value')
    } finally {
      delete process.env['DSH_ENV_FORWARD_RTK_COMPOSITION_TEST']
    }
  })

  it('falls back to the identity transform when rtk is unavailable', async () => {
    const calls: { argv: string[]; policy: SandboxPolicy }[] = []
    class FakeSandboxProvider extends SandboxProvider {
      confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
        calls.push({ argv: [...argv], policy })
        return passthrough(argv)
      }
    }
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(FakeSandboxProvider)
    await ctx.plugin(SandboxPolicyService, {})
    await ctx.plugin(LocalSubprocessRuntime)
    ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
    await ctx.plugin(ForwardingSandboxBashExecutor, { graceMs: 200, rtkAvailable: false })
    const bash = ctx.shell as ForwardingSandboxBashExecutor
    await (await bash.execute(bash.resolve({ command: 'git status' }))).result()
    expect(calls[0]?.argv).toEqual(['bash', '-c', 'git status'])
  })
})
