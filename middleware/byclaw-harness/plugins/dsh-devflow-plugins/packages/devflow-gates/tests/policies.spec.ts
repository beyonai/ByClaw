// Per-edge execution policy: the timeout and working directory handed to the
// shell executor, concurrent command execution, and the failure log that keeps
// the veto summary from being the only record of what a gate printed.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ShellExecutor from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import type { DevActor, TransitionResult } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import * as DevflowGates from '@zhchxiao123/dsh-devflow-gates'

const HUMAN: DevActor = { kind: 'human', name: 'byclaw' }

/**
 * A resolvable promise, spelled out rather than taken from
 * `Promise.withResolvers`: the linter builds no program for files outside the
 * packages' `include: ["src"]`, so it has neither the ES2024 lib nor our
 * tsconfig and reads that call as an error type.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** Records the resolved spec of every command, and settles them on demand. */
class ScriptedExecutor extends ShellExecutor {
  readonly specs: ShellExecSpec[] = []
  readonly started: string[] = []
  constructor(
    ctx: Context,
    private readonly script: Record<string, { exitCode: number | null; stdout?: string; stderr?: string; holds?: Promise<void> }>,
  ) {
    super(ctx)
  }

  resolve(request: ShellExecRequest): ShellExecSpec {
    return {
      command: request.command,
      workdir: request.workdir ?? '/scripted',
      timeoutMs: request.timeoutMs ?? 1000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 64_000,
      sandboxPolicy: request.sandboxPolicy,
    }
  }

  async run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.specs.push(spec)
    this.started.push(spec.command)
    const entry = this.script[spec.command]
    if (entry === undefined) throw new Error(`unscripted gate command: ${spec.command}`)
    if (entry.holds !== undefined) await entry.holds
    return {
      exitCode: entry.exitCode,
      signal: entry.exitCode === null ? 'SIGKILL' : null,
      timedOut: false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: entry.stdout ?? '', truncated: false },
      stderr: { text: entry.stderr ?? '', truncated: false },
    }
  }

  start(): ShellProcess {
    throw new Error('gates never start background processes')
  }
}

const DEVELOPING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
  '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"ready"}',
  '{"rev":4,"at":"t4","type":"transition","from":"ready","to":"developing"}',
]

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(
  script: Record<string, { exitCode: number | null; stdout?: string; stderr?: string; holds?: Promise<void> }>,
  config: DevflowGates.Config,
): Promise<{ store: FilesystemDevflowStore; shell: ScriptedExecutor }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-devflow-policies-'))
  const dir = join(root, 'tasks', '0001-a')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'card.md'), '---\ntitle: Card\n---\nbody\n')
  await writeFile(join(dir, 'journal.jsonl'), DEVELOPING.join('\n') + '\n')
  const ctx = new Context()
  context = ctx
  let shell!: ScriptedExecutor
  await ctx.plugin((child: Context) => { shell = new ScriptedExecutor(child, script) })
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  await ctx.plugin(DevflowGates, config).await()
  return { store: ctx.get('devflow') as FilesystemDevflowStore, shell }
}

function review(store: FilesystemDevflowStore): Promise<TransitionResult> {
  return store.transition(store.resolve({
    id: DevflowCardId('0001-a'), to: 'reviewing', expectedRevision: 4, by: HUMAN,
  }))
}

/**
 * One harness, several projects. The store's `root` is left unset in the
 * bundle on purpose so each caller's workspace resolves it, and a transition
 * carries its own `root` — but the gate held a single configured directory, so
 * every project's logs landed in one place and report names collided the
 * moment two projects both held `0001-a`. Deriving the path from
 * `attempt.root` is what this case exists to prove.
 */
