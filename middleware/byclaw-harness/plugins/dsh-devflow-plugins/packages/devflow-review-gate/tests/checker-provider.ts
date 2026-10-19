// Scripted checker provider shared by this package's specs: each start records
// what the gate sent (prompt, routing, tool filter, parent cwd, signal) and
// replies from a queue, so a spec can count dispatches, observe concurrency,
// and shape verdicts.
//
// Restated from the double of the same name in `devflow-agent-gate/tests`,
// with one addition: `replies` may be a function of the dispatch, because a
// per-rule-group review needs its reply to depend on which group was sent.
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProvider, SubagentResult, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

/** One recorded dispatch. */
export interface CheckerCall {
  prompt: string
  label: string | undefined
  agentOptions: SubagentStartRequest['agentOptions']
  cwd: string | undefined
  parentAgentsAvailable: boolean
  signal: AbortSignal
  disposed: () => boolean
}

/**
 * A scripted reply; `hang` settles the child result only once the run is
 * cancelled, as a real backend does when the runtime aborts its start signal.
 */
export type ScriptedReply = SubagentResult | 'hang'

interface CheckerOptions {
  name?: string
  agentOptions?: boolean
  /** Consumed in dispatch order, or derived from the prompt when a function. */
  replies: ScriptedReply[] | ((prompt: string) => ScriptedReply)
  /** Throws instead of starting, to exercise a rejected dispatch. */
  failStart?: string
}

/** A controllable provider answering each start from `replies`. */
export function checkerProvider(options: CheckerOptions, calls: CheckerCall[]): SubagentProvider {
  let seq = 0
  return {
    name: options.name ?? 'checker',
    capabilities: {
      agentOptions: options.agentOptions ?? true,
      outputSchema: false,
      depthLimit: false,
      agentPreset: false,
    },
    inheritsParentContext: false,
    start(request) {
      const prompt = request.prompt.map(block => block.type === 'text' ? block.text : '').join('')
      let disposed = false
      calls.push({
        prompt,
        label: request.label,
        agentOptions: request.agentOptions,
        cwd: request.parent.session.header.cwd,
        parentAgentsAvailable: request.parent.ctx.agents !== undefined,
        signal: request.signal,
        disposed: () => disposed,
      })
      if (options.failStart !== undefined) throw new Error(options.failStart)
      const reply = typeof options.replies === 'function' ? options.replies(prompt) : options.replies.shift()
      if (reply === undefined) throw new Error('checkerProvider: no scripted reply left for this start')
      return Promise.resolve({
        id: SessionId(`checker-child-${++seq}`),
        localAgent: undefined,
        result: reply === 'hang' ? cancelled(request.signal) : Promise.resolve(reply),
        dispose: () => {
          disposed = true
          return Promise.resolve()
        },
      })
    },
  }
}

/** A completed checker run whose final output is `text`. */
export function checkerReply(text: string): SubagentResult {
  return { output: [{ type: 'text', text }], stopReason: 'completed' }
}

/** A completed run ending in a verdict block covering `reviewed` with no findings. */
export function cleanReply(reviewed: readonly string[]): SubagentResult {
  return checkerReply(`Looks fine.\n\n\`\`\`json\n${JSON.stringify({ reviewed, skipped: [], comments: [] })}\n\`\`\`\n`)
}

/** A completed run reporting one finding at `severity`. */
export function findingReply(
  reviewed: readonly string[],
  severity: string,
  content = 'null dereference',
): SubagentResult {
  return checkerReply(`Found something.\n\n\`\`\`json\n${JSON.stringify({
    reviewed,
    skipped: [],
    comments: [{ path: reviewed[0], content, severity, category: 'bug', start_line: 3, end_line: 3 }],
  })}\n\`\`\`\n`)
}

/** The result of a run that only ends when it is cancelled. */
function cancelled(signal: AbortSignal): Promise<SubagentResult> {
  return new Promise<SubagentResult>((resolve) => {
    const settle = (): void => { resolve({ output: [], stopReason: 'aborted' }) }
    if (signal.aborted) settle()
    else signal.addEventListener('abort', settle, { once: true })
  })
}
