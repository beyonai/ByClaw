import { spawn } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SaveTextSpill } from '@deepseek-ai/dsh-spill'
import ToolEnvironmentSpillStore, { safeName, sessionDir, type ToolEnvironmentSubprocess } from '../src/index.ts'

/** Runs the store's commands with the real shell, standing in for the tool environment. */
function localSubprocess(calls: string[][] = []): ToolEnvironmentSubprocess {
  return {
    spawn(spec) {
      calls.push([...spec.argv])
      const child = spawn(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, stdio: [spec.stdio.stdin === 'pipe' ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
      let stderr = ''
      child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
      const stdin = spec.stdio.stdin === 'pipe' ? new PassThrough() : undefined
      if (stdin !== undefined) stdin.pipe(child.stdin!)
      return {
        stdin,
        done: new Promise(resolve => child.on('close', exitCode => resolve({ exitCode }))),
        collected: { stderr: { readFrom: () => ({ text: stderr }) } },
      }
    },
  }
}

const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })

async function setup(subprocess: ToolEnvironmentSubprocess | null = localSubprocess(), cleanupPeriodDays = 30) {
  const root = join(await mkdtemp(join(tmpdir(), 'spill-tool-env-')), 'spill')
  dirs.push(join(root, '..'))
  const ctx = new Context()
  if (subprocess !== null) ctx.provide('subprocess', subprocess)
  await ctx.plugin(ToolEnvironmentSpillStore, { root, cleanupPeriodDays })
  return { ctx, root }
}

const request = (content: string, sessionId = 'session-1', suggestedName = 'bash-output.txt'): SaveTextSpill => ({
  owner: { sessionId: sessionId as SaveTextSpill['owner']['sessionId'] },
  source: { kind: 'tool', toolName: 'bash', callId: 'c1' as never, label: 'bash' },
  suggestedName,
  content,
})

describe('spill store in the tool environment', () => {
  it('writes the full text owner-only under a hashed session directory and points read at it', async () => {
    const { ctx, root } = await setup()
    const content = 'line\n'.repeat(5000) + 'ünïcode ✓ \u0000 end'
    const ref = await ctx.spillStore.saveText(request(content))
    expect(ref.locator.startsWith(`${sessionDir(root, 'session-1')}/`)).toBe(true)
    expect(ref.locator.endsWith('-bash-output.txt')).toBe(true)
    expect(ref.bytes).toBe(Buffer.byteLength(content))
    expect(ref.retrievalHint).toMatch(/read/)
    expect(await readFile(ref.locator, 'utf8')).toBe(content)
    expect((await stat(ref.locator)).mode & 0o777).toBe(0o600)
    expect((await stat(sessionDir(root, 'session-1'))).mode & 0o777).toBe(0o700)
  })

  it('keeps untrusted names and session ids out of the path', async () => {
    const { ctx, root } = await setup()
    const ref = await ctx.spillStore.saveText(request('x', '../../etc', '../../passwd'))
    expect(ref.locator.startsWith(`${root}/session-`)).toBe(true)
    // Exactly `<root>/session-<hash>/<file>`: nothing in the name or id adds or climbs a segment.
    expect(ref.locator.slice(root.length + 1).split('/')).toHaveLength(2)
    expect(safeName('')).toBe('output')
    expect(safeName('.hidden name;rm -rf')).toBe('_hidden_name_rm_-rf')
  })

  it('never replaces an existing file', async () => {
    const calls: string[][] = []
    const { ctx } = await setup(localSubprocess(calls), 0)
    const ref = await ctx.spillStore.saveText(request('first'))
    const [, , script, , dir, file] = calls.at(-1)!
    // Replaying the same write must fail instead of clobbering.
    const again = localSubprocess().spawn({ argv: ['/bin/sh', '-c', script!, 'sh', dir!, file!], cwd: '/', graceMs: 0, stdio: { stdin: 'pipe', stdout: { maxBytes: 1 }, stderr: { maxBytes: 1024 } } })
    again.stdin!.end('second')
    expect((await again.done).exitCode).not.toBe(0)
    expect(await readFile(ref.locator, 'utf8')).toBe('first')
  })

  it('fails the save when there is no tool environment, so the policy keeps the result inline', async () => {
    const { ctx } = await setup(null)
    await expect(ctx.spillStore.saveText(request('x'))).rejects.toThrow(/no subprocess provider/)
  })

  it('fails the save when the write fails', async () => {
    const { ctx, root } = await setup()
    await mkdir(join(root, '..'), { recursive: true })
    await writeFile(root, 'a file where the root directory should be')
    await expect(ctx.spillStore.saveText(request('x'))).rejects.toThrow(/writing in the tool environment failed/)
  })

  it('deletes expired spill files once, on the first spill', async () => {
    const calls: string[][] = []
    const { ctx, root } = await setup(localSubprocess(calls), 30)
    const oldDir = sessionDir(root, 'old-session')
    await mkdir(oldDir, { recursive: true })
    await writeFile(join(oldDir, 'stale.txt'), 'old')
    const longAgo = new Date(Date.now() - 40 * 86_400_000)
    await utimes(join(oldDir, 'stale.txt'), longAgo, longAgo)
    await ctx.spillStore.saveText(request('new'))
    await ctx.spillStore.saveText(request('newer'))
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(calls.filter(argv => argv[2]!.includes('find')).length).toBe(1)
    expect((await readdir(root)).sort()).toEqual([sessionDir(root, 'session-1').slice(root.length + 1)])
  })
})
