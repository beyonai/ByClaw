#!/usr/bin/env node
// The process the MCP client's stdio transport spawns when CodeGraph runs on a
// tool environment: it relays its stdin and stdout over the plugin's private
// Unix socket, after presenting the instance secret from the environment.
// Usage: node stdio-socket.mjs <socket path>
import { connect } from 'node:net'

const [path] = process.argv.slice(2)
const token = process.env.DSH_CODEGRAPH_BRIDGE_TOKEN
if (path === undefined || token === undefined || token === '') {
  process.stderr.write('codegraph bridge: a socket path and DSH_CODEGRAPH_BRIDGE_TOKEN are required\n')
  process.exit(2)
}
const socket = connect(path)
socket.once('connect', () => {
  socket.write(`${token}\n`)
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
})
socket.once('error', (error) => {
  process.stderr.write(`codegraph bridge: ${error.message}\n`)
  process.exit(1)
})
socket.once('close', () => { process.exit(0) })
process.stdin.once('end', () => { socket.end() })
