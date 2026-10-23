/**
 * Which tool environment (B) an employee's commands run in.
 *
 * The employee declares it (`toolEnvironment` on the template); when it does
 * not, the Skills it carries tell: a Skill whose `metadata.openclaw.requires.bins`
 * names a media binary wants the media environment. The runtime binds the
 * Agent instantiated from the template to that environment in the
 * `dsh-tool-env` pool; descendants inherit the binding, and an Agent without
 * one uses the default environment. Nothing here starts a sandbox.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import type { DshAgentTemplate } from './agent-template.ts'

/** Binaries that mark a Skill as needing a given environment; the first matching rule wins. */
export type ToolEnvironmentRules = ReadonlyArray<{ environment: string; bins: readonly string[] }>

export const DEFAULT_TOOL_ENVIRONMENT_RULES: ToolEnvironmentRules = [
  { environment: 'media', bins: ['ffmpeg', 'ffprobe', 'libreoffice', 'soffice', 'sox', 'imagemagick', 'convert'] },
]

/** The pool as the binder sees it (`ctx.toolEnvironments` from dsh-tool-env; optional). */
export interface ToolEnvironmentBinder {
  readonly defaultName: string
  has(name: string): boolean
  bind(agentId: string, name: string): () => void
}

/** Binaries a Skill declares under `metadata.openclaw.requires.bins` in its SKILL.md frontmatter. */
export function requiredBins(skillMarkdown: string): string[] {
  const normalized = skillMarkdown.replace(/^﻿/u, '')
  if (!normalized.startsWith('---')) return []
  const lines = normalized.split(/\r?\n/u)
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---' || lines[index]?.trim() === '...') { end = index; break }
  }
  if (end < 0) return []
  let frontmatter: unknown
  try { frontmatter = load(lines.slice(1, end).join('\n')) } catch { return [] }
  const metadata = record(record(frontmatter)?.['metadata'])
  const bins = record(record(metadata?.['openclaw'])?.['requires'])?.['bins']
  return Array.isArray(bins) ? bins.filter((bin): bin is string => typeof bin === 'string').map(bin => bin.trim()).filter(bin => bin !== '') : []
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * The environment a template's instances belong to: its declaration, else the
 * first rule one of its Skills' required binaries matches, else `undefined`
 * (the instance inherits its parent's environment or uses the default).
 */
export function inferToolEnvironment(
  template: Pick<DshAgentTemplate, 'toolEnvironment' | 'skills'>,
  rules: ToolEnvironmentRules = DEFAULT_TOOL_ENVIRONMENT_RULES,
  read: (path: string) => string = path => readFileSync(path, 'utf8'),
): string | undefined {
  const declared = template.toolEnvironment?.trim()
  if (declared !== undefined && declared !== '') return declared
  const required = new Set<string>()
  for (const skill of template.skills) {
    let markdown: string
    try { markdown = read(join(skill.path, 'SKILL.md')) } catch { continue }
    for (const bin of requiredBins(markdown)) required.add(bin.toLowerCase())
  }
  if (required.size === 0) return undefined
  return rules.find(rule => rule.bins.some(bin => required.has(bin.toLowerCase())))?.environment
}

/**
 * Bind a template instance to its environment. An unknown name binds to the
 * default and is reported, so a misconfigured employee still runs. Returns the
 * disposer; a no-op without the pool or without anything to bind.
 */
export function bindTemplateEnvironment(
  binder: ToolEnvironmentBinder | undefined,
  agentId: string,
  template: Pick<DshAgentTemplate, 'id' | 'toolEnvironment' | 'skills'>,
  log: { info(message: string): void; warn(message: string): void },
  rules: ToolEnvironmentRules = DEFAULT_TOOL_ENVIRONMENT_RULES,
): () => void {
  if (binder === undefined) return () => undefined
  const wanted = inferToolEnvironment(template, rules)
  if (wanted === undefined) return () => undefined
  if (!binder.has(wanted)) {
    log.warn(`[byclaw-dsh] template ${template.id} wants tool environment "${wanted}", which this host does not configure; using "${binder.defaultName}"`)
    return binder.bind(agentId, binder.defaultName)
  }
  log.info(`[byclaw-dsh] 🧰 工具环境 (session=${agentId}, template=${template.id}, environment=${wanted}${template.toolEnvironment === undefined ? ', inferred from Skills' : ''})`)
  return binder.bind(agentId, wanted)
}
