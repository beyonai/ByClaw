// Rule discovery against real files: parsing tolerances (BOM, quotes, colons
// in titles), the id fence that keeps a directory name from becoming a path
// escape, watch staleness semantics, and the per-agent root derivation that
// keeps rules, cards, and spec documents under one `.devflow/`.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-iron-rules'
import { loadRules, parseRuleFile, rulesByteSize, validateRuleId, watchStatus, workspaceOf } from '../src/rules.ts'
import type { Workspace } from '../src/rules.ts'
import type { IronRule } from '../src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function workspace(): Promise<Workspace> {
  root = await mkdtemp(join(tmpdir(), 'devflow-iron-rules-'))
  return { projectRoot: root, rulesDir: join(root, '.devflow', 'iron-rules') }
}

async function writeRule(rulesDir: string, id: string, ruleFile: string, check?: string): Promise<void> {
  const dir = join(rulesDir, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'RULE.md'), ruleFile)
  if (check !== undefined) await writeFile(join(dir, 'check.sh'), check)
}

function rule(overrides: Partial<IronRule>): IronRule {
  return { id: 'r', title: 't', owner: 'local', body: '', dir: '/x', enforcement: 'judgement', ...overrides }
}

describe('workspaceOf', () => {
  const config = resolveConfig({})

  it('derives <session cwd>/.devflow/iron-rules for an agent with a workspace', () => {
    const agent = { session: { header: { cwd: '/work/repo' } } } as Agent
    expect(workspaceOf(agent, config)).toEqual({
      projectRoot: resolve('/work/repo'),
      rulesDir: join(resolve('/work/repo'), '.devflow', 'iron-rules'),
    })
  })

  it('falls back to the configured root for an agent without one', () => {
    const agent = { session: { header: {} } } as Agent
    expect(workspaceOf(agent, config)).toEqual({
      projectRoot: resolve('.'),
      rulesDir: resolve('.devflow/iron-rules'),
    })
  })
})

describe('validateRuleId', () => {
  it.each(['no-any-in-src', 'a', '0rule'])('accepts %s', (id) => {
    expect(validateRuleId(id)).toBeUndefined()
  })

  it.each(['../escape', 'a/b', '/abs', 'Upper', 'sp ace', '-lead', ''])('rejects %s as a path hazard or malformed id', (id) => {
    expect(validateRuleId(id)).toContain('invalid rule id')
  })
})

describe('parseRuleFile', () => {
  it('splits frontmatter from body, stripping a BOM, quotes, and comment lines', () => {
    const parsed = parseRuleFile('﻿---\ntitle: "Ban: something"\n# comment\nowner: admin\nbadline\n---\nBody text\n')
    expect(parsed.frontmatter).toEqual({ title: 'Ban: something', owner: 'admin' })
    expect(parsed.body).toBe('Body text')
  })

  it('treats a file without a fence as all body', () => {
    expect(parseRuleFile('just prose\n')).toEqual({ frontmatter: {}, body: 'just prose' })
  })
})

describe('watchStatus', () => {
  it('is undefined without a declaration — unknown must not read as stale', async () => {
    const { projectRoot } = await workspace()
    expect(await watchStatus(rule({}), projectRoot)).toBeUndefined()
    expect(await watchStatus(rule({ watches: [] }), projectRoot)).toBeUndefined()
  })

  it('reports stale only on a total miss', async () => {
    const { projectRoot } = await workspace()
    await mkdir(join(projectRoot, 'src'))
    expect(await watchStatus(rule({ watches: ['src/', 'gone/'] }), projectRoot))
      .toEqual({ declared: 2, missing: 1, stale: false })
    expect(await watchStatus(rule({ watches: ['gone/', 'also-gone/'] }), projectRoot))
      .toEqual({ declared: 2, missing: 2, stale: true })
  })
})

