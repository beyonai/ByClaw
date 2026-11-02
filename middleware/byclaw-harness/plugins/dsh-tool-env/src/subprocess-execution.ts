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

export async function executeSandboxProcess(process: SandboxProcess, signal?: AbortSignal): Promise<SandboxResult> {
  try {
    const result = await process.done
    signal?.throwIfAborted()
    if (!await process.waitForExit(signal)) throw new Error('OUTCOME_UNKNOWN')
    return { exitCode: result.exitCode, stdout: process.collected.stdout?.readFrom(0).text ?? '', stderr: process.collected.stderr?.readFrom(0).text ?? '' }
  } finally {
    if (signal?.aborted) {
      process.terminate()
      // The aborted signal would make waitForExit return before SSH termination.
      // Keep ownership/execution pending until the remote cleanup RPC settles.
      if (!await process.waitForExit()) throw new Error('OUTCOME_UNKNOWN')
    }
  }
}
