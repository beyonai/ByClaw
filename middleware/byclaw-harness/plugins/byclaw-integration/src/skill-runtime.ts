/** Plugin-owned per-agent Skill views and atomically published ByClaw generations. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import type { DshAgentTemplate } from './agent-template.ts'
import { groupScope } from '@byclaw/dsh-agent-teams'
import { projectMemberSkill, revokeMemberSkillRoots, setActiveMemberSkillRoots } from './group-skill-resources.ts'
import type { ToolEnvironmentFiles } from './tool-environment-files.ts'

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

/** Default employee (agent-workspace) Skill root inside the user tree. */
export const AGENT_SKILLS_ROOT = '/by/.openclaw'

/** Employee (agent-workspace) Skill root beneath a user tree (`byRoot`). */
export function agentSkillRootFor(byRoot: string): string {
  return join(resolve(byRoot), '.openclaw')
}

/** Directory listing and text reads of employee Skills: this host by default, or the tool environment. */
interface WorkspaceSkillReader {
  list(path: string): Promise<Array<{ name: string; skillDirectory: boolean }>>
  read(path: string): Promise<string>
}

const hostWorkspaceSkills: WorkspaceSkillReader = {
  async list(path) {
    return (await readdir(path, { withFileTypes: true }))
      .map(entry => ({ name: entry.name, skillDirectory: entry.isDirectory() || entry.isSymbolicLink() }))
  },
  read: path => readFile(path, 'utf8'),
}

function toolEnvironmentWorkspaceSkills(files: ToolEnvironmentFiles): WorkspaceSkillReader {
  return {
    // Listing reports a symlink by its target type or as `other`; a non-directory then has no SKILL.md.
    async list(path) {
      return (await files.listDir(path)).map(entry => ({ name: entry.name, skillDirectory: entry.type !== 'file' }))
    },
    read: path => files.readText(path),
  }
}

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

