/** Machine-global expert-team templates and workspace-runtime pointers. */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { agentTeamsRuntimeRoot, canonicalRuntimePath, isPathWithin, resolveTeamStateRoot } from './runtime-state.ts'
import { readTeam, sanitizeKey } from './state.ts'
import type { ByClawMemberSource, TaskStatus, TeamState } from './types.ts'

export interface ExpertTemplateMember {
  name: string
  role?: string
  provider?: string
  model?: string
  source?: ByClawMemberSource
}

export interface ExpertTeamTemplate {
  version: 1
  id: string
  name: string
  description?: string
  members: ExpertTemplateMember[]
  createdAt: number
  updatedAt: number
}

export interface ExpertTeamTemplateInput {
  id?: string
  name: string
  description?: string
  members: ExpertTemplateMember[]
}

export interface RuntimeInstancePointer {
  version: 1
  id: string
  teamId: string
  teamName: string
  workspace: string
  stateRoot: string
  captainSessionId: string
  createdAt: number
}

export interface RuntimeInstanceView extends RuntimeInstancePointer {
  status: 'active' | 'stale'
  lifecycle?: string
  description?: string
  controlledWorkflow?: boolean
  memberCount: number
  taskCount: number
  members: Array<{
    name: string
    role?: string
    provider?: string
    model?: string
    status: string
  }>
  taskStatusCounts: Partial<Record<TaskStatus, number>>
}

/** Resolve the catalog without depending on the caller's working directory. */
export function defaultCatalogDir(): string {
  const dshHome = process.env['DSH_HOME']?.trim()
  return join(dshHome === undefined || dshHome === '' ? join(homedir(), '.dsh') : dshHome, 'agent-teams')
}

function templatesDir(catalogDir: string): string {
  return join(catalogDir, 'templates')
}

/** Exact filename shared by publication, revocation and generation staging. */
export function teamTemplateFileName(id: string): string {
  return `${sanitizeKey(id)}.json`
}

function instancesDir(catalogDir: string): string {
  return join(catalogDir, 'instances')
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error: unknown) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

async function jsonFiles(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => join(path, entry.name))
      .sort()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/u, '')) as unknown
}

function normalizeMember(value: ExpertTemplateMember): ExpertTemplateMember {
  const name = value.name.trim()
  if (name === '') throw new Error('template member name must not be empty')
  return {
    name,
    ...value.role === undefined || value.role.trim() === '' ? {} : { role: value.role.trim() },
    ...value.provider === undefined || value.provider.trim() === '' ? {} : { provider: value.provider.trim() },
    ...value.model === undefined || value.model.trim() === '' ? {} : { model: value.model.trim() },
    ...value.source === undefined ? {} : { source: structuredClone(value.source) },
  }
}

function isTemplate(value: unknown): value is ExpertTeamTemplate {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record['version'] === 1 && typeof record['id'] === 'string' && record['id'] !== ''
    && typeof record['name'] === 'string' && record['name'] !== ''
    && (record['description'] === undefined || typeof record['description'] === 'string')
    && Array.isArray(record['members'])
    && record['members'].every(member => typeof member === 'object' && member !== null
      && typeof (member as Record<string, unknown>)['name'] === 'string')
    && typeof record['createdAt'] === 'number' && typeof record['updatedAt'] === 'number'
}

function isPointer(value: unknown): value is RuntimeInstancePointer {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record['version'] === 1 && typeof record['id'] === 'string'
    && typeof record['teamId'] === 'string' && typeof record['teamName'] === 'string'
    && typeof record['workspace'] === 'string' && typeof record['stateRoot'] === 'string'
    && typeof record['captainSessionId'] === 'string' && typeof record['createdAt'] === 'number'
}

export async function writeTeamTemplate(
  catalogDir: string,
  input: ExpertTeamTemplateInput,
): Promise<ExpertTeamTemplate> {
  const name = input.name.trim()
  if (name === '') throw new Error('template name must not be empty')
  const id = sanitizeKey(input.id?.trim() || name)
  const path = join(templatesDir(catalogDir), `${id}.json`)
  const previous = await readJson(path).catch(() => undefined)
  const createdAt = isTemplate(previous) ? previous.createdAt : Date.now()
  const template: ExpertTeamTemplate = {
    version: 1,
    id,
    name,
    ...input.description === undefined || input.description.trim() === '' ? {} : { description: input.description.trim() },
    members: input.members.map(normalizeMember),
    createdAt,
    updatedAt: Date.now(),
  }
  const memberKeys = template.members.map(member => sanitizeKey(member.name))
  if (new Set(memberKeys).size !== memberKeys.length) throw new Error('template member names must be unique')
  await writeJsonAtomic(path, template)
  return template
}

export async function readTeamTemplate(catalogDir: string, id: string): Promise<ExpertTeamTemplate | undefined> {
  const value = await readJson(join(templatesDir(catalogDir), teamTemplateFileName(id))).catch(() => undefined)
  return isTemplate(value) ? value : undefined
}

