# ByClaw 与 DeepSeek Harness 端到端集成设计

## 目标

为 ByClaw 聊天链路增加一个由系统参数控制的 DeepSeek Harness（DSH）Worker 路由，并让 `byclaw-integration` 插件把 DSH 的正文、思考过程、工具调用、工具结果和子 Agent 生命周期转换为现有 ByClaw 前端能够直接消费的事件。

本次交付还包括使用 `envs/229/.env` 启动本地 ByClaw BE、FE 和 DSH 源码，在《测试研发项目》中向 `@ByClaw研发专家团` 发送“让成员分别做下自我介绍”，验证从浏览器请求到 DSH 专家团执行再到前端渲染的完整链路。

## 当前状态

ByClaw BE 的普通聊天由 `RouteService.route()` 调用 Framework SDK。现有 `TargetAgentResolver` 根据资源 Worker 类型、会话恢复信息和用户编码得到目标 AgentType，随后 `GatewayClient.sendMessage()` 将消息发给 Worker。

BE 已有 `ByaiSystemConfigService.getDcSystemConfigValueByCode()`，能够按编码读取系统参数并处理环境变量替换。

`byclaw-integration` 已经具备以下能力：

- 注册 `BYCLAW_DSH` 和 `BYCLAW_DSH_<userCode>` 两个默认 AgentType；
- 消费 Framework SDK 的 `AskAgent`、`Resume` 和取消命令；
- 将 ByClaw 会话映射为持久 DSH 根会话；
- 根据授权资源将数字员工或专家团投影为 DSH 模板；
- 监听 DSH 会话事件并转发根回复、思考、工具和子 Agent 活动；
- 使用 AgentTeams 执行专家团任务。

现有插件把多类 DSH 活动封装成自定义 `contentType=3015` 事件，但 ByClaw FE 将 `3015` 解释为工具调用卡，期望的内容字段是 `title`、`input`、`output` 和 `status`。自定义 DSH 信封不能被当前 FE 正确呈现，因此需要改为现有 ByClaw 原生事件协议。

## 范围

### 包含

- BE 增加 `ENABLE_DSH` 系统参数编码及其路由判断；
- `ENABLE_DSH` 严格等于字符串 `1` 时，把普通 Framework SDK 聊天路由到 `BYCLAW_DSH_<userCode>`；
- 插件输出当前 FE 已支持的正文、思考、工具和状态事件；
- 保留并整合 `byclaw-dsh/plugins/byclaw-integration` 中已有未提交修改；
- 将插件源代码同步到 `deepseek-harness/plugins/byclaw-integration` 后从 DSH 源码启动；
- 在 229 运行数据库中创建或更新 `ENABLE_DSH=1`；
- 本地启动和真实浏览器端到端验证。

### 不包含

- 不修改 DeepSeek Harness 核心包；
- 不为 FE 新增 DSH 专用消息协议或专用渲染器；
- 不新增数据库迁移文件；
- 不修改 `deploy/middleware/initdb/`；
- 不提交账号、密码、Token、模型密钥或填充后的环境文件；
- 不顺带重构现有聊天、Framework SDK 或 AgentTeams 架构。

## 架构设计

### BE 路由开关

`RouteService` 在完成现有 `TargetAgentResolver` 解析后、调用 Framework SDK 前读取 `ENABLE_DSH`。

判断规则为：

```text
ENABLE_DSH != null && trim(ENABLE_DSH) == "1"
```

启用时，最终目标 AgentType 为：

```text
BYCLAW_DSH_<userCode>
```

未启用时保持现有目标，不改变 `BY_SUPER`、`BYCLAW_EXE_<userCode>`、`BYCLAW_CODE_<userCode>`、调试和恢复会话行为。

该覆盖只作用于已经进入 Framework SDK 的普通聊天。`INTERFACE` 和 `A2A` 在 `RouteService` 开头走独立路由，不受该开关影响。

最终目标必须在写入 `ctx.targetAgentType` 之前确定，使日志、沙箱重试判断和后续监听逻辑看到同一个目标。多泳道请求仍只发送一条 Framework SDK 消息到 DSH Worker，原有资源、专家团和泳道元数据继续放在 `gatewayParams` 中，由插件按入站资源信息执行。

### 系统参数运行数据

