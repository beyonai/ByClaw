import assert from 'node:assert/strict'
import { mapConcurrent } from '../src/startup-concurrency.ts'
let active = 0, peak = 0
const result = await mapConcurrent([4, 3, 2, 1], 2, async n => {
  peak = Math.max(peak, ++active)
  await new Promise(resolve => setTimeout(resolve, n * 5))
  active--
  return n * 2
})
assert.equal(peak, 2)
assert.deepEqual(result, [8, 6, 4, 2])
let completed = false
await assert.rejects(mapConcurrent([0, 1], 2, async n => {
  if (n === 0) throw new Error('expected failure')
  await new Promise(resolve => setTimeout(resolve, 30))
  completed = true
}), /expected failure/)
assert(completed, 'all in-flight writes must settle before the staging directory is cleaned up')
await assert.rejects(mapConcurrent([1], 0, async n => n), /positive integer/)
console.log('startup concurrency verification passed')
