/** Select the terminal response from one command's committed DSH events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Tracks only the response Session routed to its owning ByClaw command. */
export class ByClawFinalAnswerTracker {
  private candidate: { turn: number; text: string } | undefined
  private answer: string | undefined

  /** Final text after normal turn completion; absent during execution or failure. */
  get value(): string | undefined { return this.answer }

  /**
   * Observe a committed event from the command's response Session.
   * @param event - Durable event; child Session events must be excluded by the caller.
   */
  observe(event: SessionEvent): void {
    switch (event.type) {
      case 'turn/start':
      case 'step/start':
      case 'assistant/attempt':
        this.candidate = undefined
        this.answer = undefined
        return
      case 'assistant/message': {
        // Surface replacements change model history without producing a user answer.
        if (event.surfaceOp !== 'append') return
        const content = event.data.message.content
        const text = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
        this.candidate = event.data.interrupted !== true
          && !content.some(block => block.type === 'tool-call')
          && text.trim() !== ''
          ? { turn: event.data.turn, text }
          : undefined
        this.answer = undefined
        return
      }
      case 'turn/end':
        this.answer = event.data.reason.kind === 'completed' && this.candidate?.turn === event.data.turn
          ? this.candidate.text
          : undefined
        return
      default:
        // Other built-in and plugin events do not select the terminal response.
        return
    }
  }
}
