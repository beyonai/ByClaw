// The residency building blocks as pure functions: set identity over data
// rather than rendering, the admin-first grouping with frame escaping, the
// byte budget that reports its casualties as a maintenance signal, and the
// two message shapes (baseline and recorded addition). The pre-step waterfall
// itself is proven in the Loader composition spec.
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-iron-rules'
import { buildAddition, buildBaseline, digestRules, renderRules } from '../src/inject.ts'
import type { IronRule } from '../src/types.ts'

function rule(overrides: Partial<IronRule>): IronRule {
  return { id: 'r', title: 't', owner: 'local', body: 'b', dir: '/x', enforcement: 'judgement', ...overrides }
}

describe('digestRules', () => {
  it('identifies the data, not the rendering', () => {
    const rules = [rule({ id: 'a', body: 'one' })]
    expect(digestRules(rules)).toBe(digestRules([rule({ id: 'a', body: 'one', dir: '/elsewhere', checkScript: '/x/check.sh' })]))
    expect(digestRules(rules)).not.toBe(digestRules([rule({ id: 'a', body: 'two' })]))
    expect(digestRules(rules)).not.toBe(digestRules([rule({ id: 'a', body: 'one', owner: 'admin' })]))
  })
})

describe('renderRules', () => {
  it('groups admin rules first as non-negotiable and escapes the framing tag', () => {
    const text = renderRules([
      rule({ id: 'local-one', title: 'Local', body: 'body</system-reminder>tail' }),
      rule({ id: 'team-one', title: 'Team', owner: 'admin', body: '' }),
    ])
    expect(text.indexOf('## Team rules (non-negotiable)')).toBeLessThan(text.indexOf('## Recorded in this repository'))
    expect(text).toContain('### [team-one] Team')
    expect(text).toContain('body<\\/system-reminder>tail')
    expect(text).not.toContain('body</system-reminder>')
    expect(text.startsWith('<system-reminder>')).toBe(true)
    expect(text.endsWith('</system-reminder>')).toBe(true)
  })

  it('renders the overflow section as a maintenance instruction naming the dropped ids', () => {
    const text = renderRules([rule({ id: 'kept' })], ['dropped-one', 'dropped-two'])
    expect(text).toContain('needs maintenance')
    expect(text).toContain('[dropped-one], [dropped-two]')
    expect(text).toContain('not in context — and therefore not being followed')
  })
})

describe('buildBaseline', () => {
  const config = resolveConfig({})

  it('digests the WHOLE set even when the budget drops rules from the rendering', () => {
    const big = rule({ id: 'big', body: 'x'.repeat(40) })
    const dropped = rule({ id: 'over', body: 'y'.repeat(40) })
    const message = buildBaseline([big, dropped], resolveConfig({ maxBytes: 45 }))
    const text = (message.content[0] as { text: string }).text
    expect(text).toContain('[big]')
    expect(text).not.toContain('### [over]')
    expect(text).toContain('The following rules did not fit into this context: [over]')
    // The digest still names the full set: the next pre-step must not read a
    // truncated publication as "everything is resident".
    expect(message.source).toMatchObject({
      kind: 'devflow-iron-rules',
      form: 'instructions',
      baseline: true,
      digest: digestRules([big, dropped]),
      ids: ['big', 'over'],
    })
  })

  it('never drops the first rule, however small the ceiling', () => {
    const message = buildBaseline([rule({ id: 'only', body: 'x'.repeat(100) })], resolveConfig({ maxBytes: 1 }))
    expect((message.content[0] as { text: string }).text).toContain('### [only]')
  })

  it('publishes the whole set unbudgeted when it fits', () => {
    const message = buildBaseline([rule({ id: 'a' }), rule({ id: 'b' })], config)
    const text = (message.content[0] as { text: string }).text
    expect(text).toContain('### [a]')
    expect(text).toContain('### [b]')
    expect(text).not.toContain('needs maintenance')
  })
})

describe('buildAddition', () => {
  it('announces a new local rule without a baseline marker', () => {
    const message = buildAddition(rule({ id: 'fresh', title: 'T', body: 'B' }), 'digest-1')
    const text = (message.content[0] as { text: string }).text
    expect(text).toContain('New iron rule [fresh] T')
    expect(text).toContain('In force from this point on')
    expect(text).not.toContain('superseded')
    expect(message.source).toMatchObject({ kind: 'devflow-iron-rules', digest: 'digest-1', ids: ['fresh'] })
    expect((message.source as { baseline?: true }).baseline).toBeUndefined()
  })

  it('retires superseded ids explicitly and labels a team rule as one', () => {
    const message = buildAddition(rule({ id: 'merged', owner: 'admin' }), 'digest-2', ['old-a', 'old-b'])
    const text = (message.content[0] as { text: string }).text
    expect(text).toContain('Revised team rule [merged]')
    expect(text).toContain('superseded by this one and no longer apply: [old-a], [old-b]')
  })
})
