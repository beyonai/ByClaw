/** Resolve ByClaw inbound @ targets to authorized DSH templates. */

import type { AuthorizedByClawResources } from './catalog.ts'
import type { ByClawDigitalEmployee, ByClawExpertGroup } from './types.ts'

export interface ByClawInboundTarget {
  templateId: string
  resourceId: string
  kind: 'employee' | 'group'
  name: string
  text: string
}

interface Candidate {
  templateId: string
  resourceId: string
  kind: ByClawInboundTarget['kind']
  code: string
  name: string
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function uniqueCandidates(resources: AuthorizedByClawResources): Candidate[] {
  const directEmployeeIds = new Set(resources.directEmployeeIds)
  const employees = resources.employees
    .filter(employee => directEmployeeIds.has(employee.id))
    .map(employeeCandidate)
  const groups = resources.groups.map(groupCandidate)
  return [...employees, ...groups]
}

function employeeCandidate(employee: ByClawDigitalEmployee): Candidate {
  return {
    templateId: `byclaw-employee-${employee.id}`,
    resourceId: employee.id,
    kind: 'employee',
    code: employee.code,
    name: employee.name,
  }
}

function groupCandidate(group: ByClawExpertGroup): Candidate {
  return {
    templateId: `byclaw-group-${group.id}`,
    resourceId: group.id,
    kind: 'group',
    code: group.code,
    name: group.name,
  }
}

function structuredTarget(
  candidates: Candidate[],
  extraPayload: Record<string, unknown>,
): Candidate | undefined {
  // Codes and names are descriptive metadata; only the ID selects a target.
  const id = stringValue(extraPayload.agent_id)
  if (id === '') return undefined

  const candidate = candidates.find(entry => entry.resourceId === id)
  if (candidate === undefined) {
    throw new Error(`ByClaw direct target agent_id="${id}" was not found or is not directly authorized`)
  }
  return candidate
}

function textTarget(candidates: Candidate[], text: string): ByClawInboundTarget | undefined {
  const aliases = candidates.flatMap(candidate => (
    [candidate.code, candidate.name]
      .filter(alias => alias.trim() !== '' && !/^\d+$/u.test(alias.trim()))
      .map(alias => ({ candidate, alias: alias.trim() }))
  )).sort((left, right) => right.alias.length - left.alias.length)
  const mentions: Array<{ candidate: Candidate; start: number; end: number }> = []
  for (let start = text.indexOf('@'); start >= 0; start = text.indexOf('@', start + 1)) {
    const match = aliases.find(({ alias }) => {
      const end = start + 1 + alias.length
      const next = text[end]
      return text.slice(start + 1, end).toLocaleLowerCase() === alias.toLocaleLowerCase()
        && (next === undefined || /[\s,，。.!！？?;；:：()[\]{}<>、/\\]/u.test(next))
    })
    if (match !== undefined) mentions.push({ candidate: match.candidate, start, end: start + 1 + match.alias.length })
  }
  if (mentions.length > 1) throw new Error('ByClaw textual @ target is ambiguous')
  const distinct = [...new Map(mentions.map(mention => [mention.candidate.templateId, mention.candidate])).values()]
  if (distinct.length > 1) throw new Error('ByClaw textual @ target is ambiguous')
  const mention = mentions.find(candidate => candidate.candidate.templateId === distinct[0]?.templateId)
  if (mention === undefined) return undefined
  return result(mention.candidate, (text.slice(0, mention.start) + text.slice(mention.end)).trim())
}

function result(candidate: Candidate, text: string): ByClawInboundTarget {
  return {
    templateId: candidate.templateId,
    resourceId: candidate.resourceId,
    kind: candidate.kind,
    name: candidate.name,
    text,
  }
}

/** Resolve one authorized direct target, or leave the message on the main Agent path. */
export function resolveByClawInboundTarget(
  resources: AuthorizedByClawResources,
  extraPayload: Record<string, unknown> | undefined,
  text: string,
): ByClawInboundTarget | undefined {
  const candidates = uniqueCandidates(resources)
  const structured = structuredTarget(candidates, extraPayload ?? {})
  if (structured !== undefined) return result(structured, text.trim())
  return textTarget(candidates, text)
}
