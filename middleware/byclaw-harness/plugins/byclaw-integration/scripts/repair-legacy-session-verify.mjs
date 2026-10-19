import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeZstdJsonlArtifact,
  decodeZstdJsonlLines,
  encodeZstdJsonlArtifact,
  encodeZstdJsonlLines,
  repairLegacySessionArtifact,
} from '../lib/index.js'

const directory = await mkdtemp(join(tmpdir(), 'byclaw-session-repair-'))
const artifact = join(directory, 'session.jsonl.zstd')
const records = [
  { type: 'session', version: 1, id: 'legacy-root', createdAt: 1, cwd: '/workspace/byclaw', delegationDepth: 0 },
  { seq: 0, id: 'event-0', timestamp: 2, type: 'user/message', data: { content: [] } },
  { seq: 1, id: 'event-1', timestamp: 3, type: 'byclaw/session-workspace', data: { externalSessionId: 'legacy-root', cwd: '/workspace/byclaw' } },
  { seq: 2, id: 'event-2', timestamp: 4, type: 'byclaw/root-binding', data: { kind: 'main' } },
  { seq: 3, id: 'event-3', timestamp: 5, type: 'byclaw/unknown', data: { keep: true } },
]
const original = await encodeZstdJsonlArtifact(records)
await writeFile(artifact, original)

const dryRun = await repairLegacySessionArtifact(artifact)
assert.deepEqual(dryRun, {
  path: artifact,
  scannedEvents: 4,
  changedEvents: 2,
  applied: false,
})
assert.deepEqual(await readFile(artifact), original)

const applied = await repairLegacySessionArtifact(artifact, { apply: true })
assert.equal(applied.applied, true)
assert.equal(applied.changedEvents, 2)
assert.equal(typeof applied.backupPath, 'string')
assert.deepEqual(await readFile(applied.backupPath), original)

const repaired = await decodeZstdJsonlArtifact(await readFile(artifact))
assert.deepEqual(repaired[0], records[0])
assert.equal(repaired[1].ignorable, undefined)
assert.equal(repaired[2].ignorable, true)
assert.equal(repaired[3].ignorable, true)
assert.deepEqual(repaired[4], records[4])
assert.deepEqual(repaired.map(record => record.seq), records.map(record => record.seq))

const second = await repairLegacySessionArtifact(artifact, { apply: true })
assert.deepEqual(second, {
  path: artifact,
  scannedEvents: 4,
  changedEvents: 0,
  applied: false,
})

const corrupt = join(directory, 'corrupt.jsonl.zstd')
const corruptBytes = Buffer.from('not a zstandard stream')
await writeFile(corrupt, corruptBytes)
await assert.rejects(repairLegacySessionArtifact(corrupt, { apply: true }), /corrupt Zstandard session log/u)
assert.deepEqual(await readFile(corrupt), corruptBytes)

const losslessArtifact = join(directory, 'lossless.jsonl.zstd')
const losslessLines = [
  '{"type":"session","version":1,"id":"lossless","createdAt":1,"delegationDepth":0}',
  '{"seq":0,"id":"event-0","timestamp":2,"type":"byclaw/session-workspace","data":{"externalSessionId":"lossless","cwd":"/workspace","unsafe":9007199254740993,"exponent":1e+30,"escaped":"\\u4f60"}}',
  '{"seq":1,"id":"event-1","timestamp":3,"type":"other/event","data":{"unsafe":9007199254740993}}',
]
await writeFile(losslessArtifact, await encodeZstdJsonlLines(losslessLines))
await repairLegacySessionArtifact(losslessArtifact, { apply: true })
const repairedLines = await decodeZstdJsonlLines(await readFile(losslessArtifact))
assert.equal(
  repairedLines[1],
  losslessLines[1].replace(/\}$/u, ',"ignorable":true}'),
)
assert.equal(repairedLines[2], losslessLines[2])

console.info('ByClaw legacy session repair verification passed')
