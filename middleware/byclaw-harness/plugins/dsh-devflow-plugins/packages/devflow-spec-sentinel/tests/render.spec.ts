// The one interruption's text as a pure function: every failing anchor named
// with its location, all four triage exits present, and the told-once promise
// closing the message.
import { describe, expect, it } from 'vitest'
import { renderStaleNotice } from '../src/render.ts'

describe('renderStaleNotice', () => {
  it('names each document, its failing anchors, the four exits, and the told-once promise', () => {
    const text = renderStaleNotice([
      {
        id: '@scope/pkg/backend/edges',
        anchors: [
          { id: 'a1', kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal', reason: 'symbol isLegal is no longer declared in src/stages.ts' },
          { id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'TERMINAL', reason: 'normalized body hash changed' },
        ],
      },
      {
        id: 'guides/layout',
        anchors: [{ id: 'files', kind: 'symbol', file: 'src/layout.ts', reason: 'symbol gone' }],
      },
    ])

    expect(text).toContain('made the following architecture document(s) stale')
    expect(text).toContain('[@scope/pkg/backend/edges]')
    expect(text).toContain('  - anchor a1 (symbol) on src/stages.ts#isLegal: symbol isLegal is no longer declared in src/stages.ts')
    expect(text).toContain('  - anchor a2 (content-hash) on src/stages.ts#TERMINAL: normalized body hash changed')
    expect(text).toContain('[guides/layout]')
    // A reference without a symbol renders the file alone, no dangling '#'.
    expect(text).toContain('  - anchor files (symbol) on src/layout.ts: symbol gone')

    expect(text).toContain('devflow_read_spec')
    expect(text).toContain('devflow_write_spec with `replaces: [<same id>]`')
    expect(text).toContain('The document was wrong even before this change')
    expect(text).toContain('merge or retire it by naming its id')
    expect(text).toContain('The work is not settled yet')
    expect(text).toContain('This session will not interrupt you again over these documents.')
  })
})
