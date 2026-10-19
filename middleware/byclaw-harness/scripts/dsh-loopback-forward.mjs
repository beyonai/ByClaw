/**
 * Loopback mirror of the DSH Web port, preloaded into the DSH process by the
 * image entrypoint (`node --import`).
 *
 * DSH 0.2 rejects wildcard listeners, so `@byclaw/dsh-lan-web` turns
 * `--host 0.0.0.0` into the container's first non-internal IPv4 address and
 * 127.0.0.1 is no longer served. In-container clients still dial loopback:
 * the OpenSandbox execd `/proxy/<port>` route (used for endpoints that are not
 * published directly) forwards to 127.0.0.1:<port>. This module listens on
 * 127.0.0.1:<port> and relays each TCP connection unchanged to that same
 * address the plugin binds, so DSH applies its usual Host fence and
 * authentication to the forwarded request.
 *
 * Loopback starts accepting only once DSH serves the LAN address, so a
 * successful connect to 127.0.0.1:<port> still means DSH is up, as it did when
 * DSH bound 0.0.0.0.
 *
 * Contract: BYCLAW_DSH_LOOPBACK_PORT holds the Web port. Without an external
 * IPv4 interface the plugin itself binds 127.0.0.1, so nothing is mirrored.
 * Timers and the listener are unref'ed and never keep the process alive; a
 * failure to listen is reported and otherwise ignored.
 */

import net from 'node:net'
import { networkInterfaces } from 'node:os'

const POLL_MILLISECONDS = 200

const port = Number(process.env.BYCLAW_DSH_LOOPBACK_PORT)
delete process.env.BYCLAW_DSH_LOOPBACK_PORT

/** The address @byclaw/dsh-lan-web binds for 0.0.0.0: the first non-internal IPv4. */
function lanBindAddress(interfaces = networkInterfaces()) {
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return undefined
}

function mirror(target) {
  // Half-open sockets let each direction end on its own, as on a direct connection.
  const server = net.createServer({ allowHalfOpen: true }, client => {
    const upstream = net.connect({ host: target, port, allowHalfOpen: true })
    client.pipe(upstream)
    upstream.pipe(client)
    // Once the client is gone, nothing can read what upstream still sends.
    client.on('close', () => upstream.destroy())
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })
  server.on('error', error => {
    process.stderr.write(`byclaw-dsh: loopback mirror 127.0.0.1:${port} unavailable: ${error.message}\n`)
  })
  server.listen({ host: '127.0.0.1', port }, () => {
    process.stderr.write(`byclaw-dsh: forwarding 127.0.0.1:${port} to ${target}:${port}\n`)
  })
  server.unref()
}

/** Mirror once the LAN listener accepts a connection. */
function mirrorWhenServing(target) {
  const probe = net.connect({ host: target, port })
  probe.unref()
  probe.once('connect', () => {
    probe.destroy()
    mirror(target)
  })
  probe.once('error', () => {
    setTimeout(() => mirrorWhenServing(target), POLL_MILLISECONDS).unref()
  })
}

const target = Number.isInteger(port) && port > 0 && port < 65536 ? lanBindAddress() : undefined
if (target !== undefined) mirrorWhenServing(target)
