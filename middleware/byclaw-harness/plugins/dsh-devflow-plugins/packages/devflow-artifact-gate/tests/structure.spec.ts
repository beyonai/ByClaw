// The structure check, category by category, against a real store and real
// transitions: what counts as a frontmatter defect, how sections match, what
// an existence-only structure demands, and which registrations participate at all
// (path-only records carry no kind and never match).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import type { Config } from '@zhchxiao123/dsh-devflow-artifact-gate'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }
const AGENT: DevActor = { kind: 'agent', session: 'ses-1' }
const CREATED = '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeCard(id: string): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), `---\ntitle: Card ${id}\n---\n\nbody\n`)
  await writeFile(join(dir, 'journal.jsonl'), CREATED + '\n')
}

async function boot(config: Config): Promise<Context> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-artifact-structure-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowArtifactGate, config).await()
  return ctx
}

async function attach(ctx: Context, id: string, kind: string, content: string, expectedRevision: number): Promise<void> {
  const result = await ctx.devflow.attachArtifact({
    id: DevflowCardId(id), kind, content, expectedRevision, by: AGENT,
  })
  if (!result.ok) throw new Error(`attach failed: ${result.message}`)
}

function move(ctx: Context, id: string, expectedRevision: number): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId(id), to: 'designing', expectedRevision, by: HUMAN,
  }))
}

function vetoMessage(result: TransitionResult): string {
  expect(result).toMatchObject({ ok: false, code: 'vetoed' })
  if (result.ok) throw new Error('expected a veto')
  return result.message
}

const DESIGN_GATED: Config = {
  kinds: { design: { frontmatter: ['card'] } },
  edges: { 'draft->designing': ['design'] },
}

