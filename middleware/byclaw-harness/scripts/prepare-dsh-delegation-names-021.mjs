#!/usr/bin/env node
/**
 * Build-only: keep the DSH 0.2.1 tool-subagent prompt section from walking every delegation tool in the process.
 * `delegationTools` is module-level, so on a shared host it holds every user's and every agent's definition, and the
 * section ran `tools.get` (through the Cordis service proxy) for each of them on every agent step. Track the distinct
 * names next to the set and look each name up once; `get(name) ∈ delegationTools` selects the same names as the
 * original filter because `get` returns one definition per name. Rebuild packages/subagent/tool-subagent before use.
 */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const supportedDshVersion = '0.2.1-rc.2'
export const marker = 'byclaw-delegation-names-v1'

export const edits = [
  [
    `const delegationTools = new Set<ToolDefinition>()`,
    `const delegationTools = new Set<ToolDefinition>()
// ${marker}: distinct names in delegationTools, which a shared host fills with every user's definitions.
const delegationToolNames = new Map<string, number>()`,
  ],
  [
    `        delegationTools.add(definition)
        return () => {
          delegationTools.delete(definition)
          unregister()
        }`,
    `        if (!delegationTools.has(definition)) {
          delegationTools.add(definition)
          delegationToolNames.set(definition.name, (delegationToolNames.get(definition.name) ?? 0) + 1)
        }
        return () => {
          if (delegationTools.delete(definition)) {
            const left = (delegationToolNames.get(definition.name) ?? 1) - 1
            if (left > 0) delegationToolNames.set(definition.name, left)
            else delegationToolNames.delete(definition.name)
          }
          unregister()
        }`,
  ],
  [
    `        const visible = [...delegationTools]
          .filter(tool => runtimeCtx.tools.get(tool.name, context.scope) === tool)
          .map(tool => tool.name)
          .sort()`,
    `        const tools = runtimeCtx.tools
        const visible = [...delegationToolNames.keys()]
          .filter((name) => {
            const found = tools.get(name, context.scope)
            return found !== undefined && delegationTools.has(found)
          })
          .sort()`,
  ],
]

export function prepareSource(source) {
  if (source.includes(marker)) {
    if (edits.every(([before, after]) => source.split(after).length === 2
      && (after.includes(before) ? source.split(before).length === 2 : !source.includes(before)))) return source
    throw new Error('Unsupported mixed DSH delegation names patch')
  }
  let updated = source
  for (const [before] of edits) {
    if (updated.split(before).length !== 2) throw new Error('Unsupported DSH 0.2.1 tool-subagent source')
  }
  for (const [before, after] of edits) updated = updated.replace(before, after)
  return updated
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const dir = join(root, 'packages/subagent/tool-subagent')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-tool-subagent' || manifest.version !== supportedDshVersion) {
    throw new Error(`Expected @deepseek-ai/dsh-tool-subagent@${supportedDshVersion}`)
  }
  const file = await realpath(join(dir, 'src/index.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8')
  const updated = prepareSource(source)
  if (updated !== source) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-delegation-names-021.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH delegation names prepared; rebuild packages/subagent/tool-subagent before use')
}
