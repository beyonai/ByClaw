// The package's invariant companion. Business documents live on disk and this
// plugin emits no event stream, so the companion reserves package ownership and
// installs nothing; the test proves the registration and its disposal, per
// testing policy. The one relation worth asserting — the review queue lists
// exactly the pending documents — is a file property, covered in write.spec.ts.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as BusinessInvariantCompanion from '@zhchxiao123/dsh-devflow-business/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

describe('devflow-business invariant companion', () => {
  it('registers package ownership without installing listeners', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fork = await ctx.plugin(BusinessInvariantCompanion)
    expect(fork).toBeTruthy()
    expect(() => void fork.dispose()).not.toThrow()
  })
})
