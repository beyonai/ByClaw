/** Model-facing tool definition and registration in an explicitly supplied Agent scope. */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { GroupTaskPublicationClient, type GroupTaskPublicationBinding } from './client.ts'

export const GROUP_TASK_PUBLICATION_DESCRIPTION = '用户要求发布任务成果或修改待发布内容时，准备向来源群发布的正文和附件，等待用户确认。每次调用整体替换待发布内容；正文和附件至少提供一项。此操作不上传附件、不发送群消息、不完成任务。成功后说明待确认，不能声称已发布。附件须为当前用户可读取且实际存在的 /by/ 绝对文件路径，不接受 URL、目录、相对路径或客户端本机路径。'

/** Register once per Agent context; DSH disposes the registration with that context. */
export class GroupTaskPublicationTools {
  private readonly mounted = new WeakSet<Context>()

  constructor(private readonly client: GroupTaskPublicationClient) {}

  mount(ctx: Context, binding: GroupTaskPublicationBinding, owner?: Context): void {
    if (this.mounted.has(ctx)) return
    const tool: ToolDefinition = {
      name: 'prepare_group_task_publication',
      description: GROUP_TASK_PUBLICATION_DESCRIPTION,
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
      execute: (args, exec) => this.client.prepare(binding, args, exec.signal),
    }
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
    this.mounted.add(ctx)
  }
}
