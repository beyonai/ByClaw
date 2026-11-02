import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserBrokerClient } from '../src/broker-client.js'
import { ToolEnvironmentBrowserRuntime, type BrowserSubprocess } from '../src/tool-environment-runtime.js'

const roots: string[] = []
const runtimes: ToolEnvironmentBrowserRuntime[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.stop()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
// Separate process stands in for B: bootstrap is consumed before unmodified broker frames.
const remote = `let buffer=''; let bootstrap; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { buffer+=chunk; let i; while((i=buffer.indexOf('\\n'))>=0){
const request=JSON.parse(buffer.slice(0,i)); buffer=buffer.slice(i+1);
if(!bootstrap){bootstrap=request;continue}
if(request.secret!==bootstrap.secret) process.exit(3);
if(request.type==='crash') process.exit(4);
process.stdout.write(JSON.stringify({type:'ok',requestId:request.requestId,result:{browserRunning:true,contexts:0}})+'\\n');
}}); process.stdin.on('end',()=>process.exit(0));`

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'remote-browser-')); roots.push(root)
  let spawned = 0
  let terminated = 0
  const specs: unknown[] = []
  const subprocess: BrowserSubprocess = { spawn(spec) {
    spawned++; specs.push(spec)
    const child = spawn(process.execPath, ['-e', remote], { stdio: ['pipe', 'pipe', 'pipe'] })
    return { stdin: child.stdin, stdout: child.stdout,
      done: new Promise(resolve => child.once('close', resolve)),
      terminate: () => { terminated++; child.kill() },
    }
  } }
  const runtime = new ToolEnvironmentBrowserRuntime({ socketPath: join(root, 'b.sock'), subprocess: () => subprocess })
  runtimes.push(runtime)
  return { runtime, specs, spawned: () => spawned, terminated: () => terminated }
}

describe('tool environment browser transport', () => {
  it('starts B lazily, keeps the secret out of argv/env, forwards frames and closes B on disconnect', async () => {
    const f = await fixture()
    await f.runtime.ensureStarted()
    expect(f.spawned()).toBe(0)
    const client = new BrowserBrokerClient({ socketPath: f.runtime.socketPath, secret: f.runtime.secret })
    expect(await client.status()).toEqual({ browserRunning: true, contexts: 0 })
    expect(await client.status()).toEqual({ browserRunning: true, contexts: 0 })
    expect(f.spawned()).toBe(1)
    expect(JSON.stringify(f.specs)).not.toContain(f.runtime.secret)
    client.dispose()
    await expect.poll(f.terminated).toBe(1)
  })
  it('rejects an unauthenticated local client without starting B', async () => {
    const f = await fixture(); await f.runtime.ensureStarted()
    const client = new BrowserBrokerClient({ socketPath: f.runtime.socketPath, secret: 'wrong' })
    await expect(client.status()).rejects.toThrow()
    expect(f.spawned()).toBe(0)
    client.dispose()
  })
  it('invalidates disconnected clients and allows a later connection without replaying requests', async () => {
    const f = await fixture(); await f.runtime.ensureStarted()
    const client = new BrowserBrokerClient({ socketPath: f.runtime.socketPath, secret: f.runtime.secret })
    await client.status()
    await f.runtime.stop()
    await f.runtime.ensureStarted()
    await expect.poll(f.terminated).toBe(1)
    expect(await client.status()).toEqual({ browserRunning: true, contexts: 0 })
    expect(f.spawned()).toBe(2)
    client.dispose()
  })
  it('logs why the bridge on B failed instead of leaving only a closed connection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remote-browser-')); roots.push(root)
    const logs: string[] = []
    // B's bridge as it ends when browserd cannot start: message on stderr, exit code 1.
    const failing = `process.stdin.once('data', () => { process.stderr.write('browserd-start-failed: browser-viewer-root-not-found\\nbrowser-remote-bridge-failed: browser-owned-runtime-exited:1\\n'); process.exit(1) })`
    const subprocess: BrowserSubprocess = { spawn() {
      const child = spawn(process.execPath, ['-e', failing], { stdio: ['pipe', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      return { stdin: child.stdin, stdout: child.stdout,
        done: new Promise(resolve => child.once('close', code => resolve({ exitCode: code, signal: null }))),
        terminate: () => { child.kill() },
        collected: { stderr: { readFrom: () => ({ text: stderr }) } },
      }
    } }
    const runtime = new ToolEnvironmentBrowserRuntime({ socketPath: join(root, 'b.sock'), subprocess: () => subprocess, log: message => logs.push(message) })
    runtimes.push(runtime)
    await runtime.ensureStarted()
    const client = new BrowserBrokerClient({ socketPath: runtime.socketPath, secret: runtime.secret })
    await expect(client.status()).rejects.toThrow()
    await expect.poll(() => logs.length).toBe(1)
    expect(logs[0]).toBe('browser bridge on the tool environment exited 1: browserd-start-failed: browser-viewer-root-not-found | browser-remote-bridge-failed: browser-owned-runtime-exited:1')
    client.dispose()
  })
  it('rejects malformed JSON before starting B', async () => {
    const f = await fixture(); await f.runtime.ensureStarted()
    const socket = createConnection(f.runtime.socketPath)
    await new Promise<void>(resolve => { socket.once('close', () => resolve()); socket.write('bad json\n') })
    expect(f.spawned()).toBe(0)
  })
})