由于请求未指定迁移版本，本次不创建或修改版本化 DML。联调时通过现有系统参数管理接口或受控数据库连接，在 229 运行数据库中创建或更新：

```text
param_code  = ENABLE_DSH
param_value = 1
```

写入后清理或刷新系统参数缓存，确保 BE 立即读取新值。运行数据变更只用于目标环境，不写入 Git。

### DSH 插件事件投影

插件继续监听 DSH `session/event`，但向 Framework 数据流输出 ByClaw 现有协议。

| DSH 事件 | ByClaw 事件 | contentType | 内容与关联规则 |
| --- | --- | --- | --- |
| 根或直接目标 Agent 的正文增量 | `ANSWER_DELTA` | `1002` | 保持增量文本；同一连续段复用消息标识 |
| 根或子 Agent 的思考文本 | `REASONING_LOG_DELTA` | `1001` | 文本进入思考区域；使用所属会话状态节点作为父节点 |
| 工具开始 | `REASONING_LOG_DELTA` | `3015` | `messageId=toolCallId`；JSON 内容含 `title`、`input`、`status=_START_`；`objectType=tool_call` |
| 工具结果 | `REASONING_LOG_DELTA` | `3015` | 与开始事件复用 `messageId`；JSON 内容含 `output`、`status=_DONE_/_ERROR_` |
| 子 Agent 开始/完成/失败 | `REASONING_LOG_DELTA` | `3009` | `objectType=tool_call`；稳定会话消息标识；状态分别为 `_START_/_DONE_/_ERROR_` |
| 子 Agent 正文 | `REASONING_LOG_DELTA` | `1002` | 挂在对应子 Agent 状态节点下，避免混入根最终答案 |
| 待办计划 | `ANSWER_DELTA` | `2008` | 保留现有任务计划卡协议 |
| 用户交互 | `REASONING_LOG_DELTA` | `3014` | 保留现有问题表单协议和 Resume 关联 |

工具开始和工具结果必须使用同一个 `orderId`，以便 BE 的消息聚合与 FE 的工具卡归并逻辑把输入、输出和终态合并到同一节点。

DSH 会话 ID、父会话 ID、委派深度、原始事件类型和事件序号放进非展示 `metadata`。这些字段用于日志和诊断，不再占用 `3015` 的展示内容。

现有 `3016` AgentTeams 快照不作为本次 FE 主展示协议。专家团的可见执行过程由子 Agent 状态、思考、工具和正文事件表达；快照可继续作为诊断元数据或在确认不会形成未知前端消息后保留。

### 插件源代码同步与 DSH 启动

源码主维护位置为：

```text
/Users/chenxiaofeng/code/open/byclaw-dsh/plugins/byclaw-integration
```

DSH 源码运行位置为：

```text
/Users/chenxiaofeng/code/open/deepseek-harness/plugins/byclaw-integration
```

同步前分别检查两个目录的 Git 状态和差异。已有本地修改必须保留；只合并本次需要的文件，不使用覆盖整个目录的破坏性复制。同步后在 DSH 工作区构建插件，并通过 `web` profile 的 bundle patch 启用插件。

DSH 从 `deepseek-harness` 源码工作区启动，不修改 DSH 核心源码。`byclaw-integration` 的 `BYCLAW_DSH_BASE_URL` 环境覆盖指向本地 BE，同时 `USER_CODE=0027024710` 用于注册 `BYCLAW_DSH_0027024710` Worker。

## 本地启动设计

### 环境来源

BE、FE 和 DSH 都以 `/Users/chenxiaofeng/code/open/ByClaw/envs/229/.env` 为基础环境。

运行时只补充本地覆盖：

- `JAVA_HOME=/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home`；
- `USER_CODE=0027024710`；
- `BYCLAW_DSH_BASE_URL=http://127.0.0.1:8086`；
- 其他仅在本地模型或 DSH profile 确实需要时加入的非持久覆盖。

不复制秘密到仓库文件。进程日志不得打印数据库密码、Redis 密码、Framework Token、模型密钥或登录密码。

### 启动顺序

