// REAL-composition proof: a cordis.yml booted through the actual Loader mounts
// the system-prompt registry, the skill registry, the filesystem store, and
// this plugin, and both model-visible layers hold. The catalog lists
// `devflow-workflow` as model- and user-invocable, its body loads from the
// shipped asset, and a same-layer provider with a lower rank overrides it by
// name (the deployment override path the module doc promises; layer shadowing
// would beat rank, so the override provider registers in the same global
// layer). `devflow-spec-authoring` and `devflow-spec-bootstrap` appear
// exactly when the composition also mounts the `devflowSpec` seam: present
// with the spec-filesystem row, absent without it, and withdrawn when the
// spec service's own fiber is disposed while `devflow-workflow` stays. After a pre-step, the assembled runtime
// context carries a board snapshot consistent with the journal, a workspace
// without `.devflow/` contributes nothing and gains no directory, and
// disposing the plugin withdraws the skill and the context together.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'

import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { emptyInbox } from '../../../tests/agent-double.ts'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry, { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import SystemPrompt, { renderContextSections } from '@deepseek-ai/dsh-system-prompt'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import FilesystemDevflowSpecStore from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { DevActor } from '@zhchxiao123/dsh-devflow'
import { afterEach, describe, expect, it } from 'vitest'
import * as Guidance from '../src/index.ts'

const cleanups: (() => Promise<unknown>)[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function newWorkspace(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(workspace, { recursive: true, force: true }))
  return workspace
}

async function boot(options: { spec?: boolean } = {}): Promise<Context> {
  const root = await newWorkspace('guidance-loader-')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-skill'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    ...options.spec === true ? ["- name: '@zhchxiao123/dsh-devflow-spec-filesystem'"] : [],
    "- name: '@zhchxiao123/dsh-devflow-guidance'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = `${pathToFileURL(root).href}/`
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-skill', SkillRegistry],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-spec-filesystem', FilesystemDevflowSpecStore],
    ['@zhchxiao123/dsh-devflow-guidance', Guidance],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

function agentIn(ctx: Context, name: string, cwd: string): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId(`${name}-${basename(cwd)}`)
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd, isSeeded: false })
  return {
    id,
    options: {},
    session,
    inbox: emptyInbox(),
    status: 'idle',
    ctx: scope.ctx,
    followup: () => {},
    steer: () => {},
    inject: () => {},
    send: () => {},
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Dispatch the pre-step waterfall the way the agent loop would. */
async function preStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  return await ctx.waterfall('agent/pre-step', {
    agent,
    messages: [],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
  }, () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [] }))
}

// The model-visible read: `renderContextSections` drops empty contributions
// and runs the strict `{{}}` interpolation, so "undefined" here means the
// snapshot reaches no model.
async function boardText(ctx: Context, agent: Agent): Promise<string | undefined> {
  const assembly = await ctx.systemPrompt.assemble({ agent })
  return renderContextSections(assembly).find(entry => entry.name === 'devflow-board')?.text
}

