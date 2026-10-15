/** LAN-capable command-line provider for the dsh Web profile. */

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

/** Construct the Web command accepted by this bundle. */
function webCommand(): Command {
  return new Command()
    .name('dsh --profile web')
    .description('Serve the DeepSeek Harness browser UI, including an explicit LAN bind.')
    .helpOption('-h, --help', 'show this help')
    .option('--host <host>', 'bind host: 127.0.0.1 or 0.0.0.0')
    .option('--no-open', 'do not open the Web UI in the default browser')
    .option('--port <port>', 'listen port; pass 0 to let the OS pick a free one')
    .option('--trusted-host <authority...>', 'extra authority the /api browser-trust fence accepts (host or host:port; repeatable)')
    .addHelpText('after', `
Examples:
  dsh --profile web                          serve on the composed host and port
  dsh --profile web --host 0.0.0.0 --no-open serve on every IPv4 interface
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
    if (options.host === '0.0.0.0') {
      program.configureOutput().writeErr!(
        'dsh lan web: WARNING: LAN clients that receive the launch token can execute dsh tools on this host; use only on a trusted network.\n',
      )
    }
    ctx.provide(WEB_STARTUP_SERVICE, {
      openBrowser: options.open,
      ...options.host !== undefined && { host: options.host },
      ...options.port !== undefined && { port: Number(options.port) },
      trustedHosts: options.trustedHost ?? [],
    } satisfies WebStartupValues)
  })
  parseCmdline(ctx, program)
}
