import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import type { BrowserSubprocess } from './tool-environment-runtime.js'

/** Preserve a goal download inside B; neither source nor destination is opened on A. */
export async function saveToolEnvironmentDownload(
  subprocess: BrowserSubprocess,
  root: string,
  source: string,
  name: string,
  runId: string,
): Promise<string> {
  const target = join(root, runId, `${randomUUID()}-${basename(name).replace(/[^a-zA-Z0-9._-]/g, '_') || 'download'}`)
  const child = subprocess.spawn({
    argv: [process.execPath, '-e',
      "const fs=require('node:fs/promises');const path=require('node:path');(async()=>{await fs.mkdir(path.dirname(process.argv[2]),{recursive:true,mode:448});await fs.copyFile(process.argv[1],process.argv[2],require('node:fs').constants.COPYFILE_EXCL)})().catch(()=>process.exit(1))",
      source, target],
    cwd: '/', env: {}, graceMs: 1000,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 4096 } },
  })
  child.stdin?.on('error', () => undefined)
  child.stdin?.end()
  child.stdout?.resume()
  const result = await child.done as { exitCode?: number }
  if (result.exitCode !== 0) throw new Error('browser-remote-artifact-copy-failed')
  return target
}
