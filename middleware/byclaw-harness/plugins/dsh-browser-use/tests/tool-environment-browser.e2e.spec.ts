/** Opt-in real Chromium test: separate subprocess and artifact roots stand in for the SSH sandbox. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { OwnedBrowserBroker } from '../src/owned-runtime.js'
import { ToolEnvironmentBrowserRuntime, type BrowserSubprocess } from '../src/tool-environment-runtime.js'

it.skipIf(!process.env.BYCLAW_TEST_CHROMIUM)('opens, inspects, screenshots and downloads in the remote browser process', async () => {
  const root = await mkdtemp('/tmp/bre-')
  const remoteRoot = join(root, 'sandbox')
  const server = createServer((request, response) => {
    if (request.url === '/download') {
      response.setHeader('Content-Disposition', 'attachment; filename="sample.txt"')
      response.end('remote artifact')
    } else response.end('<html><title>Remote browser</title><body><h1>Browser in tool sandbox</h1><a href="/download">Download file</a></body></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const children = new Set<ReturnType<typeof spawn>>()
  const subprocess: BrowserSubprocess = { spawn(spec) {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../lib/tool-environment-bridge.js', import.meta.url))], {
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
        BYCLAW_BROWSER_EXECUTABLE_PATH: process.env.BYCLAW_TEST_CHROMIUM!, BYCLAW_TOOL_BROWSER_ROOT: remoteRoot,
      },
    })
    children.add(child)
    child.stderr?.on('data', chunk => process.stderr.write(chunk))
    return { stdin: child.stdin!, stdout: child.stdout!, terminate: () => { child.kill('SIGTERM') },
      done: new Promise(resolve => child.once('close', code => { children.delete(child); resolve({ exitCode: code }) })),
    }
  } }
  const runtime = new ToolEnvironmentBrowserRuntime({ socketPath: join(root, 'host.sock'), subprocess: () => subprocess, goalEnabled: true, idleBrowserMs: 1500 })
  const broker = new OwnedBrowserBroker(runtime)
  const lease = { leaseId: 'remote-test', capability: 'remote-capability' }
  try {
    await broker.open(lease, { startUrl: `http://127.0.0.1:${address.port}`, allowedDomains: ['127.0.0.1'] })
    const inspection = await broker.inspect(lease)
    expect(inspection.title).toBe('Remote browser')
    const screenshot = await broker.screenshot(lease)
    expect(screenshot.path.startsWith(remoteRoot)).toBe(true)
    expect((await stat(screenshot.path)).size).toBeGreaterThan(0)
    const download = inspection.elements.find(element => element.name === 'Download file')
    expect(download).toBeDefined()
    const result = await broker.act(lease, { kind: 'click', element: download!.index })
    const file = result.download ?? result.downloads?.[0]
    expect(file?.path.startsWith(remoteRoot)).toBe(true)
    expect(await readFile(file!.path, 'utf8')).toBe('remote artifact')
    // Goal control and human-takeover state must be enabled in B from A's config.
    await broker.goal(lease, { command: 'start', runId: 'remote-goal', maxRunMs: 30_000, maxPauseMs: 5_000 })
    expect(await broker.goal(lease, { command: 'state', runId: 'remote-goal' })).toMatchObject({ runId: 'remote-goal', status: 'running' })
    await broker.goal(lease, { command: 'finish', runId: 'remote-goal' })
    await broker.closeLease(lease)
    await expect.poll(() => children.size, { timeout: 10_000 }).toBe(0)
    // Idle shutdown releases SSH activity; a later call restores a fresh daemon.
    await broker.open(lease, { startUrl: `http://127.0.0.1:${address.port}`, allowedDomains: ['127.0.0.1'] })
    expect((await broker.inspect(lease)).title).toBe('Remote browser')
    await broker.closeLease(lease)
  } finally {
    broker.dispose()
    await runtime.stop()
    for (const child of children) child.kill('SIGTERM')
    await expect.poll(() => children.size, { timeout: 10_000 }).toBe(0)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}, 45_000)
