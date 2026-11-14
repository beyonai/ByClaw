/** HACU eligibility and immutable publication identity owned by this plugin. */

import { z } from 'zod'
import { publicationIdSchema } from './ids.ts'
import type { GroupTaskPublicationBinding } from './client.ts'

/** Durable identity selected only from a trusted inbound command. */
export const groupTaskPublicationBindingSchema = z.object({
  taskId: z.string().min(1),
  userCode: z.string().min(1),
  humanTaskId: z.string().regex(/^[1-9]\d*$/u).optional(),
  privateGroupId: z.string().regex(/^[1-9]\d*$/u).optional(),
  enterpriseId: z.string().regex(/^[1-9]\d*$/u).optional(),
})

export type { GroupTaskPublicationBinding } from './client.ts'

const groupChatSchema = z.object({
  conversationKey: publicationIdSchema,
  childSessionId: publicationIdSchema,
})

// The BE emits this marker only for a persisted direct task. Ordinary group references
// can use other identifiers; direct-task identifiers are positive database IDs on the wire.
const privatePublicationSchema = z.object({
  taskSessionId: z.string().regex(/^[1-9]\d*$/u),
  groupSessionId: z.string().regex(/^[1-9]\d*$/u),
  enterpriseId: z.string().regex(/^[1-9]\d*$/u).optional(),
})

/** Preserve the first HACU binding; later commands cannot replace its task or user. */
export function resolveGroupTaskPublicationBinding(
  current: GroupTaskPublicationBinding | undefined,
  command: { header: { sessionId: string | number; userCode: string }; extraPayload: Record<string, unknown> },
): GroupTaskPublicationBinding | undefined {
  const isHACU = groupChatSchema.safeParse(command.extraPayload['groupChat']).success
  const group = command.extraPayload['groupChat'] as Record<string, unknown> | undefined
  const privateMarker = command.extraPayload['groupPrivatePublication'] as Record<string, unknown> | undefined
  const humanTaskId = z.string().regex(/^[1-9]\d*$/u).optional().parse(group?.['humanTaskId'] ?? privateMarker?.['humanTaskId'] ?? command.extraPayload['humanTaskId'])
  const taskId = publicationIdSchema.parse(command.header.sessionId)
  const marker = command.extraPayload['groupPrivatePublication']
  const direct = marker === undefined ? undefined : privatePublicationSchema.parse(marker)
  if (direct && direct.taskSessionId !== taskId) throw new Error('私聊发布上下文与当前会话不一致。')
  if (current !== undefined) {
    if (current.userCode !== command.header.userCode
      || current.taskId !== taskId) {
      throw new Error('群任务发布上下文与当前会话身份不一致。')
    }
    if (direct && current.privateGroupId !== undefined
      && (direct.groupSessionId !== current.privateGroupId || direct.enterpriseId !== current.enterpriseId)) {
      throw new Error('私聊发布上下文与已绑定的来源群或租户不一致。')
    }
    if (current.humanTaskId !== undefined && humanTaskId !== undefined && current.humanTaskId !== humanTaskId) {
      throw new Error('待办提交上下文不能切换到另一项待办。')
    }
    if ((!direct || current.privateGroupId !== undefined) && (humanTaskId === undefined || current.humanTaskId === humanTaskId)) return current
  }
  if (!current && !isHACU && !direct) return undefined
  return groupTaskPublicationBindingSchema.parse({
    ...current,
    taskId,
    userCode: command.header.userCode,
    ...(humanTaskId && { humanTaskId }),
    ...(direct && { privateGroupId: direct.groupSessionId, enterpriseId: direct.enterpriseId }),
  })
}
