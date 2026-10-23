/** Browser navigation helpers over the DSH 0.2.1 Session Controller and Workspace UI. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * The Session shown in the main conversation view. DSH 0.2.1 removed
 * `SessionListState.current`; the main view now holds the only `mainView`
 * Session reference, which is how shipped DSH client plugins find it.
 */
export function currentSessionId(state: SessionListState): SessionId | undefined {
  for (const session of Object.values(state.byId)) {
    const retainedBy = session.retainedBy as Readonly<Record<string, number | undefined>>
    if ((retainedBy['mainView'] ?? 0) > 0) return session.id
  }
  return undefined
}

/**
 * Minimal structural face of `ctx.uiWorkspace` (dsh-client-ui-workspace), which
 * owns Session navigation since DSH 0.2.1 removed `ctx.sessions.open()`.
 */
export interface WorkspaceNavigation {
  openSession(target: SessionId): void
}
