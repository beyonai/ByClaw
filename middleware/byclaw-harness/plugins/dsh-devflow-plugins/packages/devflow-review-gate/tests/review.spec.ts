// The listener end to end: a real git repository, a real devflow store, a fake
// `ocr` on PATH, and a scripted checker. What is asserted is what a user or an
// operator would see — whether the card moved, what the rejection said, what
// landed in the report directory, and what the journal recorded.
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import AgentRuntime from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, DevStage, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowOcrGate from '@zhchxiao123/dsh-devflow-review-gate'
import type { Config } from '@zhchxiao123/dsh-devflow-review-gate'
import { checkerProvider, cleanReply, findingReply } from './checker-provider.ts'
import type { CheckerCall, ScriptedReply } from './checker-provider.ts'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

const DEVELOPING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
]

/** Workspace root; the devflow root is `<workspace>/.devflow`. */
let workspace: string
let context: Context | undefined

const PREVIEW_OK = JSON.stringify({
  schema_version: '1',
  mode: 'workspace',
  repository: '',
  reviewable_files: [{ path: 'a.ts', status: 'modified', insertions: 1, deletions: 1 }],
  excluded_files: [{ path: 'notes.md', status: 'added', insertions: 1, deletions: 0, exclude_reason: 'unsupported_ext' }],
})

const RULE_OK = JSON.stringify({
  schema_version: '1',
  groups: [{ group_id: 1, source: 'system', pattern: '**/*.ts', files: ['a.ts'], rule: 'TS RULE' }],
})

/**
 * Write a shell script standing in for the `ocr` binary. A fake is what makes
 * these cases runnable on a machine with no `ocr` installed, and lets a case
 * script a version or an exit code a real install would not produce.
 */
async function fakeOcr(options: {
  version?: string
  preview?: string
  rule?: string
  exitCode?: number
} = {}): Promise<string> {
  const bin = join(workspace, 'fake-bin')
  await mkdir(bin, { recursive: true })
  const path = join(bin, 'ocr')
  const preview = (options.preview ?? PREVIEW_OK).replace('"repository":""', `"repository":${JSON.stringify(workspace)}`)
  await writeFile(path, [
    '#!/bin/sh',
    `if [ "$1" = "--version" ]; then echo '${options.version ?? 'open-code-review v1.12.0 (abc) linux/arm64'}'; exit 0; fi`,
    `if [ "$2" = "preview" ]; then cat <<'PREVIEW_EOF'\n${preview}\nPREVIEW_EOF\nexit ${options.exitCode ?? 0}; fi`,
    `if [ "$2" = "rule" ]; then cat <<'RULE_EOF'\n${options.rule ?? RULE_OK}\nRULE_EOF\nexit ${options.exitCode ?? 0}; fi`,
    'echo "unexpected ocr invocation: $*" >&2',
    'exit 64',
  ].join('\n'), 'utf8')
  await chmod(path, 0o755)
  return path
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-review-'))
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

interface Booted {
  ctx: Context
  store: FilesystemDevflowStore
  calls: CheckerCall[]
  reportDir: string
}

async function boot(options: {
  replies?: ScriptedReply[] | ((prompt: string) => ScriptedReply)
  ocr?: Parameters<typeof fakeOcr>[0]
  command?: string
  config?: Partial<Config>
  withProvider?: boolean
} = {}): Promise<Booted> {
  const command = options.command ?? await fakeOcr(options.ocr ?? {})
  // Derived from the card's devflow root now, not configured. Inside the
  // root on purpose: that is what puts it behind devflow-fs-guard.
  const reportDir = join(workspace, '.devflow', 'reports', 'review-gate')
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LocalSubprocessRuntime).await()
  await ctx.plugin(LocalBashExecutor).await()
  await ctx.plugin(AgentRuntime).await()
  await ctx.plugin(AgentDefaultModel, { provider: 'test-provider', model: 'test-model' }).await()
  await ctx.plugin(SubagentRuntime).await()
  const calls: CheckerCall[] = []
  if (options.withProvider !== false) {
    ctx.subagents.registerProvider(checkerProvider({
      replies: options.replies ?? (() => cleanReply(['a.ts'])),
    }, calls))
  }
  await ctx.plugin(FilesystemDevflowStore, { root: join(workspace, '.devflow') }).await()
  await ctx.plugin(DevflowOcrGate, {
    edges: { 'developing->reviewing': { provider: 'checker' } },
    command,
    reviewTimeoutMs: 30_000,
    ...options.config,
  }).await()
  return { ctx, store: ctx.get('devflow') as FilesystemDevflowStore, calls, reportDir }
}

