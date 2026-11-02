import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SandboxPolicyService } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { ForwardingSandboxBashExecutor } from '../src/index.ts'

class PassthroughSandboxProvider extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return {
      argv: [...argv],
      enforcement: 'full',
      denialSignatures: [],
      runnerFailureRules: [],
    }
  }
}

let ctx: Context | undefined
const originalBeyondToken = process.env['BEYOND_TOKEN']
const originalApiKey = process.env['DEEPSEEK_API_KEY']
const originalSessionId = process.env['DSH_SESSION_ID']

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  restoreEnvironment('BEYOND_TOKEN', originalBeyondToken)
  restoreEnvironment('DEEPSEEK_API_KEY', originalApiKey)
  restoreEnvironment('DSH_SESSION_ID', originalSessionId)
})

async function setup(): Promise<ForwardingSandboxBashExecutor> {
  ctx = new Context()
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PassthroughSandboxProvider)
  await ctx.plugin(SandboxPolicyService, {
    mode: 'danger-full-access',
    workspaceRoot: process.cwd(),
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(ForwardingSandboxBashExecutor, { graceMs: 200 })
  return ctx.shell as ForwardingSandboxBashExecutor
}

describe('forwarded Bash environment', () => {
  it('reaches Python after DSH scrubs credential-shaped ambient names', async () => {
    process.env['BEYOND_TOKEN'] = 'beyond-visible'
    process.env['DEEPSEEK_API_KEY'] = 'api-key-visible'
    const bash = await setup()

    const result = await (await bash.execute(bash.resolve({
      command: `python3 -c 'import os; print(os.environ.get("BEYOND_TOKEN", "")); print(os.environ.get("DEEPSEEK_API_KEY", ""))'`,
    }))).result()

    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('beyond-visible\napi-key-visible\n')
  })

  it('keeps the current managed DSH values above forwarded host values', async () => {
    process.env['DSH_SESSION_ID'] = 'stale-host-session'
    const bash = await setup()

    const result = await (await bash.execute(bash.resolve({
      command: 'printf %s "$DSH_SESSION_ID"',
      dshEnv: { DSH_SESSION_ID: 'current-session' },
    }))).result()

    expect(result.exitCode).toBe(0)
    expect(result.stdout.text).toBe('current-session')
  })
})
