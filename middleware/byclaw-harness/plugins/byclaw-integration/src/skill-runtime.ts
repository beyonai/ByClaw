import { AsyncLocalStorage } from 'node:async_hooks'
/** Plugin-owned per-agent Skill views and atomically published ByClaw generations. */
import { mapConcurrent } from './startup-concurrency.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import type { DshAgentTemplate } from './agent-template.ts'
import { groupScope } from '@byclaw/dsh-agent-teams'
import { projectMemberSkill, revokeMemberSkillRoots, setActiveMemberSkillRoots } from './group-skill-resources.ts'

/** Structural registry API supported by the adapter; no DSH implementation is replaced. */
interface SkillSummary {
  name: string
  description: string
  source: string
  provider: string
  invocation: { modelInvocable: boolean; userInvocable: boolean }
  path?: string
  resourceBase?: { kind: 'directory'; path: string }
}
interface SkillDefinition extends SkillSummary { content: string }
interface Lookup { scope?: object; cwd?: string; signal?: AbortSignal }
interface SkillSnapshot { skills: SkillSummary[]; complete: boolean }
interface Registry {
  list(options?: Lookup): Promise<SkillSummary[]>
  snapshot(options?: Lookup): Promise<SkillSnapshot>
  get(name: string, options?: Lookup): Promise<SkillDefinition | undefined>
}
interface View { definitions: Map<string, SkillDefinition>; digest: string }
interface Binding {
  templateId: string
  agentId: string
  dshAgentId: string
}

const AGENT_SKILLS_ROOT = '/by/.openclaw'

function agentWorkspaceSkillRoot(root: string, agentId: string): string {
  return join(root, `workspace-baiying-agent-${agentId}`, 'skills')
}

export interface ByClawSkillPreparationError {
  templateId: string
  code: string
  path: string
  error: unknown
}

export interface ByClawSkillPreparationRename {
  templateId: string
  code: string
  path: string
  originalName: string
  runtimeName: string
}

export interface ByClawSkillPreparationOptions {
  allowSkillFailure?: boolean
  onSkillError?: (failure: ByClawSkillPreparationError) => void
  onSkillRename?: (rename: ByClawSkillPreparationRename) => void
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'byclaw-skill-revision': { kind: 'byclaw-skill-revision'; form: 'instructions'; digest: string }
  }
}

/** Resolve the immutable deployment payload, independently of user/project Skill roots. */
export function resolveBuiltinSkillDir(configured?: string): string {
  return resolve(configured?.trim() || process.env['BYCLAW_SKILLS_DIR']?.trim()
    || fileURLToPath(new URL('../../../builtin/skills/', import.meta.url)))
}

function booleanField(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error(`Skill ${key} must be a boolean`)
  return value
}

async function readDefinition(readPath: string, publishedPath: string, code?: string, onCompatibleName?: (name: string) => void): Promise<SkillDefinition> {
  const raw = (await readFile(readPath, 'utf8')).replace(/^\uFEFF/u, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(raw)
  const parsed: unknown = match === null ? {} : load(match[1]!)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error(`invalid Skill metadata: ${readPath}`)
  const data = parsed as Record<string, unknown>
  let name = data['name'] ?? code
  // Some published ByClaw archives suffix their stable code with a dotted version.
  // Adapt only this known format; do not turn arbitrary invalid names into valid Skills.
  if (typeof name === 'string' && code !== undefined && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(code)
    && name.startsWith(`${code}-`) && /^v?\d+(?:\.\d+)+(?:-[a-z0-9-]+)?$/u.test(name.slice(code.length + 1))) {
    onCompatibleName?.(name)
    name = code
  }
  const description = data['description'] ?? (code === undefined ? undefined : `ByClaw Skill ${code}`)
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)
    || typeof description !== 'string' || description.trim() === '') {
    throw new Error(
      `invalid Skill name/description: ${readPath} `
      + `(name=${JSON.stringify(name)}, descriptionType=${typeof description})`,
    )
  }
  return {
    name, description, content: match === null ? raw : raw.slice(match[0].length).trimStart(),
    source: code === undefined ? 'bundled' : 'runtime', provider: 'byclaw', path: publishedPath,
    resourceBase: { kind: 'directory', path: dirname(publishedPath) },
    invocation: {
      modelInvocable: !booleanField(data, 'disable-model-invocation', false),
      userInvocable: booleanField(data, 'user-invocable', true),
    },
  }
}

