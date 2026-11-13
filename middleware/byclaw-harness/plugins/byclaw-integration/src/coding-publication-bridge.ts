/** Route lease-local MCP requests back to the host's original DSH publication callback. */
import { posix } from 'node:path'
import { codingLeaseFiles } from './coding-context.ts'
import type { ExecutionSandbox } from './coding-router.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export interface CodingPublicationBridgeOptions {
  bridgeId: string
  home: string
  sandbox: ExecutionSandbox
  actor: string
  leaseId: string
  workspaceRoot: string
  signal: AbortSignal
  prepare(args: unknown, signal: AbortSignal): Promise<unknown>
  abort(): void
}

/** One turn owns its callback, lease, request IDs and response paths; models cannot select identities. */
export class CodingPublicationBridge {
  private pending: Promise<void> = Promise.resolve()
  private readonly seen = new Set<string>()
  private closed = false

  constructor(private readonly options: CodingPublicationBridgeOptions) {
    if (!UUID.test(options.bridgeId)) throw new Error('EXECUTION_PUBLICATION_BRIDGE_INVALID')
  }

  accept(event: Record<string, unknown>): void {
    const { requestId } = event
    if (this.closed || event.bridgeId !== this.options.bridgeId || typeof requestId !== 'string' || !UUID.test(requestId)) {
      throw new Error('EXECUTION_PUBLICATION_SCOPE_MISMATCH')
    }
    // Replayed stdout must never repeat a potentially committed POST, even after an uncertain failure.
    if (this.seen.has(requestId)) return
    if (this.seen.size >= 100) throw new Error('EXECUTION_PUBLICATION_REQUEST_LIMIT')
    this.seen.add(requestId)
    this.pending = this.pending.then(async () => {
      this.options.signal.throwIfAborted()
      let response: { result: unknown } | { error: string }
      try {
        response = { result: await this.options.prepare(event.arguments, this.options.signal) }
      } catch {
        // Never expose token material or arbitrary transport exception text to the CLI/model.
        response = { error: 'Harness 准备待发布内容失败或结果未确认；请核查服务端认证、任务状态和最新待发布卡片，不要自动重试。' }
      }
      this.options.signal.throwIfAborted()
      const files = codingLeaseFiles(this.options.sandbox, this.options.actor, this.options.leaseId,
        this.options.workspaceRoot, this.options.signal)
      const path = posix.join(this.options.home, '.publication', this.options.bridgeId, `${requestId}.response.json`)
      await files.writeText(path, JSON.stringify(response), { exclusive: true })
    })
    // Stop the CLI on a broken response channel, retaining the rejection for lease cleanup.
    void this.pending.catch(() => this.options.abort())
  }

  async close(): Promise<void> {
    this.closed = true
    await this.pending
  }
}
