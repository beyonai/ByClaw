import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { saveToolEnvironmentDownload } from '../src/tool-environment-artifacts.js'
import type { BrowserSubprocess } from '../src/tool-environment-runtime.js'

it('copies goal artifacts through B with literal argv and reports failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remote-artifact-'))
  const subprocess: BrowserSubprocess = { spawn(spec) {
    const child = spawn(spec.argv[0]!, spec.argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
    return { stdin: child.stdin, stdout: child.stdout, terminate: () => { child.kill() },
      done: new Promise(resolve => child.once('close', code => resolve({ exitCode: code }))),
    }
  } }
  try {
    const source = join(root, 'download; not-a-command.txt')
    await writeFile(source, 'sandbox bytes')
    const target = await saveToolEnvironmentDownload(subprocess, join(root, 'artifacts'), source, '../report;$.txt', 'run-1')
    expect(target.startsWith(join(root, 'artifacts/run-1'))).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('sandbox bytes')
    await expect(saveToolEnvironmentDownload(subprocess, root, join(root, 'missing'), 'file', 'run-2'))
      .rejects.toThrow('browser-remote-artifact-copy-failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})
