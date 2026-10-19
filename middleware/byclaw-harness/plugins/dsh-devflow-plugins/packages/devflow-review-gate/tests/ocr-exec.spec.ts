// Running the CLI: what reaches the shell, which faults stop the review, and
// which calls a scope resolution actually makes. The executor is scripted
// rather than real so the cases can cover faults an installed `ocr` will not
// produce on demand — a killed process, a truncated capture, a version too old
// to emit JSON.
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ShellExecutor from '@deepseek-ai/dsh-shell'
import type { ShellExecRequest, ShellExecSpec, ShellProcess, ShellRunResult } from '@deepseek-ai/dsh-shell'
import {
  ReviewError,
  STDOUT_BUDGET,
  assertUsableVersion,
  resolveReviewScope,
  runCapture,
} from '@zhchxiao123/dsh-devflow-review-gate/src/ocr.ts'

/** One scripted outcome; every field mirrors what a real run would report. */
interface Scripted {
  exitCode?: number | null
  signal?: string | null
  stdout?: string
  stderr?: string
  timedOut?: boolean
  truncated?: boolean
}

/** Answers each command from a script keyed by a substring of the command line. */
class ScriptedExecutor extends ShellExecutor {
  readonly commands: string[] = []
  readonly specs: ShellExecSpec[] = []
  constructor(ctx: Context, private readonly script: readonly (readonly [string, Scripted])[]) {
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

  run(spec: ShellExecSpec): Promise<ShellRunResult> {
    this.commands.push(spec.command)
    this.specs.push(spec)
    const entry = this.script.find(([match]) => spec.command.includes(match))?.[1]
    if (entry === undefined) throw new Error(`unscripted ocr command: ${spec.command}`)
    return Promise.resolve({
      exitCode: 'exitCode' in entry ? entry.exitCode : 0,
      signal: entry.signal ?? null,
      timedOut: entry.timedOut ?? false,
      aborted: false,
      timeoutMs: spec.timeoutMs,
      stdout: { text: entry.stdout ?? '', truncated: entry.truncated ?? false },
      stderr: { text: entry.stderr ?? '', truncated: false },
    })
  }

  start(): ShellProcess {
    throw new Error('the review gate never starts background processes')
  }
}

const INVOCATION = { command: 'ocr', workdir: '/work', timeoutMs: 5000 }

async function withShell(script: readonly (readonly [string, Scripted])[]): Promise<{
  ctx: Context
  shell: ScriptedExecutor
}> {
  const ctx = new Context()
  let shell!: ScriptedExecutor
  await ctx.plugin((child: Context) => { shell = new ScriptedExecutor(child, script) }).await()
  return { ctx, shell }
}

const VERSION_OK: readonly [string, Scripted] = ['--version', { stdout: 'open-code-review v1.12.0 (494bf1c8d) linux/arm64\n' }]

describe('running the CLI', () => {
  it('quotes the executable and every argument, and asks for the full capture', async () => {
    const { ctx, shell } = await withShell([["'delegate'", { stdout: '{}' }]])
    await runCapture(ctx, INVOCATION, ['delegate', 'rule', "we'ird $name.ts"])
    expect(shell.commands[0]).toBe("'ocr' 'delegate' 'rule' 'we'\\''ird $name.ts'")
    expect(shell.specs[0]).toMatchObject({ workdir: '/work', timeoutMs: 5000, stdoutMaxBytes: STDOUT_BUDGET })
  })

  it('returns stdout unchanged on success', async () => {
    const { ctx } = await withShell([["'delegate'", { stdout: '{"ok":true}' }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).resolves.toBe('{"ok":true}')
  })

  it('faults on a non-zero exit, quoting what the CLI said', async () => {
    const { ctx } = await withShell([["'delegate'", { exitCode: 1, stderr: 'unknown revision nosuchref' }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow('failed (exit 1): unknown revision nosuchref')
  })

  it('falls back to stdout when a failure printed nothing to stderr', async () => {
    const { ctx } = await withShell([["'delegate'", { exitCode: 2, stdout: 'bad flag' }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow('failed (exit 2): bad flag')
  })

  it('reports a failure that printed nothing at all', async () => {
    const { ctx } = await withShell([["'delegate'", { exitCode: 3 }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow('failed (exit 3)')
  })

  it('faults on a killed process, naming the signal', async () => {
    const { ctx } = await withShell([["'delegate'", { exitCode: null, signal: 'SIGKILL' }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow('killed by SIGKILL')
  })

  it('names the missing signal rather than printing null', async () => {
    const { ctx } = await withShell([["'delegate'", { exitCode: null, signal: null }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow('killed by a signal')
  })

  it('faults on a timeout, naming the budget', async () => {
    const { ctx } = await withShell([["'delegate'", { timedOut: true, exitCode: null }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow('exceeded its 5000ms budget')
  })

  it('faults on a truncated capture rather than parsing a partial file list', async () => {
    const { ctx } = await withShell([["'delegate'", { stdout: '{"reviewable', truncated: true }]])
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow(ReviewError)
    await expect(runCapture(ctx, INVOCATION, ['delegate'])).rejects.toThrow('produced more than')
  })
})

describe('version gating at the first gated attempt', () => {
  // The version comes back rather than being merely checked: it keys the
  // verdict cache, because a CLI upgrade can change which files are selected.
  it('returns the release of a CLI new enough to emit JSON', async () => {
    const { ctx } = await withShell([VERSION_OK])
    await expect(assertUsableVersion(ctx, INVOCATION)).resolves.toBe('1.12.0')
  })

  it('faults on a CLI too old for --format json, naming the minimum', async () => {
    const { ctx } = await withShell([['--version', { stdout: 'open-code-review v1.8.2 (abc) linux/arm64' }]])
    await expect(assertUsableVersion(ctx, INVOCATION)).rejects.toThrow('is v1.8.2; the gate needs v1.9.0 or newer')
  })

  it('faults when the banner carries no version at all', async () => {
    const { ctx } = await withShell([['--version', { stdout: 'not the program you think' }]])
    await expect(assertUsableVersion(ctx, INVOCATION)).rejects.toThrow('could not read a version')
  })
})

const PREVIEW_RANGE = JSON.stringify({
  schema_version: '1',
  mode: 'range',
  repository: '/work',
  from: 'main',
  to: 'HEAD',
  merge_base: 'a'.repeat(40),
  reviewable_files: [
    { path: 'main.go', status: 'added', insertions: 6, deletions: 0 },
    { path: 'src.ts', status: 'modified', insertions: 4, deletions: 0 },
  ],
  excluded_files: [
    { path: 'note.md', status: 'added', insertions: 1, deletions: 0, exclude_reason: 'unsupported_ext' },
  ],
})

const RULE_TWO = JSON.stringify({
  schema_version: '1',
  groups: [
    { group_id: 1, source: 'system', pattern: '**/*.go', files: ['main.go'], rule: 'Go rules' },
    { group_id: 2, source: 'system', pattern: '**/*.ts', files: ['src.ts'], rule: 'TS rules' },
  ],
})

describe('resolving the review scope', () => {
  it('asks for range mode when the edge names a base ref', async () => {
    const { ctx, shell } = await withShell([
      ["'preview'", { stdout: PREVIEW_RANGE }],
      ["'rule'", { stdout: RULE_TWO }],
    ])
    const { preview, groups } = await resolveReviewScope(ctx, INVOCATION, { baseRef: 'main' }, [])
    expect(shell.commands[0]).toContain("'--from' 'main' '--to' 'HEAD'")
    expect(preview.mergeBase).toBe('a'.repeat(40))
    expect(groups.map(group => group.pattern)).toEqual(['**/*.go', '**/*.ts'])
  })

  it('asks for workspace mode when no base ref is configured', async () => {
    const { ctx, shell } = await withShell([
      ["'preview'", { stdout: PREVIEW_RANGE }],
      ["'rule'", { stdout: RULE_TWO }],
    ])
    await resolveReviewScope(ctx, INVOCATION, {}, [])
    expect(shell.commands[0]).not.toContain('--from')
  })

  it('passes configured excludes as one comma-separated argument', async () => {
    const { ctx, shell } = await withShell([
      ["'preview'", { stdout: PREVIEW_RANGE }],
      ["'rule'", { stdout: RULE_TWO }],
    ])
    await resolveReviewScope(ctx, INVOCATION, {}, ['**/testdata/*', '**/generated/*'])
    expect(shell.commands[0]).toContain("'--exclude' '**/testdata/*,**/generated/*'")
  })

  it('asks nothing of `rule` for an excluded file, which the CLI would rule anyway', async () => {
    const { ctx, shell } = await withShell([
      ["'preview'", { stdout: PREVIEW_RANGE }],
      ["'rule'", { stdout: RULE_TWO }],
    ])
    await resolveReviewScope(ctx, INVOCATION, {}, [])
    expect(shell.commands[1]).toContain("'main.go'")
    expect(shell.commands[1]).toContain("'src.ts'")
    expect(shell.commands[1]).not.toContain('note.md')
  })

  it('makes no rule call at all when nothing is reviewable', async () => {
    const empty = JSON.stringify({
      mode: 'range', repository: '/work', merge_base: 'b'.repeat(40),
      reviewable_files: [], excluded_files: [],
    })
    const { ctx, shell } = await withShell([["'preview'", { stdout: empty }]])
    const { preview, groups } = await resolveReviewScope(ctx, INVOCATION, { baseRef: 'main' }, [])
    expect(preview.reviewable).toEqual([])
    expect(groups).toEqual([])
    expect(shell.commands).toHaveLength(1)
  })

  it('asks for each path once when workspace mode reports one twice', async () => {
    const twice = JSON.stringify({
      mode: 'workspace', repository: '/work',
      reviewable_files: [
        { path: 'src.ts', status: 'deleted', insertions: 0, deletions: 3 },
        { path: 'src.ts', status: 'added', insertions: 3, deletions: 0 },
      ],
      excluded_files: [],
    })
    const { ctx, shell } = await withShell([
      ["'preview'", { stdout: twice }],
      ["'rule'", { stdout: JSON.stringify({ groups: [{ source: 'system', pattern: '**/*.ts', files: ['src.ts'], rule: 'TS' }] }) }],
    ])
    const { preview } = await resolveReviewScope(ctx, INVOCATION, {}, [])
    expect(preview.reviewable).toHaveLength(2)
    expect(shell.commands[1].match(/'src\.ts'/g)).toHaveLength(1)
  })

  it('merges the groups of a batched rule resolution into one set', async () => {
    const many = Array.from({ length: 900 }, (_unused, index) => `packages/some-package/src/a-fairly-long-file-name-${index}.ts`)
    const preview = JSON.stringify({
      mode: 'workspace',
      repository: '/work',
      reviewable_files: many.map(path => ({ path, status: 'added', insertions: 1, deletions: 0 })),
      excluded_files: [],
    })
    const calls: string[][] = []
    const { ctx, shell } = await withShell([
      ["'preview'", { stdout: preview }],
      ["'rule'", { stdout: '' }],
    ])
    vi.spyOn(shell, 'run').mockImplementation((spec) => {
      shell.commands.push(spec.command)
      if (spec.command.includes("'preview'")) {
        return Promise.resolve(runResult(preview))
      }
      const paths = [...spec.command.matchAll(/'([^']*\.ts)'/g)].map(match => match[1])
      calls.push(paths)
      return Promise.resolve(runResult(JSON.stringify({
        groups: [{ source: 'system', pattern: '**/*.ts', files: paths, rule: 'TS rules' }],
      })))
    })
    const { groups } = await resolveReviewScope(ctx, INVOCATION, {}, [])
    expect(calls.length).toBeGreaterThan(1)
    expect(groups).toHaveLength(1)
    expect(groups[0].files).toEqual(many)
  })
})

/** A successful run carrying `text` on stdout. */
function runResult(text: string): ShellRunResult {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 5000,
    stdout: { text, truncated: false },
    stderr: { text: '', truncated: false },
  }
}
