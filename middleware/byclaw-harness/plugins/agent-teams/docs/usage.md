# 使用指南（详细）

本文档收纳 dsh-agent-teams 的详细使用内容：工作原理、Web UI 行为、工具一览、配置与已知限制。README 只保留简介与快速上手。

## 工作原理

`dsh-agent-teams` 复用 DSH 的能力接缝（capability seam），不依赖 workflow 引擎：

| DSH 能力 | AgentTeams 用法 |
|---|---|
| `ctx.tools` 注册表 | 注册 17 个 `agent_teams_*` 工具（与 `tool-workflow` 同一注册路径） |
| `ctx.subagents.startActivation()` | 创建成员：durable 可续聊子代理，带成员 persona |
| `ctx.subagents.followup()` | 唤醒收件成员（消息进入其下一轮次） |
| `ctx.subagents.listChildren()` + `ctx.agents` | 前者发现 durable 成员，后者提供真实 `running / idle / ready` 活动状态 |
| `agent/status` | 成员进入 idle 后触发共享任务池自动续领与下一轮唤醒 |
| `ctx.systemPrompt.section()` | 注册"AgentTeams 使用策略"提示段 |
| Web server 路由注册 | 活动面板数据路由 `/plugins/dsh-agent-teams/state` + 鲸鱼图片静态服务（`webServer`/`httpServer` 双键兼容，见下） |
| 文件系统 | 团队状态持久化在 `$DSH_HOME/runtime/byclaw-agent-teams/<workspace-and-namespace-digest>/<teamId>/` |

数据链路：工具执行 → 磁盘状态（真相源）→ host 快照路由 → 浮层 1s 轮询渲染。`agent-teams/*` 会话事件仅在运行中的 Harness 已识别该事件类型时尽力追加；未知类型会跳过，且事件不是活动面板或团队恢复的真相源。

> **内测版本兼容**：npm `latest`（`0.0.1-rc.1`）的服务键仍是 `ctx.httpServer` / `ctx.workspace`，后续 `next`（`rc.2`）重命名为 `ctx.webServer` / `ctx.workspaceRegistry`。插件对两组键都做了探测（新键优先、旧键回退，`internal/service` 事件同时监听两组），两个版本都能注册路由。

### Web UI

- **右上角活动面板**（body-portal 浮层）：团队创建后自动展开；每个团队展示队长、分段总进度、状态统计、可折叠成员树和紧凑任务 DAG。DAG 以真实 SVG 曲线连接依赖，悬停或键盘聚焦可预览完整上下游链，点击固定，`Esc` 取消；选中节点会显示负责人、未满足前置和下游解锁信息。成员行展示职业头像、角色、实时状态和任务标签，点击可打开成员子会话。收起态为右上角小浮标（团队数 + 活动脉冲点）。
- **小鲸鱼形象**：队长/成员头像为 DeepSeek 小鲸鱼职业插画（`assets/agent-teams/`，8 角色 + 6 动作），按角色关键词匹配；状态动作小图随成员状态切换并带动画（工作浮动 / 空闲呼吸 / 未知思考），未读消息头像外圈光晕；遵循 `prefers-reduced-motion`。
- **会话跟随**：面板只显示**当前会话**的团队（按 captainSessionId 匹配）；新建会话面板自动收起，切回团队会话恢复。
- **对话流卡片**：团队创建时对话流出现轻量卡片（成员一览、点击跳转成员会话、"活动面板"按钮可重新激活已关闭的浮层）。
- **历史复盘**：`agent_teams_delete` 将团队**归档保留**（`<stateRoot>/archive/<teamId>/`，成员、任务、依赖图和邮箱完整留存）；结束团队时成员会被标记为 removed，但历史快照仍保留整支队伍，并以空闲/已交付状态展示，避免任务仍在而成员消失。打开历史会话点卡片即可恢复同一套成员树与 DAG。

### 团队状态文件

```
$DSH_HOME/runtime/byclaw-agent-teams/<workspace-and-namespace-digest>/<teamId>/
├── team.json            # 团队记录：成员、任务（含依赖）、任务序号
└── inbox/
    ├── captain.jsonl    # 队长邮箱（成员 → 队长）
    └── <member>.jsonl   # 每个成员一个邮箱（JSONL）
```

任务状态机：`pending → claimed → in_progress → completed | failed | cancelled`。每次执行携带单调 `attempt` + 唯一 `attemptId`；转派先使旧 attempt 失效，再中断并等待旧成员安静，因此迟到更新无法覆盖新结果。领取前校验依赖，并禁止成员同时拥有两个未完成任务。

