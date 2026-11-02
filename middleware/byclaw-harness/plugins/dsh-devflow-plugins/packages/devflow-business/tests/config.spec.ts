// Config resolution reads its argument as `unknown` on purpose: a schemastery
// `z.object` leaves every property optional, so the declared type admits `{}`,
// `null`, and a half-filled object alike. A misconfiguration has to fail at
// load rather than reach disk as a surprising root.
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-business'

describe('resolveConfig', () => {
  it('defaults the root under .devflow so one guard covers every devflow state', () => {
    expect(resolveConfig({}).root).toBe('.devflow/business')
    expect(resolveConfig(undefined).root).toBe('.devflow/business')
    expect(resolveConfig(null).root).toBe('.devflow/business')
  })

  it('keeps a declared root', () => {
    expect(resolveConfig({ root: 'knowledge/domain' }).root).toBe('knowledge/domain')
  })

  it('fails loud on a root that is present but unusable', () => {
    expect(() => resolveConfig({ root: '   ' })).toThrow('non-empty path')
    expect(() => resolveConfig({ root: 42 })).toThrow('must be a string path')
  })
})
