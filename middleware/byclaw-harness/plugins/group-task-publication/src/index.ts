/** Optional publication extension for trusted ByClaw session setup. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ByClawSessionHost } from '@byclaw/dsh-integration/session-extensions'
import { GroupTaskPublicationClient } from './client.ts'
import { GroupTaskPublicationTools, GROUP_TASK_PUBLICATION_DESCRIPTION, HUMAN_TASK_SUBMISSION_DESCRIPTION } from './tool.ts'
import { GroupTaskPublicationState } from './state.ts'
import { GroupHumanTaskTools, resolveHumanTaskBinding } from './human-task.ts'

export { GroupTaskPublicationClient, type GroupTaskPublicationBinding, type GroupTaskPublicationClientOptions, type Publication } from './client.ts'
export { GroupTaskPublicationTools, GROUP_TASK_PUBLICATION_DESCRIPTION } from './tool.ts'
export { GroupTaskPublicationState, publicationDomainSpec, publicationSessionSchema } from './state.ts'
export { resolveGroupTaskPublicationBinding } from './context.ts'

export const name = 'group-task-publication'
export const inject = ['storageDomain']

/** Deployment deadline for a non-retried POST and its file preflight. */
export interface Config {
  timeoutMs: number
  /** Explicit employee resource IDs allowed to prepare human-task proposals. */
  taskManagerAgentIds?: string[]
}

export const Config: z<Config> = z.object({
  timeoutMs: z.natural().min(1).default(30_000),
  taskManagerAgentIds: z.array(z.string()).default([]),
})

/** Await durable eligibility before registering the tool in the supplied Agent context. */
export function apply(ctx: Context, config: Config): Promise<void> {
  const ready = GroupTaskPublicationState.open(ctx)
  const composers = new WeakMap<ByClawSessionHost, GroupTaskPublicationTools>()
  const taskManagers = new WeakMap<ByClawSessionHost, GroupHumanTaskTools>()
  // Startup rejection is returned to Cordis; cleanup only closes successfully opened domains.
  ctx.effect(() => () => ready.then(state => state.close(), () => undefined))
  ctx.on('byclaw/session-setup', async ({ agentCtx, command, host }) => {
    if (host.userCode !== command.header.userCode) throw new Error('群任务发布上下文与宿主用户身份不一致。')
    const taskBinding = resolveHumanTaskBinding(command, config.taskManagerAgentIds ?? [])
    if (taskBinding) {
      let taskManager = taskManagers.get(host)
      if (!taskManager) {
        taskManager = new GroupHumanTaskTools({ ...host, timeoutMs: config.timeoutMs })
        taskManagers.set(host, taskManager)
      }
      taskManager.mount(agentCtx, taskBinding, ctx)
    } else {
      taskManagers.get(host)?.unmount(agentCtx)
    }
    const state = await ready
    const binding = await state.select(command)
    if (binding === undefined) return
    let tools = composers.get(host)
    if (tools === undefined) {
      tools = new GroupTaskPublicationTools(new GroupTaskPublicationClient({ ...host, timeoutMs: config.timeoutMs }))
      composers.set(host, tools)
    }
    tools.mount(agentCtx, binding, ctx)
  })
  ctx.on('byclaw/coding-setup', async setup => {
    const { command, host } = setup
    if (host.userCode !== command.header.userCode) throw new Error('群任务发布上下文与宿主用户身份不一致。')
    const binding = await (await ready).select(command)
    if (binding === undefined) return
    const client = new GroupTaskPublicationClient({ ...host, timeoutMs: config.timeoutMs })
    setup.publication = { description: binding.humanTaskId === undefined ? GROUP_TASK_PUBLICATION_DESCRIPTION : HUMAN_TASK_SUBMISSION_DESCRIPTION, mode: 'mcp',
      binding: { taskId: binding.taskId, userCode: binding.userCode,
        ...(binding.privateGroupId === undefined ? {} : { privateGroupId: binding.privateGroupId }),
        ...(binding.enterpriseId === undefined ? {} : { enterpriseId: binding.enterpriseId }) },
      prepare: (args, signal) => client.prepare(binding, args, signal) }
  })
  return ready.then(() => undefined)
}