1. 确认 229 环境中的数据库、Redis 和模型依赖可达；
2. 构建和启动 BE，验证 8086 端口及应用就绪；
3. 构建和启动 DSH，验证插件资源同步成功且 `BYCLAW_DSH_0027024710` Worker 在线；
4. 启动 FE，验证 8000 端口及代理目标为本地 BE；
5. 再进行浏览器登录和业务测试。

按依赖顺序启动可以把 Worker 注册、模型解析或资源同步失败与 FE 展示问题分开定位。

## 错误处理

- 系统参数不存在、为空、包含非 `1` 值或读取为 `0`：保持原 Worker 路由，不报错；
- 系统参数读取服务异常：沿用现有 BE 错误传播和日志策略，不静默切换到 DSH；
- DSH Worker 未上线：Framework SDK 返回失败，BE 保留原有错误和重试处理；
- 插件首次资源同步失败：插件启动失败，Worker 不上线；
- DSH 工具失败：工具卡终态为 `_ERROR_`，结果中保留可展示错误文本；
- DSH 会话失败：发出对应子 Agent 或根状态失败事件，并让 Framework 任务失败；
- 浏览器端到端失败：先按 BE 路由、Redis Worker、DSH 会话、Framework 数据流、BE SSE、FE 归并和渲染的顺序定位，不通过跳过步骤制造假阳性。

## 测试设计

### BE 自动化测试

新增聚焦测试覆盖：

- `ENABLE_DSH` 为 `null` 时保留现有目标；
- `ENABLE_DSH` 为空或 `0` 时保留现有目标；
- `ENABLE_DSH` 为 `1` 时得到 `BYCLAW_DSH_<userCode>`；
- 带空白的 `1` 按标准化规则启用；
- 不同用户编码不会交叉路由；
- `INTERFACE` 和 `A2A` 路由不经过 DSH 覆盖。

测试优先放在可单测的目标解析函数或服务中，避免为验证一个字符串判断启动完整 Spring 容器。

### 插件自动化测试

扩展 `worker-verify.mjs` 或拆出聚焦投影验证，覆盖：

- 正文增量为 `ANSWER_DELTA/1002`；
- 思考文本为 `REASONING_LOG_DELTA/1001`；
- 工具开始和结果复用 `toolCallId`，并分别产生 `_START_` 与 `_DONE_/_ERROR_`；
- 子 Agent 状态使用 `3009`，子 Agent 正文挂在状态节点下；
- DSH 诊断字段进入 metadata；
- Resume、ask-user、计划卡和现有资源路由验证继续通过。

### 进程级验证

- BE 相关 Maven 测试通过；
- `pnpm --filter @byclaw/dsh-integration run verify` 通过；
- DSH `--dump-config` 包含启用的 `byclaw-dsh`；
- Redis Worker 注册信息包含 `BYCLAW_DSH_0027024710`；
- BE 日志显示消息目标为 `BYCLAW_DSH_0027024710`；
- DSH 日志显示收到对应 ByClaw `AskAgent` 和专家团执行过程。

### 浏览器端到端验收

使用提供的账号登录本地 FE，进入《测试研发项目》，新建会话并发送：

```text
@ByClaw研发专家团：让成员分别做下自我介绍
```

验收条件：

1. 请求由 BE 发送给 `BYCLAW_DSH_0027024710`；
2. DSH 插件识别并实例化 `ByClaw研发专家团`；
3. 团长调度配置成员执行；
4. 页面能看到成员执行状态、思考或工具卡，以及各成员的自我介绍；
5. 根回复完成且会话不持续加载；
6. BE 与 DSH 无未处理异常；
7. 页面刷新后已落库消息仍可正确显示。

如果模型自主行为没有让每位成员分别输出，先核对专家团资源配置和插件模板提示词；只有确认协议和调度链路正常后，才调整入站文本或提示词，不用伪造前端事件通过验收。

## 安全与回滚

账号密码只用于本地浏览器登录，不写入源码、设计文档、环境文件、测试 fixture 或命令历史中的持久脚本。

回滚顺序为：

1. 将 229 运行参数 `ENABLE_DSH` 设为 `0`，聊天立即恢复原 Worker 路由；
2. 停止 DSH Worker；
3. 如需代码回滚，仅撤销本次 BE 路由和插件投影改动，不影响已有插件工作；
4. 不删除用户已有 DSH 会话、插件缓存或 ByClaw 消息数据，除非另行获得明确授权。
