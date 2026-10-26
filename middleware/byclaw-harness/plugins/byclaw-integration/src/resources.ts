/** Parsers for ByClaw digital-employee and expert-group detail records. */

import type {
  ByClawDigitalEmployee,
  ByClawExpertGroup,
  ByClawExpertGroupMember,
  ByClawSkillRef,
} from './types.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
}

function required(value: unknown, field: string): string {
  const parsed = text(value)
  if (parsed === '') throw new Error(`ByClaw resource requires non-empty ${field}`)
  return parsed
}

function parsedValue(value: unknown, depth = 0): unknown {
  if (depth >= 4 || typeof value !== 'string') return value
  const normalized = value.trim()
  if (normalized === '' || !/^[\[{"-]|^(?:true|false|null|\d)/u.test(normalized)) return value
  try {
    return parsedValue(JSON.parse(normalized) as unknown, depth + 1)
  } catch {
    return value
  }
}

function parsedArray(value: unknown): unknown[] {
  const parsed = parsedValue(value)
  return Array.isArray(parsed) ? parsed : []
}

function parsedRecord(value: unknown): Record<string, unknown> | undefined {
  return record(parsedValue(value))
}

function joinedValues(value: unknown, keys: readonly string[]): string {
  const values: string[] = []
  for (const item of parsedArray(value)) {
    const entry = record(item)
    if (entry === undefined) continue
    for (const key of keys) {
      const candidate = text(entry[key])
      if (candidate !== '') values.push(candidate)
    }
  }
  return [...new Set(values)].join('\n')
}

function employeeInstructions(snapshot: Record<string, unknown>): string {
  const sections: string[] = []
  const persona = parsedValue(snapshot['relPrompt'] ?? snapshot['corePersonaDefinition'])
  if (Array.isArray(persona)) {
    for (const value of persona) {
      const entry = record(value)
      const content = text(entry?.['value'])
      if (content === '') continue
      const title = text(entry?.['name']) || text(entry?.['nameEn']) || text(entry?.['key'])
      sections.push(title === '' ? content : `## ${title}\n\n${content}`)
    }
  } else {
    const content = text(persona)
    if (content !== '') sections.push(content)
  }

  for (const [title, value] of [
    ['核心能力', snapshot['ability']],
    ['处理流程', snapshot['processingFlow']],
  ] as const) {
    const content = text(parsedValue(value))
    if (content !== '') sections.push(`## ${title}\n\n${content}`)
  }

  const competencies = parsedArray(snapshot['coreCompetencies']).flatMap((value) => {
    const entry = record(value)
    const name = text(entry?.['coreCompetency']) || text(entry?.['name'])
    const description = text(entry?.['description'])
    return name === '' && description === '' ? [] : [`- ${[name, description].filter(Boolean).join('：')}`]
  })
  if (competencies.length > 0) sections.push(`## 核心能力清单\n\n${competencies.join('\n')}`)
  return [...new Set(sections)].join('\n\n')
}

function parseSkill(value: unknown): ByClawSkillRef | undefined {
  const entry = record(value)
  if (entry === undefined) return undefined
  const code = text(entry['skillCode'])
  const downloadUrl = text(entry['skillUrl'])
  const versionUrl = text(entry['versionUrl'])
  if (code === '' || downloadUrl === '' || versionUrl === '') return undefined
  return {
    id: text(entry['resourceId']) || code,
    code,
    type: text(entry['skillType']) || 'hub',
    downloadUrl,
    versionUrl,
  }
}

function skillRefs(snapshot: Record<string, unknown>): ByClawSkillRef[] {
  const source = Object.hasOwn(snapshot, 'relSkills')
    ? parsedArray(snapshot['relSkills'])
    : parsedArray(snapshot['skills'])
  const unique = new Map<string, ByClawSkillRef>()
  for (const value of source) {
    const skill = parseSkill(value)
    if (skill !== undefined) unique.set(skill.code, skill)
  }
  return [...unique.values()]
}

/**
 * The employee's tool sandbox selection: the ByClaw editor keeps it as one entry
 * `{ key: 'toolSandbox', value: '<service_key>' }` of the advanced-settings
 * array; an object with a `toolSandbox` field is accepted too.
 */
function toolSandboxFromAdvancedSettings(raw: unknown): string {
  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) } catch { return '' }
  }
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const item = record(entry)
      if (item?.['key'] === 'toolSandbox') return text(item['value'])
    }
    return ''
  }
  return text(record(parsed)?.['toolSandbox'])
}

