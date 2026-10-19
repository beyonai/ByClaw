# byclaw-model-router

`@byclaw/byclaw-model-router` 根据任务意图和调用方提供的模型信息选择模型。它不读取 Redis，不管理模型凭据、endpoint 或协议适配器。`byclaw-integration` 读取配置、提供候选及精确解析接口，并将路由安装到 ByClaw 根 agent、委派员工和本地 AgentTeams 成员。

```sh
BYCLAW_MODEL_ROUTER_ENABLED=true
BYCLAW_MODEL_ROUTER_MODEL_IDS=redis-model-id-a,redis-model-id-b
BYCLAW_JEV_API_KEY=<Vercel AI Gateway key>
BYCLAW_JEV_BASE_URL=https://ai-gateway.vercel.sh/typesafe
BYCLAW_JEV_MODEL=typesafe-ai/jev
BYCLAW_JEV_TIMEOUT_MS=15000
BYCLAW_MODEL_ROUTER_MIN_CONFIDENCE=0.7
BYCLAW_MODEL_ROUTER_MAX_RESELECTS=2
BYCLAW_MODEL_ROUTER_RECOVERY_BUDGET_MS=30000
```

开关默认关闭。`BYCLAW_MODEL_ROUTER_MODEL_IDS` 是 Worker 部署明确允许的自动候选池；候选来自 Redis `byai:aimodel:config` 的相应记录。agent 原先绑定的模型（含入站模型覆盖）即使不在自动池内，也保留为它自己的失败备用；不能因此被 Jev 选给其他 agent。多用户具有不同模型权限时，应由接入方按用户提供候选，而不能共享部署池。

可在 Redis `instanceParam` 配置 `routingDescription`（用途、优势与局限）、`routingInputPrice`（每百万输入 token 的价格，未知则不填）和 `routingAccountId`（非秘密账号分组 ID）。工具/图片能力、上下文容量、输出限制和推理档位沿用实际模型配置。生成 profile 中现有的占位价格 0 不作为路由价格使用。

## 选择及失败恢复

### 对话输入框的模型选择

启用模型路由后，integration 通过 DSH 原有的模型目录与输入框右下角选择器提供 `Auto` 及配置池中的模型，无需修改 DSH 前端。Web profile 需包含官方 `@deepseek-ai/dsh-client-ui-model-selection`（标准 web-app bundle 已包含）。选择 ByClaw 数字员工后，没有显式选择记录的根会话默认保存为 Auto；已有的手动选择不会被覆盖。

- **Auto**：走 `byclaw-model-router` 自动选模与下述回退流程。菜单保持 Auto，不随每次实际选中的模型跳动。
- **手动模型**：固定根对话使用选中的模型和推理档位，跳过 JEV 选模及跨模型回退；原有同模型重试仍由 DSH 处理。
- 选择写入原生 `model/selection` 会话事件，重启恢复后仍生效；进行中的请求保持当前快照，修改从下一次正常提示词组装生效。普通会话的 Auto 回退到切换前最后选择／使用的真实模型（包括推理档位）；首轮尚无请求时使用会话初始真实模型。员工会话始终优先回退到员工配置的模型。
- 数字员工／专家组选择由 `byclaw-agent-router` 独立处理；根会话手动选模不传给委派员工或团队成员。

`byclaw-agent-model-router` 指上述两层路由组合，不是第三个插件。普通会话和员工会话均可使用 Auto。普通会话切换前的真实模型通过 `byclaw/model-router-fallback` 事件保存，Auto 生成记录及重复选择 Auto 不会覆盖它；退出 Auto 手动选模后，再切回 Auto 会采用新的真实模型。非 Redis 模型只作为本会话的精确回退，不进入 JEV 自动候选池。旧会话若只留下 Auto 且没有可恢复的真实模型，仍可从配置池自动选模，但没有本会话回退模型；日志会显示 `selection: null`，不会把虚拟 Auto 发送给生成接口。

模型列表还会保留 DSH 已注册的其他模型。模型配置池在启动时发布到原生目录，修改池后需要重启。

任务开始时先过滤工具、图片、上下文/输出容量等硬要求，再让 Jev Choice 选择。单个合格候选无需辅助调用。Jev 超时、不可用或低置信度时使用该 agent 配置的模型。候选解析严格按选中的 ID，不会暗中换成 Redis 全局默认。

生成失败先遵循已有的有限同模型重试策略，随后依次：尝试当前 agent 配置的模型；它也失败后排除已失败模型并再让 Jev 选择。若初选已是配置模型则不重复尝试同一项。鉴权、限流或额度错误会排除同账号的后续自动候选。无候选、重选次数耗尽、恢复预算耗尽或取消时终止。通用参数错误不触发换模。

重选后若候选的配置已失效，会记录 `MODEL_UNAVAILABLE`、排除该候选，并在剩余重选次数内继续选择。例如 A 失败 → 配置模型 B 失败 → JEV 选 C 但 C 已删除 → 再选剩余模型 D。每次选择都计入同一个次数上限；JEV 本身不可用或低置信度时结束本次恢复，不对同一候选池反复请求。

