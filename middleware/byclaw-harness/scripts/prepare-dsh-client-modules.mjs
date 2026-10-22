#!/usr/bin/env node
/** Remove repeated client-bundle composition in the pinned disposable DSH build. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const edits = [
  ["  for (const char of value) if (char === '\\n') count += 1", "  for (let at = value.indexOf('\\n'); at !== -1; at = value.indexOf('\\n', at + 1)) count += 1"],
  ["/** Concatenate one or more factory registrations and compose their maps as indexed sections. */", [
    "/** Cache only the current byte snapshot of each live record; HMR replaces buffers. */",
    "const preparedCombos = new WeakMap<WebPluginRecord, {",
    "  bundle: Buffer",
    "  sourceMap: WebPluginRecord['sourceMap']",
    "  source: string",
    "  section: Record<string, unknown>",
    "  lines: number",
    "}>()",
    "",
    "function prepareCombo(record: WebPluginRecord) {",
    "  const cached = preparedCombos.get(record)",
    "  if (cached?.bundle === record.bundle && cached.sourceMap === record.sourceMap) return cached",
    "  const prepared = comboSource(record)",
    "  const section = record.sourceMap === undefined",
    "    ? identitySectionMap(prepared.source, prepared.fallbackSource)",
    "    : comboSectionMap(record)",
    "  const source = `${prepared.source};\\n`",
    "  const result = { bundle: record.bundle, sourceMap: record.sourceMap, source, section, lines: newlineCount(source) }",
    "  preparedCombos.set(record, result)",
    "  return result",
    "}",
    "",
    "type CachedCombo = {",
    "  artifact: ComboArtifact",
    "  snapshots: { record: WebPluginRecord; bundle: Buffer; sourceMap: WebPluginRecord['sourceMap']; rev: string }[]",
    "}",
    "",
    "/** Concatenate one or more factory registrations and compose their maps as indexed sections. */",
  ].join('\n')],
  [[
    "    const prepared = comboSource(record)",
    "    const section = record.sourceMap === undefined",
    "      ? identitySectionMap(prepared.source, prepared.fallbackSource)",
    "      : comboSectionMap(record)",
    "    sections.push({ offset: { line, column: 0 }, map: section })",
    "    const bundle = `${prepared.source};\\n`",
    "    source += bundle",
    "    line += newlineCount(bundle)",
  ].join('\n'), [
    "    const prepared = prepareCombo(record)",
    "    sections.push({ offset: { line, column: 0 }, map: prepared.section })",
    "    source += prepared.source",
    "    line += prepared.lines",
  ].join('\n')],
  [[
    "function buildBatch(phase: WebBootBatchPhase, records: readonly WebPluginRecord[]): BatchArtifact {",
    "  const artifact = buildCombo(records)",
  ].join('\n'), "function buildBatch(phase: WebBootBatchPhase, artifact: ComboArtifact): BatchArtifact {"],
  ["  private composed: WebBootGraph", [
    "  private composed: WebBootGraph",
    "  private comboCache = new Map<string, CachedCombo>()",
  ].join('\n')],
  [[
    "    const artifacts: BatchArtifact[] = []",
    "    for (const records of partitionComboRecords(bootstrap)) {",
    "      artifacts.push(buildBatch('bootstrap', records))",
    "    }",
    "    for (const records of partitionComboRecords(application)) {",
    "      artifacts.push(buildBatch('application', records))",
    "    }",
  ].join('\n'), [
    "    // Retain only this graph's combos. Unchanged bootstrap/single bundles are",
    "    // reused while late plugins arrive; removed groups are released on success.",
    "    const nextCache = new Map<string, CachedCombo>()",
    "    const combo = (records: readonly WebPluginRecord[], revision?: string): ComboArtifact => {",
    "      const key = JSON.stringify([revision ?? null, records.map(record => record.entry.id)])",
    "      const prior = this.comboCache.get(key)",
    "      const cached = prior !== undefined && prior.snapshots.length === records.length",
    "        && prior.snapshots.every((snapshot, i) => snapshot.record === records[i]",
    "          && snapshot.bundle === records[i]!.bundle && snapshot.sourceMap === records[i]!.sourceMap",
    "          && snapshot.rev === records[i]!.entry.rev)",
    "        ? prior",
    "        : { artifact: buildCombo(records, revision), snapshots: records.map(record => ({",
    "          record, bundle: record.bundle, sourceMap: record.sourceMap, rev: record.entry.rev,",
    "        })) }",
    "      nextCache.set(key, cached)",
    "      return cached.artifact",
    "    }",
    "    const artifacts: BatchArtifact[] = []",
    "    for (const records of partitionComboRecords(bootstrap)) {",
    "      artifacts.push(buildBatch('bootstrap', combo(records)))",
    "    }",
    "    for (const records of partitionComboRecords(application)) {",
    "      artifacts.push(buildBatch('application', combo(records)))",
    "    }",
  ].join('\n')],
  ["      const artifact = buildCombo([record], record.entry.rev)", "      const artifact = combo([record], record.entry.rev)"],
  ["    this.previousBatchResponses = this.batchResponses", [
    "    this.comboCache = nextCache",
    "    this.previousBatchResponses = this.batchResponses",
  ].join('\n')]
]

export function prepareSource(source) {
  const states = edits.map(([before, after]) => {
    if (source.split(after).length === 2 && !source.replace(after, '').includes(before)) return 'patched'
    if (source.split(before).length === 2 && !source.includes(after)) return 'original'
    throw new Error('Unsupported DSH client module source; refusing to guess')
  })
  if (new Set(states).size !== 1) throw new Error('Incomplete DSH client-composition patch')
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
  console.log('DSH client composition prepared; rebuild client-modules before use')
}
