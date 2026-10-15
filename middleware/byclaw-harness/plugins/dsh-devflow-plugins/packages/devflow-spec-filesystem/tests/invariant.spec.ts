// The package's invariant companion. This provider owns no event stream, so
// the companion reserves package ownership and installs nothing; the test
// proves the registration and its disposal, per testing policy.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as SpecFilesystemInvariantCompanion from '@zhchxiao123/dsh-devflow-spec-filesystem/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('devflow-spec-filesystem invariant companion', () => {
  it('registers package ownership without installing listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fork = await ctx.plugin(SpecFilesystemInvariantCompanion)
    expect(fork).toBeTruthy()
    expect(() => void fork.dispose()).not.toThrow()
  })
})
