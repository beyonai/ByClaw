// With workspaceOnToolEnvironment the workspace-layout service reads manifests
// through the context's tool providers and answers exactly what the local
// resolver answers, fixture for fixture.
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Sentinel from '@zhchxiao123/dsh-devflow-spec-sentinel'
import type { DevflowSpecWorkspace } from '../src/types.ts'
import { createWorkspaceLayout } from '../src/workspace-layout.ts'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

const FIXTURES = join(import.meta.dirname, 'fixtures')

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('workspace layout on a tool environment', () => {
  it('discovers every fixture layout the local resolver discovers', async () => {
    context = new Context()
    const { fs } = await mountToolEnvironment(context)
    await context.plugin({
      apply: (child: Context) => { Sentinel.apply(child, { workspaceOnToolEnvironment: true }) },
    })
    const remote = context.get('devflowSpecWorkspace') as DevflowSpecWorkspace
    const local = createWorkspaceLayout(new Context())

    const fixtures = (await readdir(FIXTURES, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => join(FIXTURES, entry.name))
    expect(fixtures.length).toBeGreaterThan(5)
    for (const root of fixtures) {
      expect(await remote.discover!(root), root).toEqual(await local.discover!(root))
    }
    expect(fs.calls.some(call => call.startsWith('readText ') && call.endsWith('package.json'))).toBe(true)
    expect(fs.calls.some(call => call.startsWith('listDir '))).toBe(true)
  })
})