describe('loadRules', () => {
  it('is inert in a workspace with no rule directory', async () => {
    const space = await workspace()
    expect(await loadRules(space)).toEqual({ ...space, rules: [], warnings: [] })
  })

  it('parses rules in directory order, skipping and warning on the malformed', async () => {
    const space = await workspace()
    await writeRule(space.rulesDir, 'b-rule', '---\ntitle: Second\nenforcement: judgement\n---\nbody b\n')
    await writeRule(space.rulesDir, 'a-rule', '---\ntitle: First\nowner: admin\nwatches: src/ lib/\n---\nbody a\n', 'exit 0\n')
    await writeRule(space.rulesDir, 'no-title', '---\nowner: local\n---\nbody\n')
    await mkdir(join(space.rulesDir, 'stray'), { recursive: true })
    await mkdir(join(space.rulesDir, 'Bad Name'), { recursive: true })
    // A file at the top level is not a rule directory and is not even listed.
    await writeFile(join(space.rulesDir, 'notes.md'), 'x')

    const set = await loadRules(space)
    expect(set.rules.map(r => r.id)).toEqual(['a-rule', 'b-rule'])
    const [first, second] = set.rules
    expect(first).toMatchObject({
      title: 'First',
      owner: 'admin',
      body: 'body a',
      enforcement: 'script',
      checkScript: join(space.rulesDir, 'a-rule', 'check.sh'),
      watches: ['src/', 'lib/'],
    })
    expect(second).toMatchObject({ title: 'Second', owner: 'local', enforcement: 'judgement' })
    expect(second?.checkScript).toBeUndefined()
    expect(second?.watches).toBeUndefined()
    expect(set.warnings).toEqual([
      'invalid rule id "Bad Name" (expected lowercase letters, digits, and hyphens, starting with a letter or digit), skipped',
      'no-title: RULE.md frontmatter has no "title", skipped',
      'stray: no RULE.md, skipped',
    ])
  })

  it('infers enforcement from the disk for a rule that never declared it', async () => {
    const space = await workspace()
    await writeRule(space.rulesDir, 'legacy-check', '---\ntitle: Legacy\n---\nbody\n', 'exit 0\n')
    await writeRule(space.rulesDir, 'legacy-prose', '---\ntitle: Prose\n---\nbody\n')
    const set = await loadRules(space)
    expect(set.rules.map(r => [r.id, r.enforcement])).toEqual([
      ['legacy-check', 'script'],
      ['legacy-prose', 'judgement'],
    ])
  })

  it('corrects a declared id that disagrees with the directory name, warning', async () => {
    const space = await workspace()
    await writeRule(space.rulesDir, 'real-name', '---\nid: other-name\ntitle: T\n---\nbody\n')
    const set = await loadRules(space)
    expect(set.rules[0]?.id).toBe('real-name')
    expect(set.warnings).toEqual(['real-name: RULE.md declares id "other-name"; using the directory name'])
  })

  it('keeps a declared enforcement even when the disk disagrees', async () => {
    const space = await workspace()
    // Declared script but no check.sh on disk: the declaration wins; the check
    // half simply has nothing to run for it.
    await writeRule(space.rulesDir, 'declared', '---\ntitle: D\nenforcement: script\n---\nbody\n')
    const set = await loadRules(space)
    expect(set.rules[0]).toMatchObject({ enforcement: 'script' })
    expect(set.rules[0]?.checkScript).toBeUndefined()
  })

  it('collapses an empty watches declaration to undefined', async () => {
    const space = await workspace()
    await writeRule(space.rulesDir, 'empty-watch', '---\ntitle: E\nwatches:\n---\nbody\n')
    const set = await loadRules(space)
    expect(set.rules[0]?.watches).toBeUndefined()
  })
})

describe('rulesByteSize', () => {
  it('sums UTF-8 bytes of titles and bodies', () => {
    expect(rulesByteSize([rule({ title: 'ab', body: 'cd' }), rule({ title: '中', body: '' })])).toBe(4 + 3)
  })
})
