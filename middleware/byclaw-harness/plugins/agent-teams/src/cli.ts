#!/usr/bin/env node
/** Model-free query CLI for global Agent Teams templates and runtime pointers. */

import {
  defaultCatalogDir,
  listRuntimeInstances,
  listTeamTemplates,
  readRuntimeInstance,
  readTeamTemplate,
} from './catalog.ts'

function usage(): never {
  process.stderr.write('Usage: dsh-agent-teams <templates|instances> <list|show> [id] [--json] [--catalog-dir <path>]\n')
  process.exit(2)
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) usage()
  args.splice(index, 2)
  return value
}

const args = process.argv.slice(2)
const catalogDir = optionValue(args, '--catalog-dir') ?? defaultCatalogDir()
const jsonIndex = args.indexOf('--json')
const json = jsonIndex >= 0
if (json) args.splice(jsonIndex, 1)
const [domain, action, id, ...rest] = args
if (rest.length > 0 || (domain !== 'templates' && domain !== 'instances')
  || (action !== 'list' && action !== 'show') || (action === 'show' && id === undefined)
  || (action === 'list' && id !== undefined)) usage()

if (domain === 'templates') {
  const value = action === 'list' ? await listTeamTemplates(catalogDir) : await readTeamTemplate(catalogDir, id ?? '')
  if (action === 'show' && value === undefined) {
    process.stderr.write(`Template not found: ${id}\n`)
    process.exit(1)
  }
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  else if (Array.isArray(value)) {
    process.stdout.write(value.length === 0 ? 'No expert-team templates.\n' : value.map(template => (
      `${template.id}\t${template.name}\t${template.members.length} experts`
    )).join('\n') + '\n')
  } else if (value !== undefined) {
    process.stdout.write([
      `${value.name} (${value.id})`,
      value.description ?? '',
      ...value.members.map(member => `- ${member.name}\t${member.role ?? ''}`),
    ].filter(line => line !== '').join('\n') + '\n')
  }
} else {
  const value = action === 'list' ? await listRuntimeInstances(catalogDir) : await readRuntimeInstance(catalogDir, id ?? '')
  if (action === 'show' && value === undefined) {
    process.stderr.write(`Runtime instance not found: ${id}\n`)
    process.exit(1)
  }
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  else if (Array.isArray(value)) {
    process.stdout.write(value.length === 0 ? 'No Agent Teams runtime instances.\n' : value.map(instance => (
      `${instance.id}\t${instance.teamName}\t${instance.status}\t${instance.workspace}`
    )).join('\n') + '\n')
  } else if (value !== undefined) {
    process.stdout.write([
      `${value.teamName} (${value.id})`,
      `status: ${value.status}${value.lifecycle === undefined ? '' : `/${value.lifecycle}`}`,
      `workspace: ${value.workspace}`,
      `captain: ${value.captainSessionId}`,
      `members/tasks: ${value.memberCount}/${value.taskCount}`,
      ...value.description === undefined ? [] : [`description: ${value.description}`],
      ...value.members.map(member => (
        `- ${member.name}\t${member.role ?? ''}\t${member.status}\t${member.provider ?? ''}${member.model === undefined ? '' : `/${member.model}`}`
      )),
    ].join('\n') + '\n')
  }
}
