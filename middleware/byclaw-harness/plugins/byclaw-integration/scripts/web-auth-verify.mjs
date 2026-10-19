/** Fixed public launch-token adapter verification. */

import assert from 'node:assert/strict'
import * as WebAuth from '../src/web-auth.ts'
import {
  BYCLAW_DSH_WEB_AUTH_ENABLED_ENV,
  BYCLAW_DSH_WEB_AUTH_TOKEN_ENV,
  overrideByClawWebAuthToken,
  resolveByClawWebAuthToken,
} from '../src/web-auth.ts'

assert.equal(resolveByClawWebAuthToken({
  [BYCLAW_DSH_WEB_AUTH_TOKEN_ENV]: 'fixed-token',
}), 'fixed-token')
assert.equal(resolveByClawWebAuthToken({
  [BYCLAW_DSH_WEB_AUTH_ENABLED_ENV]: 'true',
  [BYCLAW_DSH_WEB_AUTH_TOKEN_ENV]: 'fixed-token',
}), 'fixed-token')
assert.equal(resolveByClawWebAuthToken({
  [BYCLAW_DSH_WEB_AUTH_ENABLED_ENV]: 'false',
  [BYCLAW_DSH_WEB_AUTH_TOKEN_ENV]: 'fixed-token',
}), false)
assert.throws(() => resolveByClawWebAuthToken({
  [BYCLAW_DSH_WEB_AUTH_ENABLED_ENV]: 'sometimes',
  [BYCLAW_DSH_WEB_AUTH_TOKEN_ENV]: 'fixed-token',
}), /must be true\/false, 1\/0, on\/off, or yes\/no/u)

const calls = []
const connection = {
  authenticatedUrl(baseUrl) {
    const url = new URL(baseUrl)
    url.pathname = '/'
    url.searchParams.set('token', 'internal-random-token')
    return url.href
  },
  authorizeIndex(request, response) {
    calls.push(request.url)
    response.status = request.url === '/?token=internal-random-token' ? 303 : 401
    return false
  },
  requestRejection(request) {
    return request.headers.host === '192.0.2.10:3080' ? 401 : 403
  },
}
const originalAuthenticatedUrl = connection.authenticatedUrl
const originalAuthorizeIndex = connection.authorizeIndex
const originalRequestRejection = connection.requestRejection

const dispose = overrideByClawWebAuthToken(connection, 'ztesoft')
assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080'), 'http://127.0.0.1:3080/?token=ztesoft')

const accepted = {}
assert.equal(connection.authorizeIndex({
  method: 'GET',
  url: '/?token=ztesoft',
  headers: { host: '127.0.0.1:3080' },
}, accepted), false)
assert.equal(accepted.status, 303)
assert.equal(calls.at(-1), '/?token=internal-random-token')

const rejected = {}
connection.authorizeIndex({
  method: 'GET',
  url: '/?token=wrong',
  headers: { host: '127.0.0.1:3080' },
}, rejected)
assert.equal(rejected.status, 401)
assert.equal(calls.at(-1), '/?token=wrong')

const duplicate = {}
connection.authorizeIndex({
  method: 'GET',
  url: '/?token=ztesoft&token=ztesoft',
  headers: { host: '127.0.0.1:3080' },
}, duplicate)
assert.equal(duplicate.status, 401)

dispose()
assert.equal(connection.authenticatedUrl('http://127.0.0.1:3080'), 'http://127.0.0.1:3080/?token=internal-random-token')

const stackedAuthorize = connection.authorizeIndex
connection.authorizeIndex = function wrappedAuthorize(request, response) {
  return stackedAuthorize.call(this, request, response)
}
const reload = overrideByClawWebAuthToken(connection, 'rotated-token')
const rotated = {}
connection.authorizeIndex({ method: 'GET', url: '/?token=rotated-token', headers: {} }, rotated)
assert.equal(rotated.status, 303)
reload()
const afterUnload = {}
connection.authorizeIndex({ method: 'GET', url: '/?token=rotated-token', headers: {} }, afterUnload)
assert.equal(afterUnload.status, 401)

assert.notEqual(connection.authenticatedUrl, originalAuthenticatedUrl)
assert.notEqual(connection.authorizeIndex, originalAuthorizeIndex)

assert.throws(() => overrideByClawWebAuthToken(connection, ''), /non-empty/u)

const disableByClawWebAuthentication = WebAuth.disableByClawWebAuthentication
assert.equal(typeof disableByClawWebAuthentication, 'function', 'authentication bypass adapter is missing')
const restoreAuthentication = disableByClawWebAuthentication(connection)
assert.equal(connection.authenticatedUrl('http://192.0.2.10:3080'), 'http://192.0.2.10:3080/')
const unauthenticatedIndex = {}
assert.equal(connection.authorizeIndex({
  method: 'GET',
  url: '/',
  headers: { host: '192.0.2.10:3080' },
}, unauthenticatedIndex), true)
assert.equal(unauthenticatedIndex.status, undefined)
assert.equal(connection.requestRejection({
  headers: { host: '192.0.2.10:3080', origin: 'http://192.0.2.10:3080' },
}), undefined)
assert.equal(connection.requestRejection({
  headers: { host: 'attacker.invalid', origin: 'http://attacker.invalid' },
}), 403)

restoreAuthentication()
assert.equal(connection.authenticatedUrl('http://192.0.2.10:3080'), 'http://192.0.2.10:3080/?token=internal-random-token')
assert.equal(connection.requestRejection({ headers: { host: '192.0.2.10:3080' } }), 401)
assert.notEqual(connection.requestRejection, originalRequestRejection)
console.log('ByClaw Web auth-token adapter checks passed')
