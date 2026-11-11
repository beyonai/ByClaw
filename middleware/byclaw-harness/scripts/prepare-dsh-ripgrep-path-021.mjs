#!/usr/bin/env node
/**
 * Build-only: let DSH 0.2.1's glob/grep find ripgrep where they actually run. They spawn the
 * binary packaged in this installation by absolute path. On a shared host the spawn runs in the
 * user's tool environment, which has no such path, so the host names the rg there through
 * BYCLAW_RIPGREP_PATH. And under the host's profile resolver, which keeps logical package paths,
 * `@vscode/ripgrep` cannot reach its pnpm-adjacent platform package and throws; fall back to the
 * rg on PATH instead of failing every search. Rebuild packages/fs/tool-fs-search before use.
 */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const supportedDshVersion = '0.2.1-rc.2'
export const marker = 'byclaw-ripgrep-path-v1'

export const before = `export function resolveRgPath(): Promise<string> {
  rgPathPromise ??= Promise.resolve().then(async () => {
    const executable = parse(process.execPath)
    const executableSidecar = process.platform === 'win32'
      ? join(executable.dir, \`\${executable.name}-rg.exe\`)
      : \`\${process.execPath}-rg\`
    if ('pkg' in process && existsSync(executableSidecar)) return executableSidecar
    const dependency = (await import('@vscode/ripgrep')).rgPath
    return`

export const after = `export function resolveRgPath(): Promise<string> {
  // ${marker}: a host whose tools run elsewhere names the rg there; an unreachable packaged binary falls back to PATH.
  const configured = process.env.BYCLAW_RIPGREP_PATH?.trim()
  if (configured) return Promise.resolve(configured)
  rgPathPromise ??= Promise.resolve().then(async () => {
    const executable = parse(process.execPath)
    const executableSidecar = process.platform === 'win32'
      ? join(executable.dir, \`\${executable.name}-rg.exe\`)
      : \`\${process.execPath}-rg\`
    if ('pkg' in process && existsSync(executableSidecar)) return executableSidecar
    let dependency: string
    try {
      dependency = (await import('@vscode/ripgrep')).rgPath
    } catch {
      return 'rg'
    }
    return`

export function prepareSource(source) {
  if (source.includes(marker)) {
    if (source.split(after).length === 2 && !source.includes(before)) return source
    throw new Error('Unsupported mixed DSH ripgrep path patch')
  }
  if (source.split(before).length !== 2) throw new Error('Unsupported DSH 0.2.1 tool-fs-search source')
  return source.replace(before, after)
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const dir = join(root, 'packages/fs/tool-fs-search')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-tool-fs-search' || manifest.version !== supportedDshVersion) {
    throw new Error(`Expected @deepseek-ai/dsh-tool-fs-search@${supportedDshVersion}`)
  }
  const file = await realpath(join(dir, 'src/search-core.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8')
  const updated = prepareSource(source)
  if (updated !== source) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-ripgrep-path-021.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH ripgrep path prepared; rebuild packages/fs/tool-fs-search before use')
}
