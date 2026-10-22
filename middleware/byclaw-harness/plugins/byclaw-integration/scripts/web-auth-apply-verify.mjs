/** Plugin activation wiring for the explicit no-auth Web mode. */

import assert from 'node:assert/strict'
import { apply, BYCLAW_DSH_WEB_AUTH_ENABLED_ENV, BYCLAW_DSH_WEB_AUTH_TOKEN_ENV } from '../src/index.ts'

const previousEnabled = process.env[BYCLAW_DSH_WEB_AUTH_ENABLED_ENV]
const previousToken = process.env[BYCLAW_DSH_WEB_AUTH_TOKEN_ENV]
const previousUserCode = process.env.USER_CODE
process.env[BYCLAW_DSH_WEB_AUTH_ENABLED_ENV] = 'false'
process.env[BYCLAW_DSH_WEB_AUTH_TOKEN_ENV] = 'must-not-be-used'
delete process.env.USER_CODE
const errors = []

let dispose = () => undefined
const rootEffects = []
let searchGuard
const connection = {
  authenticatedUrl(baseUrl) {
    const url = new URL(baseUrl)
    url.pathname = '/'
    url.searchParams.set('token', 'internal-random-token')
    return url.href
  },
  authorizeIndex(_request, response) {
    response.status = 401
    return false
  },
  requestRejection(request) {
    return request.headers.host === '192.168.20.8:3080' ? 401 : 403
  },
}

try {
  await apply({
    effect(factory) { rootEffects.push(factory()) },
    tools: { guard(check) { searchGuard = check; return () => { searchGuard = undefined } } },
    logger: {
      // Startup phases log at info level before the userCode check.
      info() {},
      error(message) { errors.push(message) },
    },
    inject(services, callback) {
      assert.deepEqual(services, ['connection'])
      callback({
        connection,
        effect(factory) {
          dispose = factory()
        },
      })
    },
  }, { enabled: true })

  assert.match(searchGuard({ name: 'web_search' }), /disabled by ByClaw policy/u, 'default web search must be guarded before startup')
  assert.equal(searchGuard({ name: 'bash' }), undefined)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /requires config\.userCode or USER_CODE/u)

  assert.equal(connection.authenticatedUrl('http://192.168.20.8:3080'), 'http://192.168.20.8:3080/')
  const response = {}
  assert.equal(connection.authorizeIndex({
    method: 'GET',
    url: '/',
    headers: { host: '192.168.20.8:3080' },
  }, response), true)
  assert.equal(response.status, undefined)
  assert.equal(connection.requestRejection({
    headers: { host: '192.168.20.8:3080', origin: 'http://192.168.20.8:3080' },
  }), undefined)
  assert.equal(connection.requestRejection({
    headers: { host: 'attacker.invalid', origin: 'http://attacker.invalid' },
  }), 403)
} finally {
  dispose()
  for (const release of rootEffects.reverse()) release?.()
  if (previousEnabled === undefined) delete process.env[BYCLAW_DSH_WEB_AUTH_ENABLED_ENV]
  else process.env[BYCLAW_DSH_WEB_AUTH_ENABLED_ENV] = previousEnabled
  if (previousToken === undefined) delete process.env[BYCLAW_DSH_WEB_AUTH_TOKEN_ENV]
  else process.env[BYCLAW_DSH_WEB_AUTH_TOKEN_ENV] = previousToken
  if (previousUserCode === undefined) delete process.env.USER_CODE
  else process.env.USER_CODE = previousUserCode
}

console.log('ByClaw Web authentication activation checks passed')
