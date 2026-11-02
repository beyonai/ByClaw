/** LAN-capable command-line provider for the dsh Web profile. */

import { networkInterfaces } from 'node:os'
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  WEB_STARTUP_SERVICE,
  type WebStartupValues,
} from '@deepseek-ai/dsh-web-app/startup'

/** Stable Cordis plugin name. */
export const name = 'byclaw-lan-web-startup'

/** Services required before Web invocation flags can be resolved. */
export const inject = ['cmdlineArgs']

interface WebOptions {
  host?: string
  open: boolean
  port?: string
  trustedHost?: string[]
}

/** The bind host the shipped Web flags accept on loopback-only hosts. */
const LOOPBACK_HOST = '127.0.0.1'

/**
 * The concrete address that stands in for `--host 0.0.0.0`. DSH 0.2 WebServer
 * rejects wildcard binds at load, so the LAN bind uses this host's first
 * non-internal IPv4 interface address (a container's own address, the same
 * value `hostname -i` reports); the shipped Host fence accepts that bind IP
 * without a `--trusted-host` entry.
 * @param interfaces - the host's interfaces, as `os.networkInterfaces()` reports them.
 * @returns the first external IPv4 address, or undefined when the host has none.
 */
export function lanBindAddress(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string | undefined {
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return undefined
}

/** Replaceable seams for tests; production resolves the real interfaces. */
export const internals = { lanBindAddress: (): string | undefined => lanBindAddress() }

/** Construct the Web command accepted by this bundle. */
function webCommand(): Command {
  return new Command()
    .name('dsh --profile web')
    .description('Serve the DeepSeek Harness browser UI, including an explicit LAN bind.')
    .helpOption('-h, --help', 'show this help')
    .option('--host <host>', 'bind host: 127.0.0.1, or 0.0.0.0 for this host\'s LAN interface address')
    .option('--no-open', 'do not open the Web UI in the default browser')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .addHelpText('after', `
Examples:
  dsh --profile web                          serve on the composed host and port
  dsh --profile web --host 0.0.0.0 --no-open serve on the LAN interface address
  dsh --profile web --port 8080              serve on another port
`)
}

/** Parse the Web invocation and publish values consumed by the shipped Web rows. */
export function apply(ctx: Context): void {
  const program = webCommand()
  program.action(() => {
    const options = program.opts<WebOptions>()
    if (options.host !== undefined && options.host !== '127.0.0.1' && options.host !== '0.0.0.0') {
      program.error('error: --host must be 127.0.0.1 or 0.0.0.0')
    }
    if (options.port !== undefined && !/^\d+$/.test(options.port)) {
      program.error(`error: --port must be a number, got ${JSON.stringify(options.port)}`)
    }
    let host = options.host
    if (host === '0.0.0.0') {
      const writeErr = program.configureOutput().writeErr!
      writeErr(
        'dsh lan web: WARNING: LAN clients that receive the launch token can execute dsh tools on this host; use only on a trusted network.\n',
      )
      host = internals.lanBindAddress()
      if (host === undefined) {
        host = LOOPBACK_HOST
        writeErr(`dsh lan web: no external IPv4 interface found; serving on ${LOOPBACK_HOST} only.\n`)
      } else {
        writeErr(`dsh lan web: --host 0.0.0.0 binds the LAN interface address ${host} (DSH rejects wildcard binds); loopback is not served.\n`)
      }
    }
    ctx.provide(WEB_STARTUP_SERVICE, {
      openBrowser: options.open,
      ...host !== undefined && { host },
      ...options.port !== undefined && { port: Number(options.port) },
      trustedHosts: options.trustedHost ?? [],
    } satisfies WebStartupValues)
  })
  parseCmdline(ctx, program)
}