每个 agent、每个任务独立保存回退模型和失败集合；正常工具步骤保持选择。恢复只重试失败模型请求，保留已完成的工具结果。辅助请求和决策记录到 Session 的 `byclaw/model-router` 事件，不记录生成凭据或上游错误正文。发送给 Jev 的意图包含当前被接纳的输入和近期文本上下文；图片只作为能力要求，不上传图片给 Jev。上下文容量检查使用包含提示词/工具的保守字符估算；精确 token 检查仍由 DSH/供应商执行。

ByClaw 输出为追加协议。当前请求已输出文本或 reasoning 后，停止透明重试和换模，避免把两个模型的回答拼接；部分输出后的产品策略仍待确认。工具调用在成功请求完成后才执行，请求恢复保留此前工具结果而不会自动重放旧调用。新模型仍可能主动再次提出相同业务操作，写操作的业务幂等由工具保证。

## DSH 兼容性

### 运行日志

INFO 日志默认开启，无需额外环境变量。搜索 `[byclaw-model-router]`：`startup` 显示开关、Gateway 入口及是否配置 key；`bound` 表示路由已安装到 agent；`jev_request` 包含发送的意图、约束、失败记录及候选；`jev_response` 包含校验后的选择、置信度、概率和 token 用量；`decision` 显示最终模型 ID、provider/model 及选择方式（`jev`、`single`、`agent-configured` 或 `manual`）。`stopped` 表示恢复结束或已有部分输出。使用 `routingId`、`sessionId`、`turn` 和 `jevRequest` 关联日志。

`[byclaw-integration] routers` 同时报告两个开关及自动模型池。日志包含任务正文与候选描述，但不打印 Gateway key、请求鉴权头、业务模型凭据或未经校验的上游错误正文。无效响应记录失败原因，不将原始错误响应直接写入日志。

实际换模要求 DSH 的 `agent/request-error` 支持 `{ kind: 'retry', reassemble: true }`，用新模型重组提示词、工具快照和 runtime context，开始新请求序列，保留该步骤已接纳的用户输入和此前工具结果。

本仓库的 `Dockerfile` 和 `Dockerfile.extensions` 已接入 [`prepare-dsh-model-routing-runtime.mjs`](../../scripts/prepare-dsh-model-routing-runtime.mjs)：只在镜像构建的 `/workspace` 中对 **DSH 0.1.5-rc.2** 应用兼容补丁，校验版本及源码形状后重建 `dsh-agent` 和 `dsh-agent-loop`。两个包同时进入 profile 本地依赖覆盖，源码及编译产物也带入最终镜像，保证 `tsx` 源码入口与普通包入口一致。版本或形状不匹配会停止构建；脚本不自动寻找或修改旁边工作区。

启用模型路由后，plugin 和 integration 会检查实际 `ctx.agentLoop` 服务的 `byclawRequestReassembly` 能力，而不只检查某个已安装包。未支持时在启动阶段报 `BYCLAW_MODEL_ROUTER_REASSEMBLY_REQUIRED`；请求阶段仍保留旧组装保护。旁边 `0.1.1-rc.2` 的本地运行副本不属于兼容范围，不能直接在那里打开此开关，需要使用本仓库的兼容镜像。路由关闭时保留原有绑定。

若现有基础镜像不是目标版本，先按 `Dockerfile.base` 构建固定版本基础镜像，再构建扩展镜像：

```sh
docker build -f Dockerfile.base -t byclaw/dsh-base:model-router .
docker build -f Dockerfile.extensions --build-arg BASE_IMAGE=byclaw/dsh-base:model-router -t byclaw/dsh:model-router .
```

显式的兼容脚本入口为 `node scripts/prepare-dsh-model-routing-runtime.mjs --workspace /path/to/disposable-dsh-build`，只用于你选择的可丢弃构建副本；追加 `--check` 只检查是否完整应用，原版未应用时退出非零。修改源码后还须像 Dockerfile 一样重建和打包，单独跑脚本不能代替交付新运行时。

每次失败恢复分别使用恢复选路预算，约束该次备用模型解析或 Jev 重选；模型生成时间和同模型重试退避不消耗此预算，避免配置模型响应较慢后无法继续选择。整个任务由重选次数上限和供应商调用时限约束。环境变量修改后重启 Worker。

离线测试：

```sh
node --test plugins/byclaw-model-router/tests/*.test.js plugins/jev-client/tests/*.test.js plugins/byclaw-agent-router/tests/*.test.js scripts/prepare-dsh-model-routing-runtime.test.mjs
```

Gateway 固定示例联调：`node plugins/jev-client/scripts/gateway-smoke.mjs --live`，参见[共享客户端说明](../jev-client/README.md)。此联调只检查 Gateway 鉴权和 Choice 协议，不调用业务模型。

在已应用本仓库兼容补丁并构建的 DSH workspace 中，可运行 `node plugins/byclaw-model-router/scripts/dsh-verify.mjs` 验证真实 agent loop、工具结果保留和完整回退，脚本先检查实际服务能力。源码验证使用 workspace 的 tsx hook 与 `TSX_TSCONFIG_PATH`；`DSH_TEST_SOURCE_ROOT` 可指定该 workspace，`DSH_TEST_BYCLAW_BINDING=true` 可额外验证 integration 的自动 Agent 绑定（需先构建 integration）。此验证使用脚本模型和模拟 Jev 响应，不调用外部模型，不依赖旁边工作区的未提交改动。
