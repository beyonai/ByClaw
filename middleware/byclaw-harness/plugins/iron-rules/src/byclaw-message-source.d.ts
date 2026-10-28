/** Preserve the source tag of existing ByClaw-authored context records. */
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    plugin: { kind: 'plugin'; plugin: string } & ContextFormed
  }
}
