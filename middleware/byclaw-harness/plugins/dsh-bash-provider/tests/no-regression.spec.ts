import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { ForwardingSandboxBashExecutor } from '../src/index.ts'

const spillDir = mkdtempSync(join(tmpdir(), 'equiv-'))
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(c => c.fiber.dispose())) })

async function setup(cfg: Record<string, unknown> = {}) {
  class P extends SandboxProvider {
    confine(argv: readonly string[], _p: SandboxPolicy): ConfinedArgv {
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
    }
  }
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry); await ctx.plugin(P)
  await ctx.plugin(SandboxPolicyService); await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(ForwardingSandboxBashExecutor, { graceMs: 200, rtkAvailable: true, ...cfg })
  return ctx.shell as ForwardingSandboxBashExecutor
}

// Commands representative of ordinary, non-build agent traffic.
const ORDINARY = [
  'ls -la', 'cat README.md', 'git status', 'git log --oneline -5',
  'npm test', 'pnpm install', 'echo hello', 'grep -rn foo src/',
  'python3 script.py', 'curl -s https://example.com', 'cd /tmp && ls',
  'echo "make dinner"', 'cat Makefile', 'cargo fmt', 'go vet ./...', 'docker ps',
]

describe('ordinary traffic is byte-identical with the guard on or off', () => {
  it('produces the same command and env either way', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    for (const command of ORDINARY) {
      const a = on.resolve({ command })
      const b = off.resolve({ command })
      expect(a.command, `command: ${command}`).toBe(b.command)
      expect(a.env, `env: ${command}`).toEqual(b.env)
      expect(a.command).not.toContain('oom_score_adj')
      expect(a.env?.['MAKEFLAGS']).toBeUndefined()
    }
  })

  it('preserves every other resolved spec field', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    const a = on.resolve({ command: 'ls -la' })
    const b = off.resolve({ command: 'ls -la' })
    expect(a).toEqual(b)
  })
})

describe('build commands differ only in command prefix and MAKEFLAGS', () => {
  it('changes nothing else in the spec', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    const a = on.resolve({ command: 'make all' })
    const b = off.resolve({ command: 'make all' })

    const { command: ca, env: ea, ...restA } = a
    const { command: cb, env: eb, ...restB } = b
    expect(restA).toEqual(restB)

    // The only env difference is the added MAKEFLAGS.
    const { MAKEFLAGS, ...eaRest } = ea ?? {}
    expect(MAKEFLAGS).toMatch(/^-j\d+$/)
    expect(eaRest).toEqual(eb ?? {})
    // The guarded command still contains the original verbatim.
    expect(ca).toContain(cb)
  })
})

describe('existing guarantees still hold', () => {
  it('still enforces the browser command policy', async () => {
    const bash = await setup()
    expect(() => bash.resolve({ command: 'chromium --headless' })).toThrow()
  })

  it('still forwards host environment', async () => {
    const bash = await setup()
    const spec = bash.resolve({ command: 'ls' })
    expect(Object.keys(spec.env ?? {}).length).toBeGreaterThan(0)
  })

  it('still honours explicit request env over the host', async () => {
    const bash = await setup()
    expect(bash.resolve({ command: 'ls', env: { PATH: '/custom' } }).env?.['PATH']).toBe('/custom')
  })

  it('still disables rtk routing when rtk is absent', async () => {
    const bash = await setup({ rtkAvailable: false })
    expect(bash.resolve({ command: 'git status' }).command).toBe('git status')
  })
})
