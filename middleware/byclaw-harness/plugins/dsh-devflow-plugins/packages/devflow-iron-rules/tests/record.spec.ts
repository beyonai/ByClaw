// The shared write path behind the tool and the `devflowIronRules` service:
// triage coherence, every rejection settling BEFORE the first write, the net
// change budget that lets a merge through where pure addition would refuse,
// admin protection, and the immediate context injection that makes a recorded
// rule effective on the very next request.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-iron-rules'
import { digestRules } from '../src/inject.ts'
import { recordRule, triageDiagnostic } from '../src/record.ts'
import type { IronRule, RecordInput } from '../src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** An agent double carrying only what recordRule reads: a cwd and an inject sink. */
function agentIn(cwd: string, injected: UserMessage[]): Agent {
  return {
    session: { header: { cwd } },
    inject: (message: UserMessage) => injected.push(message),
  } as unknown as Agent
}

async function workspace(): Promise<{ cwd: string; rulesDir: string; injected: UserMessage[]; agent: Agent }> {
  root = await mkdtemp(join(tmpdir(), 'devflow-iron-record-'))
  const injected: UserMessage[] = []
  return { cwd: root, rulesDir: join(root, '.devflow', 'iron-rules'), injected, agent: agentIn(root, injected) }
}

async function writeRule(rulesDir: string, id: string, ruleFile: string): Promise<void> {
  const dir = join(rulesDir, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'RULE.md'), ruleFile)
}

/** The whole rule tree as comparable state, to prove a rejection changed nothing. */
async function treeState(rulesDir: string): Promise<Map<string, string>> {
  const state = new Map<string, string>()
  let ids: string[] = []
  try {
    ids = (await readdir(rulesDir)).sort()
  } catch {
    // No rule directory yet is a legal state to snapshot.
    return state
  }
  for (const id of ids) {
    for (const file of (await readdir(join(rulesDir, id))).sort()) {
      state.set(`${id}/${file}`, await readFile(join(rulesDir, id, file), 'utf8'))
    }
  }
  return state
}

function input(overrides: Partial<RecordInput>): RecordInput {
  return { id: 'new-rule', title: 'Do the thing', body: '**Ban** it.', enforcement: 'judgement', ...overrides }
}

const config = resolveConfig({})
const ctx = new Context()

describe('triageDiagnostic', () => {
  it('is coherent in all four quadrants', () => {
    expect(triageDiagnostic(input({ enforcement: 'script', check: 'exit 0', watches: ['src/'] }))).toBeUndefined()
    expect(triageDiagnostic(input({ enforcement: 'script', watches: ['src/'] }))).toContain('requires a `check` script')
    expect(triageDiagnostic(input({ enforcement: 'script', check: '  ', watches: ['src/'] }))).toContain('requires a `check` script')
    expect(triageDiagnostic(input({ enforcement: 'script', check: 'exit 0' }))).toContain('requires `watches`')
    expect(triageDiagnostic(input({ enforcement: 'script', check: 'exit 0', watches: [] }))).toContain('requires `watches`')
    expect(triageDiagnostic(input({ enforcement: 'judgement' }))).toBeUndefined()
    expect(triageDiagnostic(input({ enforcement: 'judgement', check: 'exit 0' }))).toContain('contradicts')
  })
})

describe('recordRule rejections leave the disk untouched', () => {
  it.each([
    ['an invalid id', input({ id: '../escape' }), 'invalid rule id'],
    ['a blank title', input({ title: '  ' }), 'non-empty title'],
    ['an incoherent triage', input({ enforcement: 'script' }), 'requires a `check` script'],
    ['replaces naming a missing rule', input({ replaces: ['ghost'] }), 'replaces names rules that do not exist: ghost'],
  ] as const)('%s', async (_case, request, message) => {
    const { rulesDir, agent, injected } = await workspace()
    await writeRule(rulesDir, 'existing', '---\ntitle: E\n---\nbody\n')
    const before = await treeState(rulesDir)

    const outcome = await recordRule(ctx, agent, request, config)

    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain(message)
    expect(await treeState(rulesDir)).toEqual(before)
    expect(injected).toHaveLength(0)
  })

  it('refuses to replace a team rule, naming the review that governs it', async () => {
    const { rulesDir, agent } = await workspace()
    await writeRule(rulesDir, 'team-rule', '---\ntitle: T\nowner: admin\n---\nbody\n')
    const before = await treeState(rulesDir)

    const outcome = await recordRule(ctx, agent, input({ replaces: ['team-rule'] }), config)

    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('team rules cannot be replaced: team-rule')
    expect(await treeState(rulesDir)).toEqual(before)
  })

  it('refuses an existing id that is not being revised, pointing at replaces', async () => {
    const { rulesDir, agent } = await workspace()
    await writeRule(rulesDir, 'taken', '---\ntitle: T\n---\nbody\n')
    const outcome = await recordRule(ctx, agent, input({ id: 'taken' }), config)
    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('rule [taken] already exists')
  })

  it('budgets the NET change: a pure addition over the ceiling is refused, a merge passes', async () => {
    const { rulesDir, agent } = await workspace()
    const tight = resolveConfig({ maxBytes: 120 })
    await writeRule(rulesDir, 'old-a', `---\ntitle: A\n---\n${'a'.repeat(50)}\n`)
    await writeRule(rulesDir, 'old-b', `---\ntitle: B\n---\n${'b'.repeat(50)}\n`)
    const before = await treeState(rulesDir)

    const addition = await recordRule(ctx, agent, input({ id: 'third', body: 'c'.repeat(50) }), tight)
    expect(addition.ok).toBe(false)
    expect(addition.text).toContain('byte ceiling')
    expect(await treeState(rulesDir)).toEqual(before)

    const merge = await recordRule(ctx, agent, input({ id: 'merged', body: 'c'.repeat(50), replaces: ['old-a', 'old-b'] }), tight)
    expect(merge.ok).toBe(true)
  })

  it('reports a write failure as a settled outcome rather than a rejection', async () => {
    const { rulesDir, agent } = await workspace()
    // The rule id's directory slot is occupied by a FILE, so mkdir fails.
    await mkdir(rulesDir, { recursive: true })
    await writeFile(join(rulesDir, 'blocked'), 'not a directory')
    const outcome = await recordRule(ctx, agent, input({ id: 'blocked' }), config)
    expect(outcome.ok).toBe(false)
    expect(outcome.text).toContain('writing the rule failed')
  })
})

