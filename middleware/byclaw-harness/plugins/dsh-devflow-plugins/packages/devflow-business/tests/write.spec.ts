// The shared write path behind `devflow_write_business`: every rejection
// settling BEFORE the first byte, the review fence no parameter can lift,
// single-direction citation checking that admits the only correct authoring
// order, and the replaces path that lets the base shrink.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-business'
import { REVIEW_QUEUE } from '../src/hygiene.ts'
import { loadDocs, workspaceOf } from '../src/store.ts'
import type { BusinessWriteInput } from '../src/types.ts'
import { presentWriteCall, writeBusiness } from '../src/write.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** An agent double carrying only what the write path reads: a session cwd. */
function agentIn(cwd: string): Agent {
  return { session: { header: { cwd } } } as unknown as Agent
}

async function workspace(sources: readonly string[] = ['proposal-2026-01']): Promise<{
  cwd: string
  businessDir: string
  agent: Agent
}> {
  root = await mkdtemp(join(tmpdir(), 'devflow-business-write-'))
  const businessDir = join(root, '.devflow', 'business')
  await mkdir(businessDir, { recursive: true })
  await writeFile(
    join(businessDir, 'source-manifest.yaml'),
    `sources:\n${sources.map(id => `  - id: ${id}\n    kind: proposal\n`).join('')}`,
  )
  return { cwd: root, businessDir, agent: agentIn(root) }
}

