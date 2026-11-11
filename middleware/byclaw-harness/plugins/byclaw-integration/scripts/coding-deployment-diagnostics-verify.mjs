import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codingPublicText } from '../src/coding-diagnostics.ts'
import { CodexEventAdapter } from '../src/cli-event-adapter.ts'

test('public text and final answers redact complete and truncated SSH private keys', () => {
  for (const type of ['OPENSSH ', 'RSA ', 'EC ', '']) {
    const privateKey = `-----BEGIN ${type}PRIVATE KEY-----\nsynthetic-only\n-----END ${type}PRIVATE KEY-----`
    assert.equal(codingPublicText(privateKey), '[REDACTED SSH PRIVATE KEY]')
    assert.equal(codingPublicText(privateKey.split('-----END')[0]), '[REDACTED SSH PRIVATE KEY]')
    const adapter = new CodexEventAdapter(() => {})
    adapter.write([ { type: 'turn.started' }, { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: privateKey } }, { type: 'turn.completed' } ].map(x => JSON.stringify(x)).join('\n') + '\n')
    assert.equal(adapter.finish(0), '[REDACTED SSH PRIVATE KEY]')
  }
})
