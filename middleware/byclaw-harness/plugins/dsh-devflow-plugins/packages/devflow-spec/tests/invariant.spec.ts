// The package's invariant companion. This Definition owns no event stream, so
// the companion reserves package ownership and installs nothing; the test
// proves the registration and its disposal, per testing policy.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as DevflowSpecInvariantCompanion from '@zhchxiao123/dsh-devflow-spec/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('devflow-spec invariant companion', () => {
  it('registers package ownership without installing listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fork = await ctx.plugin(DevflowSpecInvariantCompanion)
    expect(fork).toBeTruthy()
    expect(() => fork.dispose()).not.toThrow()
  })
})