/** The whole base as comparable state, to prove a rejection changed nothing. */
async function treeState(businessDir: string): Promise<Map<string, string>> {
  const state = new Map<string, string>()
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries
    try {
      entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      // An absent directory is a legal state to snapshot.
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`)
      else state.set(`${prefix}${entry.name}`, await readFile(path, 'utf8'))
    }
  }
  await walk(businessDir, '')
  return state
}

function input(overrides: Partial<BusinessWriteInput> = {}): BusinessWriteInput {
  return {
    id: 'order-object',
    bucket: 'meta',
    title: 'An order is the trading order, not the payment or delivery record',
    body: 'The material distinguishes three records that are all called "order" in speech.',
    sources: ['proposal-2026-01'],
    scope: 'trading domain, all versions',
    ...overrides,
  }
}

const config = resolveConfig({})
const ctx = new Context()

describe('writeBusiness rejections', () => {
  it('refuses an id that would escape the bucket directory, before building a path', async () => {
    const { businessDir, agent } = await workspace()
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ id: '../escape' }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('invalid-id')
    expect(await treeState(businessDir)).toEqual(before)
  })

  it('refuses an empty title, which would load as a skipped file', async () => {
    const { businessDir, agent } = await workspace()
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ title: '   ' }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('invalid-title')
    expect(await treeState(businessDir)).toEqual(before)
  })

  it('refuses a bucket outside the closed set', async () => {
    const { businessDir, agent } = await workspace()
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ bucket: 'glossary' as never }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('unknown-bucket')
    expect(outcome.text).toContain('meta, principle, scenario, practice, reference')
    expect(await treeState(businessDir)).toEqual(before)
  })

  it('refuses a claim with no source', async () => {
    const { businessDir, agent } = await workspace()
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ sources: ['  '] }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('no-sources')
    expect(await treeState(businessDir)).toEqual(before)
  })

  it('refuses a source the manifest does not register', async () => {
    const { businessDir, agent } = await workspace()
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ sources: ['hallway-conversation'] }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('unregistered-source')
    expect(outcome.text).toContain('hallway-conversation')
    expect(await treeState(businessDir)).toEqual(before)
  })

  it('refuses a citation to a document that does not exist', async () => {
    const { businessDir, agent } = await workspace()
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ body: 'Depends on [[payment-object]].' }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('dangling-reference')
    expect(outcome.text).toContain('[[payment-object]]')
    expect(await treeState(businessDir)).toEqual(before)
  })

  it('refuses an id already taken unless it is being replaced', async () => {
    const { businessDir, agent } = await workspace()
    await writeBusiness(ctx, agent, input(), config)
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ title: 'A second take' }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('exists')
    expect(outcome.text).toContain('replaces')
    expect(await treeState(businessDir)).toEqual(before)
  })

  it('refuses replacing an id nothing holds', async () => {
    const { businessDir, agent } = await workspace()
    const before = await treeState(businessDir)

    const outcome = await writeBusiness(ctx, agent, input({ replaces: ['never-written'] }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.code).toBe('exists')
    expect(await treeState(businessDir)).toEqual(before)
  })
})

describe('the review fence', () => {
  it('writes pending-review no matter what the caller supplies', async () => {
    const { businessDir, agent } = await workspace()

    // Every optional field populated, plus fields a caller might hope are
    // passed through. The schema has no status parameter; this proves the
    // absence is load-bearing rather than incidental.
    await writeBusiness(ctx, agent, {
      ...input({ watches: ['services/order/'] }),
      ...{ status: 'confirmed', lastConfirmed: '2026-01-01' } as unknown as Partial<BusinessWriteInput>,
    }, config)

    const text = await readFile(join(businessDir, 'meta', 'order-object.md'), 'utf8')
    expect(text).toContain('status: pending-review')
    expect(text).not.toContain('confirmed\n')
  })

  it('drops a replaced document back to pending-review', async () => {
    const { businessDir, agent } = await workspace()
    await writeBusiness(ctx, agent, input(), config)
    const path = join(businessDir, 'meta', 'order-object.md')
    await writeFile(path, (await readFile(path, 'utf8')).replace('status: pending-review', 'status: confirmed'))

    const outcome = await writeBusiness(ctx, agent, input({ body: 'Revised.', replaces: ['order-object'] }), config)

    expect(outcome.ok).toBe(true)
    expect(await readFile(path, 'utf8')).toContain('status: pending-review')
  })

  it('lists exactly the pending documents in the review queue', async () => {
    const { businessDir, agent } = await workspace(['proposal-2026-01'])
    await writeBusiness(ctx, agent, input(), config)
    await writeBusiness(ctx, agent, input({ id: 'timeout-budget', bucket: 'principle', body: 'Budget is 800ms.' }), config)

    const confirmedPath = join(businessDir, 'meta', 'order-object.md')
    await writeFile(confirmedPath, (await readFile(confirmedPath, 'utf8')).replace('status: pending-review', 'status: confirmed'))
    // The queue is a projection, rebuilt on the next write rather than edited.
    await writeBusiness(ctx, agent, input({ id: 'retry-rule', bucket: 'principle', body: 'Retries are capped at 3.' }), config)

    const queue = await readFile(join(businessDir, REVIEW_QUEUE), 'utf8')
    expect(queue).toContain('id: timeout-budget')
    expect(queue).toContain('id: retry-rule')
    expect(queue).not.toContain('id: order-object')
  })
})

describe('authoring order', () => {
  it('accepts the first document of a domain, which nothing cites yet', async () => {
    const { businessDir, agent } = await workspace()

    // Distillation establishes meaning first; a base whose first write is
    // refused for being uncited could never be started.
    const outcome = await writeBusiness(ctx, agent, input(), config)

    expect(outcome.ok).toBe(true)
    expect(outcome.code).toBeUndefined()
    const { docs } = await loadDocs(workspaceOf(agent, config))
    expect(docs.map(doc => doc.id)).toEqual(['order-object'])
    expect(await readFile(join(businessDir, 'meta', 'order-object.md'), 'utf8')).toContain('sources: proposal-2026-01')
  })

  it('admits a citation to a document the same write replaces', async () => {
    const { agent } = await workspace()
    await writeBusiness(ctx, agent, input(), config)

    const outcome = await writeBusiness(ctx, agent, input({
      id: 'order-object',
      body: 'Supersedes the earlier take at [[order-object]].',
      replaces: ['order-object'],
    }), config)

    expect(outcome.ok).toBe(true)
  })

  it('merges a cluster, deleting the superseded documents', async () => {
    const { businessDir, agent } = await workspace()
    await writeBusiness(ctx, agent, input({ id: 'order-a', body: 'One take.' }), config)
    await writeBusiness(ctx, agent, input({ id: 'order-b', body: 'Another take.' }), config)

    const outcome = await writeBusiness(ctx, agent, input({
      id: 'order-object',
      body: 'The combined statement.',
      replaces: ['order-a', 'order-b'],
    }), config)

    expect(outcome.ok).toBe(true)
    expect(outcome.text).toContain('merging [order-a], [order-b]')
    const { docs } = await loadDocs(workspaceOf(agent, config))
    expect(docs.map(doc => doc.id)).toEqual(['order-object'])
    expect(await readdir(join(businessDir, 'meta'))).toEqual(['order-object.md'])
  })
})

describe('presentWriteCall', () => {
  it('names the bucket and id a reviewer would look for', () => {
    expect(presentWriteCall({ id: 'order-object', bucket: 'meta', title: 'An order is…' })).toEqual({
      card: 'generic',
      title: 'Write business knowledge [meta/order-object]',
      kind: 'other',
      rawInput: 'An order is…',
    })
  })
})

describe('write faults', () => {
  it('reports a failed write and leaves no temp file behind', async () => {
    const { businessDir, agent } = await workspace()
    // A file where the bucket directory must go: mkdir fails, so nothing can
    // be written and the caller has to be told rather than left guessing.
    await writeFile(join(businessDir, 'meta'), 'not a directory\n')

    const outcome = await writeBusiness(ctx, agent, input(), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('writing the document failed')
    expect((await readdir(businessDir)).filter(name => name.endsWith('.tmp'))).toEqual([])
  })
})
