/** LAN-capable replacement for the shipped Web startup provider. */

import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { WebStartupValues } from '@deepseek-ai/dsh-web-app/startup'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/startup.ts'

const contexts: Context[] = []

afterEach(async () => {
  internals.stdout = process.stdout
  internals.stderr = process.stderr
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function invoke(args: string[]): {
  exits: number[]
  output: string
  values: WebStartupValues | undefined
} {
  const ctx = new Context()
  contexts.push(ctx)
  const exits: number[] = []
  let output = ''
  const sink = { write: (chunk: string) => { output += chunk; return true } }
  internals.stdout = sink
  internals.stderr = sink
  provideCmdline(ctx, { args, exit: code => void exits.push(code) })
  apply(ctx)
  return {
    exits,
    output,
    values: ctx.get('webStartup') as WebStartupValues | undefined,
  }
}

describe('LAN Web startup provider', () => {
  it('publishes an explicit all-interface bind with the shipped Web flags intact', () => {
    const result = invoke([
      '--host', '0.0.0.0',
      '--port', '8080',
      '--no-open',
      '--trusted-host', 'harness.internal', '192.168.1.10',
    ])

    expect(result.exits).toEqual([])
    expect(result.values).toEqual({
      host: '0.0.0.0',
      openBrowser: false,
      port: 8080,
      trustedHosts: ['harness.internal', '192.168.1.10'],
    })
  })

  it('rejects a bind host outside the WebServer host vocabulary', () => {
    const result = invoke(['--host', '192.168.1.10'])

    expect(result.exits).toEqual([1])
    expect(result.output).toContain('--host must be 127.0.0.1 or 0.0.0.0')
    expect(result.values).toBeUndefined()
  })

  it('warns that the all-interface bind exposes authenticated tool execution', () => {
    const result = invoke(['--host', '0.0.0.0'])

    expect(result.output).toContain('LAN clients that receive the launch token can execute dsh tools on this host')
  })
})
