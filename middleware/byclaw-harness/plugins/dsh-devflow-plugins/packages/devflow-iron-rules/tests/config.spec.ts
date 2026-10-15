// Misconfiguration fails loud at load: every bound that would misbehave
// silently at zero or as a fraction is rejected by resolveConfig, and the
// defaults document themselves by being asserted here.
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-iron-rules'

describe('resolveConfig', () => {
  it('fills every default', () => {
    expect(resolveConfig({})).toEqual({
      root: '.devflow/iron-rules',
      maxBytes: 32_768,
      checkTimeoutMs: 120_000,
      checkOutputMaxChars: 2_000,
      maxRetries: 2,
    })
  })

  it('keeps explicit values', () => {
    expect(resolveConfig({
      root: '/tmp/rules',
      maxBytes: 1,
      checkTimeoutMs: 5,
      checkOutputMaxChars: 9,
      maxRetries: 0,
    })).toEqual({ root: '/tmp/rules', maxBytes: 1, checkTimeoutMs: 5, checkOutputMaxChars: 9, maxRetries: 0 })
  })

  it.each([
    ['maxBytes', { maxBytes: 0 }],
    ['maxBytes', { maxBytes: 1.5 }],
    ['checkTimeoutMs', { checkTimeoutMs: 0 }],
    ['checkOutputMaxChars', { checkOutputMaxChars: -1 }],
  ] as const)('rejects a %s that cannot work', (field, config) => {
    expect(() => resolveConfig(config)).toThrow(new RegExp(`${field} must be a positive integer`))
  })

  it('rejects a negative or fractional maxRetries but allows zero', () => {
    expect(() => resolveConfig({ maxRetries: -1 })).toThrow(/maxRetries must be a non-negative integer/)
    expect(() => resolveConfig({ maxRetries: 0.5 })).toThrow(/maxRetries must be a non-negative integer/)
    expect(resolveConfig({ maxRetries: 0 }).maxRetries).toBe(0)
  })

  it('rejects a blank root', () => {
    expect(() => resolveConfig({ root: '  ' })).toThrow(/root must be a non-empty path/)
  })
})
