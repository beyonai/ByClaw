/**
 * Which tool environment (B) an employee's commands run in.
 *
 * The employee selects a sandbox spec (`toolSandbox`, carried on the agent
 * template); the runtime binds the Agent instantiated from the template to that
 * spec in the `dsh-tool-env` pool. Descendants inherit the binding; an Agent
 * without one uses the default spec. Nothing here starts a sandbox.
 */
import type { DshAgentTemplate } from './agent-template.ts'

/** The pool as the binder sees it (`ctx.toolEnvironments` from dsh-tool-env; optional). */
export interface ToolEnvironmentBinder {
  readonly defaultName: string
  has(name: string): boolean
  bind(agentId: string, name: string): () => void
}

/**
 * Bind a template instance to the spec its employee selected. A spec this host
 * cannot serve binds to the default and is reported, so a misconfigured
 * employee still runs. Returns the disposer; a no-op without the pool or
 * without a selection.
 */
export function bindTemplateEnvironment(
  binder: ToolEnvironmentBinder | undefined,
  agentId: string,
  template: Pick<DshAgentTemplate, 'id' | 'toolSandbox'>,
  log: { info(message: string): void; warn(message: string): void },
): () => void {
  if (binder === undefined) return () => undefined
  const wanted = template.toolSandbox?.trim()
  if (wanted === undefined || wanted === '') return () => undefined
  if (!binder.has(wanted)) {
    log.warn(`[byclaw-dsh] template ${template.id} selects tool sandbox "${wanted}", which this host cannot serve; using "${binder.defaultName}"`)
    return binder.bind(agentId, binder.defaultName)
  }
  log.info(`[byclaw-dsh] 🧰 工具沙箱 (session=${agentId}, template=${template.id}, spec=${wanted})`)
  return binder.bind(agentId, wanted)
}
