#!/usr/bin/env node
/** Serialize each unchanged source-map section once in the pinned disposable DSH build. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const edits = [
  [
    "  section: Record<string, unknown>\n  lines: number",
    "  sectionJson: string\n  lines: number"
  ],
  [
    "  const result = { bundle: record.bundle, sourceMap: record.sourceMap, source, section, lines: newlineCount(source) }",
    "  const result = { bundle: record.bundle, sourceMap: record.sourceMap, source, sectionJson: JSON.stringify(section), lines: newlineCount(source) }"
  ],
  [
    "  const sections: { offset: { line: number; column: 0 }; map: Record<string, unknown> }[] = []",
    "  const sections: string[] = []"
  ],
  [
    "    sections.push({ offset: { line, column: 0 }, map: prepared.section })",
    "    sections.push(`{\"offset\":{\"line\":${line},\"column\":0},\"map\":${prepared.sectionJson}}`)"
  ],
  [
    "  const sourceMap = Buffer.from(`${JSON.stringify({ version: 3, file: 'client.js', sections })}\\n`)",
    "  const sourceMap = Buffer.from(`{\"version\":3,\"file\":\"client.js\",\"sections\":[${sections.join(',') }]}\\n`)"
  ]
]

export function prepareSource(source) {
  const states = edits.map(([before, after]) => {
    if (source.split(after).length === 2 && !source.replace(after, '').includes(before)) return 'patched'
    if (source.split(before).length === 2 && !source.includes(after)) return 'original'
    throw new Error('Unsupported DSH client module source; refusing to guess')
  })
  if (new Set(states).size !== 1) throw new Error('Incomplete DSH client-map patch')
  return states[0] === 'patched' ? source : edits.reduce((value, [before, after]) => value.replace(before, after), source)
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const directory = 'packages/client/modules'
  const manifest = JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-modules' || manifest.version !== '0.1.5-rc.2') {
    throw new Error('Expected @deepseek-ai/dsh-client-modules@0.1.5-rc.2')
  }
  const file = await realpath(join(root, directory, 'src/index.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8')
  const updated = prepareSource(source)
  if (updated !== source) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-client-modules.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH client map serialization prepared; rebuild client-modules before use')
}
