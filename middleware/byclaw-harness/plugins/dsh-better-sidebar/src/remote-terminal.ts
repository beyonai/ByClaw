/**
 * Tool-environment terminals: a {@link PtySpawner} over the DSH subprocess
 * service's `spawnTerminal` (the SSH provider allocates the terminal on the
 * user's tool sandbox). The registries stay synchronous — node-pty spawns
 * synchronously — so the adapter hands back a handle immediately, queues
 * input and resizes while the remote allocation is in flight, and reports an
 * allocation failure as terminal output plus an exit (the same shape a shell
 * that dies at startup has).
 */
import { constants } from 'node:os'
import type { Readable } from 'node:stream'
import type { PtyProcess, PtySpawner, PtySpawnOptions } from './pty-manager.ts'

/** Exit facts of one remote process (`SubprocessOutcome`). */
export interface RemoteTerminalOutcome {
  exitCode: number | null
  signal: string | null
}

/** The live remote terminal (`SubprocessTerminalHandle` slice). */
export interface RemoteTerminalHandle {
  readonly output: Readable
  readonly done: Promise<RemoteTerminalOutcome>
  write(data: string): Promise<void>
  resize(cols: number, rows: number): Promise<void>
  terminate(): Promise<void>
}

/** One terminal spawn (`SubprocessTerminalSpawnSpec` slice). */
export interface RemoteTerminalSpawnSpec {
  argv: readonly string[]
  cwd: string
  env?: Record<string, string> | undefined
  rows: number
  cols: number
  terminalType: string
  graceMs: number
  signal?: AbortSignal | undefined
}

/** The subprocess-service operations the terminals need (`ctx.subprocess`). */
export interface RemoteTerminalService {
  terminalEnvironment(signal?: AbortSignal): Promise<{ platform: 'posix' | 'windows'; defaultShell?: string }>
  spawnTerminal(spec: RemoteTerminalSpawnSpec): Promise<RemoteTerminalHandle>
}

/** TERM-to-KILL grace for a remote terminal session. */
const TERMINAL_GRACE_MS = 2_000
/** How long an exit waits for the output stream to flush its tail. */
const OUTPUT_DRAIN_MS = 1_000
/** Shell used when neither the config nor the tool environment names one. */
const FALLBACK_SHELL = '/bin/bash'

/**
 * Build a spawner whose terminals run through the subprocess service.
 * @param service - resolves the live subprocess service at spawn time (it may be replaced).
 * @param defaultShell - resolves the shell used when the caller passes an empty file.
 * @returns the spawner the PTY registries use in tool-environment mode.
 */
export function createRemotePtySpawner(
  service: () => RemoteTerminalService,
  defaultShell: () => Promise<string>,
): PtySpawner {
  return {
    spawn: (file, args, options) => new RemotePty(service, file === '' ? defaultShell : () => Promise.resolve(file), args, options),
  }
}

/**
 * Resolve the shell of the tool environment once per call site: the
 * provider's login/environment shell, else `/bin/bash`.
 * @param service - the live subprocess service.
 * @returns a memoized resolver (a failed lookup is retried next time).
 */
export function remoteDefaultShell(service: () => RemoteTerminalService): () => Promise<string> {
  let cached: Promise<string> | undefined
  return () => {
    cached ??= service().terminalEnvironment().then(
      environment => environment.defaultShell?.trim() || FALLBACK_SHELL,
      (error: unknown) => { cached = undefined; throw error },
    )
    return cached
  }
}

/** Numeric signal for node-pty-shaped exit events. */
function signalNumber(signal: string | null): number | undefined {
  if (signal === null) return undefined
  return (constants.signals as Record<string, number | undefined>)[signal]
}

/** Only the remote-provider-supported environment entries (strings). */
function stringEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') out[key] = value
  return out
}

/** One remote terminal behind the node-pty-shaped face. */
class RemotePty implements PtyProcess {
  cols: number
  rows: number
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>()
  private readonly allocation = new AbortController()
  private handle: RemoteTerminalHandle | undefined
  private queuedInput: string[] = []
  private resizePending = false
  private killed = false
  private exited = false

  constructor(
    service: () => RemoteTerminalService,
    shell: () => Promise<string>,
    args: string[],
    options: PtySpawnOptions,
  ) {
    this.cols = options.cols
    this.rows = options.rows
    void this.start(service, shell, args, options)
  }

  private async start(
    service: () => RemoteTerminalService,
    shell: () => Promise<string>,
    args: string[],
    options: PtySpawnOptions,
  ): Promise<void> {
    let handle: RemoteTerminalHandle
    try {
      const file = await shell()
      handle = await service().spawnTerminal({
        argv: [file, ...args],
        cwd: options.cwd,
        env: stringEnvironment(options.env),
        rows: this.rows,
        cols: this.cols,
        terminalType: options.name,
        graceMs: TERMINAL_GRACE_MS,
        signal: this.allocation.signal,
      })
    } catch (error) {
      if (!this.killed) this.emitData(`\r\n[terminal could not start: ${error instanceof Error ? error.message : String(error)}]\r\n`)
      this.emitExit({ exitCode: 1 })
      return
    }
    if (this.killed) {
      void handle.terminate().catch(() => {})
      this.emitExit({ exitCode: 0 })
      return
    }
    this.handle = handle
    handle.output.setEncoding('utf8')
    handle.output.on('data', (chunk: string) => { this.emitData(chunk) })
    handle.output.on('error', () => {})
    const drained = new Promise<void>((resolve) => {
      if (handle.output.readableEnded || handle.output.destroyed) resolve()
      handle.output.once('end', () => resolve())
      handle.output.once('close', () => resolve())
    })
    for (const data of this.queuedInput) void handle.write(data).catch(() => {})
    this.queuedInput = []
    if (this.resizePending) void handle.resize(this.cols, this.rows).catch(() => {})
    handle.done.then(
      async (outcome) => {
        await Promise.race([drained, new Promise<void>(resolve => setTimeout(resolve, OUTPUT_DRAIN_MS))])
        const signal = signalNumber(outcome.signal)
        this.emitExit({ exitCode: outcome.exitCode ?? (signal === undefined ? 1 : 128 + signal), ...(signal !== undefined ? { signal } : {}) })
      },
      (error: unknown) => {
        this.emitData(`\r\n[terminal connection lost: ${error instanceof Error ? error.message : String(error)}]\r\n`)
        this.emitExit({ exitCode: 1 })
      },
    )
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  write(data: string): void {
    if (this.exited || this.killed) return
    if (this.handle === undefined) this.queuedInput.push(data)
    else void this.handle.write(data).catch(() => {})
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    if (this.exited || this.killed) return
    if (this.handle === undefined) this.resizePending = true
    else void this.handle.resize(cols, rows).catch(() => {})
  }

  /** Every signal ends the whole remote terminal session (the provider's only termination verb). */
  kill(_signal?: string): void {
    if (this.killed) return
    this.killed = true
    if (this.handle === undefined) {
      this.allocation.abort(new Error('terminal closed before allocation finished'))
      return
    }
    void this.handle.terminate().catch(() => {})
  }

  private emitData(data: string): void {
    for (const listener of [...this.dataListeners]) listener(data)
  }

  private emitExit(event: { exitCode: number; signal?: number }): void {
    if (this.exited) return
    this.exited = true
    for (const listener of [...this.exitListeners]) listener(event)
  }
}