function viewOf(skills: Iterable<SkillDefinition>): View {
  const definitions = new Map([...skills].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(s => [s.name, s]))
  return { definitions, digest: createHash('sha256').update(JSON.stringify([...definitions.values()])).digest('hex') }
}

function uniqueRuntimeSkillName(
  name: string,
  code: string,
  path: string,
  merged: ReadonlyMap<string, SkillDefinition>,
): string | undefined {
  const slug = code.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  const suffix = slug === ''
    ? createHash('sha256').update(`${code}\0${path}`).digest('hex').slice(0, 12)
    : slug.length > 32 ? slug.slice(0, 12) : slug
  const base = `${name}-${suffix}`
  for (let attempt = 1; attempt <= 1_000; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`
    if (!merged.has(candidate)) return candidate
  }
  return undefined
}

function summaries(view: View): SkillSummary[] {
  return [...view.definitions.values()].map(({ content: _content, ...summary }) => structuredClone(summary))
}
function mergeSummaries(base: readonly SkillSummary[], overlay: View): SkillSummary[] {
  const merged = new Map(base.map(s => [s.name, s]))
  for (const item of summaries(overlay)) merged.set(item.name, item)
  return [...merged.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

async function readAgentWorkspaceView(
  skillsRoot: string,
  agentId: string,
  onInvalidSkill: (path: string, error: unknown) => void,
): Promise<View | undefined> {
  const root = agentWorkspaceSkillRoot(skillsRoot, agentId)
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const definitions: SkillDefinition[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const skillPath = join(root, entry.name, 'SKILL.md')
    try {
      const definition = await readDefinition(skillPath, skillPath)
      definitions.push({ ...definition, source: 'agent-workspace', provider: 'byclaw' })
    } catch (error: unknown) {
      // A malformed workspace Skill must not make the entire Agent turn fail.
      // The validator can report the exact file and the next refresh can pick it up.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      if ((error as NodeJS.ErrnoException).code !== undefined) throw error
      onInvalidSkill(skillPath, error)
    }
  }
  return definitions.length === 0 ? undefined : viewOf(definitions)
}

/** Bind agent identities to current template resources while retaining the standard DSH catalog/tool. */
export class ByClawSkillRuntime {
  private readonly originalCalls = new AsyncLocalStorage<boolean>()
  private readonly bindings = new WeakMap<object, Binding>()
  private generations = new Map<string, View>()
  private deferred = new Map<string, { template: DshAgentTemplate; root: string; options: ByClawSkillPreparationOptions }>()
  private readonly loading = new Map<string, Promise<void>>()
  private readonly projectedMembers = new Set<string>()
  private readonly disposers: Array<() => void> = []
  private readonly reportedWorkspaceErrors = new Set<string>()
  private disposed = false

  private constructor(
    private readonly builtins: View,
    private readonly agentSkillRoot: string,
    private readonly reportWorkspaceError: (path: string, error: unknown) => void,
    private readonly resolveDeferredTemplate?: (template: DshAgentTemplate) => Promise<DshAgentTemplate>,
  ) {}

  /** Load deployment Skills once and install lifecycle-owned registry adapters. */
  static async install(ctx: Context, options: { builtinSkillDir?: string; agentSkillRoot?: string; resolveDeferredTemplate?: (template: DshAgentTemplate) => Promise<DshAgentTemplate> } = {}): Promise<ByClawSkillRuntime> {
    const root = resolveBuiltinSkillDir(options.builtinSkillDir)
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink()).sort((a, b) => a.name.localeCompare(b.name))
    const loaded = await mapConcurrent(entries, 8, async entry => {
      const path = join(root, entry.name, 'SKILL.md')
      try { return await readDefinition(path, path) } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return undefined
      }
    })
    const definitions = loaded.filter((definition): definition is SkillDefinition => definition !== undefined)
    if (new Set(definitions.map(s => s.name)).size !== definitions.length) throw new Error('duplicate builtin Skill names')
    const runtime = new ByClawSkillRuntime(
      viewOf(definitions),
      options.agentSkillRoot ?? AGENT_SKILLS_ROOT,
      (path, error) => ctx.logger.error(`[byclaw-dsh] Invalid agent workspace Skill ${path}; skipping: ${String(error)}`),
      options.resolveDeferredTemplate,
    )
    runtime.installAdapters(ctx)
    return runtime
  }

  /** Bind a root, delegated template, or expert-team member for its agent lifetime. */
  bind(agentCtx: Context, agent: Agent, template: Pick<DshAgentTemplate, 'id' | 'source'>): () => void {
    if (this.disposed) throw new Error('ByClaw Skill runtime is disposed')
    const existing = this.bindings.get(agent)
    if (existing !== undefined) throw new Error(`ByClaw Skill binding already exists for ${agent.id}`)
    const binding = {
      templateId: template.id,
      agentId: template.source.resourceId,
      dshAgentId: String(agent.id),
    }
    return agentCtx.effect(() => {
      this.bindings.set(agent, binding)
      return () => { if (this.bindings.get(agent) === binding) this.bindings.delete(agent); revokeMemberSkillRoots(String(agent.id)); this.projectedMembers.delete(String(agent.id)) }
    }, `byclaw-skills:${template.id}`)
  }

  /** Return the trusted ByClaw business resource ID bound to an Agent. */
  agentId(agent: Agent): string | undefined {
    return this.bindingForScope(agent)?.agentId
  }

  /** Describe the complete effective view for runtime logs without Skill bodies. */
  entries(templateId: string): Array<{ name: string; path: string }> {
    return [...(this.generations.get(templateId) ?? this.builtins).definitions.values()]
      .map(skill => ({ name: skill.name, path: skill.resourceBase!.path }))
  }

  /** Read a staged generation before publication; the returned commit performs no I/O and cannot partially publish. */
  async prepareGeneration(
    templates: readonly DshAgentTemplate[],
    stagedRoot: string,
    liveRoot: string,
    options: ByClawSkillPreparationOptions = {},
  ): Promise<() => void> {
    const deferred = new Map<string, { template: DshAgentTemplate; root: string; options: ByClawSkillPreparationOptions }>()
    const immediate = templates.filter(template => {
      if (!template.skills.some(skill => skill.ref !== undefined)) return true
      if (this.resolveDeferredTemplate === undefined) throw new Error('ByClaw deferred Skill loader is unavailable')
      deferred.set(template.id, { template, root: liveRoot, options })
      return false
    })
    const next = await this.readViews(immediate, stagedRoot, liveRoot, options)
    for (const id of deferred.keys()) next.set(id, this.builtins)
    return () => { if (!this.disposed) {
      for (const agentId of this.projectedMembers) revokeMemberSkillRoots(agentId)
      this.generations = next
      this.deferred = deferred
      this.loading.clear()
    } }
  }

  private async readViews(templates: readonly DshAgentTemplate[], stagedRoot: string, liveRoot: string,
    options: ByClawSkillPreparationOptions): Promise<Map<string, View>> {
    const next = new Map<string, View>()
    const loaded = new Map<string, Promise<{ definition: SkillDefinition; originalName?: string } | { error: unknown }>>()
    const views = await mapConcurrent(templates, 8, async template => {
      const merged = new Map(this.builtins.definitions)
      const associated = new Set<string>()
      for (const source of template.skills) {
        const suffix = relative(resolve(liveRoot), resolve(source.path))
        if (suffix === '' || suffix === '..' || suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(suffix)) {
          throw new Error(`Skill ${source.code} is outside the ByClaw generation cache`)
        }
        const key = JSON.stringify([source.path, source.code])
        let pending = loaded.get(key)
        if (pending === undefined) {
          pending = (async () => {
            try {
              let originalName: string | undefined
              const definition = await readDefinition(
                join(stagedRoot, suffix, 'SKILL.md'), join(source.path, 'SKILL.md'), source.code,
                name => { originalName = name },
              )
              return { definition, originalName }
            } catch (error: unknown) { return { error } }
          })()
          loaded.set(key, pending)
        }
        const loadedSkill = await pending
        if ('error' in loadedSkill) {
          options.onSkillError?.({ templateId: template.id, code: source.code, path: source.path, error: loadedSkill.error })
          if (options.allowSkillFailure !== true) throw loadedSkill.error
          continue
        }
        const definition = loadedSkill.definition
        if (loadedSkill.originalName !== undefined) {
          options.onSkillRename?.({ templateId: template.id, code: source.code, path: source.path,
            originalName: loadedSkill.originalName, runtimeName: definition.name })
        }
        if (associated.has(definition.name)) {
          const error = new Error(`duplicate associated Skill ${definition.name} in ${template.id}`)
          if (options.allowSkillFailure !== true) {
            options.onSkillError?.({ templateId: template.id, code: source.code, path: source.path, error })
            throw error
          }
          const runtimeName = uniqueRuntimeSkillName(definition.name, source.code, source.path, merged)
          if (runtimeName === undefined) {
            options.onSkillError?.({
              templateId: template.id,
              code: source.code,
              path: source.path,
              error: new Error(`${error.message}; unable to allocate a unique runtime name`),
            })
            continue
          }
          options.onSkillRename?.({
            templateId: template.id,
            code: source.code,
            path: source.path,
            originalName: definition.name,
            runtimeName,
          })
          associated.add(runtimeName)
          merged.set(runtimeName, { ...definition, name: runtimeName })
          continue
        }
        associated.add(definition.name)
        merged.set(definition.name, definition)
      }
      // Agent-local Skills are the final overlay: skill-creator edits here must
      // win over bundled and resource-projected Skills with the same name.
      const workspaceRoot = agentWorkspaceSkillRoot(this.agentSkillRoot, template.source.resourceId)
      try {
        for (const entry of (await readdir(workspaceRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
          const skillPath = join(workspaceRoot, entry.name, 'SKILL.md')
          try {
            const definition = await readDefinition(skillPath, skillPath)
            merged.set(definition.name, { ...definition, source: 'agent-workspace', provider: 'byclaw' })
          } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
            options.onSkillError?.({ templateId: template.id, code: entry.name, path: skillPath, error })
            if (options.allowSkillFailure !== true) throw error
          }
        }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      return [template.id, viewOf(merged.values())] as const
    })
    for (const [id, view] of views) next.set(id, view)
    return next
  }

  private async loadDeferred(templateId: string): Promise<void> {
    const generation = this.deferred
    const entry = generation.get(templateId)
    if (entry === undefined) return
    const pending = this.loading.get(templateId)
    if (pending !== undefined) return pending
    const operation = (async () => {
      const template = await this.resolveDeferredTemplate!(entry.template)
      const views = await this.readViews([template], entry.root, entry.root, entry.options)
      if (this.disposed) throw new Error('ByClaw Skill runtime is disposed')
      if (this.deferred !== generation) throw new Error('ByClaw Skill authorization generation changed during loading; retry lookup')
      this.generations.set(templateId, views.get(templateId) ?? this.builtins)
    })()
    this.loading.set(templateId, operation)
    try { await operation } finally { if (this.loading.get(templateId) === operation) this.loading.delete(templateId) }
  }

  /** Remove all adapters and listeners; repeated disposal is harmless. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
    this.generations.clear()
    this.deferred.clear()
    this.loading.clear()
    for (const agentId of this.projectedMembers) revokeMemberSkillRoots(agentId)
    this.projectedMembers.clear()
  }

  private bindingForScope(scope?: object): Binding | undefined {
    return scope === undefined ? undefined : this.bindings.get(scope)
  }

  private forBinding(binding?: Binding): View | undefined {
    return binding === undefined ? undefined : this.generations.get(binding.templateId) ?? this.builtins
  }

  private async effectiveView(binding?: Binding, refresh = true): Promise<View> {
    if (refresh && !this.originalCalls.getStore() && binding !== undefined) await this.loadDeferred(binding.templateId)
    const base = this.forBinding(binding) ?? this.builtins
    if (binding === undefined) return base
    const workspace = await readAgentWorkspaceView(this.agentSkillRoot, binding.agentId, (path, error) => {
      const key = `${path}\0${String(error)}`
      if (this.reportedWorkspaceErrors.has(key)) return
      this.reportedWorkspaceErrors.add(key)
      this.reportWorkspaceError(path, error)
    })
    if (workspace === undefined) return base
    const merged = new Map(base.definitions)
    for (const definition of workspace.definitions.values()) merged.set(definition.name, definition)
    return viewOf(merged.values())
  }

  private installAdapters(ctx: Context): void {
    const skills = ctx.get('skills') as unknown as Registry | undefined
    if (skills === undefined) throw new Error('ByClaw requires the DSH Skill registry')
    const runtime = this
    this.disposers.push(ctx.systemPrompt.section({
      name: 'byclaw:skill-creator-policy',
      order: 115,
      text: 'Skill workflow invariant: before creating, editing, or updating any Skill, you must load the `skill-creator` Skill first and follow the instructions it provides. This applies to existing Skills, newly created Skills, root Agents, and delegated Agents alike.',
    }))
    const original = { list: skills.list, snapshot: skills.snapshot, get: skills.get }
    const present = async (view: View, scope?: object): Promise<View> => {
      const agent = scope as Agent | undefined
      if (agent === undefined || groupScope(ctx, String(agent.id))?.role !== 'member') return view
      const definitions = await Promise.all([...view.definitions.values()].map(definition => projectMemberSkill(String(agent.id), definition, view.digest)))
      if (runtime.disposed) throw new Error('ByClaw Skill runtime is disposed')
      const current = await runtime.effectiveView(runtime.bindingForScope(scope), false)
      if (current.digest !== view.digest) return present(current, scope)
      setActiveMemberSkillRoots(String(agent.id), definitions.flatMap(definition => definition.resourceBase === undefined ? [] : [definition.resourceBase.path]))
      runtime.projectedMembers.add(String(agent.id))
      return { definitions: new Map(definitions.map(definition => [definition.name, definition])), digest: view.digest }
    }
    const visibleSummaries = async (view: View, scope?: object): Promise<SkillSummary[]> => summaries(await present(view, scope))
    const wrappers: Registry = {
      async list(options = {}) {
        options.signal?.throwIfAborted()
        const view = await runtime.effectiveView(runtime.bindingForScope(options.scope))
        return groupScope(ctx, String((options.scope as Agent | undefined)?.id))?.role === 'member' ? await visibleSummaries(view, options.scope) : mergeSummaries(await runtime.originalCalls.run(true, () => original.list.call(this, options)), view)
      },
      async snapshot(options = {}) {
        options.signal?.throwIfAborted()
        const view = await runtime.effectiveView(runtime.bindingForScope(options.scope))
        if (groupScope(ctx, String((options.scope as Agent | undefined)?.id))?.role === 'member') return { skills: await visibleSummaries(view, options.scope), complete: true }
        const snapshot = await runtime.originalCalls.run(true, () => original.snapshot.call(this, options))
        return { ...snapshot, skills: mergeSummaries(snapshot.skills, view) }
      },
      async get(name, options = {}) {
        options.signal?.throwIfAborted()
        const binding = runtime.bindingForScope(options.scope)
        const view = await runtime.effectiveView(binding)
        const owned = (await present(view, options.scope)).definitions.get(name)
        if (owned !== undefined) return runtime.withAgentRuntimeEnvironment(owned, binding)
        return groupScope(ctx, String((options.scope as Agent | undefined)?.id))?.role === 'member' ? undefined : runtime.originalCalls.run(true, () => original.get.call(this, name, options))
      },
    }
    this.disposers.push(ctx.effect(() => {
      const previous = new Map(Object.keys(wrappers).map(key => [key, Object.getOwnPropertyDescriptor(skills, key)]))
      for (const key of ['list', 'snapshot', 'get'] as const) {
        Object.defineProperty(skills, key, { configurable: true, writable: true, value: wrappers[key] })
      }
      return () => {
        for (const key of ['list', 'snapshot', 'get'] as const) {
          if (Object.getOwnPropertyDescriptor(skills, key)?.value !== wrappers[key]) continue
          const descriptor = previous.get(key)
          if (descriptor === undefined) Reflect.deleteProperty(skills, key)
          else Object.defineProperty(skills, key, descriptor)
        }
      }
    }, 'byclaw-skills:registry-view'))
    this.disposers.push(ctx.on('agent/pre-step', async ({ agent }, next) => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const view = this.forBinding(this.bindingForScope(agent))
      if (view === undefined) return decision
      const previous = this.lastRevision(agent)
      if (previous === view.digest) return decision
      return { ...decision, messages: [...decision.messages, createUserMessage({
        source: { kind: 'byclaw-skill-revision', form: 'instructions', digest: view.digest },
        content: [{ type: 'text', text: previous === undefined
          ? 'This agent uses the existing DSH Skills plus deployment builtin Skills and its currently associated Skills. Use the available skill catalog and load Skill instructions on demand.'
          : 'Skill resources changed. Reload any Skill before relying on its earlier instructions. Only the current available skill catalog applies.' }],
      })] }
    }))
    this.disposers.push(ctx.effect(() => () => { this.disposed = true; this.generations.clear(); this.deferred.clear(); this.loading.clear(); for (const agentId of this.projectedMembers) revokeMemberSkillRoots(agentId); this.projectedMembers.clear() }, 'byclaw-skills:lifecycle'))
  }

  private lastRevision(agent: Agent): string | undefined {
    for (const event of [...agent.session.ownEvents()].reverse()) {
      if (event.type === 'user/message' && event.data.source.kind === 'byclaw-skill-revision') return event.data.source.digest
    }
    return undefined
  }

  private withAgentRuntimeEnvironment(definition: SkillDefinition, binding: Binding | undefined): SkillDefinition {
    if (binding === undefined) return structuredClone(definition)
    const quote = (value: string): string => `'${value.replace(/'/gu, "'\\''")}'`
    const command = `env BYCLAW_AGENT_ID="$DSH_BYCLAW_AGENT_ID" BYCLAW_DSH_AGENT_ID=${quote(binding.dshAgentId)}`
    return {
      ...structuredClone(definition),
      content: `${definition.content}\n\n## ByClaw runtime environment\n\nThe shell runtime injects the trusted, read-only identity DSH_BYCLAW_AGENT_ID for this Agent. When a Skill runs a local script through Bash, prefix the script command with:\n\n\`\`\`sh\n${command} <script-command>\n\`\`\`\n\nThe variables are scoped to that command and its child processes only. Never invent, override, or export DSH_BYCLAW_AGENT_ID; skill-creator validates it as the source of truth.`,
    }
  }
}
