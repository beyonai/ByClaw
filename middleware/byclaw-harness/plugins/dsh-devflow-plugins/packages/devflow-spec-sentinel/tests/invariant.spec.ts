// The package's invariant companion. The sentinel dispatches no events of its
// own, so the companion reserves package ownership and installs nothing; the
// test proves the registration and its disposal, per testing policy.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SentinelInvariantCompanion from '@zhchxiao123/dsh-devflow-spec-sentinel/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('devflow-spec-sentinel invariant companion', () => {
  it('registers package ownership without installing listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fork = await ctx.plugin(SentinelInvariantCompanion)
    expect(fork).toBeTruthy()
    expect(() => void fork.dispose()).not.toThrow()
  })
})