describe('two projects served by one gate', () => {
  it('keeps each project logs in its own devflow root', async () => {
    const { store } = await boot(
      { suite: { exitCode: 1, stderr: 'first project boom' } },
      { edges: { 'developing->reviewing': ['suite'] } },
    )
    // A second devflow root holding a card of the very same id.
    const other = await mkdtemp(join(tmpdir(), 'dsh-devflow-policies-other-'))
    try {
      const dir = join(other, 'tasks', '0001-a')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'card.md'), '---\ntitle: Card\n---\nbody\n')
      await writeFile(join(dir, 'journal.jsonl'), DEVELOPING.join('\n') + '\n')

      await review(store)
      await store.transition(store.resolve({
        id: DevflowCardId('0001-a'), to: 'reviewing', expectedRevision: 4, by: HUMAN, root: other,
      }))

      const here = join(root!, 'reports', 'gates', '0001-a-developing-to-reviewing-0.log')
      const there = join(other, 'reports', 'gates', '0001-a-developing-to-reviewing-0.log')
      // Same card id, same edge, same revision: one configured directory would
      // have made these one file, with the second write erasing the first.
      expect(here).not.toBe(there)
      await expect(readFile(here, 'utf8')).resolves.toContain('first project boom')
      await expect(readFile(there, 'utf8')).resolves.toContain('first project boom')
      await expect(readdir(join(root!, 'reports', 'gates'))).resolves.toHaveLength(1)
      await expect(readdir(join(other, 'reports', 'gates'))).resolves.toHaveLength(1)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})

describe('devflow-gates edge policies', () => {
  it('hands the edge its own timeout and working directory', async () => {
    const { store, shell } = await boot(
      { suite: { exitCode: 0 } },
      {
        edges: { 'developing->reviewing': ['suite'] },
        policies: { 'developing->reviewing': { timeoutMs: 900_000, workdir: '/elsewhere' } },
      },
    )
    expect((await review(store)).ok).toBe(true)
    expect(shell.specs[0]).toMatchObject({ command: 'suite', timeoutMs: 900_000, workdir: '/elsewhere' })
  })

  it('leaves an unpoliced edge on the executor defaults, in the card workspace', async () => {
    const { store, shell } = await boot(
      { check: { exitCode: 0 } },
      { edges: { 'developing->reviewing': ['check'] } },
    )
    expect((await review(store)).ok).toBe(true)
    // The workspace is the parent of the devflow root; the timeout is whatever
    // the executor resolved.
    expect(shell.specs[0]?.workdir).toBe(join(root!, '..'))
    expect(shell.specs[0]?.timeoutMs).toBe(1000)
  })

  it('stops at the first failure when the edge is sequential', async () => {
    const { store, shell } = await boot(
      { first: { exitCode: 1, stderr: 'first blew up' }, second: { exitCode: 0 } },
      { edges: { 'developing->reviewing': ['first', 'second'] } },
    )
    const result = await review(store)
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    expect(shell.started).toEqual(['first'])
  })

  it('runs every command and names each failure when the edge is parallel', async () => {
    const held = deferred()
    const { store, shell } = await boot(
      {
        slow: { exitCode: 1, stderr: 'slow failed', holds: held.promise },
        quick: { exitCode: 1, stderr: 'quick failed' },
        fine: { exitCode: 0 },
      },
      {
        edges: { 'developing->reviewing': ['slow', 'quick', 'fine'] },
        policies: { 'developing->reviewing': { parallel: true } },
      },
    )
    const moving = review(store)
    // All three are in flight before the slow one settles: sequential would
    // still be waiting on `slow`.
    await vi.waitFor(() => { expect(shell.started).toHaveLength(3) })
    held.resolve()
    const result = await moving
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    const message = (result as { message: string }).message
    expect(message).toContain('slow failed')
    expect(message).toContain('quick failed')
    expect(message).not.toContain('fine')
  })

  // Behaviour change: the log used to be opt-in through `failureLogDir`, and
  // unset left the truncated summary as the only account of why a gate
  // refused — missing exactly when it is needed. With the location derived
  // from the card's devflow root there is no "unset" left, so every failed
  // command's complete output is kept, inside the root where
  // `dsh-devflow-fs-guard` reaches it.
  it('always writes the complete output of a failed command and names the file', async () => {
    const shouting = 'x'.repeat(5000)
    const { store } = await boot(
      { suite: { exitCode: 3, stdout: shouting, stderr: 'the tail' } },
      { edges: { 'developing->reviewing': ['suite'] }, maxFailureOutputChars: 40 },
    )
    const result = await review(store)
    const message = (result as { message: string }).message
    expect(message).toContain('(truncated)')

    const logs = join(root!, 'reports', 'gates')
    const written = await readdir(logs)
    expect(written).toEqual(['0001-a-developing-to-reviewing-0.log'])
    const logPath = join(logs, written[0] ?? '')
    expect(message).toContain(`full output: ${logPath}`)
    const body = await readFile(logPath, 'utf8')
    expect(body).toContain('command: suite')
    expect(body).toContain('exit 3')
    expect(body).toContain('the tail')
    // The whole output, not the summary's 40 characters.
    expect(body).toContain(shouting)
  })

  // A file where the log directory belongs: `mkdir(recursive)` answers EEXIST
  // for that on every platform, unlike a non-directory *parent*, which is
  // ENOTDIR on POSIX and ENOENT on Windows.
  it('still vetoes when the failure log cannot be written', async () => {
    const { store } = await boot(
      { suite: { exitCode: 1, stderr: 'boom' } },
      { edges: { 'developing->reviewing': ['suite'] } },
    )
    await mkdir(join(root!, 'reports'), { recursive: true })
    await writeFile(join(root!, 'reports', 'gates'), 'a file where the log directory would go\n')
    const result = await review(store)
    expect(result).toMatchObject({ ok: false, code: 'vetoed' })
    const message = (result as { message: string }).message
    // The gate's decision does not depend on the log: the summary still
    // carries what the command printed, and nothing points at a missing file.
    expect(message).toContain('boom')
    expect(message).not.toContain('full output:')
  })

  it('fails the load on a policy naming an invalid edge or a non-positive timeout', async () => {
    await expect(boot({}, { policies: { 'nowhere->done': {} } }))
      .rejects.toThrow('policies names invalid edge "nowhere->done"')
    await expect(boot({}, { policies: { 'developing->reviewing': { timeoutMs: 0 } } }))
      .rejects.toThrow('timeoutMs must be a positive integer')
  })
})