function move(
  store: FilesystemDevflowStore,
  to: DevStage = 'reviewing',
  expectedRevision = 4,
): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId('0001-a'), to, expectedRevision, by: HUMAN,
  }))
}

/**
 * Send an admitted card back to `developing` so the same edge can be
 * re-attempted. A rework edge carries a required reason, which is devflow's
 * own rule rather than this gate's.
 */
async function rework(store: FilesystemDevflowStore): Promise<void> {
  const result = await store.transition(store.resolve({
    id: DevflowCardId('0001-a'),
    to: 'developing',
    expectedRevision: 5,
    by: HUMAN,
    reason: 'more work to do',
  }))
  expect(result.ok).toBe(true)
}

/** Absolute path of one report file under the derived directory. */
function reportPath(name: string): string {
  return join(workspace, '.devflow', 'reports', 'review-gate', name)
}

async function onlyReport(reportDir: string): Promise<string> {
  const files = await readdir(reportDir)
  expect(files).toHaveLength(1)
  return await readFile(join(reportDir, files[0]), 'utf8')
}

describe('a clean review', () => {
  it('admits the move', async () => {
    const { store } = await boot()
    await expect(move(store)).resolves.toMatchObject({ ok: true })
  })

  it('writes the report even though nothing was found', async () => {
    const { store, reportDir } = await boot()
    await move(store)
    const report = await onlyReport(reportDir)
    expect(report).toContain('verdict: allow')
    expect(report).toContain('coverage_rate: 100%')
    expect(report).toContain('## Findings')
    expect(report).toContain('None.')
  })

  // The location is the whole point of deriving it: inside the devflow root
  // is what `dsh-devflow-fs-guard` protects by name, so the agent whose work
  // is under review cannot rewrite the report with its own file tools.
  it('writes the report inside the card devflow root, where fs-guard reaches it', async () => {
    const { store } = await boot()
    await move(store)
    const written = await readdir(join(workspace, '.devflow', 'reports', 'review-gate'))
    expect(written).toHaveLength(1)
    expect(relative(join(workspace, '.devflow'), reportPath(written[0])).startsWith('..')).toBe(false)
  })

  it('states the scope it reviewed, the card having no git identity of its own', async () => {
    const { store, reportDir } = await boot()
    await move(store)
    const report = await onlyReport(reportDir)
    expect(report).toContain('mode: workspace')
    expect(report).toMatch(/head: [0-9a-f]{40}/)
    expect(report).toContain('total_files: 1')
    expect(report).toContain('- `a.ts` (modified, +1/-1)')
    expect(report).toContain('- `notes.md` — unsupported_ext')
  })

  // The card's requirement text is the business context a reviewer needs to
  // tell a defect from a deliberate choice, and it is the reason the gate
  // assembles the prompt itself rather than routing the text through
  // `ocr delegate --background`.
  it('shows the checker the card requirement, not just its title', async () => {
    const { store, calls } = await boot()
    await move(store)
    expect(calls[0].prompt).toContain('Retry with backoff')
    expect(calls[0].prompt).toContain('Retries must back off.')
  })

  it('records the coverage account on the committed journal entry', async () => {
    const { ctx, store } = await boot()
    await move(store)
    const entries = await ctx.devflow.history(DevflowCardId('0001-a'))
    expect(JSON.stringify(entries.at(-1))).toContain('reviewed 1/1 files (100%)')
  })
})

describe('a review that finds something', () => {
  it('refuses the move and points at the report', async () => {
    const { store, reportDir } = await boot({ replies: () => findingReply(['a.ts'], 'critical') })
    const result = await move(store)
    expect(result.ok).toBe(false)
    const files = await readdir(reportDir)
    expect((result as { message: string }).message).toContain(files[0])
    expect((result as { message: string }).message).toContain('1 critical at or above high')
  })

  it('leaves the card where it was', async () => {
    const { ctx, store } = await boot({ replies: () => findingReply(['a.ts'], 'critical') })
    await move(store)
    const card = await ctx.devflow.read(DevflowCardId('0001-a'))
    expect(card).toMatchObject({ stage: 'developing', stageRevision: 4 })
  })

  it('admits a finding below the threshold and says so', async () => {
    const { store, reportDir } = await boot({ replies: () => findingReply(['a.ts'], 'low') })
    await expect(move(store)).resolves.toMatchObject({ ok: true })
    const report = await onlyReport(reportDir)
    expect(report).toContain('verdict: allow')
    expect(report).toContain('### low')
  })

  it('reports without vetoing when the threshold is never', async () => {
    const { store, reportDir } = await boot({
      replies: () => findingReply(['a.ts'], 'critical'),
      config: { edges: { 'developing->reviewing': { provider: 'checker', vetoAtOrAbove: 'never' } } },
    })
    await expect(move(store)).resolves.toMatchObject({ ok: true })
    expect(await onlyReport(reportDir)).toContain('### critical')
  })
})

