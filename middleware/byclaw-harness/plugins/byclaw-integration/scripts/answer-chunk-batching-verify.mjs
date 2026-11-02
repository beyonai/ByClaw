import assert from 'node:assert/strict'
import { AnswerChunkBatcher, TimedChunkBatcher } from '../lib/session-runtime.js'

let now = 0
const timed = new TimedChunkBatcher(96, 80, () => now)
assert.equal(timed.append('root:timed:1', '短输出'), undefined)
assert.equal(timed.nextDelay(now), 80)
now = 79
assert.deepEqual(timed.takeDue(now), [])
assert.equal(timed.nextDelay(now), 1)
now = 80
assert.deepEqual(timed.takeDue(now), [['root:timed:1', '短输出']])
assert.equal(timed.nextDelay(now), undefined)

assert.equal(timed.append('root:threshold:1', 'x'.repeat(96)), 'x'.repeat(96))
assert.equal(timed.nextDelay(now), undefined, 'threshold flush must cancel its pending deadline')

assert.equal(timed.append('child:timed:1', '子会话输出'), undefined)
assert.equal(timed.flush('child:timed:1'), '子会话输出')
now = 160
assert.deepEqual(timed.takeDue(now), [], 'boundary flush must not leave a duplicate timer callback')

const batcher = new AnswerChunkBatcher(8)

assert.equal(batcher.append('root:1:1', '你'), undefined)
assert.equal(batcher.append('root:1:1', '好'), undefined)
assert.equal(batcher.append('root:1:1', '，这是'), undefined)
assert.equal(batcher.append('root:1:1', '批量输出'), '你好，这是批量输出')
assert.equal(batcher.flush('root:1:1'), undefined)

assert.equal(batcher.append('root:1:2', '剩余'), undefined)
assert.equal(batcher.flush('root:1:2'), '剩余')

assert.equal(batcher.append('child:1:1', '独立'), undefined)
assert.equal(batcher.append('root:1:3', '根会话'), undefined)
assert.deepEqual([...batcher.keys()].sort(), ['child:1:1', 'root:1:3'])
assert.equal(batcher.flush('child:1:1'), '独立')
assert.equal(batcher.flush('root:1:3'), '根会话')
assert.deepEqual([...batcher.keys()], [])

console.log('answer chunk batching verification passed')
