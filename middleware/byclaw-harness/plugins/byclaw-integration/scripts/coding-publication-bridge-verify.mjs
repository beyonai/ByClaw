/** Real DSH authentication/client and lease-file responses; no live credentials, BE or model. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CodingPublicationBridge } from '../src/coding-publication-bridge.ts'
import { resolveByClawAuthorization } from '../src/resource-authorization.ts'
import { GroupTaskPublicationClient } from '../../group-task-publication/src/client.ts'

const execute = promisify(execFile)
const python = process.platform === 'win32' ? 'python' : 'python3'

async function fixture(t, options = {}) {
  const root = (await mkdtemp(join(tmpdir(), 'publication-bridge-'))).replaceAll('\\', '/')
  t.after(() => rm(root, { recursive: true, force: true }))
  const controller = new AbortController(), bridgeId = randomUUID(), requests = []
  let token = 'synthetic-login-one', authReads = 0, prepares = 0
  const redis = {
    get: async key => key === 'SHARE_BFM_USER_CODE_fixture' ? '42' : null,
    exists: async () => 1,
    hgetall: async key => key === 'user:42:login:auth' ? { 'Beyond-Token': token } : {},
  }
  const binding = { taskId: '3001', userCode: 'fixture', privateGroupId: '2001', enterpriseId: '19' }
  const client = new GroupTaskPublicationClient({
    userCode: 'fixture', baseUrl: 'https://be.invalid/byaiService', byRoot: root,
    resolveSourcePath: path => join(root, path.slice('/by/'.length)), timeoutMs: 1000,
    resolveAuthHeaders: async () => {
      authReads++
      return (await resolveByClawAuthorization(redis, 'fixture')).authHeaders
    },
    fetchImpl: async (url, request) => {
      requests.push({ url, token: request.headers.get('Beyond-Token'), tenant: request.headers.get('X-Enterprise-Id'), body: JSON.parse(request.body) })
      if (options.rotateToken) token = 'synthetic-login-two'
      if (options.fetchFails) throw new Error('synthetic-secret-must-not-leak')
      return Response.json({ code: 0, data: { taskId: '3001', pendingPublicationId: '4001',
        text: requests.at(-1).body.text, sourcePaths: [], createTime: 'fixture-time' } })
    },
  })
  const sandbox = {
    async execute(actor, lease, argv, cwd, signal) {
      assert.equal(actor, 'owned-actor'); assert.equal(lease, 'owned-lease')
      assert.equal(cwd, root); assert.equal(signal, controller.signal)
      if (options.writeFails) return { exitCode: 1, stdout: '', stderr: '' }
      return { exitCode: 0, ...await execute(python, argv.slice(1)) }
    },
  }
  const home = root + '/.sessions/3001/executors/1001/codex-home'
  const bridge = new CodingPublicationBridge({ bridgeId, home, sandbox, actor: 'owned-actor', leaseId: 'owned-lease',
    workspaceRoot: root, signal: controller.signal, abort: () => controller.abort(),
    prepare: async (args, signal) => { prepares++; return client.prepare(binding, args, signal) },
  })
  const event = (args = { text: '成果', sourcePaths: [] }) => ({ type: 'byclaw.publication.request', bridgeId, requestId: randomUUID(), arguments: args })
  const response = async request => JSON.parse(await readFile(`${home}/.publication/${bridgeId}/${request.requestId}.response.json`, 'utf8'))
  return { bridge, bridgeId, controller, requests, event, response, root, home,
    setToken(value) { token = value }, counts: () => ({ authReads, prepares }) }
}

test('MCP reuses the original DSH client and refreshes user authentication on each invocation', async t => {
  const f = await fixture(t, { rotateToken: true })
  const first = f.event(), second = f.event({ text: '更新成果', sourcePaths: [] })
  f.bridge.accept(first)
  f.bridge.accept(second)
  // Closing drains accepted work before the owning lease may be returned.
  await f.bridge.close()
  assert.equal((await f.response(first)).result.taskId, '3001')
  assert.equal(f.requests[0].token, 'synthetic-login-one')
  assert.equal(f.requests[1].token, 'synthetic-login-two')
  assert.equal(f.requests[1].tenant, '19')
  assert.equal(f.requests[1].url, 'https://be.invalid/byaiService/group-chat/tasks/3001/pending-publication')
  assert.equal(JSON.stringify(await f.response(second)).includes('synthetic-login'), false)
  assert.deepEqual(f.counts(), { authReads: 2, prepares: 2 })
})

test('duplicate events never retry an uncertain POST, and transport secrets do not reach MCP', async t => {
  const f = await fixture(t, { fetchFails: true }), request = f.event()
  f.bridge.accept(request); f.bridge.accept(request)
  await f.bridge.close()
  const result = await f.response(request)
  assert.ok(result.error.includes('不要自动重试'))
  assert.ok(!JSON.stringify(result).includes('synthetic-secret'))
  assert.equal(f.requests.length, 1)
  assert.throws(() => f.bridge.accept(request), /SCOPE_MISMATCH/)
})

test('wrong turn IDs, forged response paths and cancelled work never invoke the callback', async t => {
  const f = await fixture(t)
  assert.throws(() => f.bridge.accept({ ...f.event(), bridgeId: randomUUID() }), /SCOPE_MISMATCH/)
  assert.throws(() => f.bridge.accept({ ...f.event(), requestId: '../../other-user' }), /SCOPE_MISMATCH/)
  f.controller.abort()
  f.bridge.accept(f.event())
  await assert.rejects(f.bridge.close())
  assert.deepEqual(f.counts(), { authReads: 0, prepares: 0 })
})

test('the DSH client rejects missing credentials and model-supplied identities before contacting BE', async t => {
  const f = await fixture(t)
  f.setToken('')
  const request = f.event()
  f.bridge.accept(request)
  await f.bridge.close()
  assert.ok((await f.response(request)).error)
  assert.equal(f.requests.length, 0)
  const other = await fixture(t)
  const forged = other.event({ text: '成果', userCode: 'another-user', taskId: 'other-task' })
  other.bridge.accept(forged)
  await other.bridge.close()
  assert.ok((await other.response(forged)).error)
  assert.equal(other.requests.length, 0)
  assert.equal(other.counts().authReads, 0)
})

test('a broken response channel aborts the owning CLI and never repeats the publication', async t => {
  const f = await fixture(t, { writeFails: true })
  f.bridge.accept(f.event())
  await assert.rejects(f.bridge.close())
  assert.equal(f.controller.signal.aborted, true)
  assert.equal(f.requests.length, 1)
})

test('real Python MCP and runner receive a card from the original DSH client without tool-side credentials', { timeout: 15_000 }, async t => {
  const f = await fixture(t)
  const runner = fileURLToPath(new URL('./coding-workspace.py', import.meta.url))
  const program = `
import json, os, runpy, subprocess, sys
from pathlib import Path
runner = runpy.run_path(sys.argv[1])
home = Path(sys.argv[2]); bridge_id = sys.argv[3]
directory = home / '.publication' / bridge_id
directory.mkdir(parents=True)
script = home / 'publication-mcp.py'
script.write_text(runner['PUBLICATION_MCP_SERVER'], encoding='utf-8')
config = home / 'bridge.json'
config.write_text(json.dumps({'bridgeDirectory': str(directory)}), encoding='utf-8')
bridge = runner['PublicationBridge'](directory, bridge_id)
bridge.start()
try:
    request = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {
        'name': 'prepare_group_task_publication', 'arguments': {'text': '成果', 'sourcePaths': []}}}
    env = {key: value for key, value in os.environ.items() if key not in ('BEYOND_TOKEN', 'SSO_TOKEN')}
    env['PYTHONIOENCODING'] = 'utf-8'
    result = subprocess.run([sys.executable, str(script), str(config)], input=json.dumps(request)+'\\n',
        env=env, text=True, encoding='utf-8', capture_output=True, timeout=10, check=True)
    runner['emit']('test.mcp.result', payload=json.loads(result.stdout))
finally:
    bridge.close()
`
  const child = spawn(python, ['-u', '-c', program, runner, f.home, f.bridgeId], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  const exited = once(child, 'exit')
  let stderr = '', result
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  for await (const line of createInterface({ input: child.stdout })) {
    const event = JSON.parse(line)
    if (event.type === 'byclaw.publication.request') f.bridge.accept(event)
    else if (event.type === 'test.mcp.result') result = event.payload
    else assert.fail('unexpected runner event')
  }
  assert.equal((await exited)[0], 0, stderr)
  await f.bridge.close()
  assert.ok(!result.result.isError)
  assert.equal(JSON.parse(result.result.content[0].text).pendingPublicationId, '4001')
  assert.equal(f.requests.length, 1)
  assert.equal(f.requests[0].token, 'synthetic-login-one')
  assert.deepEqual(f.counts(), { authReads: 1, prepares: 1 })
})
