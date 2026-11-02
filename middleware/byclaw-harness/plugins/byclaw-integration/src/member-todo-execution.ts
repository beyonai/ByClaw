import type { Context } from '@deepseek-ai/cordis'
import type {} from '@byclaw/dsh-todo-execution'
import { registerContinuableChildSetup } from '@byclaw/dsh-agent-teams/child-setup'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

/** Bind fresh and cold-resumed team members before they accept work. */
export function installMemberTodoExecution(ctx: Context): void {
  registerContinuableChildSetup(ctx, (childCtx, child) => {
    const descriptor = foldSubagentDescriptor(child.session.ownEvents())
    return descriptor?.label?.startsWith('agent-teams:')
      ? ctx.todoExecution.bindMember(childCtx, child)
      : () => undefined
  })
}
