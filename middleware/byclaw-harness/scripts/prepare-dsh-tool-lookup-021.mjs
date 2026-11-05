#!/usr/bin/env node
/**
 * Build-only: make the DSH 0.2.1 tool registry resolve one name without materializing the scope's whole view.
 * `ToolRegistry.get` rebuilt `view(scope)` (every tool on the chain copied into new Maps) for a single lookup;
 * the system prompt calls it per delegation tool on every step, so a shared host spent about a quarter of its
 * main thread and much of its GC there. The replacement gives the same answer as `view(scope).visible.get(name)`.
 * Rebuild packages/core/tools before use.
 */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const supportedDshVersion = '0.2.1-rc.2'
export const marker = 'byclaw-tool-lookup-v1'

export const getBefore = `  get(name: string, scope?: ScopeKey): ToolDefinition | undefined {
    return this.view(scope).visible.get(name)
  }`

// Mirrors view(): the scope's own registrations shadow and skip the chain filter; inherited names (global, then
// ancestors farthest first) must be admitted by every chain layer; run_code is added last for non-native scopes.
export const getAfter = `  get(name: string, scope?: ScopeKey): ToolDefinition | undefined {
    // ${marker}: resolve one name along the chain instead of materializing view(scope).
    if (name === RUN_CODE_NAME && this.modeFor(scope) !== 'native') return this.requirePtcTransport()
    const stack = this.layers // one read: the registry is reached through the Cordis service proxy
    const own = stack.peek(scope)
    const mine = own?.tools.get(name)
    if (mine !== undefined) return mine
    const layers = stack.chainLayers(scope)
    let inherited = stack.global.tools.get(name)
    for (const layer of layers) {
      if (layer !== own) inherited = layer.tools.get(name) ?? inherited
    }
    return inherited !== undefined && layers.every(layer => layer.admits(name)) ? inherited : undefined
  }`

export function prepareSource(source) {
  if (source.includes(marker)) {
    if (source.split(getAfter).length === 2 && !source.includes(getBefore)) return source
    throw new Error('Unsupported mixed DSH tool lookup patch')
  }
  if (source.split(getBefore).length !== 2) throw new Error('Unsupported DSH 0.2.1 tool registry source')
  if (!source.includes('private view(scope?: ScopeKey): ToolView {')) throw new Error('Unsupported DSH 0.2.1 tool registry source')
  return source.replace(getBefore, getAfter)
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const dir = join(root, 'packages/core/tools')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-tools' || manifest.version !== supportedDshVersion) {
    throw new Error(`Expected @deepseek-ai/dsh-tools@${supportedDshVersion}`)
  }
  const file = await realpath(join(dir, 'src/index.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8')
  const updated = prepareSource(source)
  if (updated !== source) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-tool-lookup-021.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH tool lookup prepared; rebuild packages/core/tools before use')
}
