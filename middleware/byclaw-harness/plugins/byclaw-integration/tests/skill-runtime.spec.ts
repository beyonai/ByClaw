import { afterEach, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt, { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import { installMemberSelectionRuntime } from '../../agent-teams/src/members.ts'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { parseByClawDigitalEmployee } from '../src/resources.ts'
import { ByClawResourceWatch } from '../src/resource-watch.ts'
import { projectByClawResourcesToTemplates } from '../src/integration.ts'
import type { DshAgentTemplate } from '../src/agent-template.ts'
import { writeAgentTemplate } from '../src/agent-template.ts'
import { registerAgentTemplateRuntime } from '../src/template-runtime.ts'
import { byClawSkillCacheDir, writeCachedByClawSkill } from '../src/skill-sync.ts'
import { ByClawSessionWorkspaceRegistry } from '../src/session-workspace.ts'

const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function skill(root: string, code: string, description: string, body = 'Original body', name = code) {
  const path = join(root, code)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description === '' ? '""' : description}\n---\n${body}`)
  return { code, path }
}
function template(id: string, skills: DshAgentTemplate['skills']): DshAgentTemplate {
  return { schemaVersion: 'dsh.agent-template/v1', id, kind: 'agent', name: id, description: '', persona: '', skills,
    source: { system: 'byclaw', resourceId: id, resourceCode: id, workerAgentType: 'BYCLAW_DSH', directlyAuthorized: true } }
}
function agent(id: string, header: Partial<Session['header']> = {}): Agent {
  const sid = SessionId(id)
  const session = Session.create(sid, [], {
    version: SESSION_FORMAT_VERSION,
    id: sid,
    createdAt: 0,
    isSeeded: false,
    delegationDepth: 0,
    ...header,
  })
  return { id: sid, session, ctx: new Context(), options: {}, status: 'idle',
    send() {}, followup() {}, steer() {}, cancel() {}, whenIdle: () => Promise.resolve(),
  } as unknown as Agent
}
async function fixture(options: {
  resolveDeferredTemplate?: (template: DshAgentTemplate) => Promise<DshAgentTemplate>
  skillDirectories?: { present<T extends { path?: string; resourceBase?: { kind: 'directory'; path: string } }>(definition: T): Promise<T> }
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-skills-test-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const builtin = join(root, 'builtin')
  await skill(builtin, 'builtin-help', '>\n  Shared builtin\n  multiline description')
  const cache = join(root, 'cache')
  const html = await skill(cache, 'redis-code', 'Employee HTML', 'Bound HTML body', 'html-artifact')
  const other = await skill(cache, 'other-employee', 'Other employee')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({ name: 'unrelated-global', description: 'Unrelated global', source: 'runtime', content: 'Global body' })
  ctx.skills.register({ name: 'html-artifact', description: 'Wrong global shadow', source: 'runtime', content: 'Wrong body' })
  await ctx.plugin(toolSkill)
  const { ByClawSkillRuntime } = await import('../src/skill-runtime.ts')
  const runtime = await ByClawSkillRuntime.install(ctx, {
    ...options,
    builtinSkillDir: builtin,
    agentSkillRoot: join(root, 'agent-skills'),
  })
  cleanups.push(() => runtime.dispose())
  const templates = [template('byclaw-employee-1', [html]), template('byclaw-employee-2', [other])]
  const publish = await runtime.prepareGeneration(templates, cache, cache)
  publish()
  const a = agent('a'), b = agent('b'), main = agent('main')
  // Real contexts own binding disposal; real agents are used as lookup scope identities.
  const aCtx = ctx.extend({ agent: a }), bCtx = ctx.extend({ agent: b })
  runtime.bind(aCtx, a, templates[0]!)
  runtime.bind(bCtx, b, templates[1]!)
  const propose = async (who: Agent, text?: string) => {
    const messages = text ? [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })] : []
    return agentEvents(ctx, who).waterfall('agent/pre-step',
      { messages, turn: 1, step: 1, signal: new AbortController().signal },
      async () => ({ kind: 'enter' as const, messages }))
  }
  const call = (who: Agent, name: string) => ctx.tools.execute({ agent: who, signal: new AbortController().signal,
    callId: ToolCallId('probe'), name: 'skill', arguments: { name } })
  return { root, builtin, cache, html, ctx, runtime, templates, a, b, main, propose, call }
}
function catalog(decision: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['propose']>>) {
  if (decision.kind !== 'enter') throw new Error('step rejected')
  return decision.messages.find(message => message.source.kind === 'skill-catalog')
}
function persist(who: Agent, decision: { kind: string; messages?: unknown[] }) {
  if (decision.kind !== 'enter') throw new Error('step rejected')
  for (const message of decision.messages ?? []) who.session.append('user/message', message as never, { surfaceOp: 'append' })
}

it('treats an explicitly empty relSkills as revocation even if legacy skills remains', () => {
  const legacy = [{ skillCode: 'old', skillUrl: '/old.zip', versionUrl: '/old.version' }]
  const raw = { resourceId: '1', resourceName: 'employee', skills: legacy }
  expect(parseByClawDigitalEmployee(raw).skills).toHaveLength(1)
  expect(parseByClawDigitalEmployee({ ...raw, relSkills: [] }).skills).toEqual([])
  expect(parseByClawDigitalEmployee({ ...raw, relSkills: '[]' }).skills).toEqual([])
})

it('publishes builtins plus exact associations and retains the ordinary agent catalog', async () => {
  const f = await fixture()
  const list = (scope: Agent) => f.ctx.skills.list({ scope })
  expect((await list(f.a)).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
  expect((await list(f.b)).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'other-employee', 'unrelated-global'])
  expect((await list(f.main)).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
  expect((await list(f.a))[0]?.description).toBe('Shared builtin multiline description\n')
  expect(catalog(await f.propose(f.a))?.source).toMatchObject({ entries: [
    { name: 'builtin-help', description: 'Shared builtin multiline description' },
    { name: 'html-artifact', description: 'Employee HTML' },
    { name: 'unrelated-global', description: 'Unrelated global' },
  ] })
  expect((await f.ctx.skills.get('html-artifact', { scope: f.a }))?.content).toContain('Bound HTML body')
  expect((await f.call(f.a, 'unrelated-global')).isError).toBe(false)
  expect((await f.call(f.a, 'builtin-help')).isError).toBe(false)
  expect(JSON.stringify(await f.propose(f.a, '/unrelated-global'))).toContain('Global body')
  expect(JSON.stringify(await f.propose(f.a, '/html-artifact'))).toContain('Bound HTML body')
  f.runtime.dispose()
  expect((await list(f.a)).map(s => s.name)).toEqual(['html-artifact', 'unrelated-global'])
})

it('tells the model where a Skill directory is for its commands, keeping the Skill text', async () => {
  const presented: string[] = []
  const f = await fixture({ skillDirectories: {
    async present(definition) {
      const base = definition.resourceBase?.path
      if (base === undefined || !base.includes('/cache/')) return definition
      presented.push(base)
      const visible = `/by/.byclaw/skills/${base.slice(base.lastIndexOf('/') + 1)}`
      return { ...definition, path: `${visible}/SKILL.md`, resourceBase: { kind: 'directory', path: visible } }
    },
  } })
  const skill = await f.ctx.skills.get('html-artifact', { scope: f.a })
  expect(skill?.resourceBase).toEqual({ kind: 'directory', path: '/by/.byclaw/skills/redis-code' })
  expect(skill?.path).toBe('/by/.byclaw/skills/redis-code/SKILL.md')
  expect(skill?.content).toContain('Bound HTML body')
  const listed = (await f.ctx.skills.list({ scope: f.a })).find(s => s.name === 'html-artifact')
  expect(listed?.resourceBase?.path).toBe('/by/.byclaw/skills/redis-code')
  // Deployment builtins are on B at the same path already.
  expect((await f.ctx.skills.get('builtin-help', { scope: f.a }))?.resourceBase?.path).toBe(join(f.builtin, 'builtin-help'))
  expect(presented).toContain(f.html.path)
  // The runtime's own record keeps the host path, which the log names.
  expect(f.runtime.entries('byclaw-employee-1').find(e => e.name === 'html-artifact')?.path).toBe(f.html.path)
})

it('keeps the skill-creator workflow mandatory for Skill creation and modification', async () => {
  const f = await fixture()
  const sections = (await f.ctx.systemPrompt.assemble({ scope: f.a })).sections
  const policy = sections.find(section => section.name === 'byclaw:skill-creator-policy')
  expect(policy?.text).toContain('must load the `skill-creator` Skill')
  expect(policy?.text).toContain('creating, editing, or updating any Skill')
})

it('adds a per-agent environment prefix to the Skill instruction without leaking it to another Agent', async () => {
  const f = await fixture()

  const employeeSkill = await f.ctx.skills.get('html-artifact', { scope: f.a })
  const otherEmployeeSkill = await f.ctx.skills.get('other-employee', { scope: f.b })

  expect(employeeSkill?.content).toContain('env BYCLAW_AGENT_ID="$DSH_BYCLAW_AGENT_ID" BYCLAW_DSH_AGENT_ID=\'a\'')
  expect(employeeSkill?.content).not.toContain('BYCLAW_DSH_AGENT_ID=b')
  expect(otherEmployeeSkill?.content).toContain('env BYCLAW_AGENT_ID="$DSH_BYCLAW_AGENT_ID" BYCLAW_DSH_AGENT_ID=\'b\'')
  expect(otherEmployeeSkill?.content).not.toContain('BYCLAW_DSH_AGENT_ID=a')
})

it('exposes the trusted business Agent ID for the shell environment bridge', async () => {
  const f = await fixture()
  expect(f.runtime.agentId(f.a)).toBe('byclaw-employee-1')
  expect(f.runtime.agentId(f.b)).toBe('byclaw-employee-2')
  expect(f.runtime.agentId(f.main)).toBeUndefined()
})

it('layers ByClaw Skills over native plugin bundled Skills without hiding them', async () => {
  const f = await fixture()
  const bundled = [
    ['devflow-workflow', 'Devflow workflow body'],
    ['devflow-spec-authoring', 'Devflow spec body'],
    ['deploy-bootstrap', 'Deploy bootstrap body'],
    ['testenv-bootstrap', 'Testenv bootstrap body'],
    ['testenv-author', 'Testenv author body'],
  ] as const
  const dispose = bundled.map(([name, content]) => f.ctx.skills.register({
    name,
    description: `${name} bundled Skill`,
    source: 'bundled',
    content,
  }))
  cleanups.push(() => { for (const unregister of dispose.reverse()) unregister() })

  const expected = bundled.map(([name]) => name)
  const list = await f.ctx.skills.list({ scope: f.a })
  expect(list.map(skill => skill.name)).toEqual(expect.arrayContaining(expected))
  expect((await f.ctx.skills.snapshot({ scope: f.a })).skills.map(skill => skill.name))
    .toEqual(expect.arrayContaining(expected))
  for (const [name, content] of bundled) {
    expect((await f.ctx.skills.get(name, { scope: f.a }))?.content).toBe(content)
    expect(await f.call(f.a, name)).toMatchObject({ isError: false })
  }
})

it('updates a live agent after watch publication, reloads changed bodies and retains builtins after revocation', async () => {
  const f = await fixture()
  persist(f.a, await f.propose(f.a))
  const subscriber = new EventEmitter()
  Object.assign(subscriber, { subscribe: async () => {}, unsubscribe: async () => {}, psubscribe: async () => {}, punsubscribe: async () => {}, quit: async () => {} })
  let templates = f.templates
  const watch = new ByClawResourceWatch({
    redis: { duplicate: () => subscriber, config: async () => ['notify-keyspace-events', 'Kh'], get: async () => null, hgetall: async () => ({}) } as never,
    userCode: 'test', channel: 'changes', pollMs: 60000, pollOnlyMs: 60000, debounceMs: 60000, missingGraceMs: 500,
    logger: { info() {}, warn() {} }, onAuthorizationChange: async () => {},
    onResourceChange: async () => { (await f.runtime.prepareGeneration(templates, f.cache, f.cache))() },
  })
  cleanups.push(() => watch.close())
  await watch.start({ userId: '1', authKey: 'test', resourceIds: ['1'] })
  const change = async (at: number) => {
    subscriber.emit('message', 'changes', JSON.stringify({ eventType: 'DIG_EMPLOYEE_SKILLS_SYNCED', resourceId: '1', changedAt: at }))
    await watch.flushResourceChangesNow()
  }
  await skill(f.cache, 'redis-code', 'Employee HTML', 'Updated body', 'html-artifact')
  await change(1)
  const step = await f.propose(f.a)
  expect(JSON.stringify(step)).toContain('Reload')
  expect(JSON.stringify(await f.call(f.a, 'html-artifact'))).toContain('Updated body')
  persist(f.a, step)
  expect(JSON.stringify(await f.propose(f.a))).not.toContain('Reload')
  await skill(f.cache, 'redis-code', 'Updated HTML metadata', 'Updated body', 'html-artifact')
  await change(2)
  const metadataStep = await f.propose(f.a)
  expect(catalog(metadataStep)?.source).toMatchObject({ entries: [
    { name: 'builtin-help' }, { name: 'html-artifact', description: 'Updated HTML metadata' },
    { name: 'unrelated-global' },
  ] })
  persist(f.a, metadataStep)
  templates = [template('byclaw-employee-1', []), f.templates[1]!]
  await change(3)
  expect(catalog(await f.propose(f.a))?.source).toMatchObject({ entries: [
    { name: 'builtin-help' },
    { name: 'html-artifact', description: 'Wrong global shadow' },
    { name: 'unrelated-global' },
  ] })
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
  expect((await f.call(f.a, 'html-artifact')).isError).toBe(false)
  expect((await f.ctx.skills.list({ scope: f.b })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'other-employee', 'unrelated-global'])
})

it('does not publish a prepared generation until commit and retains it after a preparation failure', async () => {
  const f = await fixture()
  const commit = await f.runtime.prepareGeneration([template('byclaw-employee-1', [])], f.cache, f.cache)
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toContain('html-artifact')
  commit()
  await expect(f.runtime.prepareGeneration([template('byclaw-employee-1', [{code:'missing',path:join(f.cache,'missing')}])], f.cache, f.cache)).rejects.toThrow()
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
})

it('updates the live Skill cache incrementally before publishing templates and commits it on synchronization', async () => {
  const f = await fixture()
  const ref = { id: '3', code: 'new-skill', type: 'hub', downloadUrl: '/new.zip', versionUrl: '/version' }
  const events: string[] = []
  await projectByClawResourcesToTemplates({
    resources: { employees: [{ id: '1', code: 'EMP', name: 'Employee', description: '', capabilities: '', persona: '', workerAgentType: 'BYCLAW_DSH', skills: [ref] }],
      groups: [], directEmployeeIds: ['1'], watchedResourceIds: ['1'], authHeaders: {}, authorization: { userId: 'u', authKey: 'auth', resourceIds: ['1'] } },
    agentTemplateDir: join(f.root, 'templates'), teamCatalogDir: join(f.root, 'teams'), cacheRoot: f.cache, baseUrl: 'http://test',
    syncSkill: async (ref, root) => {
      expect(root).toBe(f.cache)
      const target = byClawSkillCacheDir(root!, ref.code)
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), '---\nname: new-skill\ndescription: New Skill\n---\nNew body')
      return target
    },
    prepareSkillGeneration: async (templates, skillRoot) => {
      events.push('prepare')
      expect(skillRoot).toBe(f.cache)
      expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toContain('html-artifact')
      const commit = await f.runtime.prepareGeneration(templates, skillRoot, f.cache)
      return () => { events.push('commit'); commit() }
    },
  })
  expect(events).toEqual(['prepare', 'commit'])
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'new-skill', 'unrelated-global'])
})

it('removes revoked cached Skills only after the new runtime generation commits', async () => {
  const f = await fixture()
  const source = await skill(join(f.root, 'sources'), 'revoked-skill', 'Revoked Skill')
  const revoked = byClawSkillCacheDir(f.cache, 'revoked-skill')
  await writeCachedByClawSkill({
    sourceDir: source.path,
    targetDir: revoked,
    metadata: {
      code: 'revoked-skill',
      version: 'v1',
      downloadUrl: '/revoked.zip',
      versionUrl: '/revoked.version',
    },
  })
  const events: string[] = []

  await projectByClawResourcesToTemplates({
    resources: {
      employees: [], groups: [], directEmployeeIds: [], watchedResourceIds: [], authHeaders: {},
      authorization: { userId: 'u', authKey: 'auth', resourceIds: [] },
    },
    agentTemplateDir: join(f.root, 'revoked-templates'),
    teamCatalogDir: join(f.root, 'revoked-teams'),
    cacheRoot: f.cache,
    baseUrl: 'http://test',
    prepareSkillGeneration: async () => {
      events.push('prepare')
      expect(existsSync(revoked)).toBe(true)
      return () => {
        events.push('commit')
        expect(existsSync(revoked)).toBe(true)
      }
    },
  })

  expect(events).toEqual(['prepare', 'commit'])
  expect(existsSync(revoked)).toBe(false)
})

it('publishes healthy resources while reporting and skipping failed downloads and invalid Skill metadata', async () => {
  const f = await fixture()
  const failedDownload = { id: 'download', code: 'failed-download', type: 'hub', downloadUrl: '/failed.zip', versionUrl: '/failed.version' }
  const invalidMetadata = { id: 'invalid', code: 'invalid-metadata', type: 'hub', downloadUrl: '/invalid.zip', versionUrl: '/invalid.version' }
  const healthy = { id: 'healthy', code: 'healthy-skill', type: 'hub', downloadUrl: '/healthy.zip', versionUrl: '/healthy.version' }
  const errors: Array<{ phase: 'sync' | 'prepare'; code: string; templateId?: string }> = []

  const projected = await projectByClawResourcesToTemplates({
    resources: {
      employees: [
        { id: '1', code: 'EMP-1', name: 'Employee 1', description: '', capabilities: '', persona: '', workerAgentType: 'BYCLAW_DSH', skills: [failedDownload, invalidMetadata] },
        { id: '2', code: 'EMP-2', name: 'Employee 2', description: '', capabilities: '', persona: '', workerAgentType: 'BYCLAW_DSH', skills: [healthy] },
      ],
      groups: [], directEmployeeIds: ['1', '2'], watchedResourceIds: ['1', '2'], authHeaders: {},
      authorization: { userId: 'u', authKey: 'auth', resourceIds: ['1', '2'] },
    },
    agentTemplateDir: join(f.root, 'isolated-templates'), teamCatalogDir: join(f.root, 'isolated-teams'),
    cacheRoot: f.cache, baseUrl: 'http://test', allowSkillSyncFailure: true,
    syncSkill: async (ref, root) => {
      if (ref.code === failedDownload.code) throw new Error('download unavailable')
      const target = byClawSkillCacheDir(root!, ref.code)
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), ref.code === invalidMetadata.code
        ? '---\nname: invalid-metadata\ndescription:\ninvalid continuation\n---\nBroken body'
        : '---\nname: healthy-skill\ndescription: Healthy Skill\n---\nHealthy body')
      return target
    },
    onSkillSyncError: ref => { errors.push({ phase: 'sync', code: ref.code }) },
    prepareSkillGeneration: async (templates, stagedRoot) => f.runtime.prepareGeneration(
      templates,
      stagedRoot,
      f.cache,
      {
        allowSkillFailure: true,
        onSkillError: ({ templateId, code }) => { errors.push({ phase: 'prepare', templateId, code }) },
      },
    ),
  })

  expect(projected.acceptedEmployeeIds).toEqual(['1', '2'])
  expect(errors).toEqual([
    { phase: 'sync', code: 'failed-download' },
    { phase: 'prepare', templateId: 'byclaw-employee-1', code: 'invalid-metadata' },
  ])
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
  expect((await f.ctx.skills.list({ scope: f.b })).map(s => s.name)).toEqual(['builtin-help', 'healthy-skill', 'html-artifact', 'unrelated-global'])
})

it('keeps invalid Skill metadata fatal when tolerant preparation is disabled', async () => {
  const f = await fixture()
  const invalid = join(f.cache, 'strict-invalid')
  await mkdir(invalid, { recursive: true })
  await writeFile(join(invalid, 'SKILL.md'), '---\nname: strict-invalid\ndescription:\ninvalid continuation\n---\nBroken body')
  const errors: string[] = []

  await expect(f.runtime.prepareGeneration(
    [template('byclaw-employee-1', [{ code: 'strict-invalid', path: invalid }])],
    f.cache,
    f.cache,
    {
      allowSkillFailure: false,
      onSkillError: ({ code }) => { errors.push(code) },
    },
  )).rejects.toThrow('can not read a block mapping entry')
  expect(errors).toEqual(['strict-invalid'])
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
})

it('keeps an agent turn usable when one live workspace Skill has invalid metadata', async () => {
  const f = await fixture()
  const workspaceSkills = join(f.root, 'agent-skills', 'workspace-baiying-agent-byclaw-employee-1', 'skills')
  await skill(workspaceSkills, 'healthy-local', 'Healthy local Skill', 'Healthy local body')
  const broken = join(workspaceSkills, 'news-collect')
  await mkdir(broken, { recursive: true })
  await writeFile(join(broken, 'SKILL.md'), '---\nname: news-collect\ndescription: \n---\nBroken body')

  const listed = await f.ctx.skills.list({ scope: f.a })
  expect(listed.map(item => item.name)).toContain('healthy-local')
  expect(listed.map(item => item.name)).not.toContain('news-collect')
  expect((await f.ctx.skills.snapshot({ scope: f.a })).skills.map(item => item.name)).toContain('healthy-local')
  expect((await f.ctx.skills.get('healthy-local', { scope: f.a }))?.content).toContain('Healthy local body')
  expect(catalog(await f.propose(f.a))?.source).toMatchObject({ entries: expect.arrayContaining([
    expect.objectContaining({ name: 'healthy-local' }),
  ]) })

  await writeFile(join(broken, 'SKILL.md'), '---\nname: news-collect\ndescription: News collection\n---\nRepaired body')
  expect((await f.ctx.skills.get('news-collect', { scope: f.a }))?.content).toContain('Repaired body')
})

it('loads a version-suffixed associated Skill under its stable code without rewriting its source', async () => {
  const f = await fixture()
  const ppt = await skill(f.cache, 'ppt-master', 'Presentation authoring', 'Keep this exact body', 'ppt-master-0.1')
  const renames: unknown[] = []
  const publish = await f.runtime.prepareGeneration(
    [template('byclaw-employee-1', [ppt])], f.cache, f.cache,
    { onSkillRename: event => renames.push(event) },
  )
  publish()
  expect((await f.ctx.skills.get('ppt-master', { scope: f.a }))?.content).toContain('Keep this exact body')
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toContain('ppt-master')
  expect(renames).toMatchObject([{ originalName: 'ppt-master-0.1', runtimeName: 'ppt-master' }])
  expect(await readFile(join(ppt.path, 'SKILL.md'), 'utf8')).toContain('name: ppt-master-0.1')
  expect(await f.ctx.skills.get('ppt-master', { scope: f.b })).toBeUndefined()
})

it('keeps unrelated invalid names and missing descriptions invalid', async () => {
  const f = await fixture()
  for (const [name, description] of [['other-skill-0.1', 'Valid description'], ['../ppt-master', 'Valid description'], ['ppt-master-0.1', '']]) {
    const entry = await skill(f.cache, 'ppt-master', description!, 'Body', name)
    await expect(f.runtime.prepareGeneration([template('byclaw-employee-1', [entry])], f.cache, f.cache))
      .rejects.toThrow('invalid Skill name/description')
  }
})

it('renames and retains a duplicate associated Skill name when tolerant preparation is enabled', async () => {
  const f = await fixture()
  const duplicateCode = '1aff4ff8e62719b62456d43c2d0c35c838a339f71de2e432173b37260eada54a'
  const duplicate = await skill(f.cache, duplicateCode, 'Duplicate HTML', 'Duplicate body', 'html-artifact')
  const errors: Array<{ templateId: string; code: string; message: string }> = []
  const renames: Array<{ templateId: string; code: string; originalName: string; runtimeName: string }> = []
  const options = {
    allowSkillFailure: true,
    onSkillError: ({ templateId, code, error }: { templateId: string; code: string; error: unknown }) => {
      errors.push({ templateId, code, message: error instanceof Error ? error.message : String(error) })
    },
    onSkillRename: ({ templateId, code, originalName, runtimeName }: {
      templateId: string; code: string; originalName: string; runtimeName: string
    }) => {
      renames.push({ templateId, code, originalName, runtimeName })
    },
  }

  const publish = await f.runtime.prepareGeneration(
    [template('byclaw-employee-1', [f.html, duplicate])],
    f.cache,
    f.cache,
    options,
  )
  publish()

  expect(errors).toEqual([])
  expect(renames).toEqual([{
    templateId: 'byclaw-employee-1',
    code: duplicateCode,
    originalName: 'html-artifact',
    runtimeName: 'html-artifact-1aff4ff8e627',
  }])
  expect((await f.ctx.skills.list({ scope: f.a })).map(s => s.name)).toEqual([
    'builtin-help',
    'html-artifact',
    'html-artifact-1aff4ff8e627',
    'unrelated-global',
  ])
  expect((await f.ctx.skills.get('html-artifact', { scope: f.a }))?.content).toContain('Bound HTML body')
  expect((await f.ctx.skills.get('html-artifact-1aff4ff8e627', { scope: f.a }))?.content).toContain('Duplicate body')
})

it('binds directly targeted root agents including empty associations', async () => {
  const f = await fixture()
  const catalogDir = join(f.root, 'roots')
  await writeAgentTemplate(catalogDir, template('byclaw-employee-empty', []))
  f.ctx.provide('subagents', {})
  const templates = registerAgentTemplateRuntime(f.ctx, {
    catalogDir, subagentProvider: 'spawn', resolveModel: async () => ({ provider: 'test', model: 'test' }),
    workspaceRegistry: {} as never, skillRuntime: f.runtime,
  })
  const root = agent('direct-root')
  const prepared = await templates.prepareRoot('byclaw-employee-empty')
  const scope = createScope(f.ctx, root)
  cleanups.push(() => scope.dispose())
  await scope.ctx.plugin({ inject: ['systemPrompt'], apply(ctx: Context) { prepared.setup(ctx.extend({ agent: root }), root) } })
  expect((await f.ctx.skills.list({ scope: root })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
})

it('scopes fallback template skills to the composed Agent and disposes them with its scope', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-fallback-skills-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const source = await skill(root, 'fallback-only', 'Fallback scoped skill')
  const catalogDir = join(root, 'catalog')
  await writeAgentTemplate(catalogDir, template('fallback-template', [source]))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  cleanups.push(() => ctx.fiber.dispose())
  const runtime = registerAgentTemplateRuntime(ctx, {
    catalogDir, subagentProvider: 'spawn', resolveModel: async () => ({ provider: 'test', model: 'test' }),
    workspaceRegistry: new ByClawSessionWorkspaceRegistry(),
  })
  const child = agent('fallback-child')
  const sibling = agent('fallback-sibling')
  const scope = createScope(ctx, child)
  const prepared = await runtime.prepareRoot('fallback-template')
  await scope.ctx.plugin({
    inject: ['systemPrompt'],
    apply(childCtx: Context) { prepared.setup(childCtx.extend({ agent: child })) },
  })
  expect((await ctx.skills.list({ scope: child })).map(s => s.name)).toEqual(['fallback-only'])
  expect(await ctx.skills.list({ scope: sibling })).toEqual([])
  await scope.dispose()
  expect(await ctx.skills.list({ scope: child })).toEqual([])
})

it('initializes the template runtime with the current Agent factory setup contract', async () => {
  const f = await fixture()
  const catalogDir = join(f.root, 'without-continuable-setup')
  f.ctx.provide('subagents', {})

  expect(() => registerAgentTemplateRuntime(f.ctx, {
    catalogDir,
    subagentProvider: 'spawn',
    resolveModel: async () => ({ provider: 'test', model: 'test' }),
    workspaceRegistry: new ByClawSessionWorkspaceRegistry(),
    skillRuntime: f.runtime,
  })).not.toThrow()
})

it('composes a Web-delegated employee from the live native parent workspace', async () => {
  const f = await fixture()
  const catalogDir = join(f.root, 'web')
  await writeAgentTemplate(catalogDir, f.templates[0]!)
  f.ctx.provide('subagents', {})
  const parent = agent('web-parent', { cwd: f.root })
  const child = agent('web-child', { parentSession: parent.id, cwd: f.root })
  cleanups.push(f.ctx.agents.register(parent))
  const workspaceRegistry = new ByClawSessionWorkspaceRegistry()
  registerAgentTemplateRuntime(f.ctx, {
    catalogDir, subagentProvider: 'spawn', resolveModel: async () => ({ provider: 'test', model: 'test' }),
    workspaceRegistry, skillRuntime: f.runtime,
  })
  f.ctx.agents.setFactory({
    async createAgent(_ownerCtx, options) {
      // The loop composes child services from its runtime context; ownerCtx
      // carries the caller lifetime and may be a Cordis service shadow.
      const scope = createScope(f.ctx, child)
      await scope.ctx.plugin({
        inject: ['systemPrompt'],
        async apply(ctx: Context) {
          const commit = await options.setup?.(ctx.extend({ agent: child }))
          expect(f.ctx.agents.get(child.id)).toBeUndefined()
          expect(workspaceRegistry.get(child.id)?.cwd).toBe(f.root)
          expect((await f.ctx.skills.list({ scope: child })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
          commit?.commit()
        },
      })
      const unregister = f.ctx.agents.register(child)
      return { agent: child, async dispose() { await unregister(); await scope.dispose() } }
    },
    async resume() { throw new Error('unexpected resume') },
  })
  let committed = false
  await f.ctx.plugin({
    inject: ['agents', 'systemPrompt'],
    async apply(ctx: Context) {
      const handle = await ctx.agents.create({
        sessionId: child.id,
        setup(childCtx) {
          childCtx.agent!.session.append('subagent/descriptor', snapshotSubagentDescriptor({
            mode: 'continuable', provider: 'spawn', label: 'byclaw-template:byclaw-employee-1:test',
          }))
          return { commit() { committed = true } }
        },
      })
      cleanups.push(() => handle.dispose())
    },
  })
  expect(committed).toBe(true)
  expect(workspaceRegistry.get(child.id)?.cwd).toBe(f.root)
  expect((await f.ctx.skills.list({ scope: child })).map(s => s.name)).toEqual(['builtin-help', 'html-artifact', 'unrelated-global'])
})

it('replaces the scoped persona prefix while preserving the deployment suffix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-persona-sections-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const employee = { ...template('persona-template', []), persona: 'EMPLOYEE_PERSONA_PREFIX' }
  await writeAgentTemplate(root, employee)
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { personaPrefix: 'DEPLOYMENT_DEFAULT_PREFIX', personaSuffix: 'DEPLOYMENT_RUNTIME_SUFFIX' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  cleanups.push(() => ctx.fiber.dispose())
  ctx.systemPrompt.section({ name: 'test:guidance', order: ctx.systemPrompt.getSectionOrder('PLAN_POLICY'), text: 'FIRST_PARTY_GUIDANCE' })
  const runtime = registerAgentTemplateRuntime(ctx, {
    catalogDir: root, subagentProvider: 'spawn', resolveModel: async () => ({ provider: 'test', model: 'test' }),
    workspaceRegistry: new ByClawSessionWorkspaceRegistry(),
  })
  const child = agent('persona-child')
  const scope = createScope(ctx, child)
  const prepared = await runtime.prepareRoot(employee.id)
  await scope.ctx.plugin({
    inject: ['systemPrompt'],
    apply(childCtx: Context) { prepared.setup(childCtx.extend({ agent: child })) },
  })
  const sections = (await ctx.systemPrompt.assemble({ scope: child })).sections
  expect(sections.filter(s => s.name === PERSONA_PREFIX_SECTION).map(s => s.text)).toEqual(['EMPLOYEE_PERSONA_PREFIX'])
  expect(sections.find(s => s.name === PERSONA_SUFFIX_SECTION)?.text).toBe('DEPLOYMENT_RUNTIME_SUFFIX')
  expect(sections.findIndex(s => s.name === PERSONA_PREFIX_SECTION)).toBeLessThan(sections.findIndex(s => s.name === 'test:guidance'))
  expect(sections.findIndex(s => s.name === PERSONA_SUFFIX_SECTION)).toBeGreaterThan(sections.findIndex(s => s.name === 'test:guidance'))
  expect((await ctx.systemPrompt.assemble()).sections.find(s => s.name === PERSONA_PREFIX_SECTION)?.text).toBe('DEPLOYMENT_DEFAULT_PREFIX')
  await scope.dispose()
  expect((await ctx.systemPrompt.assemble({ scope: child })).sections.find(s => s.name === PERSONA_PREFIX_SECTION)?.text).toBe('DEPLOYMENT_DEFAULT_PREFIX')
})


it.each(['create', 'resume'] as const)('binds AgentTeams %s children to the real ByClaw Skill runtime', async (method) => {
  const f = await fixture()
  const child = agent(`team-${method}`, { parentSession: SessionId('captain'), cwd: f.root })
  child.session.append('subagent/descriptor', snapshotSubagentDescriptor({
    mode: 'continuable', provider: 'spawn', label: 'agent-teams:team:worker',
    agentProvider: 'test', agentModel: 'test-model',
  }))
  const scope = createScope(f.ctx, child)
  cleanups.push(() => scope.dispose())
  f.ctx.provide('byclawSkills', f.runtime)
  const composition = scope.ctx.plugin({ inject: ['systemPrompt', 'byclawSkills'], apply() {} })
  await composition
  const childCtx = composition.ctx.extend({ agent: child })
  const factory = async (options: { setup?: (ctx: Context, child: Agent) => unknown }) => {
    await options.setup?.(childCtx, child)
    return { agent: child }
  }
  // Replace only the host factory: member setup and Skill binding remain real.
  const owner = {
    agents: { create: factory, resume: factory },
    effect: childCtx.effect.bind(childCtx),
  } as unknown as Context
  const selections = installMemberSelectionRuntime(owner, '.agent-teams')
  await selections.withPending('captain', 'agent-teams:team:worker',
    { provider: 'test', model: 'test-model' }, {
      id: '', name: 'worker', status: 'idle', joinedAt: 0,
      source: { kind: 'byclaw-digital-employee', employeeId: '1', employeeCode: 'worker',
        workerAgentType: 'BYCLAW_DSH', skills: [f.html] },
    }, () => owner.agents[method]({} as never))
  expect(f.runtime.agentId(child)).toBe('1')
  expect((await f.ctx.skills.get('html-artifact', { scope: child }))?.content).toContain('Bound HTML body')
  expect((await f.ctx.skills.list({ scope: child })).map(s => s.name)).not.toContain('other-employee')
  await scope.dispose()
  expect(f.runtime.agentId(child)).toBeUndefined()
})

it('reads employee Skills from the tool environment when the user tree lives there', async () => {
  const { createFakeToolEnvironment } = await import('../scripts/tool-environment-fakes.mjs')
  const { toolEnvironmentFiles } = await import('../src/tool-environment-files.ts')
  const { ByClawSkillRuntime, agentSkillRootFor } = await import('../src/skill-runtime.ts')
  const b = await createFakeToolEnvironment()
  cleanups.push(() => b.dispose())
  const root = await mkdtemp(join(tmpdir(), 'byclaw-skills-remote-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await skill(join(root, 'builtin'), 'builtin-help', 'Shared builtin')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  // The virtual B root does not exist on this host: only `ctx.fs` can serve it.
  const agentSkillRoot = agentSkillRootFor(join(b.virtual, 'by'))
  expect(existsSync(agentSkillRoot)).toBe(false)
  const runtime = await ByClawSkillRuntime.install(ctx, {
    builtinSkillDir: join(root, 'builtin'), agentSkillRoot, files: toolEnvironmentFiles(b.ctx),
  })
  cleanups.push(() => runtime.dispose())
  const employee = template('byclaw-employee-9', [])
  ;(await runtime.prepareGeneration([employee], root, root))()
  const who = agent('remote-a')
  runtime.bind(ctx.extend({ agent: who }), who, employee)
  // No employee Skill directory yet: absence on B is not an error.
  expect((await ctx.skills.list({ scope: who })).map(s => s.name)).toContain('builtin-help')
  const skills = b.toHost(join(agentSkillRoot, 'workspace-baiying-agent-byclaw-employee-9', 'skills'))
  await skill(skills, 'remote-local', 'Skill created on B', 'Remote body')
  await mkdir(join(skills, 'broken'), { recursive: true })
  await writeFile(join(skills, 'broken', 'SKILL.md'), '---\nname: broken\ndescription: \n---\nx')
  await writeFile(join(skills, 'stray-file'), 'not a Skill')
  expect((await ctx.skills.list({ scope: who })).map(s => s.name)).toEqual(expect.arrayContaining(['builtin-help', 'remote-local']))
  expect((await ctx.skills.list({ scope: who })).map(s => s.name)).not.toContain('broken')
  const loaded = await ctx.skills.get('remote-local', { scope: who })
  expect(loaded?.content).toContain('Remote body')
  expect(loaded?.path).toBe(join(agentSkillRoot, 'workspace-baiying-agent-byclaw-employee-9', 'skills', 'remote-local', 'SKILL.md'))
  expect(b.calls.fs.some(([operation]: [string]) => operation === 'listDir')).toBe(true)
  expect(b.calls.fs.some(([operation, path]: [string, string]) => operation === 'readText' && path.endsWith('remote-local/SKILL.md'))).toBe(true)
  // A Skill published in a staged generation also sees the B overlay.
  const errors: string[] = []
  const publish = await runtime.prepareGeneration([employee], root, root, { allowSkillFailure: true, onSkillError: ({ code }) => { errors.push(code) } })
  publish()
  expect(errors).toEqual(['broken'])
  expect((await ctx.skills.list({ scope: who })).map(s => s.name)).toContain('remote-local')
})

it('defers associated Skill I/O until lookup, coalesces concurrent lookups and rechecks on later reads', async () => {
  let loads = 0
  const f = await fixture({ resolveDeferredTemplate: async t => {
    loads++
    await new Promise(resolve => setTimeout(resolve, 10))
    return { ...t, skills: t.skills.map(({ ref: _ref, ...skill }) => skill) }
  } })
  const deferred = { ...f.templates[0]!, skills: [{ ...f.html, ref: {
    id: 'skill-1', code: f.html.code, type: 'hub', versionUrl: '/version', downloadUrl: '/skill.zip',
  } }] }
  ;(await f.runtime.prepareGeneration([deferred], f.cache, f.cache))()
  expect(loads).toBe(0)
  await Promise.all([f.ctx.skills.list({ scope: f.a }), f.ctx.skills.get('html-artifact', { scope: f.a })])
  expect(loads).toBe(1)
  await f.ctx.skills.get('html-artifact', { scope: f.a })
  expect(loads).toBe(2)
})

it('does not publish an in-flight lazy Skill after its authorization generation is replaced', async () => {
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture({ resolveDeferredTemplate: async t => {
    entered(); await gate
    return { ...t, skills: t.skills.map(({ ref: _ref, ...skill }) => skill) }
  } })
  ;(await f.runtime.prepareGeneration([{ ...f.templates[0]!, skills: [{ ...f.html, ref: {
    id: 'skill-1', code: f.html.code, type: 'hub', versionUrl: '/version', downloadUrl: '/skill.zip',
  } }] }], f.cache, f.cache))()
  const lookup = f.ctx.skills.get('html-artifact', { scope: f.a })
  const rejected = expect(lookup).rejects.toThrow('generation changed')
  await started
  ;(await f.runtime.prepareGeneration([], f.cache, f.cache))()
  release()
  await rejected
  expect(f.runtime.entries('byclaw-employee-1').some(x => x.path === f.html.path)).toBe(false)
})

it('retains an unrelated employee view and its in-flight lazy Skill during incremental publication', async () => {
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture({ resolveDeferredTemplate: async t => {
    entered(); await gate
    return { ...t, skills: t.skills.map(({ ref: _ref, ...skill }) => skill) }
  } })
  const deferred = { ...f.templates[0]!, skills: [{ ...f.html, ref: {
    id: 'skill-1', code: f.html.code, type: 'hub', versionUrl: '/version', downloadUrl: '/skill.zip',
  } }] }
  ;(await f.runtime.prepareGeneration([deferred], f.cache, f.cache))()
  const lookup = f.ctx.skills.get('html-artifact', { scope: f.a })
  await started
  ;(await f.runtime.prepareGeneration([deferred, f.templates[1]!], f.cache, f.cache,
    { retainTemplateIds: new Set([deferred.id]) }))()
  release()
  expect((await lookup)?.content).toContain('Bound HTML body')
  expect(f.runtime.entries(deferred.id).some(entry => entry.path === f.html.path)).toBe(true)
  expect(f.runtime.entries(f.templates[1]!.id).some(entry => entry.name === 'other-employee')).toBe(true)
})

it('discovers new associations for an initially empty lazy employee and observes their removal', async () => {
  let associations: DshAgentTemplate['skills'] = []
  const f = await fixture({ resolveDeferredTemplate: async t => ({ ...t, skills: associations }) })
  const empty = { ...f.templates[0]!, skills: [] }
  ;(await f.runtime.prepareGeneration([empty], f.cache, f.cache, { deferEmployeeTemplates: true }))()
  expect((await f.ctx.skills.get('html-artifact', { scope: f.a }))?.content).toBe('Wrong body')
  associations = [f.html]
  expect((await f.ctx.skills.get('html-artifact', { scope: f.a }))?.content).toContain('Bound HTML body')
  associations = []
  expect((await f.ctx.skills.get('html-artifact', { scope: f.a }))?.content).toBe('Wrong body')
})

it('prepares a cold coordinated root before reading its template and binds its employee Skills', async () => {
  let associations: DshAgentTemplate['skills'] = []
  const f = await fixture({ resolveDeferredTemplate: async t => ({ ...t, skills: associations }) })
  associations = [f.html]
  ;(await f.runtime.prepareGeneration([], f.cache, f.cache))()
  const { ByClawGroupCoordinationRuntime } = await import('../src/group-coordination.ts')
  const catalogDir = join(f.root, 'cold-coordination')
  const employee = { id: '1', name: 'Employee', code: 'EMP_1', description: '', capabilities: '', persona: '', workerAgentType: 'BYCLAW_DSH', skills: [] }
  const employeeTemplate = { ...f.templates[0]!, source: { ...f.templates[0]!.source, resourceId: '1' } }
  const coordination = { schemaVersion: 'byclaw.group-coordination/v1' as const, mode: 'DIRECT' as const,
    groupSessionId: 'group', taskSessionId: 'task', coordinatorAgentId: '1', allowedAgentIds: ['2'] }
  const preparations: string[] = []
  const preparedTemplates = new Map<string, DshAgentTemplate>()
  const policy = new ByClawGroupCoordinationRuntime({
    resources: () => ({ employees: [employee, { ...employee, id: '2' }], groups: [], directEmployeeIds: ['1', '2'], watchedResourceIds: ['1', '2'], authHeaders: {},
      authorization: { userId: 'test', authKey: 'test', resourceIds: ['1', '2'] } }),
    catalogDir, supportedWorkerTypes: ['BYCLAW_DSH'], resolveModel: async () => ({ provider: 'test', model: 'test' }),
    prepareEmployee: async id => {
      preparations.push(id)
      const selected = { ...employeeTemplate, id: `byclaw-employee-${id}`, source: { ...employeeTemplate.source, resourceId: id } }
      preparedTemplates.set(id, selected)
      await writeAgentTemplate(catalogDir, selected)
      ;(await f.runtime.prepareGeneration([...preparedTemplates.values()], f.cache, f.cache, { deferEmployeeTemplates: true }))()
    },
  })
  const runtime = registerAgentTemplateRuntime(f.ctx, { catalogDir, subagentProvider: 'spawn',
    resolveModel: async () => ({ provider: 'test', model: 'test' }), groupCoordination: policy,
    workspaceRegistry: new ByClawSessionWorkspaceRegistry(), skillRuntime: f.runtime })
  const prepared = await runtime.prepareRoot('byclaw-employee-1', coordination)
  expect(preparations).toEqual(['1'])
  const cold = agent('cold-coordinator')
  const scope = createScope(f.ctx, cold)
  cleanups.push(() => scope.dispose())
  await scope.ctx.plugin({ inject: ['systemPrompt'], apply(ctx: Context) { prepared.setup(ctx.extend({ agent: cold }), cold) } })
  expect((await f.ctx.skills.get('html-artifact', { scope: cold }))?.content).toContain('Bound HTML body')
  const memberPrepared = await runtime.prepareRoot('byclaw-employee-2', coordination)
  expect(preparations).toEqual(['1', '1', '2'])
  const member = agent('cold-direct-member')
  const memberScope = createScope(f.ctx, member)
  cleanups.push(() => memberScope.dispose())
  await memberScope.ctx.plugin({ inject: ['systemPrompt'], apply(ctx: Context) { memberPrepared.setup(ctx.extend({ agent: member }), member) } })
  expect((await f.ctx.skills.get('html-artifact', { scope: member }))?.content).toContain('Bound HTML body')
})
