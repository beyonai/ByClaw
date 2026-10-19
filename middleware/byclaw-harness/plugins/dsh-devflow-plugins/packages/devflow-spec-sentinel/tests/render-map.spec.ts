// The spec index's text as a pure function: two layers under one header,
// stale anchor hits surfaced first with their failing anchors, no body
// anywhere, and a byte cap that eats the broad layer before the sharp one
// and always announces what it ate.
import { describe, expect, it } from 'vitest'
import { renderSpecMap } from '../src/render-map.ts'
import type { AnchorHitEntry, ScopeDocEntry } from '../src/types.ts'

const STALE_HIT: AnchorHitEntry = {
  id: '@scope/pkg/backend/edges',
  freshness: 'stale',
  files: ['src/stages.ts'],
  failingAnchorIds: ['a1', 'a2'],
}
const FRESH_HIT: AnchorHitEntry = {
  id: '@scope/pkg/backend/terms',
  freshness: 'fresh',
  files: ['src/terms.ts', 'src/stages.ts'],
  failingAnchorIds: [],
}
const SCOPE_DOC: ScopeDocEntry = { id: '@scope/pkg/frontend/layout', title: 'Layout rules', freshness: 'fresh' }

describe('renderSpecMap', () => {
  it('renders both layers under the header, stale hits first, without bodies', () => {
    const text = renderSpecMap([FRESH_HIT, STALE_HIT], [SCOPE_DOC], 2048)
    expect(text).toBe([
      'Spec documents for files this session touched — read one with devflow_read_spec before relying on what it covers; stale means check it against the code first:',
      '- @scope/pkg/backend/edges (stale: a1, a2) anchors src/stages.ts',
      '- @scope/pkg/backend/terms (fresh) anchors src/terms.ts, src/stages.ts',
      '- @scope/pkg/frontend/layout (fresh) Layout rules',
    ].join('\n'))
  })

  it('renders a stale hit whose failing anchors are unknown, and an unevaluable hit, by freshness alone', () => {
    const text = renderSpecMap([
      { ...STALE_HIT, failingAnchorIds: [] },
      { ...FRESH_HIT, freshness: 'unevaluable' },
    ], [], 2048)
    expect(text).toContain('- @scope/pkg/backend/edges (stale) anchors src/stages.ts')
    expect(text).toContain('- @scope/pkg/backend/terms (unevaluable) anchors src/terms.ts, src/stages.ts')
  })

  it('returns the empty string when there is nothing to say', () => {
    expect(renderSpecMap([], [], 2048)).toBe('')
  })

  it('breaks {{ }} pairs in document-derived text', () => {
    const text = renderSpecMap([], [{ id: '@scope/pkg/a', title: 'uses {{handlebars}} syntax', freshness: 'fresh' }], 2048)
    expect(text).toContain('uses { {handlebars} } syntax')
    expect(text).not.toContain('{{')
  })

  it('drops scope lines from the end first when over the cap, and announces the drop', () => {
    const scopeDocs: ScopeDocEntry[] = Array.from({ length: 6 }, (_, index) => ({
      id: `@scope/pkg/doc-${String(index)}`,
      title: `Document ${String(index)}`,
      freshness: 'fresh' as const,
    }))
    const full = renderSpecMap([STALE_HIT], scopeDocs, 4096)
    const capped = renderSpecMap([STALE_HIT], scopeDocs, 400)

    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(400)
    // The sharp layer survived; the broad layer was eaten from the end.
    expect(capped).toContain('(stale: a1, a2)')
    expect(capped).toContain('@scope/pkg/doc-0')
    expect(capped).not.toContain('@scope/pkg/doc-5')
    expect(capped).toMatch(/\(spec index truncated: \d+ more document\(s\); over the 400-byte cap\.\)/)
    expect(full).not.toContain('truncated')
  })

  it('eats anchor lines only after the scope layer is gone, and stops at the header', () => {
    const hits: AnchorHitEntry[] = [STALE_HIT, FRESH_HIT]
    const capped = renderSpecMap(hits, [SCOPE_DOC], 300)
    expect(capped).not.toContain('@scope/pkg/frontend/layout')
    expect(capped).toContain('(stale: a1, a2)')
    expect(capped).not.toContain('@scope/pkg/backend/terms')
    expect(capped).toContain('truncated: 2 more document(s)')

    // A cap smaller than the header still renders the header and the
    // truncation notice — the cap governs document lines, never honesty.
    const floor = renderSpecMap(hits, [SCOPE_DOC], 1)
    expect(floor).toContain('Spec documents for files this session touched')
    expect(floor).toContain('truncated: 3 more document(s)')
  })
})
