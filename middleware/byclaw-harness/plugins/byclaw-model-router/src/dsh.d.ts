import type { Context } from '@deepseek-ai/cordis'
import type { ModelRoute, ModelRoutingConsumer, ModelRoutingOptions } from './index.js'
export interface DshModelRoutingConsumer extends ModelRoutingConsumer {
  /** Undefined preserves ordinary selection for a route the consumer does not own. */
  fallbackId(route: ModelRoute): string | undefined
  /** A user-pinned route skips automatic selection and failover for this agent only. */
  manualSelection?(): ModelRoute | undefined
}
export declare function installModelRouting(agentCtx: Context, consumer: DshModelRoutingConsumer, options?: ModelRoutingOptions): () => void
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Exact auxiliary input and validated result, never generation credentials. */
    'byclaw/model-router': { kind: 'request' | 'decision'; value: unknown }
  }
}
