/** Optional publication extension for trusted ByClaw session setup. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ByClawSessionHost } from '@byclaw/dsh-integration/session-extensions'
import { GroupTaskPublicationClient } from './client.ts'
import { GroupTaskPublicationTools } from './tool.ts'
import { GroupTaskPublicationState } from './state.ts'

export { GroupTaskPublicationClient, type GroupTaskPublicationBinding, type GroupTaskPublicationClientOptions, type Publication } from './client.ts'
export { GroupTaskPublicationTools, GROUP_TASK_PUBLICATION_DESCRIPTION } from './tool.ts'
export { GroupTaskPublicationState, publicationDomainSpec, publicationSessionSchema } from './state.ts'
export { resolveGroupTaskPublicationBinding } from './context.ts'

export const name = 'group-task-publication'
export const inject = ['storageDomain']

/** Deployment deadline for a non-retried POST and its file preflight. */
export interface Config {
  timeoutMs: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.natural().min(1).default(30_000),
})

/** Await durable eligibility before registering the tool in the supplied Agent context. */
export function apply(ctx: Context, config: Config): Promise<void> {
  const ready = GroupTaskPublicationState.open(ctx)
  const composers = new WeakMap<ByClawSessionHost, GroupTaskPublicationTools>()
  // Startup rejection is returned to Cordis; cleanup only closes successfully opened domains.
  ctx.effect(() => () => ready.then(state => state.close(), () => undefined))
  ctx.on('byclaw/session-setup', async ({ agentCtx, command, host }) => {
    if (host.userCode !== command.header.userCode) throw new Error('群任务发布上下文与宿主用户身份不一致。')
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
  return ready.then(() => undefined)
}