describe('the report on the card', () => {
  it('registers the report after the move commits when a kind is configured', async () => {
    const { ctx, store } = await boot({ config: { artifactKind: 'review-report' } })
    await move(store)
    await expect.poll(async () => {
      const entries = await ctx.devflow.history(DevflowCardId('0001-a'))
      return JSON.stringify(entries).includes('review-report')
    }).toBe(true)
  })

  it('registers nothing when no kind is configured, the directory being the record', async () => {
    const { ctx, store } = await boot()
    await move(store)
    const entries = await ctx.devflow.history(DevflowCardId('0001-a'))
    expect(JSON.stringify(entries)).not.toContain('review-report')
  })

  it('registers nothing for a move it refused', async () => {
    const { ctx, store } = await boot({
      replies: () => findingReply(['a.ts'], 'critical'),
      config: { artifactKind: 'review-report' },
    })
    await move(store)
    const entries = await ctx.devflow.history(DevflowCardId('0001-a'))
    expect(JSON.stringify(entries)).not.toContain('review-report')
  })
})

describe('an edge with no review policy', () => {
  it('is delegated untouched, and leaves no report behind', async () => {
    const { store, reportDir } = await boot({
      config: { edges: { 'reviewing->testing': { provider: 'checker' } } },
    })
    await expect(move(store)).resolves.toMatchObject({ ok: true })
    await expect(readdir(reportDir)).rejects.toThrow()
  })
})

describe('failing closed', () => {
  async function expectParked(store: FilesystemDevflowStore, ctx: Context, fragment: string): Promise<void> {
    const result = await move(store)
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain(fragment)
    expect((result as { message: string }).message).toContain('parked blocked')
    await expect.poll(async () => (await ctx.devflow.read(DevflowCardId('0001-a')))?.stage).toBe('blocked')
  }

  it('parks the card when ocr is not installed', async () => {
    const { ctx, store } = await boot({ command: join(workspace, 'no-such-ocr') })
    await expectParked(store, ctx, 'could not run')
  })

  it('parks the card when the installed ocr is too old for JSON output', async () => {
    const { ctx, store } = await boot({ ocr: { version: 'open-code-review v1.8.0 (abc) linux/arm64' } })
    await expectParked(store, ctx, 'needs v1.9.0 or newer')
  })

  it('parks the card when the CLI fails', async () => {
    const { ctx, store } = await boot({ ocr: { exitCode: 3 } })
    await expectParked(store, ctx, 'could not run')
  })

  it('parks the card when the CLI emits something that is not JSON', async () => {
    const { ctx, store } = await boot({ ocr: { preview: 'not json at all' } })
    await expectParked(store, ctx, 'is not valid JSON')
  })

  it('parks the card when no checker provider is registered', async () => {
    const { ctx, store } = await boot({ withProvider: false })
    await expectParked(store, ctx, 'is not registered')
  })

  it('parks the card when a checker leaves a file unaccounted for', async () => {
    const { ctx, store } = await boot({ replies: () => cleanReply([]) })
    await expectParked(store, ctx, 'accounted for neither reviewing nor skipping a.ts')
  })

  // A file where the report directory belongs: `mkdir(recursive)` answers
  // EEXIST for that on every platform, unlike a non-directory *parent*, which
  // is ENOTDIR on POSIX and ENOENT on Windows.
  it('parks the card when the report cannot be written', async () => {
    await mkdir(join(workspace, '.devflow', 'reports'), { recursive: true })
    await writeFile(join(workspace, '.devflow', 'reports', 'review-gate'), 'not a directory\n')
    const { ctx, store } = await boot()
    await expectParked(store, ctx, 'could not be written')
  })
})

