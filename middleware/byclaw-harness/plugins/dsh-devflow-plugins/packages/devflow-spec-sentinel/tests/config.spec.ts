// Misconfiguration fails loud at load: the deployment-varying values are the
// headless spec root and the index's byte ceiling. A blank root would
// silently point every headless evaluation at the filesystem root's parent
// of nothing, and a non-positive ceiling would silently blank the index.
import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '@zhchxiao123/dsh-devflow-spec-sentinel'

describe('resolveConfig', () => {
  it('fills the defaults', () => {
    expect(resolveConfig({})).toEqual({ root: '.devflow/spec', contextMaxBytes: 2048 })
  })

  it('keeps explicit values', () => {
    expect(resolveConfig({ root: '/etc/spec', contextMaxBytes: 512 })).toEqual({ root: '/etc/spec', contextMaxBytes: 512 })
  })

  it('rejects a blank root', () => {
    expect(() => resolveConfig({ root: '  ' })).toThrow(/root must be a non-empty path/)
  })

  it.each([[0], [-1], [1.5]])('rejects contextMaxBytes %s', (contextMaxBytes) => {
    expect(() => resolveConfig({ contextMaxBytes })).toThrow(/contextMaxBytes must be a positive integer/)
  })

  it('is enforced by the schemastery validator at load as well', () => {
    expect(() => new Config({ contextMaxBytes: 0 })).toThrow()
    expect(() => new Config({ contextMaxBytes: -5 })).toThrow()
    expect(new Config({}).contextMaxBytes).toBe(2048)
  })
})
