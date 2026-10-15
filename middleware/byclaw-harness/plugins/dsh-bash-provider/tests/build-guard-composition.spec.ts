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

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-bash-provider-build-guard-spec-'))

const passthrough = (argv: readonly string[]): ConfinedArgv =>
  ({ argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] })

// The executor's constructor registers interval-backed ctx.effects; disposing
// every context keeps those timers from outliving the test.
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(execConfig: Record<string, unknown> = {}) {
  class FakeSandboxProvider extends SandboxProvider {
    confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
      return passthrough(argv)
    }
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService)
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  await ctx.plugin(ForwardingSandboxBashExecutor, { graceMs: 200, rtkAvailable: true, ...execConfig })
  return { ctx, bash: ctx.shell as ForwardingSandboxBashExecutor }
}

describe('resolve() applies rtk before the guard prefix', () => {
  it('keeps rtk routing on a command that is both heavy and rtk-eligible', async () => {
    // The regression this file exists for. `cargo build` is a build (so it gets
    // the guard prefix) and rtk-eligible (so it should be routed). The prefix
    // contains `>` and `;`, which are rtk's disqualifying metacharacters, so
    // getting the order backwards silently drops rtk routing with no error.
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'cargo build --release' })

    expect(spec.command).toContain('rtk cargo build --release')
    expect(spec.command).toContain('/proc/self/oom_score_adj')
    // The prefix must come first, with rtk's command intact after it.
    expect(spec.command.indexOf('oom_score_adj')).toBeLessThan(spec.command.indexOf('rtk cargo'))
  })

  it('leaves a light rtk-eligible command routed and unguarded', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'git status' })

    expect(spec.command).toBe('rtk git status')
    expect(spec.command).not.toContain('oom_score_adj')
  })

  it('guards a heavy command that rtk does not handle', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'make -j8 all' })

    expect(spec.command).toContain('oom_score_adj')
    expect(spec.command).toContain('make -j8 all')
  })
})

describe('MAKEFLAGS is published only for builds', () => {
  it('sets MAKEFLAGS on a heavy command', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'make all' })
    expect(spec.env?.['MAKEFLAGS']).toMatch(/^-j\d+$/)
  })

  it('leaves the environment of a light command untouched', async () => {
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'ls -la' })
    expect(spec.env?.['MAKEFLAGS']).toBeUndefined()
  })

  it('does not override a MAKEFLAGS the caller set explicitly', async () => {
    // An explicit choice outranks the derived one.
    const { bash } = await setup()
    const spec = bash.resolve({ command: 'make all', env: { MAKEFLAGS: '-j1' } })
    expect(spec.env?.['MAKEFLAGS']).toBe('-j1')
  })
})

describe('the master switch restores the pre-guard behaviour exactly', () => {
  it('makes every guard transform the identity when disabled', async () => {
    // The rollback path: an incident is resolved by configuration, not by
    // reverting code, so `buildGuardEnabled: false` must be indistinguishable
    // from the executor before the guard existed.
    const { bash } = await setup({ buildGuardEnabled: false })

    const heavy = bash.resolve({ command: 'cargo build --release' })
    expect(heavy.command).toBe('rtk cargo build --release')
    expect(heavy.command).not.toContain('oom_score_adj')
    expect(heavy.env?.['MAKEFLAGS']).toBeUndefined()

    const make = bash.resolve({ command: 'make all' })
    expect(make.command).toBe('make all')
  })
})

describe('guard configuration reaches the transforms', () => {
  it('honours a configured oom_score_adj', async () => {
    const { bash } = await setup({ oomScoreAdj: 512 })
    expect(bash.resolve({ command: 'make all' }).command).toContain('echo 512 >')
  })

  it('keeps the ulimit backstop off by default', async () => {
    const { bash } = await setup()
    expect(bash.resolve({ command: 'make all' }).command).not.toContain('ulimit')
  })

  it('applies the ulimit backstop when explicitly enabled', async () => {
    const { bash } = await setup({ ulimitEnabled: true })
    const command = bash.resolve({ command: 'make all' }).command
    // Only emitted when a memory figure is readable; on a host where none is,
    // the clause is correctly absent rather than guessed.
    if (bash.guard.status().availableBytes !== undefined) {
      expect(command).toContain('ulimit -v ')
    }
  })
})

describe('construction never takes the Bash provider down', () => {
  it('still resolves commands when the host exposes no usable cgroup', async () => {
    // The guard is optional; the shell is not. Even with no capability
    // information at all, resolve() must keep working.
    const { bash } = await setup()
    expect(() => bash.resolve({ command: 'ls -la' })).not.toThrow()
    expect(() => bash.resolve({ command: 'make all' })).not.toThrow()
    expect(() => bash.guard.status()).not.toThrow()
  })
})

describe('build_guard_status reporting', () => {
  it('reports a coherent status without throwing', async () => {
    const { bash } = await setup()
    const status = bash.guard.status()

    expect(status.enabled).toBe(true)
    expect(['A', 'B', 'C']).toContain(status.tier)
    expect(['redis', 'file-lock', 'in-process']).toContain(status.coordination)
    expect(status.derivedJobs).toBeGreaterThanOrEqual(1)
  })

  it('always discloses the attribution caveat', async () => {
    const { bash } = await setup()
    expect(bash.guard.status().caveats.join(' ')).toContain('cannot be attributed')
  })

  it('warns when coordination rations nothing beyond this container', async () => {
    const { bash } = await setup()
    const status = bash.guard.status()
    if (status.coordination === 'in-process') {
      expect(status.caveats.join(' ')).toContain('NOT a global cap')
    }
  })

  it('warns when no kernel-enforced ceiling is in force', async () => {
    const { bash } = await setup()
    const status = bash.guard.status()
    if (status.tier === 'C') {
      expect(status.caveats.join(' ')).toContain('no kernel-enforced ceiling')
    }
  })
})
