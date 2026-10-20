/** by-framework command adapter for DSH-owned root sessions. */

import {
  AgentState,
  AgentTaskResult,
  CancelTaskCommand,
  TaskCancelledError,
  GatewayWorker,
  WorkerRegistry,
  type AgentContext,
  AskAgentCommand,
  ResumeCommand,
  type GatewayCommand,
} from '@byclaw/by-framework'
import { byClawVoicePayload } from './voice-runtime.ts'
import { extractByClawUserText } from './protocol.ts'

/** Result of one ByClaw request after its DSH work and output have settled. */
export interface ByClawDshAskResult {
  /** Existing accumulated output, including the historical-text fallback. */
  answer: string
  /** Terminal response text; absent when no complete answer could be selected. */
  finalAnswer?: string
  dshSessionId: string
}

export interface ByClawDshSessionPort {
  ask(command: AskAgentCommand, context: AgentContext): Promise<ByClawDshAskResult>
  resume(command: ResumeCommand): boolean | Promise<boolean>
  cancel(messageId: string, reason: string): void | Promise<void>
}

export interface ByClawCommandContext {
  sessionId: string
  setStreamFinished(finished: boolean): void
}

/** Testable command dispatch separated from GatewayWorker's Redis lifecycle. */
export class ByClawDshCommandHandler {
  constructor(readonly sessions: ByClawDshSessionPort) {}

  async process(command: GatewayCommand, context: AgentContext): Promise<AgentTaskResult> {
    if (command instanceof ResumeCommand) {
      if (!await this.sessions.resume(command)) throw new Error('BYCLAW_DSH Resume has no matching ask_user interaction')
      context.setStreamFinished(true)
      return new AgentTaskResult({ status: AgentState.COMPLETED, content: '', replyData: null })
    }
    if (!(command instanceof AskAgentCommand)) throw new Error(`Unsupported BYCLAW_DSH command: ${command.actionType}`)
    if (extractByClawUserText(command.content) === '' && byClawVoicePayload(command) === undefined) throw new Error('BYCLAW_DSH AskAgent content is empty')
    let result: ByClawDshAskResult
    try {
      result = await this.sessions.ask(command, context)
      if (context.isCancelRequested?.()) throw new TaskCancelledError('ByClaw task cancelled')
    } catch (error) {
      if (context.isCancelRequested?.()) throw new TaskCancelledError('ByClaw task cancelled')
      throw error
    }
    return new AgentTaskResult({
      status: AgentState.COMPLETED,
      // GatewayWorker owns finalAnswer emission; legacy output remains process data.
      content: result.finalAnswer ?? '',
      replyData: null,
      metadata: { dshSessionId: result.dshSessionId },
    })
  }
}

/** Redis-consuming by-framework Worker that delegates every command to DSH. */
export class ByClawDshGatewayWorker extends GatewayWorker {
  private readonly handler: ByClawDshCommandHandler

  constructor(options: {
    workerId: string
    agentTypes: string[]
    sessions: ByClawDshSessionPort
    redis: ConstructorParameters<typeof WorkerRegistry>[0]
    registry?: WorkerRegistry
  }) {
    super(options.workerId, options.registry ?? new WorkerRegistry(options.redis), options.redis)
    this.agentTypes = [...new Set(options.agentTypes)]
    this.handler = new ByClawDshCommandHandler(options.sessions)
  }

  private readonly agentTypes: string[]

  getAgentTypes(): ReadonlyArray<string> {
    return this.agentTypes
  }

  processCommand(command: GatewayCommand, context: AgentContext): Promise<AgentTaskResult> {
    return this.handler.process(command, context)
  }

  async onCancelTask(command: unknown): Promise<void> {
    if (command instanceof CancelTaskCommand) {
      await this.sessions.cancel(command.targetMessageId, command.reason || 'ByClaw task cancelled')
    }
  }

  private get sessions(): ByClawDshSessionPort {
    return this.handler.sessions
  }
}
