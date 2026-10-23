/** Exercise the plugin's real runner construction without Redis, DSH, or a model. */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

// An explicit module path also verifies compatibility with a locally built framework.
const frameworkUrl = process.argv[2] && pathToFileURL(process.argv[2]).href
const runtimeUrl = new URL('../src/worker-runtime.ts', import.meta.url).href
const workerStub = 'data:text/javascript,' + encodeURIComponent(`
  export class ByClawDshGatewayWorker {
    constructor(options) { Object.assign(this, options) }
    getAgentTypes() { return this.agentTypes }
    async handleMessage() { throw new Error('unexpected gateway dispatch') }
  }
`)
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './worker.ts' && context.parentURL === runtimeUrl) {
      return { url: workerStub, shortCircuit: true }
    }
    if (specifier === '@byclaw/by-framework' && frameworkUrl) {
      return next(frameworkUrl, context)
    }
    return next(specifier, context)
  },
})

const { WorkerRunner, WorkerRegistry } = await import('@byclaw/by-framework')
const { ByClawDshWorkerRuntime } = await import(runtimeUrl)
const original = {
  initialize: WorkerRunner.prototype.initialize,
  release: WorkerRunner.prototype.release,
  poll: WorkerRunner.prototype.poll,
  processAndAck: WorkerRunner.prototype.processAndAck,
  isWorkerOnline: WorkerRegistry.prototype.isWorkerOnline,
}
let releaseTasks
const waiting = new Promise(resolve => { releaseTasks = resolve })
let releasePoll
const polling = new Promise(resolve => { releasePoll = resolve })
let polls = 0
let started = 0
let resumed = false
let drained = false
WorkerRunner.prototype.initialize = async () => {}
WorkerRunner.prototype.release = async () => { drained = true }
WorkerRegistry.prototype.isWorkerOnline = async () => true
WorkerRunner.prototype.poll = async function () {
  polls++
  if (polls === 1) return Array.from({ length: 64 }, (_, i) => ({
    streamName: 'probe', msgId: String(i), data: { actionType: 'ASK_AGENT' },
  }))
  if (polls === 2) return [{ streamName: 'probe', msgId: 'reply', data: { actionType: 'RESUME' } }]
  await polling
  return []
}
WorkerRunner.prototype.processAndAck = async (_stream, _message, command) => {
  if (command.actionType === 'RESUME') resumed = true
  else { started++; await waiting }
}
const runtime = new ByClawDshWorkerRuntime({
  redis: {}, workerId: 'unbounded-probe', agentTypes: ['probe'], sessions: {},
  // Legacy callers must not reintroduce the removed plugin limit.
  maxConcurrency: 8,
})
try {
  await runtime.start('unbounded-probe')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(started, 64, 'plugin must admit more than both the old 8 and framework default 50')
  assert.equal(resumed, true, 'waiting requests must not block later Resume dispatch')
  const closing = runtime.close()
  releasePoll()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(drained, false, 'close must wait for unfinished messages')
  releaseTasks()
  await closing
  assert.equal(drained, true)
  console.log('Worker admission and shutdown verification passed')
} finally {
  const closing = runtime.close()
  releaseTasks()
  releasePoll()
  await closing
  Object.assign(WorkerRunner.prototype, {
    initialize: original.initialize, release: original.release,
    poll: original.poll, processAndAck: original.processAndAck,
  })
  WorkerRegistry.prototype.isWorkerOnline = original.isWorkerOnline
  hooks.deregister()
}
