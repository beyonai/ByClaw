# 原生 todo 执行约束

`@byclaw/dsh-todo-execution` 为同一个 Agent 的原生 `todo_write` 补充顺序执行约束。原生 `todo/write` 日志是唯一计划来源，不增加模型工具、不修改原生工具定义、不调用 BE 任务计划 API。

## 行为

- 第一次创建非空计划：第一项 `in_progress`，其余 `pending`；空计划是无操作。
- 列表内容和顺序固定。每次只能完成当前项并启动下一项；允许整表原样重试，拒绝跳步、批量完成、回退、删除、清空、改名和追加。
- 同一 turn 完成后不创建第二份计划；下一个用户 turn 可创建新计划。未完成计划跨 turn 保留，不能借 `turn/start` 的投影清空绕过检查。
- `agent/pre-step` 在下游允许进入后，注入完整列表和当前执行要求；保留其他插件的拒绝结果、消息和 `startsRequestSeries`。
- `tools.guard` 做不可被其他 allow 策略覆盖的校验；`tools/execute` 在真正调用原生工具前再次校验并串行化 todo 写入。其他工具未结束时拒绝更新；同一个嵌套传输在步骤变化后不能继续执行下一步的工具。
- 活跃顺序计划中禁止配置的委派工具及 `agent_teams_*`，不影响没有计划时的路由。各项业务工具是否属于当前任务，无法从工具名和参数中普遍证明。
- `agent/turn-stopping` 发现未完成项时 steer，默认最多纠正 3 次；仍未解决则再给一次说明阻塞的机会，保留未完成项并允许退出。不会自动标记完成，不会无限纠正。取消信号不触发纠正。
- 团队成员通过 `bindMember` 仅在准备结束时检查自己的 todo，不安装逐步提醒、顺序执行或工具限制。成员须显式调用 `todo_write` 更新已实际完成的步骤；提醒包含当前完整列表，要求保留阻塞状态，不重复业务操作、任务提交和汇报。纠正上限沿用 `maxStopCorrections`。
- 普通执行 Agent 达到纠正上限后禁止继续调用业务工具，仍允许合法 todo 更新。插件要求最终回答说明未完成项，不能保证自然语言必定诚实；前端继续显示真实 todo。
- 兼容旧 `task_plan({todos})` 入口，使用同一校验，不产生第二份计划。兼容入口内容须已去除首尾空白；原生工具继续使用自己的规范化逻辑。

本插件检查流程与状态一致性，不判断业务是否真的完成，不将工具成功当作完成证据。第一版没有任务级验收器、失败状态、自由重规划或独立报告工具。阻塞时保留原生 `pending/in_progress`，用户决定调整计划的协议留待后续设计；安装前已有不符合顺序规范的未完成列表，应先处理或使用新会话。

## 日志、恢复与展示

每次读取从本 Agent 的 `session.ownEvents()` 重建原生列表。只额外写入 `todo-execution/check` 的纠正次数与原因，不保存第二套任务状态。顺序执行模式跨 turn 时原生投影已清空，pre-step 会重新追加同一份 `todo/write` 恢复投影与卡片。会话持久化沿用宿主机制；从持久化日志重载可恢复列表和本 turn 的纠正次数。宿主若裁剪了原生 todo 历史且未保留最后快照，本插件无法恢复被删的数据。

ByClaw 仍用现有 `todo/write → emitPlan → answerDelta/2008 → 前端卡片`，没有新增 `TASK_PLAN_SNAPSHOT` 或后端执行状态机。超级助手和群协调根会话不绑定顺序执行约束；新建及冷恢复的 AgentTeams 成员绑定结束检查，团队账本仍由团队工具维护。超级助手已有未完成 Todo 保留，可更新自身调度计划，由可信宿主 `suspendForOrchestration` 退出执行检查，不自动标记完成。根据当前命令和已持久化的群协调元数据共同判断模式，恢复时省略元数据不会误切为单 Agent。

## 安装及依赖

插件需要 `tools`、`sessions` 服务，最后发布 `todoExecution`。ByClaw Integration 必需注入该服务；Cordis 依赖决定启动，不依赖 YAML 行顺序。缺少插件时 Integration 等待依赖，不会静默以无约束模式启动。

把本目录与 byclaw-integration 放入 DSH 的 plugins 工作区：

```sh
pnpm install
pnpm --filter @byclaw/dsh-todo-execution run build
pnpm --filter @byclaw/dsh-integration run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-todo-execution
```

已有 Integration profile 无需重复安装 Integration。没有接入 ByClaw 的宿主，在原生 todo 工具注册完成、Agent 接收输入之前调用 `ctx.todoExecution.bind(agent.ctx, agent)`。绑定幂等；未完成计划不能 unbind 切换团队模式。插件卸载及 Agent 作用域释放会移除注册，卸载即撤销约束。

```yaml
- id: todo-execution
  name: '@byclaw/dsh-todo-execution'
  config:
    maxStopCorrections: 3
    delegationTools: [subagent, workflow, ralph, call_subagent, byclaw_instantiate_template]
```

## 验证

```sh
pnpm --filter @byclaw/dsh-todo-execution run verify
node --import tsx/esm plugins/byclaw-integration/scripts/todo-execution-setup-verify.mjs
node --import tsx/esm plugins/byclaw-integration/scripts/member-todo-execution-verify.mjs
node --import tsx/esm plugins/byclaw-integration/scripts/todo-execution-native-verify.mjs
```

顺序执行与成员收尾回归使用 DSH 0.2.1-rc.2 的真实 ToolRuntime、原生 todo、Session、AgentLoop 与脚本模型验证；成员绑定验证覆盖新建、冷恢复、队长隔离和卸载。未运行真实模型渠道或生产前端端到端验证。本插件没有新增或修改模型可见工具描述和 schema，测试检查绑定前后的实际工具定义与顺序相同。
