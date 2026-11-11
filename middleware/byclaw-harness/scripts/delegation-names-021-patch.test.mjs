import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepare, prepareSource, edits, marker } from './prepare-dsh-delegation-names-021.mjs'

const original = edits.map(([before]) => before).join('\n// --\n')

function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 }

// Model of the module state and both filters: many users' agents register definitions under a few names; one
// scope's registry resolves each name to at most one definition (possibly a non-delegation tool of that name).
test('distinct-name lookup selects exactly the names the per-definition filter selected', () => {
  const random = rng(7)
  const names = ['subagent', 'byclaw_instantiate_template', 'agent_teams_spawn']
  for (let round = 0; round < 5000; round++) {
    const delegationTools = new Set()
    const delegationToolNames = new Map()
    const all = []
    const register = (definition) => {
      if (!delegationTools.has(definition)) {
        delegationTools.add(definition)
        delegationToolNames.set(definition.name, (delegationToolNames.get(definition.name) ?? 0) + 1)
      }
      return () => {
        if (delegationTools.delete(definition)) {
          const left = (delegationToolNames.get(definition.name) ?? 1) - 1
          if (left > 0) delegationToolNames.set(definition.name, left)
          else delegationToolNames.delete(definition.name)
        }
      }
    }
    const disposers = []
    for (let i = 0; i < 1 + Math.floor(random() * 30); i++) {
      const definition = { name: names[Math.floor(random() * names.length)], i }
      all.push(definition)
      disposers.push(register(definition))
      if (random() < 0.1) disposers.push(register(definition)) // a repeated effect must not double count
    }
    for (const dispose of disposers) if (random() < 0.3) dispose()
    const foreign = names.map(name => ({ name, foreign: true }))
    const resolved = new Map(names.map(name => [name, random() < 0.2 ? undefined
      : random() < 0.2 ? foreign[names.indexOf(name)] : all.filter(d => d.name === name)[Math.floor(random() * 4)]]))
    const get = name => resolved.get(name)
    const before = [...delegationTools].filter(tool => get(tool.name) === tool).map(tool => tool.name).sort()
    const after = [...delegationToolNames.keys()].filter((name) => {
      const found = get(name)
      return found !== undefined && delegationTools.has(found)
    }).sort()
    assert.deepEqual(after, before, `round ${round}`)
    assert.deepEqual([...delegationToolNames.keys()].sort(), [...new Set([...delegationTools].map(t => t.name))].sort())
  }
})

test('patch is exact, idempotent and refuses changed or mixed sources', () => {
  const updated = prepareSource(original)
  assert.ok(updated.includes(marker))
  for (const [before, after] of edits) assert.ok(updated.includes(after) && (after.includes(before) || !updated.includes(before)))
  assert.equal(prepareSource(updated), updated)
  assert.throws(() => prepareSource('upstream changed'), /Unsupported/)
  assert.throws(() => prepareSource(original + edits[2][0]), /Unsupported/)
  assert.throws(() => prepareSource(updated + edits[0][0]), /Unsupported/)
})

test('prepare checks the package version before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-delegation-names-'))
  try {
    const dir = join(root, 'packages/subagent/tool-subagent')
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src/index.ts'), original)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-subagent', version: '0.2.2' }))
    await assert.rejects(prepare(root), /Expected/)
    assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), original)
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-subagent', version: '0.2.1-rc.2' }))
    await prepare(root)
    assert.ok((await readFile(join(dir, 'src/index.ts'), 'utf8')).includes(marker))
  } finally { await rm(root, { recursive: true, force: true }) }
})
