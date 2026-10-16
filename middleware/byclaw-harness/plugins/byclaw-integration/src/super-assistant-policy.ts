/** Super assistants coordinate work and may directly invoke scoped media generation. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const SUPER_ASSISTANT_TOOLS = new Set([
  'byclaw_list_resources', 'byclaw_route_task', 'byclaw_instantiate_template',
  'image_generate', 'text_to_speech', 'text_to_speech_options',
  'agent_teams_status', 'ask_user_question', 'super_assistant_read_plan', 'todo_write', 'task_plan',
])

export const SUPER_ASSISTANT_POLICY = `你是超级助手，负责理解需求、澄清、规划、调度和汇总。
简单任务：问候、澄清、一般知识解释、对当前对话已有内容做简短总结，可直接回答。
媒体生成例外：用户要求文生图或文本转语音时，可直接调用已注册的 image_generate 或 text_to_speech；工具将制品写入本会话 session_root/image 或 session_root/tts。工具未注册或失败时如实说明，不用代码、命令或其他工具绕过。
用户查询或切换音色、语速时，先调用 text_to_speech_options 查询当前模型能力，再按返回的音色 ID 或名称及语速范围调用 text_to_speech。向用户说明 warnings；status 为 unsupported 或 artifacts 为空时不得声称已生成，不能把不支持调整误报为必须配置个人连接器。
复杂任务：除上述媒体生成外，需要检索或核实外部信息、读取附件或项目、代码或文件操作、浏览器、命令执行、业务系统操作、多步骤分析或专业交付，必须委派授权数字员工或专家组。不得自己执行，也不得用长篇回答冒充员工交付。
Jev 开启时直接调用 byclaw_route_task，传入含上下文、约束和验收标准的自包含任务；工具内部读取授权候选，无需先调用 byclaw_list_resources。再用返回的 template_id 和同一 task 调用 byclaw_instantiate_template，启动时只校验选择，不再次选人。Jev 关闭时先调用 byclaw_list_resources，自行选择授权模板后委派。
可读取和更新自身调度计划/Todo，读取授权资源及团队状态，向用户澄清和调度。计划项描述分工、委派与验收；只有收到员工交付并核实后才标记完成，不把派发成功当作完成。除媒体工具自身生成制品外，不得修改文件或业务数据，不得使用代码或其他工具绕过权限。
员工异步回报后，汇总有证据的结果，必要时继续委派。没有候选或路由失败时说明阻塞、澄清或重试，不自行接管复杂任务，不声称任务完成。`

export class SuperAssistantPolicy {
  private readonly bound = new WeakSet<Agent>()

  bind(scope: Context, agent: Agent): void {
    if (this.bound.has(agent)) return
    this.bound.add(agent)
    const tools = scope.get('tools')!
    const release = [tools.presentAs('native')]
    release.push(tools.guard(exec => exec.agent === agent && !SUPER_ASSISTANT_TOOLS.has(exec.name)
      ? 'SUPER_ASSISTANT_EXECUTION_DENIED: 超级助手仅可调度、澄清及调用会话媒体生成工具；其他执行请交给授权数字员工。' : undefined))
    // Filter the final assembly too: restrictions alone exempt scope-local registrations.
    release.push(scope.on('system-prompt/assemble', async (_assembly, context, next) => {
      const result = await next()
      if (context.agent !== agent) return result
      return { ...result, tools: result.tools.filter(tool => SUPER_ASSISTANT_TOOLS.has(tool.name)),
        sections: [...result.sections, { name: 'byclaw:super-assistant-orchestration', text: SUPER_ASSISTANT_POLICY }] }
    }, { prepend: true }))
    release.push(tools.register(defineTool({
      name: 'super_assistant_read_plan',
      description: '只读当前超级助手会话最近的计划和 Todo 快照；不创建、更新或完成待办，不代表员工执行进度。',
      parameters: {},
      output: {
        schema: { type: 'object', properties: { json: { type: 'string', required: true } }, additionalProperties: false },
        render: (_args, value) => [{ type: 'text', text: value.json }],
      },
      execute: async (_args, exec) => {
        if (exec.agent !== agent) throw new Error('Plan access requires the owning super-assistant session')
        const snapshot = [...agent.session.ownEvents()].reverse().find(event => event.type === 'todo/write')
        return { json: JSON.stringify({ todos: snapshot?.type === 'todo/write' ? snapshot.data.todos : [] }) }
      },
    })))
    scope.effect(() => () => { for (const dispose of release.reverse()) dispose(); this.bound.delete(agent) })
    scope.logger.info(`[byclaw-super-assistant] bound ${JSON.stringify({ sessionId: String(agent.id), tools: [...SUPER_ASSISTANT_TOOLS] })}`)
  }
}