describe('the guidance plugin under the real Loader', () => {
  it('lists the bundled skill in the catalog as model- and user-invocable', async () => {
    const ctx = await boot()

    const summary = (await ctx.skills.list()).find(entry => entry.name === 'devflow-workflow')

    expect(summary).toBeDefined()
    expect(summary?.provider).toBe('devflow-workflow')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('loads the bundled skill body from the shipped assets directory', async () => {
    const ctx = await boot()

    const skill = await ctx.skills.get('devflow-workflow')

    expect(skill?.provider).toBe('devflow-workflow')
    expect(skill?.content).toBe(
      await readFile(new URL('../assets/devflow-workflow.md', import.meta.url), 'utf8'),
    )
    expect(skill?.content).toContain('# devflow-workflow')
    expect(skill?.content).toContain('## 5. After a veto')
  })

  it('lists devflow-spec-authoring and serves its body when the composition mounts the spec seam', async () => {
    const ctx = await boot({ spec: true })

    const summary = (await ctx.skills.list()).find(entry => entry.name === 'devflow-spec-authoring')
    const skill = await ctx.skills.get('devflow-spec-authoring')

    expect(summary?.provider).toBe('devflow-spec-authoring')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(skill?.content).toBe(
      await readFile(new URL('../assets/devflow-spec-authoring.md', import.meta.url), 'utf8'),
    )
    expect(skill?.content).toContain('# devflow-spec-authoring')
  })

  it('lists devflow-spec-bootstrap and serves its body when the composition mounts the spec seam', async () => {
    const ctx = await boot({ spec: true })

    const summary = (await ctx.skills.list()).find(entry => entry.name === 'devflow-spec-bootstrap')
    const skill = await ctx.skills.get('devflow-spec-bootstrap')

    expect(summary?.provider).toBe('devflow-spec-bootstrap')
    expect(summary?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(skill?.content).toBe(
      await readFile(new URL('../assets/devflow-spec-bootstrap.md', import.meta.url), 'utf8'),
    )
    expect(skill?.content).toContain('# devflow-spec-bootstrap')
  })

  it('never advertises the spec skills in a composition without the spec seam', async () => {
    const ctx = await boot()

    const names = (await ctx.skills.list()).map(entry => entry.name)

    expect(names).toContain('devflow-workflow')
    expect(names).not.toContain('devflow-spec-authoring')
    expect(names).not.toContain('devflow-spec-bootstrap')
  })

  it('yields the name to a lower-ranked same-layer provider and returns once that rival leaves', async () => {
    const ctx = await boot()
    const rival: SkillProvider = {
      name: 'deployment-override',
      list: () => Promise.resolve([{
        name: 'devflow-workflow',
        description: 'deployment-local override',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'deployment-override',
        source: 'custom',
        rank: BUNDLED_SKILL_RANK - 1,
        locator: null,
      }]),
      get: candidate => Promise.resolve({
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation,
        provider: candidate.provider,
        source: candidate.source,
        content: 'override body',
      }),
    }

    const dispose = ctx.skills.registerProvider(() => rival)

    expect((await ctx.skills.get('devflow-workflow'))?.content).toBe('override body')
    expect((await ctx.skills.list()).find(entry => entry.name === 'devflow-workflow')?.provider)
      .toBe('deployment-override')
    dispose()
    expect((await ctx.skills.get('devflow-workflow'))?.provider).toBe('devflow-workflow')
  })

  it('assembles a board snapshot consistent with the journal after cards are created and moved', async () => {
    const ctx = await boot()
    const workspace = await newWorkspace('guidance-board-ws-')
    const root = join(workspace, '.devflow')
    const by: DevActor = { kind: 'agent', session: 'guidance-composition' }
    const created = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Snapshot target',
      body: 'Requirement.',
      by,
      root,
    }))
    if (!created.ok) throw new Error(created.message)
    const moved = await ctx.devflow.transition(ctx.devflow.resolve({
      id: created.card.id,
      to: 'designing',
      expectedRevision: created.card.stageRevision,
      by,
      root,
    }))
    if (!moved.ok) throw new Error(moved.message)
    const claimed = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Claimed work',
      body: 'Requirement.',
      by,
      root,
    }))
    if (!claimed.ok) throw new Error(claimed.message)
    const lease = await ctx.devflow.claim(claimed.card.id, by, { root })
    expect(lease.ok).toBe(true)
    const agent = agentIn(ctx, 'guidance-board', workspace)

    const decision = await preStep(ctx, agent)
    const text = await boardText(ctx, agent)

    expect(decision).toEqual({ kind: 'enter', messages: [] })
    // The snapshot agrees with the journal-derived read: one card per stage
    // the store reports, and exactly the leased card on a Claimed line.
    const listed = await ctx.devflow.list(undefined, root)
    expect(listed.map(card => card.stage).sort()).toEqual(['designing', 'draft'])
    expect(text).toBe([
      'Devflow board: 2 cards (draft 1, designing 1).',
      `Claimed: ${claimed.card.id} [draft] Claimed work`,
      'New requirements start with devflow_create; process knowledge lives in the devflow-workflow skill.',
    ].join('\n'))
  })

  it('contributes nothing for a workspace without .devflow and creates no directory there', async () => {
    const ctx = await boot()
    const workspace = await newWorkspace('guidance-bare-ws-')
    const agent = agentIn(ctx, 'guidance-bare', workspace)

    await preStep(ctx, agent)

    expect(await boardText(ctx, agent)).toBeUndefined()
    await expect(readdir(workspace)).resolves.toEqual([])
  })
})

describe('disposing the plugin alone', () => {
  it('withdraws the skill and the board context and leaves the registries serving everything else', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(FilesystemDevflowStore)
    const fiber = await ctx.plugin(Guidance, {})
    const workspace = await newWorkspace('guidance-dispose-ws-')
    const by: DevActor = { kind: 'agent', session: 'guidance-dispose' }
    const created = await ctx.devflow.create(ctx.devflow.resolveCreate({
      title: 'Survivor',
      body: 'Requirement.',
      by,
      root: join(workspace, '.devflow'),
    }))
    if (!created.ok) throw new Error(created.message)
    const agent = agentIn(ctx, 'guidance-dispose', workspace)
    await preStep(ctx, agent)
    expect((await ctx.skills.list()).some(entry => entry.name === 'devflow-workflow')).toBe(true)
    expect(await boardText(ctx, agent)).toContain('Devflow board: 1 card (draft 1).')

    await fiber.dispose()

    expect((await ctx.skills.list()).some(entry => entry.name === 'devflow-workflow')).toBe(false)
    expect(await boardText(ctx, agent)).toBeUndefined()
    // The board itself is untouched: only the plugin's registrations go.
    expect((await ctx.devflow.list(undefined, join(workspace, '.devflow'))).map(card => card.title))
      .toEqual(['Survivor'])
  })
})

describe('disposing the spec seam alone', () => {
  it('withdraws both spec skills while devflow-workflow keeps serving', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(FilesystemDevflowStore)
    const specFiber = await ctx.plugin(FilesystemDevflowSpecStore)
    await ctx.plugin(Guidance, {})
    expect((await ctx.skills.list()).map(entry => entry.name))
      .toEqual(expect.arrayContaining(['devflow-workflow', 'devflow-spec-authoring', 'devflow-spec-bootstrap']))

    await specFiber.dispose()

    const names = (await ctx.skills.list()).map(entry => entry.name)
    expect(names).toContain('devflow-workflow')
    expect(names).not.toContain('devflow-spec-authoring')
    expect(names).not.toContain('devflow-spec-bootstrap')
  })
})
