// Load-time configuration failures name the offending config item, and the
// kind-structure service publishes exactly the configured kinds — normalized,
// deep frozen, and gone when the fiber disposes.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import type { ArtifactStructures, Config } from '@zhchxiao123/dsh-devflow-artifact-gate'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function withStore(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-config-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx
}

describe('devflow-artifact-gate configuration', () => {
  it.each([
    {
      label: 'a malformed edge key',
      config: { kinds: { prd: {} }, edges: { 'draft=>designing': ['prd'] } },
      message: 'edges names invalid edge "draft=>designing"',
    },
    {
      label: 'an unknown location name',
      config: { kinds: { prd: {} }, edges: { 'draft->shipping': ['prd'] } },
      message: 'edges names invalid edge "draft->shipping"',
    },
    {
      label: 'an edge requiring an undeclared kind',
      config: { edges: { 'draft->designing': ['prd'] } },
      message: 'edges["draft->designing"] requires kind "prd", which kinds does not declare',
    },
    {
      label: 'an ill-formed kind key',
      config: { kinds: { 'Bad Kind': {} } },
      message: 'kinds names invalid kind "Bad Kind"',
    },
    {
      label: 'a blank frontmatter field',
      config: { kinds: { design: { frontmatter: [' '] } } },
      message: 'kinds["design"].frontmatter[0] must be a non-empty string',
    },
    {
      label: 'a blank section title',
      config: { kinds: { design: { sections: ['Approach', ''] } } },
      message: 'kinds["design"].sections[1] must be a non-empty string',
    },
    {
      label: 'a blank non-empty-section title',
      config: { kinds: { design: { nonEmptySections: [' '] } } },
      message: 'kinds["design"].nonEmptySections[0] must be a non-empty string',
    },
  ])('fails the load on $label', async ({ config, message }) => {
    const ctx = await withStore()
    await expect(ctx.plugin(DevflowArtifactGate, config as Config)).rejects.toThrow(message)
  })

  it('applies its defaults under direct application outside Loader normalization', async () => {
    const ctx = await withStore()
    // No config at all: nothing is gated and nothing is published beyond the
    // empty structure set.
    const bare = await ctx.plugin((child: Context) => {
      DevflowArtifactGate.apply(child, {})
    })
    expect(ctx.get('devflowArtifactStructures')).toEqual({})
    await bare.dispose()
    // A kind declared with neither list settles both to omitted.
    await ctx.plugin((child: Context) => {
      DevflowArtifactGate.apply(child, { kinds: { prd: {} } })
    })
    expect(ctx.get('devflowArtifactStructures')).toEqual({ prd: {} })
  })

  it('publishes the configured kinds as a deep-frozen devflowArtifactStructures service', async () => {
    const ctx = await withStore()
    await ctx.plugin(DevflowArtifactGate, {
      kinds: {
        prd: { frontmatter: ['card', 'title'], sections: [] },
        'review-verdict': { sections: ['Verdict'], nonEmptySections: ['Verdict'] },
      },
      // A kind no edge references stays published: it can exist purely as the
      // template a producer reads.
      edges: {},
    }).await()
    const kinds = ctx.get('devflowArtifactStructures') as ArtifactStructures
    // The empty sections list normalized away: empty equals omitted.
    expect(kinds).toEqual({
      prd: { frontmatter: ['card', 'title'] },
      'review-verdict': { sections: ['Verdict'], nonEmptySections: ['Verdict'] },
    })
    expect(Object.isFrozen(kinds)).toBe(true)
    expect(Object.isFrozen(kinds.prd)).toBe(true)
    expect(Object.isFrozen(kinds.prd.frontmatter)).toBe(true)
    expect(Object.isFrozen(kinds['review-verdict'].sections)).toBe(true)
    expect(Object.isFrozen(kinds['review-verdict'].nonEmptySections)).toBe(true)
  })
})
