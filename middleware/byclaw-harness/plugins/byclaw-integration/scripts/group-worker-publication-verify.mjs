/** Verify root publication authority is never forwarded to delegated worker requests. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'

// The payload projection is pure; load the source without unrelated worker SDK transports.
const source = await readFile(new URL('../src/group-worker.ts', import.meta.url), 'utf8')
const projection = source.slice(source.indexOf('export function externalWorkerPayload('), source.indexOf('/** Freeze only'))
const { externalWorkerPayload } = await import(`data:text/javascript,${encodeURIComponent(stripTypeScriptTypes(projection))}`)
const marker = { taskSessionId: '100', groupSessionId: '200', humanTaskId: '300' }
const payload = { groupPrivatePublication: marker, groupChat: { childSessionId: '100', conversationKey: '200' },
  humanTaskId: '300', tenantGroupTask: '100', api_key: 'fixture-only',
  extParams: { groupPrivatePublication: marker, humanTaskId: '300' } }
const child = externalWorkerPayload(payload, '400', 'model')
for (const key of ['groupPrivatePublication', 'groupChat', 'humanTaskId', 'tenantGroupTask']) {
  assert.equal(child[key], undefined)
  assert.equal(child.extParams[key], undefined)
}
assert.equal(child.agentId, '400')
assert.equal(child.model_id, 'model')
assert.equal(child.api_key, 'fixture-only')
assert.equal(payload.groupPrivatePublication, marker)
console.log('Private worker publication boundary: passed')
