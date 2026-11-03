#!/usr/bin/env node
/** Build-only name compatibility for enterprise SKILL.md names; rebuild both packages. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const nameBefore = String.raw`const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`
export const nameAfter = String.raw`const SKILL_NAME = /^[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*$/u`
export const gestureBefore = String.raw`const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g`
export const gestureAfter = String.raw`const SKILL_GESTURE = /(^|\s)\/([\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*)(?=\s|$)/gu`

export function prepareSource(source, kind) {
  const [before, after] = kind === 'skill' ? [nameBefore, nameAfter]
    : kind === 'tool-skill' ? [gestureBefore, gestureAfter] : []
  if (!before) throw new Error(`Unknown Skill patch kind: ${kind}`)
  if (source.includes(after)) {
    if (source.split(after).length === 2 && !source.includes(before)) return source
    throw new Error(`Unsupported mixed DSH ${kind} name patch`)
  }
  if (source.split(before).length !== 2) throw new Error(`Unsupported DSH 0.2.1 ${kind} source`)
  return source.replace(before, after)
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const updates = []
  // Validate both inputs before writing either: an upstream change must fail the build.
  for (const kind of ['skill', 'tool-skill']) {
    const dir = join(root, 'packages/skill', kind)
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    if (manifest.name !== `@deepseek-ai/dsh-${kind}` || manifest.version !== '0.2.1-rc.2') {
      throw new Error(`Expected @deepseek-ai/dsh-${kind}@0.2.1-rc.2`)
    }
    const file = await realpath(join(dir, 'src/index.ts'))
    if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
    const source = await readFile(file, 'utf8')
    updates.push({ file, source, updated: prepareSource(source, kind) })
  }
  for (const { file, source, updated } of updates) if (source !== updated) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-skill-names-021.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH enterprise Skill names prepared; rebuild skill and tool-skill before use')
}
