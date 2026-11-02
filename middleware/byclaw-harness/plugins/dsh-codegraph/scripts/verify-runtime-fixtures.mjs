import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const verifier = fileURLToPath(new URL('./verify.mjs', import.meta.url))
const fakeCodeGraph = fileURLToPath(new URL('./fixtures/fake-codegraph.mjs', import.meta.url))

async function verify(overrides = {}) {
  return execFileAsync(process.execPath, [verifier, '--runtime'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CODEGRAPH_COMMAND: fakeCodeGraph,
      CODEGRAPH_MCP_TOOLS: 'status',
      ...overrides,
    },
  })
}

const configured = await verify()
assert.match(configured.stdout, /plugin verification passed/u)

await assert.rejects(
  verify({ FAKE_CODEGRAPH_IGNORE_CONFIG: '1' }),
  error => error.stderr.includes('codegraph_status') && error.stderr.includes('codegraph_explore'),
)
await assert.rejects(
  verify({ FAKE_CODEGRAPH_VERSION: '0.9.4' }),
  error => error.stderr.includes("'0.9.4' !== '1.6.0'"),
)

console.info('ByClaw CodeGraph runtime verifier fixtures passed')
