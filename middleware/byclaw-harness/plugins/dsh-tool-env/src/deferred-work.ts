/**
 * Work on the tool environment that must not start it: a context boots and a
 * turn begins without B (only a tool call pays for B), so directory creation
 * and projection writes meant for B wait here, keyed so the latest write per
 * key wins, and run once B is connected, before the first operation is served.
 */
export class DeferredToolEnvironmentWork {
  private readonly pending = new Map<string, () => Promise<void>>()
  private readonly created = new Set<string>()

  constructor(private readonly log: (message: string) => void) {}

  get size(): number { return this.pending.size }

  /** Directories queued for creation (`mkdir:<path>` keys), in queue order. */
  pendingDirectories(): string[] {
    return [...this.pending.keys()].filter(key => key.startsWith('mkdir:')).map(key => key.slice('mkdir:'.length))
  }

  /**
   * Directories whose queued creation has run on B. They outlive the connection
   * (B's data volume persists across restarts), so a later probe while B is down
   * can describe them without starting it.
   */
  createdDirectories(): string[] {
    return [...this.created]
  }

  /** Remember `operation` under `key`, replacing an earlier operation with the same key. */
  defer(key: string, operation: () => Promise<void>): void {
    this.pending.delete(key)
    this.pending.set(key, operation)
  }

  /** Run everything deferred so far, in order; a failure is logged and does not stop the rest. */
  async run(): Promise<void> {
    while (this.pending.size > 0) {
      const [key, operation] = this.pending.entries().next().value as [string, () => Promise<void>]
      this.pending.delete(key)
      try {
        await operation()
        if (key.startsWith('mkdir:')) this.created.add(key.slice('mkdir:'.length))
      } catch (error) {
        this.log(`deferred tool environment work "${key}" failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
