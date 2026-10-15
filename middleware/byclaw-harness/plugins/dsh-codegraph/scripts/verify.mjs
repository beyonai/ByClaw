import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import yaml from 'js-yaml'
import { codeGraphPolicy } from '../lib/index.js'

const execFileAsync = promisify(execFile)

const policy = codeGraphPolicy()
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const codeGraphContract = manifest.dsh?.codegraph

assert.equal(typeof codeGraphContract, 'object')
assert.match(codeGraphContract.version, /^\d+\.\d+\.\d+$/u)
assert.ok(Array.isArray(codeGraphContract.mcpTools) && codeGraphContract.mcpTools.length > 0)
assert.ok(codeGraphContract.mcpTools.every(name => /^codegraph_[A-Za-z0-9_-]+$/u.test(name)))
assert.equal(new Set(codeGraphContract.mcpTools).size, codeGraphContract.mcpTools.length)

const policyToolNames = [...new Set(
  [...policy.matchAll(/mcp__codegraph__(codegraph_[A-Za-z0-9_-]+)/gu)]
    .map(match => match[1]),
)].sort()
assert.deepEqual(policyToolNames, [...codeGraphContract.mcpTools].sort())

assert.match(policy, /^## CodeGraph/mu)
assert.match(policy, /current runtime context/u)
assert.match(policy, /projectPath/u)
assert.doesNotMatch(policy, /ByClaw session/u)

const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
assert.match(patch, /id: codegraph-mcp/u)
assert.match(patch, /name: '@deepseek-ai\/dsh-mcp-client'/u)
assert.match(patch, /command: !!js process\.env\.CODEGRAPH_COMMAND \|\| 'codegraph'/u)
assert.match(patch, /args: \['serve', '--mcp'\]/u)
assert.match(patch, /id: dsh-codegraph/u)
assert.match(patch, /name: '@byclaw\/dsh-codegraph'/u)

const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: expression => ({ expression }),
})
const parsedPatch = yaml.load(patch, { schema: yaml.JSON_SCHEMA.extend(JsExpr) })
const mcpEntry = parsedPatch[0].insert.find(entry => entry.id === 'codegraph-mcp')
const configuredMcpTools = codeGraphContract.mcpTools
  .map(name => name.replace(/^codegraph_/u, ''))
  .join(',')
assert.equal(mcpEntry.config.env.CODEGRAPH_MCP_TOOLS, configuredMcpTools)
const cwdExpression = mcpEntry.config.cwd.expression
const evaluateCwd = (env, fallbackCwd) => Function(
  'process',
  `return (${cwdExpression})`,
)({ env, cwd: () => fallbackCwd })

assert.equal(evaluateCwd({ CODEGRAPH_MCP_CWD: '/' }, '/workspace'), '/')
assert.equal(evaluateCwd({}, '/workspace'), '/workspace')

async function listMcpTools(command) {
  const child = spawn(command, ['serve', '--mcp'], {
    cwd: '/',
    env: { ...process.env, ...mcpEntry.config.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdoutBuffer = ''
  let stderr = ''
  const responses = new Map()
  const waiters = new Map()

  const settleResponse = message => {
    if (typeof message.id !== 'number') return
    const waiter = waiters.get(message.id)
    if (waiter === undefined) responses.set(message.id, message)
    else {
      waiters.delete(message.id)
      waiter.resolve(message)
    }
  }
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk
    for (;;) {
      const newline = stdoutBuffer.indexOf('\n')
      if (newline < 0) break
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (line !== '') settleResponse(JSON.parse(line))
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })

  const request = (id, method, params) => new Promise((resolve, reject) => {
    const buffered = responses.get(id)
    if (buffered !== undefined) {
      responses.delete(id)
      resolve(buffered)
      return
    }
    const timeout = setTimeout(() => {
      waiters.delete(id)
      reject(new Error(`Timed out waiting for MCP ${method}; stderr: ${stderr.trim()}`))
    }, 10_000)
    waiters.set(id, {
      resolve(message) {
        clearTimeout(timeout)
        resolve(message)
      },
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })

  try {
    const initialized = await request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'dsh-codegraph-verifier', version: '1.0.0' },
    })
    assert.equal(initialized.error, undefined, JSON.stringify(initialized.error))
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
    const listed = await request(2, 'tools/list', {})
    assert.equal(listed.error, undefined, JSON.stringify(listed.error))
    return listed.result.tools.map(tool => tool.name).sort()
  } finally {
    child.kill('SIGTERM')
  }
}

if (process.argv.includes('--runtime')) {
  const command = process.env.CODEGRAPH_COMMAND || 'codegraph'
  const { stdout } = await execFileAsync(command, ['--version'], { encoding: 'utf8' })
  assert.equal(stdout.trim(), codeGraphContract.version)
  assert.deepEqual(await listMcpTools(command), [...codeGraphContract.mcpTools].sort())
}

console.info('ByClaw CodeGraph plugin verification passed')
