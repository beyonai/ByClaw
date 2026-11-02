/** HACU eligibility and immutable publication identity owned by this plugin. */

import { z } from 'zod'
import { publicationIdSchema } from './ids.ts'
import type { GroupTaskPublicationBinding } from './client.ts'

/** Durable identity selected only from a trusted inbound command. */
export const groupTaskPublicationBindingSchema = z.object({
  taskId: z.string().min(1),
  userCode: z.string().min(1),
})

export type { GroupTaskPublicationBinding } from './client.ts'

const groupChatSchema = z.object({
  conversationKey: publicationIdSchema,
  childSessionId: publicationIdSchema,
})

/** Preserve the first HACU binding; later commands cannot replace its task or user. */
export function resolveGroupTaskPublicationBinding(
  current: GroupTaskPublicationBinding | undefined,
  command: { header: { sessionId: string | number; userCode: string }; extraPayload: Record<string, unknown> },
): GroupTaskPublicationBinding | undefined {
  const isHACU = groupChatSchema.safeParse(command.extraPayload['groupChat']).success
  const taskId = publicationIdSchema.parse(command.header.sessionId)
  if (current !== undefined) {
    if (current.userCode !== command.header.userCode
      || current.taskId !== taskId) {
      throw new Error('群任务发布上下文与当前会话身份不一致。')
    }
    return current
  }
  if (!isHACU) return undefined
  return groupTaskPublicationBindingSchema.parse({
    taskId,
    userCode: command.header.userCode,
  })
}
