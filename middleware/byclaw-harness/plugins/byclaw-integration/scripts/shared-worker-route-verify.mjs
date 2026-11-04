import assert from 'node:assert/strict'
import { isSafeSharedWorkerRouteRefresh } from '../src/shared-worker-route.ts'

const routes = generation => ({
  coordinator: `BYCLAW_DSH_SHARED_ctx_user_a_${generation}`,
  member: `BYCLAW_DSH_SHARED_ctx_user_a_${generation}`,
})

assert.equal(isSafeSharedWorkerRouteRefresh(routes(365), routes(366)), true)
assert.equal(isSafeSharedWorkerRouteRefresh(routes(12), routes(184)), true)
assert.equal(isSafeSharedWorkerRouteRefresh(routes(366), routes(366)), true)
assert.equal(isSafeSharedWorkerRouteRefresh(routes(366), routes(365)), false)
assert.equal(isSafeSharedWorkerRouteRefresh(routes(366), {
  coordinator: 'BYCLAW_DSH_SHARED_ctx_user_b_367',
  member: 'BYCLAW_DSH_SHARED_ctx_user_b_367',
}), false)
assert.equal(isSafeSharedWorkerRouteRefresh(routes(366), {
  coordinator: 'BYCLAW_DSH_SHARED_ctx_user_a_367',
  member: 'BYCLAW_EXE_other',
}), false)
assert.equal(isSafeSharedWorkerRouteRefresh(routes(366), {
  ...routes(367), unexpected: 'BYCLAW_DSH_SHARED_ctx_user_a_367',
}), false)

console.info('ByClaw shared worker route verification passed')
