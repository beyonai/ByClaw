import { mkdtempSync, writeFileSync } from 'node:fs'
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

const spillDir = mkdtempSync(join(tmpdir(), 'guard-exec-'))
const workdir = mkdtempSync(join(tmpdir(), 'guard-exec-wd-'))
writeFileSync(join(workdir, 'Makefile'), 'all:\n\t@echo built-ok\n\nfail:\n\t@echo to-stderr >&2; exit 3\n')

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
  await ctx.plugin(ForwardingSandboxBashExecutor, { graceMs: 200, rtkAvailable: false, ...cfg })
  return ctx.shell as ForwardingSandboxBashExecutor
}

/** Actually execute a command end to end and collect what the caller would see. */
async function run(bash: ForwardingSandboxBashExecutor, command: string) {
  const result = await (await bash.execute(bash.resolve({ command, workdir }))).result()
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.text.trim(),
    stderr: result.stderr.text.trim(),
  }
}

describe('guarded builds really execute, with output and status intact', () => {
  it('a successful build produces identical output and exit code', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    expect(await run(on, 'make all')).toEqual(await run(off, 'make all'))
    expect((await run(on, 'make all')).stdout).toBe('built-ok')
  })

  it('a failing build propagates its real exit code through the prefix', async () => {
    // The prefix is `echo ...; <command>`, so the shell's status must be the
    // command's, not the echo's. A prefix that swallowed the status would make
    // every failed build report success.
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    const guarded = await run(on, 'make fail')
    const plain = await run(off, 'make fail')

    expect(guarded.exitCode).not.toBe(0)
    // Compared against the unguarded run rather than a hard-coded number: the
    // guarantee is "the guard changes nothing", and make's own exit code for a
    // failed recipe is its business, not this test's.
    expect(guarded).toEqual(plain)
  })

  it('does not leak the prefix into stdout or stderr', async () => {
    const on = await setup()
    const ok = await run(on, 'make all')
    const bad = await run(on, 'make fail')
    for (const stream of [ok.stdout, ok.stderr, bad.stdout, bad.stderr]) {
      expect(stream).not.toContain('oom_score_adj')
      expect(stream).not.toContain('/proc/self')
    }
  })

  it('keeps stderr and stdout separate, exactly as an unguarded run does', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    const guarded = await run(on, 'make fail')
    const plain = await run(off, 'make fail')

    expect(guarded.stdout).toBe(plain.stdout)
    expect(guarded.stderr).toBe(plain.stderr)
    // The recipe's own stderr is still there and still on stderr.
    expect(guarded.stderr).toContain('to-stderr')
    expect(guarded.stdout).not.toContain('to-stderr')
  })
})

describe('shell semantics survive the prefix', () => {
  it('preserves set -e behaviour', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    const command = 'set -e; make fail; echo NOT-REACHED'
    expect(await run(on, command)).toEqual(await run(off, command))
    expect((await run(on, command)).stdout).not.toContain('NOT-REACHED')
  })

  it('preserves the exit code of a compound command headed by a build', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    const command = 'make all && echo chained'
    const guarded = await run(on, command)
    expect(guarded.exitCode).toBe(0)
    expect(guarded.stdout).toContain('chained')
    expect(guarded).toEqual(await run(off, command))
  })

  it('preserves a multi-line script', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    const command = 'make all\necho second-line'
    expect(await run(on, command)).toEqual(await run(off, command))
  })

  it('honours workdir for a guarded command', async () => {
    const on = await setup()
    expect((await run(on, 'make all')).stdout).toBe('built-ok')
  })
})

describe('ordinary commands execute exactly as before', () => {
  const CASES = ['echo hello', 'ls Makefile', 'cat Makefile', 'exit 7', 'echo err >&2']
  it('produce identical results with the guard on or off', async () => {
    const on = await setup()
    const off = await setup({ buildGuardEnabled: false })
    for (const command of CASES) {
      expect(await run(on, command), `case: ${command}`).toEqual(await run(off, command))
    }
  })
})
