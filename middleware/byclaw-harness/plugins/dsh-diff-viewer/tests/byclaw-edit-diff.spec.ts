import { describe, expect, it } from 'vitest'
import {
  buildByClawEditDiffEvent,
  callTimeDiffs,
  type ByClawEditDiffInput,
} from '../src/byclaw-edit-diff.ts'

const event = (input: Partial<ByClawEditDiffInput> = {}) => buildByClawEditDiffEvent({
  eventId: 'call-1',
  phase: 'running',
  operation: 'edit',
  sessionId: 'session-1',
  argsRaw: JSON.stringify({ file_path: 'src/a.ts', old_string: 'const a = 1\n', new_string: 'const a = 2\n' }),
  ...input,
})

describe('ByClaw edit-diff protocol', () => {
  it('maps a running edit call to the versioned wire event', () => {
    expect(event()).toEqual({
      type: 'edit_diff',
      schemaVersion: 1,
      eventId: 'call-1',
      phase: 'running',
      operation: 'edit',
      sessionId: 'session-1',
      files: [{
        path: 'src/a.ts',
        changeType: 'modified',
        oldText: 'const a = 1\n',
        newText: 'const a = 2\n',
        additions: 1,
        deletions: 1,
        binary: false,
      }],
    })
  })

  it('uses applied result diffs in preference to call arguments', () => {
    expect(event({
      phase: 'applied',
      diffs: [{ path: 'src/a.ts', oldText: 'one\n', newText: 'one\ntwo\n' }],
    })?.files[0]).toMatchObject({ additions: 1, deletions: 0, newText: 'one\ntwo\n' })
  })

  it('maps write and deletion shapes and rejects unrelated tools', () => {
    expect(callTimeDiffs('write', JSON.stringify({ file_path: 'new.txt', content: 'hello\n' }))).toEqual([
      { path: 'new.txt', oldText: null, newText: 'hello\n' },
    ])
    expect(buildByClawEditDiffEvent({
      eventId: 'call-2', phase: 'applied', operation: 'git', sessionId: 'session-1',
      diffs: [{ path: 'gone.txt', oldText: 'bye\n', newText: null }],
    })?.files[0]).toMatchObject({ changeType: 'deleted', additions: 0, deletions: 1 })
    expect(callTimeDiffs('read', '{}')).toBeNull()
  })

  it('keeps a failed card without treating it as an applied file mutation', () => {
    expect(event({ phase: 'failed', error: 'old_string not found' })).toMatchObject({
      phase: 'failed',
      error: 'old_string not found',
    })
  })
})
