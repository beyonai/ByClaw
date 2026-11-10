/** Codex exec JSONL. Public item snapshots are separate from the terminal answer. */
import { codingPublicText, summarizeCodingDiagnostic, type CodingDiagnosticSummary } from './coding-diagnostics.ts'

export interface CodingEvent {
  kind: 'progress' | 'tool'
  id: string
  phase: 'start' | 'success' | 'error'
  title: string
  detail?: string
  input?: unknown
  output?: unknown
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
  private explicitAnswer: string | undefined
  private readonly snapshots = new Map<string, string>()
  private readonly completedItems = new Set<string>()
  private readonly activeTools = new Map<string, CodingEvent>()
  threadId: string | undefined
  diagnostic: CodingDiagnosticSummary | undefined

  constructor(
    private readonly emit: (event: CodingEvent) => void = () => {},
    private readonly onActivity: () => void = () => {},
  ) {}

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
    if (this.activeTools.size) throw new Error('CODEX_TOOLS_INCOMPLETE')
    const answer = this.explicitAnswer ?? this.answer
    if (!answer.trim()) throw new Error('CODEX_EMPTY_ANSWER')
    return answer
  }

  /** Settle outstanding tool cards when the process fails or is cancelled. */
  abort(reason: string): void {
    for (const event of this.activeTools.values()) this.emit({ ...event, phase: 'error', detail: reason })
    this.activeTools.clear()
  }

  private line(line: string): void {
    let event: Record<string, unknown> | undefined
    try { event = record(JSON.parse(line)) } catch { throw new Error('CODEX_INVALID_JSONL') }
    if (!event || typeof event.type !== 'string') throw new Error('CODEX_INVALID_EVENT')
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') this.threadId = event.thread_id
    if (event.type === 'turn.started') {
      this.answer = ''; this.explicitAnswer = undefined; this.candidate = undefined; this.completed = false
    }
    if (event.type === 'turn.failed') {
      this.failed = true
      const error = record(event.error)
      if (typeof error?.message === 'string') this.diagnostic = summarizeCodingDiagnostic(error.message)
    }
    if (event.type === 'error' && typeof event.message === 'string') {
      this.diagnostic = summarizeCodingDiagnostic(event.message)
      // Do not display the provider's arbitrary error body or pretend it is model reasoning.
    }
    // A recoverable transport error can be followed by a successful completed turn.
    if (event.type === 'turn.completed') this.completed = true
    const item = record(event.item)
    if (!item) return
    if (!['item.started', 'item.updated', 'item.completed'].includes(event.type)) return
    const id = typeof item.id === 'string' ? item.id : `anonymous-${++this.sequence}`
    if (this.completedItems.has(id)) return
    const signature = JSON.stringify(item)
    const key = `${id}:${event.type}`
    if (this.snapshots.get(key) === signature) return
    this.snapshots.set(key, signature)
    if (event.type === 'item.completed') this.completedItems.add(id)
    this.onActivity()
    if (event.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') {
      this.flushCommentary()
      if (item.phase === 'commentary') {
        this.emit({ kind: 'progress', id, phase: 'success', title: 'Codex', detail: codingPublicText(item.text, 16 * 1024) })
      } else if (item.phase === 'final_answer') {
        this.explicitAnswer = item.text
      } else {
        // Older CLI versions omit phase. Hold the last message for the final answer;
        // a following public item proves it was intermediate commentary.
        this.answer = item.text
        this.candidate = { id, text: item.text }
      }
    }
    if (event.type === 'item.completed' && item.type === 'reasoning' && typeof item.text === 'string') {
      this.flushCommentary()
      if (item.text.trim()) this.emit({ kind: 'progress', id, phase: 'success', title: 'Codex · 公开推理摘要', detail: codingPublicText(item.text, 16 * 1024) })
    }
    const titles: Record<string, string> = {
      command_execution: 'Codex · 执行命令', file_change: 'Codex · 修改文件',
      mcp_tool_call: 'Codex · 调用工具', web_search: 'Codex · 搜索', todo_list: 'Codex · 任务计划',
    }
    const title = typeof item.type === 'string' ? titles[item.type] : undefined
    if (title) {
      this.flushCommentary()
      const failed = item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0)
      const output: Record<string, unknown> = {}
      if (typeof item.exit_code === 'number') output.exitCode = item.exit_code
      if (Array.isArray(item.changes)) output.files = item.changes.slice(0, 40).map(record).filter(change => change !== undefined)
        .map(change => ({ path: codingPublicText(String(change.path ?? '')), kind: codingPublicText(String(change.kind ?? ''), 64) }))
      if (Array.isArray(item.items) && item.type === 'todo_list') output.items = item.items.slice(0, 40).map(record).filter(task => task !== undefined)
        .map(task => ({ text: codingPublicText(String(task.text ?? '')), completed: task.completed === true }))
      const input = item.type === 'command_execution' && typeof item.command === 'string' ? { command: codingPublicText(item.command) }
        : item.type === 'mcp_tool_call' ? { server: codingPublicText(String(item.server ?? ''), 128), tool: codingPublicText(String(item.tool ?? ''), 128) }
        : item.type === 'web_search' && typeof item.query === 'string' ? { query: codingPublicText(item.query) } : undefined
      const previous = this.activeTools.get(id)
      const tool: CodingEvent = { ...previous, kind: 'tool', id,
        phase: event.type === 'item.completed' ? failed ? 'error' : 'success' : 'start', title,
        ...(input === undefined ? {} : { input }),
        ...(Object.keys(output).length ? { output: { ...record(previous?.output), ...output } } : {}),
      }
      if (tool.phase === 'start') this.activeTools.set(id, tool)
      else this.activeTools.delete(id)
      this.emit(tool)
    }
  }

  private flushCommentary(): void {
    if (!this.candidate) return
    this.emit({ kind: 'progress', id: this.candidate.id, phase: 'success', title: 'Codex', detail: codingPublicText(this.candidate.text, 16 * 1024) })
    this.candidate = undefined
    this.answer = ''
  }
}