## 工具一览

| 工具 | 作用 |
|---|---|
| `agent_teams_list_instances` | 查看机器全局运行团队元数据；不会加入或控制其他队长的团队 |
| `agent_teams_get_instance` | 查看一个已发现运行团队的成员和可提交工作元数据 |
| `agent_teams_list_templates` | 读取 `catalogDir` 中的可复用专家成员名册 |
| `agent_teams_submit_task` | 向已发现团队追加一项独立、完整的工作，不改变其现有任务或所有权 |
| `agent_teams_get_submitted_task` | 查询由当前会话提交给外部团队的工作回执 |
| `agent_teams_create` | 创建团队，调用者成为队长（一个队长同时只带一个团队） |
| `agent_teams_save_template` | 将当前活动团队的非移除成员名册保存到机器全局 catalog |
| `agent_teams_add_member` | 拉成员入队（spawn 可续聊子代理 + 成员 persona） |
| `agent_teams_remove_member` | 安全移除成员：撤销 attempt、回收其未完成任务、等待中断收敛后重新调度 |
| `agent_teams_create_task` | 创建任务，支持 `dependencies` 依赖声明与 `assignee` 指派 |
| `agent_teams_reassign_task` | 原子重试/转派任务；`assignee=captain` 表示队长安全接管 |
| `agent_teams_claim_task` | 领取任务（校验依赖；队长可代领，成员只能领自己的/未指派的） |
| `agent_teams_update_task` | 携带当前 `attempt_id` 推进任务；拒绝旧 attempt 和终态结果覆盖 |
| `agent_teams_send_message` | 任意成员→任意成员/队长：消息直达对方邮箱并唤醒对方（无队长转发；拒绝冒名 `from`） |
| `agent_teams_status` | 团队全景：成员活动、任务清单、队长邮箱、各成员待读消息 |
| `agent_teams_delete` | 结束团队：打断成员，团队目录**归档保留**（任务与依赖图、邮箱完整留存） |

`agent_teams_add_member` 默认不需要模型参数：它会快照队长当前请求真正生效的 LLM provider、model 与思考强度。用户明确要求某个角色使用其他模型时，可以同时传入可选的 `provider` + `model`；只覆盖 `model` 时沿用队长当前 LLM provider。插件不会为每个成员发起二次选择或弹窗，也不暴露逐成员思考强度参数。

### 按需组建模板成员

先调用 `agent_teams_list_templates` 查看模板及成员名。`agent_teams_create` 的 `template_members` 控制首次创建的粒度：

| 调用参数 | 初始成员 |
|---|---|
| 不传 `template_id` | 空团队，后续可添加自定义成员 |
| `template_id` + `template_members: []` | 关联模板的空团队，后续按需选人 |
| `template_id` + `template_members: ["engineer"]` | 仅创建指定模板成员 |
| 仅传 `template_id` | 创建全部模板成员，兼容原有调用 |

例如模板 `software-delivery` 包含 `engineer` 和 `reviewer`：

```js
agent_teams_create({ name: "按需交付", template_id: "software-delivery", template_members: [] })
agent_teams_add_member({ name: "engineer", template_member: "engineer" })
// 后续需要审查时再增加成员
agent_teams_add_member({ name: "reviewer", template_member: "reviewer" })
```

`template_members` 必须配合 `template_id`；成员名按模板中的完整名称匹配，首尾空格会去除。空名称、未知成员、重复成员及队长保留名会在建队或启动子会话前报错。

`agent_teams_add_member.template_member` 从当前团队关联的模板读取成员配置，保留角色、provider/model、ByClaw persona 与 Skills 快照；`name` 可用作队内别名。显式 `role` 覆盖模板角色；显式 `provider` + `model` 或仅 `model` 按普通成员的规则替换模型路由。成员与队长路由完全相同时继承队长当前思考强度；路由不同时使用目标模型自己的默认思考配置，避免把某个模型专属的档位错误套用到另一个模型。不传 `template_member` 则创建自定义成员。读取模板到成员启动完成期间保持 catalog 共享准入；模板撤销或准入关闭时不会创建模板成员。

同一队长重复创建同一模板只复用现有运行团队，传入的 `template_members` 不会增删已有名册；通过 `agent_teams_add_member` 增补成员。`member_count` 返回实际活动成员数。受控工作流仍需先添加任务所需成员、创建完整 DAG，再调用 `agent_teams_start`。

## 配置

