import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeCodingDiagnostic } from '../src/coding-diagnostics.ts'

test('diagnostics retain the specific cause and supplied code instead of only a category', () => {
  const cause = 'stream disconnected before completion: connection reset by peer (os error 104)'
  const diagnostic = summarizeCodingDiagnostic(`Reconnecting... 1/5 (${cause})`, 'ECONNRESET')
  assert.equal(diagnostic.message, `Reconnecting... 1/5 (${cause})`)
  assert.equal(diagnostic.errorCode, 'ECONNRESET')
  assert.equal(diagnostic.category, 'network')
  assert.equal(diagnostic.messageTruncated, undefined)
  assert.equal(summarizeCodingDiagnostic('HTTP 429 quota exhausted', 429).errorCode, '429')
  assert.equal(summarizeCodingDiagnostic('upstream closed the stream').errorCode, undefined, 'never invent an absent code')
  assert.equal(summarizeCodingDiagnostic('', 'INVALID_REQUEST').errorCode, 'INVALID_REQUEST')
  assert.equal(summarizeCodingDiagnostic(''), undefined)
})

test('error evidence redacts credentials, headers and URLs while retaining the cause', () => {
  const secrets = ['user-secret', 'url-secret', 'bearer-secret', 'basic-secret', 'cookie-secret', 'header-secret',
    'auth-secret', 'flag-secret', 'private-key-body', 'sk-abcdefghijklmnopqrstuv']
  const diagnostic = summarizeCodingDiagnostic([
    'stream disconnected before completion: certificate verify failed',
    'https://user-secret:url-secret@internal.example/responses?signature=url-secret',
    'wss://internal.example/?key=url-secret',
    'Bearer bearer-secret Basic basic-secret',
    'Authorization: Basic header-secret',
    'Cookie: session=cookie-secret; other=header-secret',
    'Set-Cookie: session=cookie-secret',
    'CODEX_AUTH="auth-secret" --api-key flag-secret',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-key-body\n-----END OPENSSH PRIVATE KEY-----',
    'sk-abcdefghijklmnopqrstuv',
  ].join('\n'), 'TLS_CERTIFICATE_VERIFY_FAILED')
  assert.ok(diagnostic.message.includes('certificate verify failed'))
  assert.equal(diagnostic.errorCode, 'TLS_CERTIFICATE_VERIFY_FAILED')
  const serialized = JSON.stringify(diagnostic)
  for (const secret of secrets) assert.ok(!serialized.includes(secret), secret)
  assert.ok(!serialized.includes('internal.example'))
  assert.equal(summarizeCodingDiagnostic('failure', 'sk-abcdefghijklmnopqrstuv').errorCode, undefined)
})

test('messages are bounded after redaction and unknown errors still retain evidence', () => {
  const unknown = summarizeCodingDiagnostic('deployment helper rejected unsupported runtime')
  assert.equal(unknown.category, 'unknown')
  assert.equal(unknown.message, 'deployment helper rejected unsupported runtime')
  const long = summarizeCodingDiagnostic('upstream refused: ' + 'x'.repeat(2050) + '\n-----BEGIN PRIVATE KEY-----\nsecret-tail')
  assert.equal(long.message.length, 2048)
  assert.equal(long.messageTruncated, true)
  assert.ok(!long.message.includes('secret-tail'))
  assert.equal(summarizeCodingDiagnostic('failure', { secret: 'must-not-serialize' }).errorCode, undefined)
})
