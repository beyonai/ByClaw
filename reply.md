有改，是受控的架构调整，不只是增加条件判断。

改造后的职责链为：Worker 协议适配层只解析 `orchestrator`；`app/business` 的 Runtime Provider 负责调用 BE 和映射资源；`RunIngressService` 只选择超级助手或专家团配置源并生成 Run 快照；`by-conductor` 保存 transport-neutral 的编排领域模型；`OrchestratorContextCompiler` 按类型选择完全独立的 Prompt/Context Pipeline；RunService、DelegationService 和 Connector 继续负责原有执行。

具体包括：

- 新增 `domain/orchestrator.ts` 和独立的 `domain/run-ingress-context.ts`，把原来放在群聊文件里的通用 Run 入站快照职责拆开。
- 新增 `app/business/orchestrator-runtime.ts`，BE 权限、Prompt、模型、成员获取不进入 Worker 或核心领域。
- 抽出 `app/business/agent-profile-mapper.ts`，超级助手 Catalog 和专家团成员共用资源到 AgentProfile 的映射。
- 新增 `OrchestratorContextCompiler`，超级助手保持原流水线，专家团走独立最小流水线并使用独立 Prompt。
- 工具开放策略集中到 `active-leader-tools.ts`，专家团只开放 `delegateAgent`。
- Run 快照增加专家团配置，持久化恢复时重新校验；Session binding 增加编排者隔离，但旧超级助手 binding key 不变。

刻意没改的是高风险执行架构：Run/Delegation 状态机、队列、lease/fencing、Connector、事件流、取消恢复和 Beyond-Token 短期凭证机制全部复用。这样获得了明确职责边界，同时降低原功能回归风险。