describe('range mode', () => {
  it('asks the CLI for the configured base ref and records it in the report', async () => {
    const rangePreview = JSON.stringify({
      schema_version: '1',
      mode: 'range',
      repository: '',
      from: 'main',
      to: 'HEAD',
      merge_base: 'b'.repeat(40),
      reviewable_files: [],
      excluded_files: [],
    })
    const { store, reportDir } = await boot({
      ocr: { preview: rangePreview },
      config: { edges: { 'developing->reviewing': { provider: 'checker', baseRef: 'main' } } },
    })
    await expect(move(store)).resolves.toMatchObject({ ok: true })
    const report = await onlyReport(reportDir)
    expect(report).toContain('mode: range')
    expect(report).toContain('base_ref: main')
    expect(report).toContain(`merge_base: ${'b'.repeat(40)}`)
  })
})

describe('a later policy in the waterfall', () => {
  // The gate contributes its check only to a decision the rest of the
  // waterfall also admits; a downstream veto passes through untouched, and no
  // report is queued for a move that never commits.
  it('keeps its veto, and takes no credit for a move it did not cause', async () => {
    const { ctx, store } = await boot({ config: { artifactKind: 'review-report' } })
    await ctx.plugin((child: Context) => {
      child.on('devflow/transition', () => Promise.resolve({ allowed: false, reason: 'a later policy said no' }))
    }).await()
    const result = await move(store)
    expect(result.ok).toBe(false)
    expect((result as { message: string }).message).toContain('a later policy said no')
    const entries = await ctx.devflow.history(DevflowCardId('0001-a'))
    expect(JSON.stringify(entries)).not.toContain('review-report')
  })
})

describe('a repository with no commit yet', () => {
  // The scope is already pinned by the file list, so an unresolvable HEAD
  // leaves the report one field short rather than failing the review.
  it('reviews and reports without a head', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-bare-'))
    const empty = JSON.stringify({
      schema_version: '1', mode: 'workspace', repository: bare,
      reviewable_files: [], excluded_files: [],
    })
    const { store, reportDir } = await boot({ ocr: { preview: empty } })
    execFileSync('rm', ['-rf', join(workspace, '.git')])
    await expect(move(store)).resolves.toMatchObject({ ok: true })
    expect(await onlyReport(reportDir)).not.toContain('head:')
    await rm(bare, { recursive: true, force: true })
  })
})

describe('reusing a verdict', () => {
  // A rework loop re-attempts the same edge repeatedly. Without the cache
  // every attempt pays for a full fan-out of checkers, which is the cost a
  // deployment notices first.
  it('does not dispatch a second time for an identical attempt', async () => {
    const { ctx, store, calls } = await boot()
    await expect(move(store)).resolves.toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    await rework(store)
    await expect(move(store, 'reviewing', 6)).resolves.toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    expect(ctx).toBeDefined()
  })

  it('says the verdict was reused on the journal entry', async () => {
    const { ctx, store } = await boot()
    await move(store)
    await rework(store)
    await expect(move(store, 'reviewing', 6)).resolves.toMatchObject({ ok: true })
    const entries = await ctx.devflow.history(DevflowCardId('0001-a'))
    expect(JSON.stringify(entries.at(-1))).toContain('[cached]')
  })

  // Behaviour change: the cache used to be opt-in through `verdictCacheDir`,
  // and unset meant every attempt paid for a full fan-out. With the location
  // derived there is no "unset" left, and switching it off buys no
  // correctness — faults are never cached, a corrupt record reads as a miss,
  // and an unwritable cache only warns. What it costs is re-reviewing an
  // identical attempt, which is exactly what a rework loop does.
  it('keeps the cache in the card devflow root, with no way to switch it off', async () => {
    const { store, calls } = await boot()
    await move(store)
    await rework(store)
    await expect(move(store, 'reviewing', 6)).resolves.toMatchObject({ ok: true })
    expect(calls).toHaveLength(1)
    await expect(readdir(join(workspace, '.devflow', 'cache', 'review-gate'))).resolves.toHaveLength(1)
  })
})

describe('a review with nothing to review', () => {
  it('admits the move without dispatching a checker', async () => {
    const empty = JSON.stringify({
      schema_version: '1', mode: 'workspace', repository: '',
      reviewable_files: [], excluded_files: [],
    })
    const { store, calls, reportDir } = await boot({ ocr: { preview: empty } })
    await expect(move(store)).resolves.toMatchObject({ ok: true })
    expect(calls).toEqual([])
    expect(await onlyReport(reportDir)).toContain('total_files: 0')
  })
})
