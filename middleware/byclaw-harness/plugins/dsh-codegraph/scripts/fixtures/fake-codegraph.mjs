#!/usr/bin/env node
import { createInterface } from 'node:readline'

if (process.argv[2] === '--version') {
  console.info(process.env.FAKE_CODEGRAPH_VERSION || '1.6.0')
  process.exit(0)
}

if (process.argv[2] !== 'serve' || process.argv[3] !== '--mcp') process.exit(2)

const configured = process.env.FAKE_CODEGRAPH_IGNORE_CONFIG === '1'
  ? 'status'
  : process.env.CODEGRAPH_MCP_TOOLS || 'status'
const tools = configured.split(',').filter(Boolean).map(name => ({
  name: `codegraph_${name}`,
  description: `Fake ${name} tool`,
  inputSchema: { type: 'object' },
}))

const lines = createInterface({ input: process.stdin })
let initialized = false
lines.on('line', line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  // Like a real MCP server, a fresh process answers nothing before the handshake.
  if (request.method === 'initialize') initialized = true
  else if (request.method === 'server/discover') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method not found' } })}\n`)
    return
  } else if (!initialized) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32002, message: 'not initialized' } })}\n`)
    return
  }
  const result = request.method === 'initialize'
    ? {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-codegraph', version: '1.0.0' },
      }
    : request.method === 'tools/list' ? { tools }
      : request.method === 'tools/call'
        ? { content: [{ type: 'text', text: `fake ${request.params.name} in ${process.cwd()}` }] }
        : {}
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
})