/** Delete one exact reusable team template when its source catalog revokes it. */
export async function deleteTeamTemplate(catalogDir: string, id: string): Promise<void> {
  try {
    await unlink(join(templatesDir(catalogDir), teamTemplateFileName(id)))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export async function listTeamTemplates(catalogDir: string): Promise<ExpertTeamTemplate[]> {
  const templates: ExpertTeamTemplate[] = []
  for (const path of await jsonFiles(templatesDir(catalogDir))) {
    const value = await readJson(path).catch(() => undefined)
    if (isTemplate(value)) templates.push(value)
  }
  return templates.sort((left, right) => left.id.localeCompare(right.id))
}

function instanceId(stateRoot: string, teamId: string, captainSessionId: string): string {
  return createHash('sha256').update(stateRoot).update('\0').update(teamId).update('\0').update(captainSessionId).digest('hex').slice(0, 24)
}

function pointerStateRoot(pointer: RuntimeInstancePointer): string {
  const root = canonicalRuntimePath(pointer.stateRoot)
  if (isPathWithin(root, agentTeamsRuntimeRoot())) return root
  const workspace = canonicalRuntimePath(pointer.workspace)
  // Legacy pointers retain the logical workspace namespace after its files move.
  if (root !== workspace && isPathWithin(root, workspace)) {
    return resolveTeamStateRoot(workspace, relative(workspace, root))
  }
  return root
}

async function pointers(catalogDir: string): Promise<Array<{ path: string; value: RuntimeInstancePointer }>> {
  const result: Array<{ path: string; value: RuntimeInstancePointer }> = []
  for (const path of await jsonFiles(instancesDir(catalogDir))) {
    const value = await readJson(path).catch(() => undefined)
    if (isPointer(value)) result.push({ path, value })
  }
  return result
}

export async function registerRuntimeInstance(
  catalogDir: string,
  stateRoot: string,
  workspace: string,
  team: TeamState,
): Promise<RuntimeInstancePointer> {
  const root = canonicalRuntimePath(stateRoot)
  const existing = (await pointers(catalogDir)).filter(entry => entry.value.teamId === team.id
    && entry.value.captainSessionId === team.captainSessionId && pointerStateRoot(entry.value) === root)
  // Prefer the pre-migration incarnation id if a duplicate pointer was already written.
  existing.sort((left, right) => Number(left.value.stateRoot === root) - Number(right.value.stateRoot === root))
  const pointer: RuntimeInstancePointer = {
    version: 1,
    id: existing[0]?.value.id ?? instanceId(root, team.id, team.captainSessionId),
    teamId: team.id,
    teamName: team.name,
    workspace,
    stateRoot: root,
    captainSessionId: team.captainSessionId,
    createdAt: team.createdAt,
  }
  await writeJsonAtomic(join(instancesDir(catalogDir), `${pointer.id}.json`), pointer)
  for (const duplicate of existing) if (duplicate.value.id !== pointer.id) await unlink(duplicate.path)
  return pointer
}

/** Remove this team incarnation through either its legacy or private runtime pointer. */
export async function unregisterRuntimeInstance(
  catalogDir: string,
  stateRoot: string,
  teamId: string,
  captainSessionId: string,
): Promise<void> {
  for (const entry of await pointers(catalogDir)) {
    const root = pointerStateRoot({ ...entry.value, stateRoot })
    if (entry.value.teamId === teamId && entry.value.captainSessionId === captainSessionId
      && pointerStateRoot(entry.value) === root) {
      try { await unlink(entry.path) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
}

export async function listRuntimeInstances(catalogDir: string): Promise<RuntimeInstanceView[]> {
  const instances: RuntimeInstanceView[] = []
  const seen = new Set<string>()
  const entries = await pointers(catalogDir)
  entries.sort((left, right) => Number(isPathWithin(canonicalRuntimePath(left.value.stateRoot), agentTeamsRuntimeRoot())) - Number(isPathWithin(canonicalRuntimePath(right.value.stateRoot), agentTeamsRuntimeRoot())))
  for (const { value } of entries) {
    const root = pointerStateRoot(value)
    const key = instanceId(root, value.teamId, value.captainSessionId)
    if (seen.has(key)) continue
    seen.add(key)
    const candidate = await readTeam(root, value.teamId)
    const team = candidate?.captainSessionId === value.captainSessionId ? candidate : undefined
    const taskStatusCounts: Partial<Record<TaskStatus, number>> = {}
    for (const task of team?.tasks ?? []) {
      taskStatusCounts[task.status] = (taskStatusCounts[task.status] ?? 0) + 1
    }
    instances.push({
      ...value,
      stateRoot: root,
      status: team === undefined ? 'stale' : 'active',
      ...team?.lifecycle === undefined ? {} : { lifecycle: team.lifecycle },
      ...team?.description === undefined ? {} : { description: team.description },
      ...team?.controlledWorkflow === undefined ? {} : { controlledWorkflow: team.controlledWorkflow },
      memberCount: team?.members.filter(member => member.status !== 'removed').length ?? 0,
      taskCount: team?.tasks.length ?? 0,
      members: team?.members.filter(member => member.status !== 'removed').map(member => ({
        name: member.name,
        ...member.role === undefined ? {} : { role: member.role },
        ...member.provider === undefined ? {} : { provider: member.provider },
        ...member.model === undefined ? {} : { model: member.model },
        status: member.status,
      })) ?? [],
      taskStatusCounts,
    })
  }
  return instances.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

export async function readRuntimeInstance(catalogDir: string, id: string): Promise<RuntimeInstanceView | undefined> {
  return (await listRuntimeInstances(catalogDir)).find(instance => instance.id === id || instance.teamId === id)
}
