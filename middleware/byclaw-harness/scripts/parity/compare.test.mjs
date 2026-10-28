// The comparison of two probe outputs: one from a user's own sandbox, one from the
// shared DSH host's tool sandbox.
import assert from 'node:assert/strict'
import test from 'node:test'
import { compareProbes, parseProbe } from './compare.mjs'

const line = (check, ok, detail = '') => JSON.stringify({ check, ok, detail })

test('identical results are parity', () => {
  const output = [line('bycli-doctor', true), line('env', true, 'BEYOND_TOKEN REDIS_HOST USER_CODE')].join('\n')
  assert.deepEqual(compareProbes(parseProbe(output), parseProbe(output)), [])
})

test('a check that passes before the split and fails after it is a gap', () => {
  const before = parseProbe([line('bycli-doctor', true), line('kbcli', true)].join('\n'))
  const after = parseProbe([line('bycli-doctor', false, 'extension not connected'), line('kbcli', true)].join('\n'))
  assert.deepEqual(compareProbes(before, after), [{ check: 'bycli-doctor', before: 'ok', after: 'failed: extension not connected' }])
})

test('environment names compare as sets, ignoring session bookkeeping and the given names', () => {
  const before = parseProbe(line('env', true, 'BEYOND_TOKEN HOSTNAME OLDPWD REDIS_HOST GH_TOKEN USER_CODE'))
  const after = parseProbe(line('env', true, 'BEYOND_TOKEN SSH_CLIENT SSH_CONNECTION USER_CODE DWS_HOME LEAKED'))
  assert.deepEqual(compareProbes(before, after, { ignoreEnv: ['GH_TOKEN', 'DWS_HOME'] }), [
    { check: 'env', before: 'ok', after: 'missing: REDIS_HOST; extra: LEAKED' },
  ])
})

test('a check missing on one side is reported, and noise lines are skipped', () => {
  const before = parseProbe(`log noise\n${line('home-persistent', true)}\n${line('kbcli', true)}`)
  const after = parseProbe(line('kbcli', true))
  assert.deepEqual(compareProbes(before, after), [{ check: 'home-persistent', before: 'ok', after: 'not run' }])
})
