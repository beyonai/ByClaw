// The abstract store's seam behavior: it registers and unregisters as
// `ctx.devflowSpec` with the fiber, and stays an optional service a consumer
// reads through `ctx.get()`.
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import DevflowSpecStore from '@zhchxiao123/dsh-devflow-spec'
import type { AnchorVerdict, SpecDocument, SpecSummary, SpecWriteRequest, SpecWriteResult, SpecWriteSpec } from '@zhchxiao123/dsh-devflow-spec'

const SUMMARY: SpecSummary = {
  id: 'guides/cross-layer',
  title: 'Cross-Layer',
  path: 'guides/cross-layer.md',
  updatedAt: 't1',
  freshness: 'fresh',
  anchorRefs: [{ kind: 'symbol', file: 'src/stages.ts', symbol: 'isLegal' }],
}

class StubStore extends DevflowSpecStore {
  // An implementation answers for its own evaluators; the seam has no default
  // list for a consumer to fall back on.
  readonly anchorableExtensions = ['.ts']

  list(): Promise<SpecSummary[]> {
    return Promise.resolve([SUMMARY])
  }

  read(): Promise<SpecDocument> {
    return Promise.resolve({ ...SUMMARY, anchors: [], body: '', verdicts: [] })
  }

  evaluate(): Promise<AnchorVerdict[]> {
    return Promise.resolve([])
  }

  resolveWrite(request: SpecWriteRequest): SpecWriteSpec {
    return { ...request, root: request.root ?? '/spec', repoRoot: request.repoRoot ?? '/repo', updatedAt: 't1' }
  }

  write(): Promise<SpecWriteResult> {
    return Promise.resolve({ ok: true, document: SUMMARY })
  }
}

describe('DevflowSpecStore', () => {
  it('registers as ctx.devflowSpec and releases the name on dispose', async () => {
    const ctx = new Context()
    expect(ctx.get('devflowSpec')).toBeUndefined()
    const fork = await ctx.plugin(StubStore)
    expect(ctx.get('devflowSpec')).toBeInstanceOf(StubStore)
    void fork.dispose()
    expect(ctx.get('devflowSpec')).toBeUndefined()
  })

  it('lets an implementation own the write defaults', async () => {
    const ctx = new Context()
    await ctx.plugin(StubStore)
    const store = ctx.get('devflowSpec')
    expect(store).toBeDefined()
    const spec = store?.resolveWrite({ id: 'guides/cross-layer', title: 'Cross-Layer', body: '', anchors: [] })
    expect(spec).toMatchObject({ root: '/spec', updatedAt: 't1' })
    await expect(store?.list()).resolves.toEqual([SUMMARY])
    await expect(store?.read()).resolves.toMatchObject({ id: 'guides/cross-layer' })
    await expect(store?.evaluate()).resolves.toEqual([])
    await expect(store?.write(spec as SpecWriteSpec)).resolves.toEqual({ ok: true, document: SUMMARY })
  })
})
