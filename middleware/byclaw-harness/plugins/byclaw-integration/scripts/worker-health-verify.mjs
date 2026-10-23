/** Regression verification for worker health with uncapped task admission. */

import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const { WorkerRunner } = await import(process.argv[2]
  ? pathToFileURL(process.argv[2]).href
  : '@byclaw/by-framework')

const runner = new WorkerRunner({
  workerId: 'unbounded-health-probe',
  getAgentTypes: () => ['probe'],
  handleMessage: async () => undefined,
  registry: {},
  heartbeatLeaseTtlSeconds: 15,
}, {
  redisClient: {},
  maxConcurrency: Number.POSITIVE_INFINITY,
})

runner.lastConsumerTick = Date.now()
runner.lastRenewOkAt = Date.now()
runner.inFlight = new Set([Promise.resolve(), Promise.resolve()])

assert.equal(
  runner.isHealthy(),
  true,
  'unfinished tasks with a live consumer loop must remain healthy',
)

runner.lastConsumerTick = Date.now() - 60_000
assert.equal(runner.isHealthy(), false, 'unfinished tasks must not hide a stalled consumer loop')
