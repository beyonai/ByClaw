import type { SandboxResult } from './catalog.ts'

/** Public subprocess contract only; never depends on SSH runtime private stream handles. */
export interface SandboxProcess {
  done: Promise<{ exitCode: number | null }>
  waitForExit(signal?: AbortSignal): Promise<boolean>
  terminate(): void
  collected: {
    stdout?: { readFrom(offset: number): { text: string } }
    stderr?: { readFrom(offset: number): { text: string } }
  }
}

export async function executeSandboxProcess(process: SandboxProcess, signal?: AbortSignal, onStdout?: (chunk: string) => void): Promise<SandboxResult> {
  let observed = ''
  let streamError: unknown
  const drain = (final = false) => {
    if (!onStdout || streamError) return
    try {
      const raw = process.collected.stdout?.readFrom(0).text ?? ''
      // A byte collector can temporarily decode an unfinished UTF-8 character as U+FFFD.
      // Leave that tail for the next poll; only process exit makes it final.
      const text = final ? raw : raw.replace(/\uFFFD+$/u, '')
      if (!text.startsWith(observed)) throw new Error('SANDBOX_STDOUT_TRUNCATED')
      const chunk = text.slice(observed.length)
      observed = text
      if (chunk) onStdout(chunk)
    } catch (error) { streamError = error; process.terminate() }
  }
  const timer = onStdout ? setInterval(drain, 100) : undefined
  timer?.unref()
  try {
    const result = await process.done
    drain(true)
    if (streamError) throw streamError
    signal?.throwIfAborted()
    if (!await process.waitForExit(signal)) throw new Error('OUTCOME_UNKNOWN')
    return { exitCode: result.exitCode, stdout: process.collected.stdout?.readFrom(0).text ?? '', stderr: process.collected.stderr?.readFrom(0).text ?? '' }
  } finally {
    if (timer) clearInterval(timer)
    if (signal?.aborted || streamError) {
      process.terminate()
      // The aborted signal would make waitForExit return before SSH termination.
      // Keep ownership/execution pending until the remote cleanup RPC settles.
      if (!await process.waitForExit()) throw new Error('OUTCOME_UNKNOWN')
    }
  }
}
