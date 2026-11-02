# ByClaw 入站 @ 直达动态 Agent 设计

## 目标

让 ByClaw 入站消息通过与 `byai-channel` 兼容的 `extra_payload.agent_id` / `agent_code`，或消息正文中的 `@资源名称` / `@资源编码`，直接进入已授权的 ByClaw 数字员工或专家团动态实例，而不是先交给 DSH 主 Agent 再由主 Agent 决策。

## 现状与参考实现

`plugins/byclaw-integration` 当前把每条入站消息投递给稳定的 DSH 根 Agent；主 Agent 通过 `byclaw_list_resources` 和 `byclaw_instantiate_template` 决定是否委派。`/Users/chenxiaofeng/code/ByClaw/byclaw-exe/extensions/byai-channel` 使用 `extraPayload.agent_id` / `agent_code` 选择目标 Agent，并在 multi-agent 场景下按 `@agentName` 切分任务文本。

## 设计

### 入站目标解析

新增纯函数路由解析器，输入当前用户授权的资源目录、结构化 `extraPayload` 和消息正文，输出目标模板与清理后的业务文本：

- `dsh_target_session_id` / `dsh_parent_session_id` 保持最高优先级，用于已有 DSH 子会话续聊。
- `agent_id`、`agent_code`、`agent_name` 作为结构化直达目标；兼容数字和字符串 ID。
- 无结构化目标时，解析正文中的唯一 `@资源名称` 或 `@资源编码`，匹配忽略大小写但不把纯数字当作名称别名。
- 结构化字段之间或文本中匹配到多个不同资源时直接报错，不静默选取。
- 仅允许直接授权的数字员工；专家团成员只能通过其授权专家团访问。
- 未指定目标时保留原主 Agent 路径。

### 动态实例与会话

- 为 `(userCode, externalRootSessionId, templateId)` 计算稳定的 DSH 子会话 ID。
- 首次直达时，以现有根 Agent 作为精确父会话，通过 `startContinuable` 创建对应模板实例。
- 后续相同外部会话和模板通过 `subagents.followup` 复用或冷恢复该子会话；消息不进入主 Agent。
- 数字员工实例直接返回自己的输出。
- 专家团实例作为团长，继续沿用现有 `byclaw-team-*` AgentTeams 适配器、异步等待、删除和状态事件投影。
- 直达子 Agent 的输出会把 `ActiveTurn.responseSessionId` 指向该子会话，保持既有流式回答与生命周期事件协议。

### 工具与兼容性

- 抽取模板实例化核心逻辑供模型工具和入站直达路径复用，保证 Skill、Persona、模型和 workspace 装配一致。
- 现有 `byclaw_instantiate_template` 工具语义不变。
- 无 `agent_id` / `agent_code` / 文本 `@` 的消息仍使用主 Agent；既有 `dsh_target_session_id` 路由继续有效。

### 错误处理

- 目标不存在、未授权、目标字段冲突或 `@` 歧义在创建子会话前失败，并通过现有 ByClaw error 事件返回。
- 目标模板刷新或撤销后，下一次直达重新按当前授权目录解析；历史子会话不会被错误复用到另一个模板。
- 直达专家团的团长失败、成员失败和团队未结算继续使用现有 `ByClawAsyncTeamGate` 错误路径。

## 测试

新增路由验证脚本覆盖结构化 ID/编码/名称、正文 @ 解析与清理、未授权和歧义边界；扩展 Worker/session 验证覆盖直达数字员工、专家团、稳定子会话 ID、主 Agent 回退与已有 DSH 子会话续聊。构建后运行插件 `verify`，再用真实 Redis/ByClaw 环境启动 DSH Web，分别发送数字员工和专家团自我介绍入站消息，检查生命周期日志中的目标子会话和输出来源。
