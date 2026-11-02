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
import { ForwardingSandboxBashExecutor, forwardEnvironment, hostEnvironmentForwarding } from '../src/index.ts'

const spillDir = mkdtempSync(join(tmpdir(), 'dsh-bash-provider-shared-host-spec-'))
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function setup(execConfig: Record<string, unknown> = {}) {
  class FakeSandboxProvider extends SandboxProvider {
    confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
    }
  }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(FakeSandboxProvider)
  await ctx.plugin(SandboxPolicyService)
  await ctx.plugin(LocalSubprocessRuntime)
  ;(ctx.subprocess as LocalSubprocessRuntime).internals = { spillDir }
  // Only registration matters here; the real registry needs the system-prompt service.
  const registered: string[] = []
  ctx.provide('tools', { register: (definition: { name: string }) => { registered.push(definition.name); return () => {} } } as never)
  await ctx.plugin(ForwardingSandboxBashExecutor, { graceMs: 200, rtkAvailable: false, ...execConfig })
  return { ctx, bash: ctx.shell as ForwardingSandboxBashExecutor, registered }
}

describe('forwardHostEnvironment', () => {
  it('copies only allowlisted host variables, still layering request and Redis values', () => {
    expect(forwardEnvironment(
      { PATH: '/host/bin', HOME: '/root', BEYOND_TOKEN: 'host-secret', USER_CODE: 'other-user', LANG: undefined },
      { REQUEST_ONLY: 'request', HOME: '/request-home' },
      { GH_TOKEN: 'redis' },
      { allow: ['PATH', 'HOME', 'LANG', 'NOT_SET'] },
    )).toEqual({ PATH: '/host/bin', HOME: '/request-home', REQUEST_ONLY: 'request', GH_TOKEN: 'redis' })
  })

  it("keeps 'all' as the default policy", () => {
    expect(hostEnvironmentForwarding(undefined)).toBe('all')
    expect(hostEnvironmentForwarding('all')).toBe('all')
    expect(forwardEnvironment({ A: '1', B: '2' })).toEqual({ A: '1', B: '2' })
    expect(forwardEnvironment({ A: '1', B: '2' }, undefined, undefined, 'all')).toEqual({ A: '1', B: '2' })
  })

  it('rejects malformed policies', () => {
    expect(() => hostEnvironmentForwarding('none')).toThrow(/forwardHostEnvironment/)
    expect(() => hostEnvironmentForwarding({ allow: 'PATH' })).toThrow(/forwardHostEnvironment/)
    expect(() => hostEnvironmentForwarding({ allow: [''] })).toThrow(/forwardHostEnvironment/)
  })

  it('applies the allowlist to resolved commands', async () => {
    process.env['BYCLAW_SHARED_HOST_SPEC_SECRET'] = 'must-not-leak'
    process.env['BYCLAW_SHARED_HOST_SPEC_ALLOWED'] = 'allowed'
    try {
      const { bash } = await setup({ forwardHostEnvironment: { allow: ['BYCLAW_SHARED_HOST_SPEC_ALLOWED'] } })
      const spec = bash.resolve({ command: 'true', env: { FROM_REQUEST: 'yes' } })
      expect(spec.env?.['BYCLAW_SHARED_HOST_SPEC_ALLOWED']).toBe('allowed')
      expect(spec.env?.['FROM_REQUEST']).toBe('yes')
      expect(spec.env?.['BYCLAW_SHARED_HOST_SPEC_SECRET']).toBeUndefined()
      expect(spec.env?.['PATH']).toBeUndefined()
      const all = (await setup()).bash.resolve({ command: 'true' })
      expect(all.env?.['BYCLAW_SHARED_HOST_SPEC_SECRET']).toBe('must-not-leak')
    } finally {
      delete process.env['BYCLAW_SHARED_HOST_SPEC_SECRET']
      delete process.env['BYCLAW_SHARED_HOST_SPEC_ALLOWED']
    }
  })

  it('rejects a malformed policy at construction', async () => {
    await expect(setup({ forwardHostEnvironment: 'none' })).rejects.toThrow(/forwardHostEnvironment/)
  })
})

describe('workspaceOnToolEnvironment', () => {
  it('turns the build guard off without probing this host or registering its status tool', async () => {
    const { bash, registered } = await setup({ workspaceOnToolEnvironment: true, buildGuardEnabled: true })
    expect(bash.guard.isGuarded('make -j8 all')).toBe(false)
    const spec = bash.resolve({ command: 'make -j8 all' })
    expect(spec.command).toBe('make -j8 all')
    expect(spec.env?.['MAKEFLAGS']).toBeUndefined()
    expect(bash.guard.capability.cgroupPath).toBeUndefined()
    expect(bash.guard.capability.degraded).toEqual(['no-cgroup'])
    expect(bash.guard.coordination).toBe('in-process')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(registered).not.toContain('build_guard_status')
  })

  it('leaves the default guard and its status tool in place', async () => {
    const { bash, registered } = await setup()
    expect(bash.guard.isGuarded('make -j8 all')).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(registered).toContain('build_guard_status')
  })
})