插件不限制团队成员数量。在 profile 的 `cordis.patch.yml` 中覆盖其他配置：

```yaml
- id: agent-teams
  config:
    stateDir: .agent-teams        # 团队状态逻辑命名空间（实际状态保存在宿主私有运行目录）
    memberProvider: spawn         # 子代理运行后端（spawn / fork），不是 LLM provider
    memberModel: deepseek-v4      # 可选：成员模型覆盖
    memberMaxDepth: 1             # 成员再委派深度上限（0 = 禁止）
    controlledWorkflow: true      # 要求完整任务 DAG 后才能显式启动
    maxTaskAttempts: 3            # 自动重试上限
    catalogDir: /absolute/path/to/agent-teams-catalog # 全局模板和实例指针
```

最终优先级为：成员显式 `provider` + `model` / `model` → `memberModel` → 队长当前路由。只有最终 provider/model 与队长当前路由相同时才继承队长思考强度；跨路由成员由目标模型解析自己的默认思考配置。最终生效的 provider/model/思考强度会写入 `team.json`，供状态查询和成员冷恢复使用。

`controlledWorkflow: true` 时，队长要为每项任务明确传入 description、dependencies（包括空数组）、assignee、acceptance_criteria 与 required_tools（包括空数组），完整 DAG 准备好后只调用一次 `agent_teams_start`。`catalogDir` 是机器全局目录，保存可复用专家名册和运行实例指针，不应由不可信工作区控制。`maxTaskAttempts` 是自动重试的固定上限。

### Claude Code 运行面

给 `agent_teams_add_member` 传入 `runtime: claude-code` 时，成员由本机 `claude` CLI 的非交互模式执行，不会获得 Harness 的 `agent_teams_*` 工具。插件为每轮构造自包含任务提示，在 `<stateDir>/<teamId>/inbox/claude-<member>.json` 保存 Claude 会话 id 以便 `--resume`；team 和 member 均使用净化后的单路径段，状态文件会额外校验仍在 inbox 内。Claude 子进程只获得 PATH、临时目录、语言、用户配置目录和已配置的 Claude/Anthropic 认证变量，不继承其他宿主环境变量。

## 使用协议

插件提示段会指导模型按协议执行：建团队 → 按角色拉成员 → 拆任务并声明依赖 → 共享调度器自动领取并唤醒空闲成员 → 队长监控/引导 → 阻塞时先安全转派或接管 → 汇报后 `agent_teams_delete`。成员之间可以直接互发消息，无需队长中转。成员若在中断、异常结束或进程重启后变成 `idle/ready`，但磁盘上仍持有 `claimed/in_progress` 任务，调度器会撤销旧 capability、生成新 attempt 并重新唤醒同一成员。

## 已知限制

- 调度是事件驱动而非常驻轮询；队长离线时无法冷恢复成员，任务和消息保留在磁盘，待队长恢复或调用状态工具后继续投递。
- 一个队长同时只能带一个团队（与 Claude Code AgentTeams 一致）。
- 成员 persona 替换部署默认 persona；成员仍拥有完整工具集（bash/fs/web 等）。
- 团队状态为文件级持久化，多进程同时操作同一团队不保证一致（同一 dsh 进程内已用锁串行化）。
- 活动面板读磁盘真相（1s 轮询）。会话事件是运行时识别类型时的尽力信息记录，未知类型会跳过，不能用作恢复或面板数据源。
- 右上角浮层通过 body portal 挂载；宽屏展开时主对话列平滑向左礼让空间，窄屏退回 overlay 模式，左侧导航保持不动。
- 成员（模型）不总是严格走工具"仪式"（如完成时不调 `agent_teams_update_task`）——面板如实反映磁盘真相，队长以 `agent_teams_status`/文件为准汇总。

## 验证

- 离线与生命周期：`pnpm build && pnpm typecheck && pnpm verify`。除基础检查外，还包含 8 成员、31 节点多层 DAG（运行中扩展至 38 任务）的故障矩阵：并发接管/移除、50 次迟到写入、4 个开放任务冷重启、7 路认领竞争、40 次终态覆盖、42 条消息突发和最终归档；组合验证 `dsh --profile agent-teams-check --dump-config`
- 真实 e2e：`dsh plugin --profile headless add <path>` 后 `dsh --profile headless "用 AgentTeams …"`，核对 `resolveTeamStateRoot(workspace, stateDir)` 返回位置的状态文件、提交回执和活动面板快照路由
- GUI：独立实例 + ego-browser（详见 `verification-guide.md`）
