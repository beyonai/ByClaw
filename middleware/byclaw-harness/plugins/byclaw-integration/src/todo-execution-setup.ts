import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@byclaw/dsh-todo-execution'
import type { AskAgentCommand } from '@byclaw/by-framework'
import { groupCoordinationFromExtra, type GroupCoordinationSpec } from './group-coordination.ts'
import type { ByClawSessionHost } from './session-extensions.ts'

/** Bind before extensions and input admission; restored group metadata must retain its mode. */
export async function setupTodoExecution(
  ctx: Context, agentCtx: Context, agent: Agent, command: AskAgentCommand,
  host: ByClawSessionHost, persistedGroup?: GroupCoordinationSpec, orchestrationOnly = false,
): Promise<void> {
  const group = groupCoordinationFromExtra(command.extraPayload) ?? persistedGroup
  if (orchestrationOnly && group === undefined) ctx.todoExecution.suspendForOrchestration(agent)
  else if (group === undefined) ctx.todoExecution.bind(agentCtx, agent)
  else ctx.todoExecution.unbind(agent)
  await ctx.serial('byclaw/session-setup', { agentCtx, agent, command, host })
}