/** Parse one non-group digital employee snapshot. */
export function parseByClawDigitalEmployee(value: unknown): ByClawDigitalEmployee {
  const snapshot = record(value)
  if (snapshot === undefined) throw new Error('ByClaw employee snapshot must be an object')
  const id = required(snapshot['resourceId'] ?? snapshot['id'], 'resourceId')
  const name = required(snapshot['resourceName'] ?? snapshot['name'], 'resourceName')
  const description = text(snapshot['resourceDesc'] ?? snapshot['description'])
  const persona = employeeInstructions(snapshot)
  const capabilities = joinedValues(snapshot['coreCompetencies'], ['coreCompetency', 'description'])
  const modelId = text(parsedRecord(snapshot['prologue'])?.['modelId'])
  const toolSandbox = text(snapshot['toolSandbox']) || toolSandboxFromAdvancedSettings(snapshot['advancedSettings'])
  return {
    id,
    code: text(snapshot['resourceCode']) || `DIG_EMPLOYEE_${id}`,
    name,
    description,
    capabilities,
    persona,
    workerAgentType: text(snapshot['workerAgentType']) || 'NONE',
    ...(text(snapshot['createType']) === '' ? {} : { createType: text(snapshot['createType']) }),
    ...(text(snapshot['integrationType']) === '' ? {} : { integrationType: text(snapshot['integrationType']) }),
    ...modelId === '' ? {} : { modelId },
    ...toolSandbox === '' ? {} : { toolSandbox },
    ...text(snapshot['configVersion'] ?? snapshot['resourceRVerid'] ?? snapshot['resourceDVerid']) === ''
      ? {}
      : { version: text(snapshot['configVersion'] ?? snapshot['resourceRVerid'] ?? snapshot['resourceDVerid']) },
    skills: skillRefs(snapshot),
  }
}

function parseGroupMember(value: unknown, fallbackOrder: number): ByClawExpertGroupMember | undefined {
  const member = record(value)
  if (member === undefined) return undefined
  const employeeId = text(member['resourceId'] ?? member['id'])
  const name = text(member['name'] ?? member['resourceName'])
  if (employeeId === '' || name === '') return undefined
  const rawOrder = Number(member['sortOrder'])
  return {
    employeeId,
    employeeCode: text(member['resourceCode']) || `DIG_EMPLOYEE_${employeeId}`,
    name,
    ...text(member['teamRole']) === '' ? {} : { role: text(member['teamRole']) },
    ...text(member['description'] ?? member['resourceDesc']) === ''
      ? {}
      : { description: text(member['description'] ?? member['resourceDesc']) },
    ...text(member['workerAgentType']) === '' ? {} : { workerAgentType: text(member['workerAgentType']) },
    order: Number.isFinite(rawOrder) ? rawOrder : fallbackOrder,
  }
}

/** Parse one expert group and its ordered membership declarations. */
export function parseByClawExpertGroup(value: unknown): ByClawExpertGroup {
  const snapshot = record(value)
  if (snapshot === undefined) throw new Error('ByClaw expert-group snapshot must be an object')
  const id = required(snapshot['resourceId'] ?? snapshot['id'], 'resourceId')
  const name = required(snapshot['resourceName'] ?? snapshot['name'], 'resourceName')
  const members = parsedArray(snapshot['employeeGroupMembers'] ?? snapshot['members'])
    .map((member, index) => parseGroupMember(member, index + 1))
    .filter((member): member is ByClawExpertGroupMember => member !== undefined)
    .sort((left, right) => left.order - right.order || left.employeeId.localeCompare(right.employeeId))
  return {
    id,
    code: text(snapshot['resourceCode']) || `DIG_EMPLOYEE_${id}`,
    name,
    description: text(snapshot['resourceDesc'] ?? snapshot['description']),
    workerAgentType: text(snapshot['workerAgentType']) || 'BY_SUPER',
    ...text(snapshot['configVersion']) === '' ? {} : { configVersion: text(snapshot['configVersion']) },
    members,
  }
}

/** Whether a snapshot represents an expert group. */
export function isByClawExpertGroupSnapshot(value: unknown): boolean {
  const snapshot = record(value)
  return snapshot !== undefined && parsedArray(snapshot['employeeGroupMembers']).length > 0
}
