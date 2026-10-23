/**
 * Loader consumer for the split composition: DSH's SSH providers through the
 * reconnecting ToolEnv facade against a real sshd. Exercises files, processes,
 * a PTY, PTC and sandbox confinement, then proves a reconnect after B restarts.
 *
 *   tsx split-driver.ts <cordis.yml> <report.json> <restart-command>
 *
 * <restart-command> is run through /bin/sh between the two phases; it must stop
 * B's sshd and helpers and bring sshd back.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-ssh'
import type {} from '@deepseek-ai/dsh-fs-ssh'
import type {} from '@deepseek-ai/dsh-subprocess-ssh'
import type {} from '@deepseek-ai/dsh-sandbox-ssh'
import type {} from '@deepseek-ai/dsh-ptc-runtime-node'

const [configPath, reportPath, restart] = process.argv.slice(2)
if (configPath === undefined || reportPath === undefined || restart === undefined) throw new Error('split-driver requires config, report and restart command')
const ctx = await boot('byclaw-tool-env-split', configPath)
const checks: string[] = []
const timings: Record<string, number> = {}

async function completed(handle: SubprocessHandle): Promise<string> {
  const outcome = await handle.done
  assert.equal(await handle.waitForExit(), true)
  assert.deepEqual(outcome, { exitCode: 0, signal: null })
  return handle.collected.stdout?.readFrom(0).text ?? ''
}

async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try { return await work() } finally { timings[name] = Math.round(performance.now() - start) }
}

try {
  const hello = await timed('first-lease', () => ctx.ssh.ready)
  const root = hello.workspace
  assert.equal(hello.kind, 'node-script')
  checks.push('lazy-lease-handshake')

  const target = await ctx.fs.resolve(`${root}/sample.txt`)
  await ctx.fs.writeText(target, 'first\n你好\n')
  assert.equal(await ctx.fs.readText(target), 'first\n你好\n')
  await ctx.fs.editText(target, { oldString: 'first', newString: 'second', replaceAll: false })
  assert.equal(await ctx.fs.readText(target), 'second\n你好\n')
  assert((await ctx.fs.listDir(await ctx.fs.resolve(root))).some(entry => entry.name === 'sample.txt'))
  await assert.rejects(ctx.fs.writeText(target, 'denied', undefined, undefined, { mode: 'read-only', workspaceRoot: root }))
  checks.push('guarded-files')

  const options = { cwd: root, graceMs: 1000, stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 65_536 } } } as const
  const ordinary = ctx.subprocess.spawn({ ...options, argv: ['/bin/sh', '-c', 'printf "%s|%s" "$(hostname)" "$(cat sample.txt | head -1)"'] })
  const output = await timed('process-roundtrip', () => completed(ordinary))
  assert.match(output, /\|second$/u)
  checks.push('managed-process')

  const terminal = await ctx.subprocess.spawnTerminal({ argv: ['/bin/sh'], cwd: root, env: {}, terminalType: 'xterm', cols: 80, rows: 24, graceMs: 1000 })
  let terminalText = ''
  const terminalRead = (async () => { for await (const bytes of terminal.output) terminalText += Buffer.from(bytes).toString() })()
  try {
    await terminal.resize(100, 35)
    await terminal.write("stty size; printf 'pty-result:%s\\n' 42; exit\n")
    assert.equal((await terminal.done).exitCode, 0)
    await terminalRead
    assert(terminalText.includes('pty-result:42'))
    assert(terminalText.includes('35 100'))
  } finally { await terminal.terminate(); await terminalRead }
  checks.push('pty')

  // Confinement runs on B; a B without bwrap/Landlock refuses rather than running unconfined.
  const confined = await ctx.sandbox.confine(['/bin/sh', '-c', 'true'], { mode: 'read-only', workspaceRoot: root }).then(
    value => value.enforcement, () => 'unavailable')
  checks.push(`sandbox:${confined}`)

  const runtime = ctx.ptcRuntime
  const ptc = await timed('ptc-run', () => runtime.run(runtime.resolve({
    program: 'const fs=await import("node:fs/promises"); await fs.writeFile("ptc.txt","split"); return {value:await tools.echo("bridge"),cwd:process.cwd()};',
    bindings: [{ global: 'tools', functions: { echo: async (input: unknown) => String(input) } }],
    cwd: root, sandboxPolicy: { mode: confined === 'unavailable' ? 'danger-full-access' : 'workspace-write', workspaceRoot: root },
  })))
  assert.equal(ptc.error, undefined, JSON.stringify(ptc))
  assert.deepEqual(ptc.value, { value: 'bridge', cwd: root })
  assert.equal(await ctx.fs.readText(await ctx.fs.resolve(`${root}/ptc.txt`)), 'split')
  checks.push('ptc')

  // B goes away (pause, crash, recreate): in-flight state is lost, the facade is not.
  execFileSync('/bin/sh', ['-c', restart], { stdio: 'inherit' })
  let firstError: string | undefined
  try { await ctx.fs.readText(target) } catch (error) { firstError = error instanceof Error ? error.message : String(error) }
  const recovered = await timed('reconnect-read', () => ctx.fs.readText(target))
  assert.equal(recovered, 'second\n你好\n')
  assert.equal(await completed(ctx.subprocess.spawn({ ...options, argv: ['/bin/sh', '-c', 'printf again'] })), 'again')
  checks.push(firstError === undefined ? 'reconnect-transparent' : 'reconnect-after-one-failure')

  await writeFile(reportPath, `${JSON.stringify({ checks, timings, firstError, platform: hello.platform, nodeVersion: hello.nodeVersion }, null, 2)}\n`)
} finally {
  await ctx.fiber.dispose()
}
