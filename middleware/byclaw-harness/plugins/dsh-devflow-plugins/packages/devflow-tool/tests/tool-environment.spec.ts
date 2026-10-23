// With workspaceOnToolEnvironment on the store, the artifact contract, the
// spec seam, and the tools, the model-facing plane works end to end through
// the context's tool providers: artifacts are attached, gated, read back, and
// a declared spec scope is indexed.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import FilesystemDevflowSpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import * as ArtifactGate from '@zhchxiao123/dsh-devflow-artifact-gate'
import * as ToolDevflow from '@zhchxiao123/dsh-devflow-tool'
import { emptyInbox } from '../../../tests/agent-double.ts'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

let base: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (base !== undefined) await rm(base, { recursive: true, force: true })
  base = undefined
})

describe('the devflow tools on a tool environment', () => {
  it('attaches, gates, reads back, and indexes through the tool providers', async () => {
    base = await mkdtemp(join(tmpdir(), 'dsh-devflow-tool-toolenv-'))
    const repoRoot = join(base, 'repo')
    const devflowRoot = join(repoRoot, '.devflow')
    await mkdir(join(devflowRoot, 'spec', 'pkg-a'), { recursive: true })
    await writeFile(join(repoRoot, 'probe.ts'), 'export function apply(): void {}\n')
    await writeFile(join(devflowRoot, 'spec', 'pkg-a', 'contract.md'), [
      '---', 'title: Tool contract', 'updatedAt: 2026-09-02T00:00:00.000Z', 'anchors:',
      '  - id: entry', '    kind: symbol', '    file: probe.ts', '    symbol: apply', '---', '', 'Body.', '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    const { fs } = await mountToolEnvironment(ctx)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime).await()
    await ctx.plugin(FilesystemDevflowStore, { root: devflowRoot, workspaceOnToolEnvironment: true }).await()
    await ctx.plugin(FilesystemDevflowSpecStore, { root: join(devflowRoot, 'spec'), repoRoot, workspaceOnToolEnvironment: true }).await()
    await ctx.plugin(ArtifactGate, {
      kinds: { 'requirements-document': { frontmatter: ['card'], sections: ['Requirements'] } },
      edges: { 'draft->designing': ['requirements-document'] },
      workspaceOnToolEnvironment: true,
    }).await()
    await ctx.plugin(ToolDevflow, { workspaceOnToolEnvironment: true }).await()

    const scope = ctx.plugin(() => {})
    const id = SessionId('tool-toolenv')
    const header = { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: repoRoot, isSeeded: false }
    const session = Session.create(id, undefined, header)
    const owner: Agent = {
      id, options: {}, session, inbox: emptyInbox(), status: 'idle', ctx: scope.ctx,
      followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
      runMaintenance: task => task(new AbortController().signal), whenIdle: () => Promise.resolve(),
    }
    ctx.agents.register(owner)
    let call = 0
    const execute = async (name: string, args: object): Promise<{ isError: boolean | undefined; text: string }> => {
      const result = await ctx.tools.execute({
        signal: new AbortController().signal, callId: ToolCallId(`toolenv-${String(++call)}`), name, arguments: args, agent: owner,
      })
      return { isError: result.isError, text: result.content.map(block => block.type === 'text' ? block.text : '').join('') }
    }

    const created = await execute('devflow_create', { title: 'Remote', slug: 'remote', body: 'Do it.' })
    expect(created.text).toContain('Created card 0001-remote [draft]')
    expect(created.text).toContain('[missing] requirements-document')

    const thin = await execute('devflow_attach_artifact', { id: '0001-remote', kind: 'requirements-document', content: 'no frontmatter\n', expectedRevision: 1 })
    expect(thin.isError).toBe(false)
    const refused = await execute('devflow_transition', { id: '0001-remote', to: 'designing', expectedRevision: 2 })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('required artifacts are missing or malformed')

    const good = '---\ncard: 0001-remote\n---\n\n## Requirements\n\nWords.\n'
    expect((await execute('devflow_attach_artifact', { id: '0001-remote', kind: 'requirements-document', content: good, expectedRevision: 2 })).isError).toBe(false)
    expect((await execute('devflow_attach_artifact', { id: '0001-remote', kind: 'spec-refs', content: '## Scope\n\n- pkg-a\n', expectedRevision: 3 })).isError).toBe(false)
    const moved = await execute('devflow_transition', { id: '0001-remote', to: 'designing', expectedRevision: 4 })
    expect(moved.isError).toBe(false)

    const read = await execute('devflow_read_artifact', { id: '0001-remote', kind: 'requirements-document' })
    expect(read.text).toBe(`artifacts/3-requirements-document.md (draft, rev 3)\n\n${good}`)
    const shown = await execute('devflow_show', { id: '0001-remote' })
    expect(shown.text).toContain('pkg-a/contract')

    const artifactReads = fs.calls.filter(call => call.startsWith('readText ') && call.includes(join('0001-remote', 'artifacts')))
    expect(artifactReads.length).toBeGreaterThan(2)
  })
})
