/** Model-facing tool definition and registration in an explicitly supplied Agent scope. */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { GroupTaskPublicationClient, type GroupTaskPublicationBinding } from './client.ts'

export const GROUP_TASK_PUBLICATION_DESCRIPTION = '用户要求“发到群里”“发到工作组”“发布到群里”“发布到工作组”，或以类似说法要求发布成果时，优先调用本工具，为用户准备发往来源群的正文和附件，等待用户确认。用户要求修改待发布内容时也使用本工具。每次调用整体替换待发布内容；正文和附件至少提供一项。此操作不上传附件、不发送群消息、不完成任务。成功后说明待确认，不能声称已发布。附件须为当前用户可读取且实际存在的 /by/ 绝对文件路径，不接受 URL、目录、相对路径或客户端本机路径。'
export const HUMAN_TASK_SUBMISSION_DESCRIPTION = '用户要求提交当前待办任务成果或修改待提交内容时调用，为负责人准备正文和附件，等待真人确认提交。每次整体替换草稿，正文和附件至少一项。此操作不上传附件、不提交、不发送群消息，不能声称已经提交或验收通过。附件须为当前用户可读取且存在的 /by/ 绝对文件路径，不接受 URL、目录或本机路径。每次确认产生新版本，不能修改历史提交。'
const PRIVATE_PUBLICATION_DESCRIPTION = GROUP_TASK_PUBLICATION_DESCRIPTION
  + '同一私聊可多次发布。确认后可准备新卡片，已发布的成果不受影响。'

/** Register once per Agent context; DSH disposes the registration with that context. */
export class GroupTaskPublicationTools {
  private readonly mounted = new WeakMap<Context, { binding: GroupTaskPublicationBinding; tool?: ToolDefinition }>()

  constructor(private readonly client: GroupTaskPublicationClient) {}

  mount(ctx: Context, binding: GroupTaskPublicationBinding, owner?: Context): void {
    const mounted = this.mounted.get(ctx)
    if (mounted) {
      if (mounted.binding.userCode !== binding.userCode || mounted.binding.taskId !== binding.taskId) {
        throw new Error('发布工具与当前会话身份不一致。')
      }
      mounted.binding = binding
      if (mounted.tool) mounted.tool.description = binding.humanTaskId !== undefined ? HUMAN_TASK_SUBMISSION_DESCRIPTION
        : binding.privateGroupId === undefined ? GROUP_TASK_PUBLICATION_DESCRIPTION : PRIVATE_PUBLICATION_DESCRIPTION
      return
    }
    const session: { binding: GroupTaskPublicationBinding; tool?: ToolDefinition } = { binding }
    const tool: ToolDefinition = {
      name: 'prepare_group_task_publication',
      description: binding.humanTaskId !== undefined ? HUMAN_TASK_SUBMISSION_DESCRIPTION
        : binding.privateGroupId === undefined ? GROUP_TASK_PUBLICATION_DESCRIPTION : PRIVATE_PUBLICATION_DESCRIPTION,
      // Raw input schemas own validation; Zod enforces limits and rejects undeclared model fields.
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 100000, description: '完整待发布正文；省略会清空旧正文，仅发附件时可省略。' },
          sourcePaths: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 4096 }, description: '完整附件列表，元素为符合工具说明的绝对文件路径；省略或空数组清空旧附件。' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object', additionalProperties: false,
          required: ['taskId', 'pendingPublicationId', 'text', 'sourcePaths', 'createTime'],
          properties: {
            taskId: { type: 'string' }, pendingPublicationId: { type: 'string' },
            text: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            sourcePaths: { type: 'array', items: { type: 'string' } }, createTime: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args, exec) => this.client.prepare(session.binding, args, exec.signal),
    }
    session.tool = tool
    if (owner === undefined) {
      ctx.tools.register(tool)
    } else {
      const dispose = owner.effect(() => {
        const unregister = ctx.tools.register(tool)
        return () => {
          unregister()
          this.mounted.delete(ctx)
        }
      })
      ctx.effect(() => () => dispose())
    }
    this.mounted.set(ctx, session)
  }
}
