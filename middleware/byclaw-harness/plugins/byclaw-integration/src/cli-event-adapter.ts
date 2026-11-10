/** Codex exec JSONL. Only a completed turn may supply the terminal answer. */
export interface CodingEvent {
  kind: 'progress' | 'tool'
  id: string
  phase: 'start' | 'success' | 'error'
  title: string
  detail?: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export class CodexEventAdapter {
  private pending = ''
  private answer = ''
  private completed = false
  private failed = false
  private sequence = 0
  private candidate: { id: string; text: string } | undefined
  threadId: string | undefined

  constructor(private readonly emit: (event: CodingEvent) => void = () => {}) {}

  write(chunk: string): void {
    this.pending += chunk
    let newline: number
    while ((newline = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, newline).trim()
      this.pending = this.pending.slice(newline + 1)
      if (line) this.line(line)
    }
    if (this.pending.length > 1024 * 1024) throw new Error('CODEX_EVENT_TOO_LARGE')
  }

  finish(exitCode: number | null): string {
    if (this.pending.trim()) this.line(this.pending.trim())
    this.pending = ''
    if (exitCode !== 0) throw new Error(`CODEX_EXIT_FAILED (${exitCode ?? 'unknown'})`)
    if (this.failed) throw new Error('CODEX_TURN_FAILED')
    if (!this.completed) throw new Error('CODEX_TURN_INCOMPLETE')
    if (!this.answer.trim()) throw new Error('CODEX_EMPTY_ANSWER')
    return this.answer
  }

  private line(line: string): void {
    let event: Record<string, unknown> | undefined
    try { event = record(JSON.parse(line)) } catch { throw new Error('CODEX_INVALID_JSONL') }
    if (!event || typeof event.type !== 'string') throw new Error('CODEX_INVALID_EVENT')
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') this.threadId = event.thread_id
    if (event.type === 'turn.started') this.answer = ''
    if (event.type === 'turn.failed') this.failed = true
    // A recoverable transport error can be followed by a successful completed turn.
    if (event.type === 'turn.completed') this.completed = true
    const item = record(event.item)
    if (!item) return
    if (event.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') {
      this.flushCommentary()
      this.answer = item.text
      this.candidate = { id: String(item.id ?? ++this.sequence), text: item.text }
    }
    if (item.type === 'command_execution' || item.type === 'file_change' || item.type === 'mcp_tool_call' || item.type === 'web_search') {
      if (event.type !== 'item.started' && event.type !== 'item.completed') return
      this.flushCommentary()
      const failed = item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0)
      this.emit({ kind: 'tool', id: String(item.id ?? ++this.sequence),
        phase: event.type === 'item.started' ? 'start' : failed ? 'error' : 'success',
        title: `Codex · ${String(item.type)}`,
        // Do not forward arbitrary process output or authentication diagnostics to the progress panel.
        ...(typeof item.exit_code === 'number' ? { detail: `exitCode=${item.exit_code}` } : {}),
      })
    }
  }

  private flushCommentary(): void {
    if (!this.candidate) return
    this.emit({ kind: 'progress', id: this.candidate.id, phase: 'success', title: 'Codex', detail: this.candidate.text })
    this.candidate = undefined
    this.answer = ''
  }
}
