/** LAN-capable replacement for the shipped Web startup provider. */

import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { WebStartupValues } from '@deepseek-ai/dsh-web-app/startup'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, internals as lanInternals, lanBindAddress } from '../src/startup.ts'

const contexts: Context[] = []

const resolveLan = lanInternals.lanBindAddress

afterEach(async () => {
  lanInternals.lanBindAddress = resolveLan
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
  it('publishes the LAN interface address for --host 0.0.0.0 with the shipped Web flags intact', () => {
    lanInternals.lanBindAddress = () => '172.21.0.9'
    const result = invoke([
      '--host', '0.0.0.0',
      '--port', '8080',
      '--no-open',
      '--trusted-host', 'harness.internal', '192.168.1.10',
    ])

    expect(result.exits).toEqual([])
    expect(result.values).toEqual({
      host: '172.21.0.9',
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
    lanInternals.lanBindAddress = () => '172.21.0.9'
    const result = invoke(['--host', '0.0.0.0'])

    expect(result.output).toContain('LAN clients that receive the launch token can execute dsh tools on this host')
    expect(result.output).toContain('binds the LAN interface address 172.21.0.9')
  })

  it('falls back to loopback when the host has no external IPv4 interface', () => {
    lanInternals.lanBindAddress = () => undefined
    const result = invoke(['--host', '0.0.0.0'])

    expect(result.exits).toEqual([])
    expect(result.values).toMatchObject({ host: '127.0.0.1' })
    expect(result.output).toContain('no external IPv4 interface found')
  })

  it('keeps an explicit loopback bind unchanged', () => {
    const result = invoke(['--host', '127.0.0.1'])

    expect(result.values).toMatchObject({ host: '127.0.0.1' })
  })

  it('selects the first external IPv4 interface address', () => {
    expect(lanBindAddress({
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
      eth0: [
        { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '02:42:ac:15:00:09', internal: false, cidr: 'fe80::1/64', scopeid: 2 },
        { address: '172.21.0.9', netmask: '255.255.0.0', family: 'IPv4', mac: '02:42:ac:15:00:09', internal: false, cidr: '172.21.0.9/16' },
      ],
    })).toBe('172.21.0.9')
    expect(lanBindAddress({ lo: [] })).toBeUndefined()
  })
})