async function readDefinition(
  readPath: string,
  publishedPath: string,
  code?: string,
  onCompatibleName?: (name: string) => void,
  read: (path: string) => Promise<string> = path => readFile(path, 'utf8'),
): Promise<SkillDefinition> {
  const raw = (await read(readPath)).replace(/^\uFEFF/u, '')
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
  reader: WorkspaceSkillReader = hostWorkspaceSkills,
): Promise<View | undefined> {
  const root = agentWorkspaceSkillRoot(skillsRoot, agentId)
  let entries: Array<{ name: string; skillDirectory: boolean }>
  try {
    entries = await reader.list(root)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const definitions: SkillDefinition[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.skillDirectory) continue
    const skillPath = join(root, entry.name, 'SKILL.md')
    try {
      const definition = await readDefinition(skillPath, skillPath, undefined, undefined, reader.read)
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
  private readonly bindings = new WeakMap<object, Binding>()
  private generations = new Map<string, View>()
  private readonly projectedMembers = new Set<string>()
  private readonly disposers: Array<() => void> = []
  private readonly reportedWorkspaceErrors = new Set<string>()
  private disposed = false

  private constructor(
    private readonly builtins: View,
    private readonly agentSkillRoot: string,
    private readonly reportWorkspaceError: (path: string, error: unknown) => void,
    private readonly workspaceSkills: WorkspaceSkillReader = hostWorkspaceSkills,
    private readonly dshHome?: string,
  ) {}

  /** Load deployment Skills once and install lifecycle-owned registry adapters. */
  static async install(ctx: Context, options: {
    builtinSkillDir?: string
    /** Employee Skill root; defaults to `/by/.openclaw`. */
    agentSkillRoot?: string
    /** Read employee Skills in the separate tool environment holding the user tree. */
    files?: ToolEnvironmentFiles
    /** This context's DSH home for group-member Skill copies; defaults to `DSH_HOME`. */
    dshHome?: string
  } = {}): Promise<ByClawSkillRuntime> {
    const root = resolveBuiltinSkillDir(options.builtinSkillDir)
    const definitions: SkillDefinition[] = []
    for (const entry of (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const path = join(root, entry.name, 'SKILL.md')
      try { definitions.push(await readDefinition(path, path)) } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    if (new Set(definitions.map(s => s.name)).size !== definitions.length) throw new Error('duplicate builtin Skill names')
    const runtime = new ByClawSkillRuntime(
      viewOf(definitions),
      options.agentSkillRoot ?? AGENT_SKILLS_ROOT,
      (path, error) => ctx.logger.error(`[byclaw-dsh] Invalid agent workspace Skill ${path}; skipping: ${String(error)}`),
      options.files === undefined ? hostWorkspaceSkills : toolEnvironmentWorkspaceSkills(options.files),
      options.dshHome,
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
    const next = new Map<string, View>()
    const loaded = new Map<string, { definition: SkillDefinition; originalName?: string } | { error: unknown }>()
    for (const template of templates) {
      const merged = new Map(this.builtins.definitions)
      const associated = new Set<string>()
      for (const source of template.skills) {
        const suffix = relative(resolve(liveRoot), resolve(source.path))
        if (suffix === '' || suffix === '..' || suffix.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(suffix)) {
          throw new Error(`Skill ${source.code} is outside the ByClaw generation cache`)
        }
        let loadedSkill = loaded.get(source.path)
        if (loadedSkill === undefined) {
          try {
            let originalName: string | undefined
            const definition = await readDefinition(
              join(stagedRoot, suffix, 'SKILL.md'),
              join(source.path, 'SKILL.md'),
              source.code,
              name => { originalName = name },
            )
            loadedSkill = { definition, originalName }
          } catch (error: unknown) {
            loadedSkill = { error }
          }
          loaded.set(source.path, loadedSkill)
        }
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
        for (const entry of (await this.workspaceSkills.list(workspaceRoot)).sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.skillDirectory) continue
          const skillPath = join(workspaceRoot, entry.name, 'SKILL.md')
          try {
            const definition = await readDefinition(skillPath, skillPath, undefined, undefined, this.workspaceSkills.read)
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
      next.set(template.id, viewOf(merged.values()))
    }
    return () => { if (!this.disposed) {
      // Publication is synchronous: revoke earlier projections before any future tool call.
      for (const agentId of this.projectedMembers) revokeMemberSkillRoots(agentId)
      this.generations = next
    } }
  }

  /** Remove all adapters and listeners; repeated disposal is harmless. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
    this.generations.clear()
    for (const agentId of this.projectedMembers) revokeMemberSkillRoots(agentId)
    this.projectedMembers.clear()
  }

  private bindingForScope(scope?: object): Binding | undefined {
    return scope === undefined ? undefined : this.bindings.get(scope)
  }

  private forBinding(binding?: Binding): View | undefined {
    return binding === undefined ? undefined : this.generations.get(binding.templateId) ?? this.builtins
  }

  private async effectiveView(binding?: Binding): Promise<View> {
    const base = this.forBinding(binding) ?? this.builtins
    if (binding === undefined) return base
    const workspace = await readAgentWorkspaceView(this.agentSkillRoot, binding.agentId, (path, error) => {
      const key = `${path}\0${String(error)}`
      if (this.reportedWorkspaceErrors.has(key)) return
      this.reportedWorkspaceErrors.add(key)
      this.reportWorkspaceError(path, error)
    }, this.workspaceSkills)
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
      const definitions = await Promise.all([...view.definitions.values()].map(definition => projectMemberSkill(String(agent.id), definition, view.digest, runtime.dshHome)))
      if (runtime.disposed) throw new Error('ByClaw Skill runtime is disposed')
      const current = await runtime.effectiveView(runtime.bindingForScope(scope))
      if (current.digest !== view.digest) return present(current, scope)
      setActiveMemberSkillRoots(String(agent.id), definitions.flatMap(definition => definition.resourceBase === undefined ? [] : [definition.resourceBase.path]), runtime.dshHome)
      runtime.projectedMembers.add(String(agent.id))
      return { definitions: new Map(definitions.map(definition => [definition.name, definition])), digest: view.digest }
    }
    const visibleSummaries = async (view: View, scope?: object): Promise<SkillSummary[]> => summaries(await present(view, scope))
    const wrappers: Registry = {
      async list(options = {}) {
        options.signal?.throwIfAborted()
        const view = await runtime.effectiveView(runtime.bindingForScope(options.scope))
        return groupScope(ctx, String((options.scope as Agent | undefined)?.id))?.role === 'member' ? await visibleSummaries(view, options.scope) : mergeSummaries(await original.list.call(this, options), view)
      },
      async snapshot(options = {}) {
        options.signal?.throwIfAborted()
        const view = await runtime.effectiveView(runtime.bindingForScope(options.scope))
        if (groupScope(ctx, String((options.scope as Agent | undefined)?.id))?.role === 'member') return { skills: await visibleSummaries(view, options.scope), complete: true }
        const snapshot = await original.snapshot.call(this, options)
        return { ...snapshot, skills: mergeSummaries(snapshot.skills, view) }
      },
      async get(name, options = {}) {
        options.signal?.throwIfAborted()
        const binding = runtime.bindingForScope(options.scope)
        const view = await runtime.effectiveView(binding)
        const owned = (await present(view, options.scope)).definitions.get(name)
        if (owned !== undefined) return runtime.withAgentRuntimeEnvironment(owned, binding)
        return groupScope(ctx, String((options.scope as Agent | undefined)?.id))?.role === 'member' ? undefined : original.get.call(this, name, options)
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
    this.disposers.push(ctx.effect(() => () => { this.disposed = true; this.generations.clear(); for (const agentId of this.projectedMembers) revokeMemberSkillRoots(agentId); this.projectedMembers.clear() }, 'byclaw-skills:lifecycle'))
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
