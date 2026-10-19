/** Regression verification for the upstream worker saturation health contract. */

import assert from 'node:assert/strict'
import { WorkerRunner } from '@byclaw/by-framework'

const runner = new WorkerRunner({
  workerId: 'saturated-health-probe',
  getAgentTypes: () => ['probe'],
  handleMessage: async () => undefined,
  registry: {},
  heartbeatLeaseTtlSeconds: 15,
}, {
  redisClient: {},
  maxConcurrency: 2,
})

runner.lastConsumerTick = Date.now() - 60_000
runner.lastRenewOkAt = Date.now()
runner.inFlight = new Set([Promise.resolve(), Promise.resolve()])

assert.equal(
  runner.isHealthy(),
  true,
  'a saturated worker with long-running tasks must remain healthy',
)
