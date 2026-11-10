/**
 * A turn the server starts (a scheduled chat) runs while the user is logged out: the login state has no
 * Beyond-Token, so resource authorization falls back to the token BE issued for the context.
 */
import assert from 'node:assert/strict'
import { resolveByClawAuthorization } from '../src/resource-authorization.ts'

function redis(loginAuth) {
  const store = new Map([
    ['SHARE_BFM_USER_CODE_u1', '42'],
  ])
  const hashes = new Map([
    ['USER:RESOURCES:AUTH:42', { 11220395: 'DIG_EMPLOYEE' }],
    ['user:42:login:auth', loginAuth],
  ])
  return {
    get: async key => store.get(key) ?? null,
    hgetall: async key => hashes.get(key) ?? {},
    exists: async key => (hashes.has(key) ? 1 : 0),
  }
}

// Logged in: the login state's token wins, the issued one is not even asked for.
let asked = 0
const loggedIn = await resolveByClawAuthorization(redis({ 'Beyond-Token': 'login-token', 'Sso-Token': 'sso' }), 'u1', () => { asked++; return 'issued' })
assert.equal(loggedIn.authHeaders['Beyond-Token'], 'login-token')
assert.equal(loggedIn.authHeaders['Sso-Token'], 'sso')
assert.equal(asked, 0)

// Logged out: the context's issued token stands in, and the user's grants are still read.
const loggedOut = await resolveByClawAuthorization(redis({}), 'u1', async () => ' issued-token ')
assert.equal(loggedOut.authHeaders['Beyond-Token'], 'issued-token')
assert.deepEqual(loggedOut.resourceIds, ['11220395'])

// Neither: the same error as before.
await assert.rejects(resolveByClawAuthorization(redis({}), 'u1', () => undefined), /Beyond-Token was not found for userCode u1/u)
await assert.rejects(resolveByClawAuthorization(redis({}), 'u1'), /Beyond-Token was not found for userCode u1/u)

console.log('scheduled-turn-token-verify: ok')
