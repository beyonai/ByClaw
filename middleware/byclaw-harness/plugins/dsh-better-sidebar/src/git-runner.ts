import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

/** A failed system Git command with a stable machine-readable error code. */
export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly command: string,
  ) {
    super(message)
  }
}

/** Run one Git command and return its UTF-8 stdout. */
export function runGit(cwd: string, args: readonly string[], timeoutMs = 30_000): Promise<string> {
  const full = ['-C', cwd, '--no-pager', '-c', 'color.ui=false', ...args]
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn('git', full, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new GitCommandError(`git ${args[0] ?? ''} timed out after ${timeoutMs}ms`, 'git-error', args.join(' ')))
    }, timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new GitCommandError(`cannot run git: ${error.message}`, 'git-error', args.join(' ')))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) {
        resolvePromise(stdout)
      } else {
        reject(new GitCommandError(stderr.trim() || `git exited with ${String(code)}`, 'git-error', args.join(' ')))
      }
    })
  })
}

/** Platform-aware identity for comparing absolute filesystem paths. */
export function pathIdentity(path: string): string {
  const absolute = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