describe('recordRule commits', () => {
  it('writes RULE.md with the triage recorded and injects the addition immediately', async () => {
    const { rulesDir, agent, injected } = await workspace()

    const outcome = await recordRule(ctx, agent, input({
      id: 'no-any',
      title: 'Ban any in src',
      body: '**Never** use any.',
      enforcement: 'script',
      check: 'exit 1',
      watches: ['src/', 'lib/'],
    }), config)

    expect(outcome).toEqual({
      ok: true,
      text: 'Recorded iron rule [no-any] Ban any in src; its check script runs when the next turn that changes code ends.',
    })
    const ruleFile = await readFile(join(rulesDir, 'no-any', 'RULE.md'), 'utf8')
    expect(ruleFile).toBe('---\nid: no-any\ntitle: Ban any in src\nowner: local\nenforcement: script\nwatches: src/ lib/\n---\n\n**Never** use any.\n')
    expect(await readFile(join(rulesDir, 'no-any', 'check.sh'), 'utf8')).toBe('exit 1\n')

    expect(injected).toHaveLength(1)
    const [message] = injected
    expect((message?.content[0] as { text: string }).text).toContain('New iron rule [no-any] Ban any in src')
    expect(message?.source).toMatchObject({ kind: 'devflow-iron-rules', ids: ['no-any'] })
  })

  it('merges a cluster: replaced directories are deleted only after the new rule exists', async () => {
    const { rulesDir, agent, injected } = await workspace()
    await writeRule(rulesDir, 'old-a', '---\ntitle: A\n---\na\n')
    await writeRule(rulesDir, 'old-b', '---\ntitle: B\n---\nb\n')
    await writeRule(rulesDir, 'kept', '---\ntitle: K\n---\nk\n')

    const outcome = await recordRule(ctx, agent, input({ id: 'merged', title: 'Both', body: 'ab', replaces: ['old-a', 'old-b'] }), config)

    expect(outcome.ok).toBe(true)
    expect(outcome.text).toContain('merging [old-a], [old-b]')
    expect((await readdir(rulesDir)).sort()).toEqual(['kept', 'merged'])
    const text = (injected[0]?.content[0] as { text: string }).text
    expect(text).toContain('superseded by this one and no longer apply: [old-a], [old-b]')
    // The injected digest names the set as it now stands on disk, so the next
    // pre-step does not republish a duplicate baseline.
    const merged: IronRule = { id: 'merged', title: 'Both', owner: 'local', body: 'ab', dir: join(rulesDir, 'merged'), enforcement: 'judgement' }
    const kept: IronRule = { id: 'kept', title: 'K', owner: 'local', body: 'k', dir: join(rulesDir, 'kept'), enforcement: 'judgement' }
    expect((injected[0]?.source as { digest: string }).digest).toBe(digestRules([kept, merged]))
  })

  it('revises a rule in place when replaces names its own id', async () => {
    const { rulesDir, agent, injected } = await workspace()
    await writeRule(rulesDir, 'evolving', '---\ntitle: Old\n---\nold\n')

    const outcome = await recordRule(ctx, agent, input({ id: 'evolving', title: 'New', body: 'new', replaces: ['evolving'] }), config)

    expect(outcome.ok).toBe(true)
    expect(outcome.text).not.toContain('merging')
    expect(await readFile(join(rulesDir, 'evolving', 'RULE.md'), 'utf8')).toContain('title: New')
    expect((injected[0]?.content[0] as { text: string }).text).toContain('New iron rule [evolving] New')
  })
})
