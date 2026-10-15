/** Durable, transport-neutral agent templates synchronized from ByClaw. */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DSH_AGENT_TEMPLATE_VERSION = 'dsh.agent-template/v1' as const

/** One Skill available only inside an instantiated agent. */
export interface DshAgentTemplateSkill {
  code: string
  path: string
}

/** One member reference carried by an expert-team leader template. */
export interface DshAgentTemplateMember {
  templateId: string
  employeeId: string
  name: string
  role?: string
  order: number
}

/** Reusable agent metadata independent of any concrete session or team. */
export interface DshAgentTemplate {
  schemaVersion: typeof DSH_AGENT_TEMPLATE_VERSION
  id: string
  kind: 'agent' | 'expert-team'
  name: string
  description: string
  persona: string
  skills: DshAgentTemplateSkill[]
  source: {
    system: 'byclaw'
    resourceId: string
    resourceCode: string
    workerAgentType: string
    createType?: string
    integrationType?: string
    /** Authoritative ByClaw AI-model instance id, resolved again when instantiated. */
    modelId?: string
    version?: string
    directlyAuthorized: boolean
  }
  expertTeam?: {
    contextProfile: string
    promptVersion: string
    configVersion: string
    sourceModelId: string
    agentTeamsTemplateId: string
    members: DshAgentTemplateMember[]
  }
}

/** Resolve the machine-global agent-template catalog. */
export function defaultAgentTemplateDir(): string {
  const dshHome = process.env['DSH_HOME']?.trim()
  return join(dshHome === undefined || dshHome === '' ? join(homedir(), '.dsh') : dshHome, 'agent-templates')
}

function safeId(id: string): string {
  const normalized = id.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(normalized)) throw new Error(`invalid agent template id "${id}"`)
  return normalized
}

function templatePath(catalogDir: string, id: string): string {
  return join(catalogDir, 'templates', `${safeId(id)}.json`)
}

function assertTemplate(value: unknown): DshAgentTemplate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('agent template must be an object')
  const candidate = value as Partial<DshAgentTemplate>
  if (candidate.schemaVersion !== DSH_AGENT_TEMPLATE_VERSION
    || (candidate.kind !== 'agent' && candidate.kind !== 'expert-team')
    || typeof candidate.id !== 'string'
    || typeof candidate.name !== 'string'
    || typeof candidate.description !== 'string'
    || typeof candidate.persona !== 'string'
    || !Array.isArray(candidate.skills)
    || typeof candidate.source !== 'object'
    || candidate.source === null) {
    throw new Error('invalid agent template fields')
  }
  if (candidate.kind === 'expert-team' && candidate.expertTeam === undefined) {
    throw new Error('expert-team template requires expertTeam metadata')
  }
  return candidate as DshAgentTemplate
}

/** Atomically publish one reusable template. */
export async function writeAgentTemplate(catalogDir: string, template: DshAgentTemplate): Promise<void> {
  const path = templatePath(catalogDir, template.id)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(assertTemplate(template), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } catch (error: unknown) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** Read one reusable template, returning undefined when it is absent. */
export async function readAgentTemplate(catalogDir: string, id: string): Promise<DshAgentTemplate | undefined> {
  try {
    return assertTemplate(JSON.parse(await readFile(templatePath(catalogDir, id), 'utf8')) as unknown)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Remove one exact general agent template. */
export async function deleteAgentTemplate(catalogDir: string, id: string): Promise<void> {
  try {
    await unlink(templatePath(catalogDir, id))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Read one template synchronously during DSH's child-creation window. */
export function readAgentTemplateSync(catalogDir: string, id: string): DshAgentTemplate | undefined {
  try {
    return assertTemplate(JSON.parse(readFileSync(templatePath(catalogDir, id), 'utf8')) as unknown)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** List every reusable template in stable id order. */
export async function listAgentTemplates(catalogDir: string): Promise<DshAgentTemplate[]> {
  const directory = join(catalogDir, 'templates')
  let names: string[]
  try {
    names = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => entry.name)
      .sort()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const templates: DshAgentTemplate[] = []
  for (const name of names) {
    const template = await readAgentTemplate(catalogDir, name.slice(0, -5))
    if (template !== undefined) templates.push(template)
  }
  return templates
}
