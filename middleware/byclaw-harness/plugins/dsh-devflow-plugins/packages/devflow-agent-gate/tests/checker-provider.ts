// Scripted checker provider shared by this package's specs: each start records
// what the gate sent (prompt, routing, tool filter, parent cwd, signal) and
// replies from a queue, so a spec can count dispatches and shape verdicts.
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProvider, SubagentResult, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'

/** One recorded dispatch. */
export interface CheckerCall {
  prompt: string
  label: string | undefined
  agentOptions: SubagentStartRequest['agentOptions']
  toolFilter: SubagentStartRequest['toolFilter']
  cwd: string | undefined
  parentAgentsAvailable: boolean
  signal: AbortSignal
  disposed: () => boolean
}

/** A scripted reply; `hang` never settles the child result. */
export type ScriptedReply = SubagentResult | 'hang'

interface CheckerOptions {
  name?: string
  agentOptions?: boolean
  toolFilter?: boolean
  replies: ScriptedReply[]
}

/** A controllable provider consuming `replies` in dispatch order. */
export function checkerProvider(options: CheckerOptions, calls: CheckerCall[]): SubagentProvider {
  let seq = 0
  return {
    name: options.name ?? 'checker',
    capabilities: {
      agentOptions: options.agentOptions ?? true,
      outputSchema: false,
      depthLimit: false,
      toolFilter: options.toolFilter ?? false,
      persona: false,
    },
    inheritsParentContext: false,
    start(request) {
      const reply = options.replies.shift()
      if (reply === undefined) throw new Error('checkerProvider: no scripted reply left for this start')
      let disposed = false
      calls.push({
        prompt: request.prompt.map(block => block.type === 'text' ? block.text : '').join(''),
        label: request.label,
        agentOptions: request.agentOptions,
        toolFilter: request.toolFilter,
        cwd: request.parent.session.header.cwd,
        parentAgentsAvailable: request.parent.ctx.agents !== undefined,
        signal: request.signal,
        disposed: () => disposed,
      })
      return Promise.resolve({
        id: SessionId(`checker-child-${++seq}`),
        localAgent: undefined,
        result: reply === 'hang' ? new Promise<SubagentResult>(() => {}) : Promise.resolve(reply),
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

/** A completed run ending in a well-formed `allow` verdict block. */
export function allowReply(summary: string): SubagentResult {
  return checkerReply(`The work holds up.\n\n\`\`\`json\n${JSON.stringify({ verdict: 'allow', summary })}\n\`\`\`\n`)
}

/** A completed run ending in a well-formed `veto` verdict block. */
export function vetoReply(summary: string, findings?: string[]): SubagentResult {
  return checkerReply(`Problems found.\n\n\`\`\`json\n${JSON.stringify({ verdict: 'veto', summary, ...findings === undefined ? {} : { findings } })}\n\`\`\`\n`)
}
