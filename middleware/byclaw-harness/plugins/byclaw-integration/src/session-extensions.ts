/** Awaited extension point for trusted ByClaw session composition. */

import type { MediaModel } from '@byclaw/media-runtime'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AskAgentCommand } from '@byclaw/by-framework'

/** Runtime-owned identity, service location, and user-filesystem adapters. */
export interface ByClawSessionHost {
  readonly baseUrl: string
  readonly userCode: string
  readonly byRoot: string
  /** Obtain current login headers without exposing credentials to the model. */
  resolveAuthHeaders(): Promise<Record<string, string>>
  /** Translate a virtual /by/ path into this user's mounted filesystem. */
  resolveSourcePath(source: string): string
  /** Authoritative byclaw-context workspace for this Agent. */
  resolveSessionRoot?(agentId: string): string | undefined
  /** Resolve enabled media configuration without exposing credentials to tools. */
  resolveMediaModel?(type: 'IMAGE_GENERATION' | 'TTS', modelId?: string): Promise<MediaModel>
}

/** Trusted command and Agent context supplied before input admission. */
export interface ByClawSessionSetup {
  /** Explicit Agent supplied by the factory, including before registry publication. */
  readonly agent: Agent
  readonly agentCtx: Context
  readonly command: AskAgentCommand
  readonly host: ByClawSessionHost
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Compose optional session extensions before the first request or a follow-up.
     * Listeners must compose idempotently without starting the Agent. Rejection prevents input admission.
     * @param payload - Trusted inbound command, scoped Agent context, and runtime adapters.
     * @mode serial
     */
    'byclaw/session-setup'(payload: ByClawSessionSetup): void | Promise<void>
  }
}

/** Normalize wire session IDs without converting already-rounded numbers into trusted IDs.
 * @param value - A nonblank string or a positive safe integer from the gateway.
 * @returns The session ID as a string.
 */
export function normalizeByClawSessionId(value: unknown): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  throw new Error('会话 ID 必须是非空字符串或正的安全整数；超出安全整数范围的 ID 必须由上游以字符串传递。')
}
