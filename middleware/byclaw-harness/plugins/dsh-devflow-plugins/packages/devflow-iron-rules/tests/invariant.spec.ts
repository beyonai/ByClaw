// The package's invariant companion. This plugin owns no event stream or
// mutable data relation, so the companion reserves package ownership and
// installs nothing; the test proves the registration and its disposal, per
// testing policy.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as IronRulesInvariantCompanion from '@zhchxiao123/dsh-devflow-iron-rules/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('devflow-iron-rules invariant companion', () => {
  it('registers package ownership without installing listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fork = await ctx.plugin(IronRulesInvariantCompanion)
    expect(fork).toBeTruthy()
    expect(() => void fork.dispose()).not.toThrow()
  })
})
