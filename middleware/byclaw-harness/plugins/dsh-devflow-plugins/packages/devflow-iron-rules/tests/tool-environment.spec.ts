// With workspaceOnToolEnvironment rules are recorded, discovered, and measured
// through the context's tool providers: the same files on disk, written and
// read without this process's filesystem.
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { workspaceIo } from '@zhchxiao123/dsh-devflow'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-iron-rules'
import { recordRule } from '../src/record.ts'
import { loadRules, watchStatus, workspaceOf } from '../src/rules.ts'
import { mountToolEnvironment } from '../../../tests/tool-environment.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('iron rules on a tool environment', () => {
  it('records, replaces, discovers, and measures rules through the tool providers', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-iron-toolenv-'))
    context = new Context()
    const { fs, spawns } = await mountToolEnvironment(context)
    const io = workspaceIo(context, true)
    const injected: UserMessage[] = []
    const agent = { session: { header: { cwd: root } }, inject: (message: UserMessage) => injected.push(message) } as unknown as Agent
    const config = resolveConfig({ workspaceOnToolEnvironment: true })
    await mkdir(join(root, 'src'))

    const first = await recordRule(context, agent, {
      id: 'first', title: 'First', body: 'One.', enforcement: 'script', check: 'exit 0', watches: ['src/', 'gone/'],
    }, config, io)
    expect(first.ok).toBe(true)
    const merged = await recordRule(context, agent, {
      id: 'merged', title: 'Merged', body: 'Both.', enforcement: 'judgement', replaces: ['first'],
    }, config, io)
    expect(merged.ok).toBe(true)

    const rulesDir = join(root, '.devflow', 'iron-rules')
    expect(await readFile(join(rulesDir, 'merged', 'RULE.md'), 'utf8')).toContain('title: Merged')
    const set = await loadRules(workspaceOf(agent, config), io)
    expect(set.rules.map(rule => rule.id)).toEqual(['merged'])
    expect(injected).toHaveLength(2)

    const scripted = await recordRule(context, agent, {
      id: 'scripted', title: 'Scripted', body: 'Run.', enforcement: 'script', check: 'exit 0', watches: ['src/', 'gone/'],
    }, config, io)
    expect(scripted.ok).toBe(true)
    const rule = (await loadRules(workspaceOf(agent, config), io)).rules.find(entry => entry.id === 'scripted')
    expect(rule).toMatchObject({ enforcement: 'script', checkScript: join(rulesDir, 'scripted', 'check.sh') })
    expect(await watchStatus(rule!, root, io)).toEqual({ declared: 2, missing: 1, stale: false })

    expect(fs.calls.some(call => call.startsWith('writeText ') && call.endsWith('RULE.md'))).toBe(true)
    expect(spawns.argv.map(argv => argv[4])).toEqual(expect.arrayContaining(['mkdirp', 'rm']))
  })
})
