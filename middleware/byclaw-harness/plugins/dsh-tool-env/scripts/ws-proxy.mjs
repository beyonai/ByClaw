#!/usr/bin/env node
// OpenSSH ProxyCommand for a tool environment (B) reachable only through an HTTP
// ingress: carries ssh's transport (stdin/stdout) in binary WebSocket frames to the
// bridge in B (scripts/ws-bridge.py), which connects them to B's sshd.
//
//   ProxyCommand node ws-proxy.mjs ws://host/path?token=...
//
// Written by @byclaw/dsh-tool-env into the alias's ssh_config; the URL is used verbatim,
// so an ingress token in its query string is sent as-is. Needs Node 22+ (global WebSocket).
const url = process.argv[2]
if (url === undefined || url === '') {
  process.stderr.write('usage: ws-proxy.mjs ws://host[:port]/path\n')
  process.exit(64)
}
const socket = new WebSocket(url)
socket.binaryType = 'arraybuffer'
socket.onopen = () => {
  process.stdin.on('data', chunk => { socket.send(chunk) })
  process.stdin.on('end', () => { socket.close() })
}
socket.onmessage = event => { process.stdout.write(Buffer.from(event.data)) }
socket.onclose = () => { process.exit(0) }
socket.onerror = event => {
  process.stderr.write(`ws-proxy: ${event.message ?? 'WebSocket error'}\n`)
  process.exit(1)
}