describe('devflow-artifact-gate structure checks', () => {
  it('vetoes an artifact without a frontmatter block, naming the file', async () => {
    const ctx = await boot(DESIGN_GATED)
    await writeCard('0001-a')
    await attach(ctx, '0001-a', 'design', '# Just a heading\n\nwords\n', 1)
    expect(vetoMessage(await move(ctx, '0001-a', 2)))
      .toContain('design: artifacts/2-design.md has no YAML frontmatter block')
  })

  it('vetoes an opening --- that never closes as a missing frontmatter block', async () => {
    const ctx = await boot(DESIGN_GATED)
    await writeCard('0002-b')
    await attach(ctx, '0002-b', 'design', '---\ncard: 0002-b\n', 1)
    expect(vetoMessage(await move(ctx, '0002-b', 2)))
      .toContain('design: artifacts/2-design.md has no YAML frontmatter block')
  })

  it('vetoes unparseable frontmatter YAML with the parser message', async () => {
    const ctx = await boot(DESIGN_GATED)
    await writeCard('0003-c')
    await attach(ctx, '0003-c', 'design', '---\ncard: [unclosed\n---\n\nwords\n', 1)
    expect(vetoMessage(await move(ctx, '0003-c', 2)))
      .toContain('design: artifacts/2-design.md has invalid YAML frontmatter:')
  })

  it('vetoes a frontmatter that is not a mapping', async () => {
    const ctx = await boot(DESIGN_GATED)
    await writeCard('0004-d')
    await attach(ctx, '0004-d', 'design', '---\n- just\n- a list\n---\n\nwords\n', 1)
    expect(vetoMessage(await move(ctx, '0004-d', 2)))
      .toContain('design: artifacts/2-design.md frontmatter is not a YAML mapping')
  })

  it('counts a field mapped to nothing as missing', async () => {
    const ctx = await boot(DESIGN_GATED)
    await writeCard('0005-e')
    await attach(ctx, '0005-e', 'design', '---\ncard:\n---\n\nwords\n', 1)
    expect(vetoMessage(await move(ctx, '0005-e', 2)))
      .toContain('design: artifacts/2-design.md is missing frontmatter field "card"')
  })

  it('matches a section title with trailing whitespace, not a deeper or extended heading', async () => {
    const ctx = await boot({
      kinds: { design: { sections: ['Approach'] } },
      edges: { 'draft->designing': ['design'] },
    })
    await writeCard('0006-f')
    // Trailing whitespace after the title still matches; no frontmatter block
    // is fine when the structure asks only for sections.
    await attach(ctx, '0006-f', 'design', 'intro\n\n## Approach \n\nwords\n', 1)
    expect(await move(ctx, '0006-f', 2)).toMatchObject({ ok: true })

    await writeCard('0007-g')
    await attach(ctx, '0007-g', 'design', '### Approach\n\n## Approach and more\n', 1)
    expect(vetoMessage(await move(ctx, '0007-g', 2)))
      .toContain('design: artifacts/2-design.md is missing section "## Approach"')
  })

  it('does not find a required section inside the frontmatter block', async () => {
    const ctx = await boot({
      kinds: { design: { sections: ['Approach'] } },
      edges: { 'draft->designing': ['design'] },
    })
    await writeCard('0008-h')
    await attach(ctx, '0008-h', 'design', '---\nnote: "## Approach"\n---\n\nno sections\n', 1)
    expect(vetoMessage(await move(ctx, '0008-h', 2)))
      .toContain('design: artifacts/2-design.md is missing section "## Approach"')
  })

  it('rejects a section that is present but says nothing', async () => {
    // A heading with nothing under it satisfies a presence check while
    // answering the question it was added to force.
    const ctx = await boot({
      kinds: { delta: { nonEmptySections: ['Verdict'] } },
      edges: { 'draft->designing': ['delta'] },
    })

    await writeCard('0020-empty')
    await attach(ctx, '0020-empty', 'delta', '## Verdict\n\n\n## Next\n\nwords\n', 1)
    expect(vetoMessage(await move(ctx, '0020-empty', 2)))
      .toContain('delta: artifacts/2-delta.md section "## Verdict" is empty')

    // Nothing at all after the heading is the same defect.
    await writeCard('0021-trailing')
    await attach(ctx, '0021-trailing', 'delta', 'intro\n\n## Verdict\n', 1)
    expect(vetoMessage(await move(ctx, '0021-trailing', 2)))
      .toContain('section "## Verdict" is empty')

    // A missing heading is reported as missing, not as empty.
    await writeCard('0022-absent')
    await attach(ctx, '0022-absent', 'delta', 'no headings here\n', 1)
    expect(vetoMessage(await move(ctx, '0022-absent', 2)))
      .toContain('delta: artifacts/2-delta.md is missing section "## Verdict"')

    // Content before the next heading satisfies it.
    await writeCard('0023-filled')
    await attach(ctx, '0023-filled', 'delta', '## Verdict\n\nno-change: the tool plane was untouched.\n\n## Next\n', 1)
    expect(await move(ctx, '0023-filled', 2)).toMatchObject({ ok: true })
  })

  it('requires only registration for a kind declared with an empty structure', async () => {
    const ctx = await boot({
      kinds: { notes: {} },
      edges: { 'draft->designing': ['notes'] },
    })
    await writeCard('0009-i')
    expect(vetoMessage(await move(ctx, '0009-i', 1)))
      .toContain('notes: no artifact of this kind is registered on card 0009-i')

    await attach(ctx, '0009-i', 'notes', 'any shape at all\n', 1)
    expect(await move(ctx, '0009-i', 2)).toMatchObject({ ok: true })
  })

  it('ignores path-only registrations: a record without a kind never satisfies one', async () => {
    const ctx = await boot(DESIGN_GATED)
    await writeCard('0010-j')
    const registered = await ctx.devflow.attachArtifact({
      id: DevflowCardId('0010-j'), path: 'artifacts/design.md', expectedRevision: 1, by: HUMAN,
    })
    expect(registered.ok).toBe(true)
    expect(vetoMessage(await move(ctx, '0010-j', 2)))
      .toContain('design: no artifact of this kind is registered on card 0010-j')
  })

  it('treats an edge requiring an empty kind list as unconfigured', async () => {
    const ctx = await boot({
      kinds: { design: { frontmatter: ['card'] } },
      edges: { 'draft->designing': [] },
    })
    await writeCard('0011-k')
    expect(await move(ctx, '0011-k', 1)).toMatchObject({ ok: true })
  })
})
