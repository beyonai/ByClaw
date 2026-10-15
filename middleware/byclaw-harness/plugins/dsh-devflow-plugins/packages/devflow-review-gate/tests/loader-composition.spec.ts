// The shipped composition path: a test-only `cordis.yml` booted through the
// real Loader, over a real git repository and a real devflow store. A
// hand-mounted plugin does not catch an invalid Loader export shape, and the
// deployment's own file is the only place the edge config is actually written
// the way a project writes it.
//
// Genuinely external only: the `ocr` binary (a fake script, so this runs on a
// machine with no install) and the checker's model (a scripted provider).
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowOcrGate from '@zhchxiao123/dsh-devflow-review-gate'
import { checkerProvider, cleanReply, findingReply } from './checker-provider.ts'
import type { CheckerCall, ScriptedReply } from './checker-provider.ts'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

const DEVELOPING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
]

let workspace: string
let context: Context | undefined

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-loader-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: workspace })
  execFileSync('git', ['config', 'user.email', 'gate@example.invalid'], { cwd: workspace })
  execFileSync('git', ['config', 'user.name', 'gate'], { cwd: workspace })
  await writeFile(join(workspace, 'a.ts'), 'export const a = 1\n')
  execFileSync('git', ['add', '-A'], { cwd: workspace })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: workspace })
  await writeFile(join(workspace, 'a.ts'), 'export const a = 2\n')
  const dir = join(workspace, '.devflow', 'tasks', '0001-a')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), '---\ntitle: Retry with backoff\n---\nRetries must back off.\n')
  await writeFile(join(dir, 'journal.jsonl'), DEVELOPING.join('\n') + '\n')
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  await rm(workspace, { recursive: true, force: true })
})

/** A stand-in for the `ocr` binary, so the suite needs no install. */
async function fakeOcr(): Promise<string> {
  const path = join(workspace, 'ocr')
  const preview = JSON.stringify({
    schema_version: '1',
    mode: 'workspace',
    repository: workspace,
    reviewable_files: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 1 }],
    excluded_files: [],
  })
  const rule = JSON.stringify({
    schema_version: '1',
    groups: [{ group_id: 1, source: 'project', pattern: '**/*.ts', files: ['a.ts'], rule: 'PROJECT TS RULE' }],
  })
  await writeFile(path, [
    '#!/bin/sh',
    "if [ \"$1\" = \"--version\" ]; then echo 'open-code-review v1.12.0 (abc) linux/arm64'; exit 0; fi",
    `if [ "$2" = "preview" ]; then cat <<'P_EOF'\n${preview}\nP_EOF\nexit 0; fi`,
    `if [ "$2" = "rule" ]; then cat <<'R_EOF'\n${rule}\nR_EOF\nexit 0; fi`,
    'exit 64',
  ].join('\n'), 'utf8')
  await chmod(path, 0o755)
  return path
}

async function boot(replies: ScriptedReply[] | ((prompt: string) => ScriptedReply)): Promise<{
  ctx: Context
  calls: CheckerCall[]
  reportDir: string
}> {
  const command = await fakeOcr()
  // Derived from the card's devflow root; the deployment file names no path.
  const reportDir = join(workspace, '.devflow', 'reports', 'review-gate')
  const configPath = join(workspace, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-bash-local'",
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-agent-default-model'",
    '  config:',
    '    provider: test-provider',
    '    model: test-model',
    "- name: '@deepseek-ai/dsh-subagent'",
    "- name: '@zhchxiao123/dsh-devflow-filesystem'",
    '  config:',
    `    root: ${JSON.stringify(join(workspace, '.devflow'))}`,
    "- name: '@zhchxiao123/dsh-devflow-review-gate'",
    '  config:',
    '    edges:',
    "      'developing->reviewing':",
    '        provider: checker',
    '        vetoAtOrAbove: high',
    `    command: ${JSON.stringify(command)}`,
    '    reviewTimeoutMs: 30000',
    '    artifactKind: review-report',
    '',
  ].join('\n'), 'utf8')

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(workspace).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-bash-local', LocalBashExecutor],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-default-model', AgentDefaultModelConfig],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@zhchxiao123/dsh-devflow-filesystem', FilesystemDevflowStore],
    ['@zhchxiao123/dsh-devflow-review-gate', DevflowOcrGate],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const calls: CheckerCall[] = []
  ctx.subagents.registerProvider(checkerProvider({ replies }, calls))
  return { ctx, calls, reportDir }
}

/**
 * Wait for the post-commit report registration this gate queues but never
 * awaits. A case that admitted a move and then tore its workspace down would
 * otherwise race that write.
 */
async function settleAttach(ctx: Context): Promise<void> {
  await expect.poll(async () => {
    const entries = await ctx.devflow.history(DevflowCardId('0001-a'))
    return JSON.stringify(entries).includes('review-report')
  }).toBe(true)
}

function move(ctx: Context, to: 'reviewing'): Promise<TransitionResult> {
  return ctx.devflow.transition(ctx.devflow.resolve({
    id: DevflowCardId('0001-a'), to, expectedRevision: 4, by: HUMAN,
  }))
}

describe('devflow-review-gate under the real Loader', () => {
  it('loads from a deployment cordis.yml and reviews the configured edge', async () => {
    const { ctx, calls, reportDir } = await boot(() => cleanReply(['a.ts']))
    await expect(move(ctx, 'reviewing')).resolves.toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    // The project's own rule reached the reviewer, not a default of ours.
    expect(calls[0].prompt).toContain('PROJECT TS RULE')
    const files = await readdir(reportDir)
    expect(files).toHaveLength(1)
    expect(await readFile(join(reportDir, files[0]), 'utf8')).toContain('verdict: allow')
    await settleAttach(ctx)
  })

  it('refuses the move on a finding at the configured threshold', async () => {
    const { ctx } = await boot(() => findingReply(['a.ts'], 'high'))
    const result = await move(ctx, 'reviewing')
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain('1 high at or above high')
    const card = await ctx.devflow.read(DevflowCardId('0001-a'))
    expect(card).toMatchObject({ stage: 'developing', stageRevision: 4 })
  })

  it('registers the report on the card once the move commits', async () => {
    const { ctx } = await boot(() => cleanReply(['a.ts']))
    await move(ctx, 'reviewing')
    await settleAttach(ctx)
  })

  // A function plugin must named-export its namespace and have no default
  // export; mixing the forms makes the Loader discard the namespace, which
  // only a boot through the real Loader catches.
  it('exposes the export shape the Loader requires of a function plugin', () => {
    expect(DevflowOcrGate.name).toBe('devflow-review-gate')
    expect(DevflowOcrGate.inject).toEqual(['devflow', 'shell'])
    expect(typeof DevflowOcrGate.apply).toBe('function')
    expect(Object.hasOwn(DevflowOcrGate, 'default')).toBe(false)
  })
})
