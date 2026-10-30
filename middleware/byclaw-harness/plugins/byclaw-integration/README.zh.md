# @byclaw/dsh-integration

[English](README.md) | 中文

`@byclaw/dsh-integration` 是 DeepSeek Harness（DSH）接入 ByClaw 的独立插件。它不修改 DSH 或 ByClaw 源码，通过 DSH 插件扩展点、`@byclaw/by-framework` 和独立的 AgentTeams 插件完成资源同步、模型装配、消息入站及多 Agent 调度。

## 文件修改事件

文件修改工具通过 `3017` 发送版本化 `edit_diff` 事件。开始、成功和失败帧复用同一个 `eventId`，前端会更新同一张实时 Diff 卡片。成功修改在当前回合按路径聚合；回合结束后写入 UserFS 的 `.file_changes/<sessionId>/files/`，并通过既有 `3016 file_changes` 事件发送一次净变更汇总。

`edit_diff` v1 的核心字段为 `phase`（`running|applied|failed`）、`operation`（`edit|write|git`）、`sessionId` 和 `files`。每个文件携带路径、变更类型、前后文本、增删行数和二进制标记。

## 安装到 DSH

该包是从 DSH 源码检出目录构建的私有工作区包，不发布到 npm registry。把本目录放在 `plugins/byclaw-integration`，先安装 AgentTeams，再构建两个本地包并加入目标 profile：

```sh
cd /path/to/deepseek-harness
pnpm install
pnpm --filter @byclaw/dsh-agent-teams run build
pnpm --filter @byclaw/dsh-todo-execution run build
pnpm --filter @byclaw/dsh-integration run build
dsh plugin --profile web add /path/to/deepseek-harness/plugins/agent-teams
dsh plugin --profile web add /path/to/deepseek-harness/plugins/dsh-todo-execution
dsh plugin --profile web add /path/to/deepseek-harness/plugins/byclaw-integration
dsh --profile web --dump-config
```

把仓库根目录的 [`.env.example`](../.env.example) 复制到 DSH 启动目录，填写部署值，并确保生成的 `.env` 不被 Git 跟踪。包内 patch 会启用该插件。致命配置错误或核心 Redis 连接失败时，插件会记录完整初始化错误、释放已打开的资源，并让 DSH 宿主继续运行；本次 ByClaw runtime 保持停用。资源 snapshot、专家团运行配置、模板代次或 Skill 下载失败则走下文的降级资源路径，不会阻止 Worker 注册。

## 运行结构

普通 todo 计划也支持从步骤打开子代理：`ordinary-task-plan.ts` 回放父会话的 `todo/write` 和 `subagent/catalog`，把创建记录关联到当时唯一的进行中步骤，输出稳定的计划／步骤标识及真实 `child_turn` 执行记录。子代理开始和结束回合时重新投影，冷恢复时从只读持久化日志重建；使用 `plan` 事件进入后端已有的会话／消息绑定链路。没有唯一进行中步骤时不推断归属；修改或重排步骤会建立新计划，避免旧执行记录串到新步骤。前端沿用任务标题与历史轮次入口，标题栏不恢复子代理数量按钮。检查：`node --experimental-transform-types scripts/ordinary-task-plan-verify.mjs`。

同一子代理收到新的人工或主代理指令时，新轮次不自动归入最初创建它的步骤；缺少新步骤绑定时保留“暂无执行记录”占位，旧轮次仍可查看，默认入口不会冒充最新记录打开旧消息。异步结算等内部唤醒仍保留原步骤关联。

没有显式 todo 计划、直接实例化普通子代理时，也根据真实本地委派记录展示任务执行计划：每个子代理一项，标为“子代理任务”，不编造主代理尚未制定的业务步骤。状态跟随子代理实际回合开始／结束，保留精确历史轮次；只有创建记录但尚无执行回合时显示待执行。外部执行、未知类型及团队成员不生成这种兜底计划，后续写入显式计划时以显式计划为准。子代理的运行状态也在真实 `turn/start` 时发布，不再要求初始消息必须来自人工用户。

插件注册 `BYCLAW_DSH` Worker，并把 ByClaw 授权资源投影为两类可复用模板：

- 数字员工：`byclaw-employee-<resourceId>`，调用时实例化一个普通 DSH 子 Agent，不创建团队。
- 专家团：`byclaw-group-<resourceId>`，调用时先实例化专家团自己的团长 Agent；团长再通过 `byclaw-team-<resourceId>` 创建本次任务的 AgentTeams 运行团队。

未指定目标时，主 Agent 负责发现资源和选择模板，但不代替专家团团长。直达时，所选数字员工或专家团团长直接组合到入站 DSH 根 Agent 上。同一 ByClaw 会话和专家团模板复用一个运行团队，新任务追加到同一活动面板；只有用户明确要求结束或放弃团队时才调用 `agent_teams_delete`。根会话和团员会话持续复用，因此 ByClaw FE 始终看到与团队成员一一对应的会话层级。

沙箱退出后，Worker 接回原命令时会先读取所属团队的持久状态，恢复未结束任务的等待门控；不要求团长重新调用 `agent_teams_start`。团长的临时进度答复不会提前关闭原消息流，只有任务收敛、成员结束运行且团长完成汇总后才收尾。草稿、已停止、归档、等待用户及其他会话的团队不会因此重新启动。此机制保留的是命令和输出关联，不会复活已被杀死的后台进程；旧工具结果缺失时仍须报告结果未知。回归入口：`node scripts/cold-team-recovery-verify.mjs`。

```text
ByClaw 入站
  -> BYCLAW_DSH Worker
  -> 默认：DSH 主 Agent -> 模板
  -> 指定 agent_id 或 @资源：对应模板作为 DSH 根 Agent ->（专家团）AgentTeams 团员 Agent
```

入站消息指定结构化 `agent_id` 时，插件先解析授权目录，并把对应模板直接组合到入站根 Agent 上。因此业务指令不经过主 Agent 的路由／模型回合，也没有模板子 Agent 的结算中转。`agentId`、`agent_code`、`agent_name` 及其 camelCase 写法，不参与目标选择或一致性校验。没有结构化 ID 时，正文中的唯一且无歧义的 `@资源名称` 或 `@资源编码` 也可选择目标，并会在投递前移除匹配文本。目标不存在、未授权或正文歧义时，会在执行前失败；未指定目标时仍使用主 Agent 的原有路由。每个根 Agent 的模板绑定保持不可变；同一 ByClaw 会话后续切换数字员工时，插件为新模板选择独立、可恢复的根实例，切回原员工则复用其原实例。首个根实例保持原会话 ID，额外实例使用会话与模板组成的稳定 ID，所有实例仍归属同一外部会话和工作目录。专家团团员仍作为 AgentTeams 子 Agent 运行，其事件异步唤醒团长，不进行轮询。

团队快照按当前根 Agent 及已发现的后代会话限定团长范围，在读取子 Agent 活动和邮箱之前过滤无关团队；历史团队也使用同一范围。单员工对话不会枚举其他团长的子会话或读取其邮箱，输出结束时仍等待本会话必要的事件与快照收尾，避免项目内历史团队数量拖慢流终态。未指定范围的 AgentTeams 活动面板仍展示全部团队。

收尾先等待团长空闲并排空输出与团队快照，再复查团长是否被成员通知重新唤醒；若已开始新一轮，则继续等待其真实结束并转发该轮输出，之后才关闭命令，避免终态之后遗留运行中投影。

团队／模板等待器的 5 分钟是无进展巡检间隔，不是任务总时长上限。根 Agent 和成员的会话事件（包括流式输出）、运行状态变化及团队快照进展都会续期。连续无进展时，插件通过 DSH 持久化 inbox 向当前团队的实际团长发送内部巡检消息，要求检查一次成员与任务、处理阻塞或重试，并在完成后给出最终答复；嵌套团队通知其子团长，尚未形成团队时通知当前响应 Agent。长时间运行本身不判定失败，也不关闭原命令和消息转发。未消费的巡检消息去重；检查失败保留命令并在下一间隔重试。成员仍在输出时，团长本轮结束不会提前关闭团队命令。取消、正常收尾和插件关闭都会停止巡检。

团队在后台运行时，设置 `BYCLAW_DSH_BUSY_ENTER=steer` 后，发给正在执行的团长的追问会进入下一个模型步骤，无需等当前轮次空闲；默认的 `queue` 会等团长当前轮次结束。团长已空闲时，排空此前输出后再启动独立的追问轮次。追问答复使用独立的消息与 trace；插话被接纳前的输出和成员输出仍归属原任务。追问携带的附件和资源在插话被接纳的步骤注入响应团长，后台成员保留原任务上下文。此设置也控制 DSH 原生输入框在忙碌时的 Enter 行为。

Web 页面还需要 ByClaw 后端在 `rootActive=false` 且 `acceptingInput=true` 时允许新消息，并分别保留每条 trace 的输出直至各自完成。如果后端只要团队 `running` 就拒绝新消息，请求会在到达插件前被拦截。

## 动态资源与 Skill

插件启动时只读取当前用户授权范围内的 Redis 目录快照，不生成员工模板、不解析员工模型、不请求专家团运行时，也不展开专家团成员。随后启动授权与资源监听及 Worker。缺失或格式错误的快照逐条记录并跳过；目录读取失败不阻止 Worker 上线，但实际执行必须重新通过授权和目标资源校验。运行期间在以下时机刷新目录或按需准备目标：

- 调用 `byclaw_list_resources` 或实例化模板前；
- 当前用户的授权 Hash 发生变化时；
- 收到 Redis 频道 `byai:pub:dig_employee_change` 支持的资源变更时。

当前 `USER_CODE` 先通过 `SHARE_BFM_USER_CODE_<USER_CODE>` 映射到内部用户 ID，`USER:RESOURCES:AUTH:<userId>` 是资源发现的唯一授权来源。插件只解析其中的 `DIG_EMPLOYEE` 授权，并发读取对应的 `DIG_EMPLOYEE_<resourceId>` snapshot；授权专家团声明了额外成员时，只按成员 ID 补读这些 snapshot。即使当前 snapshot 不可用，已授权的专家团和成员 ID 仍保留在监听范围内，因此后续 CREATED 或 UPDATED 事件可以恢复资源。目录发现不调用 `discoverMine` 或 `findDetailsById`，也不扫描全局 `DIG_EMPLOYEE_*` key。Redis snapshot 提供员工与专家团的基础内容；专家团提示词、模型、有效成员和配置版本仍来自 `orchestrators/resolve-runtime`。运行时成员引用不可用员工时，只跳过对应专家团。Skill 版本和压缩包仍通过 ByClaw BE 获取。

Redis 的 `notify-keyspace-events` 支持时，授权监听会订阅当前 Hash 的 keyspace pattern，并始终保留轮询兜底。授权 key 暂时缺失时保留最后一次成功代次；Hash 存在但为空则确认全部授权已撤销。资源频道接受 `DIG_EMPLOYEE_CREATED`、`DIG_EMPLOYEE_UPDATED`、`DIG_EMPLOYEE_DELETED` 和 `DIG_EMPLOYEE_SKILLS_SYNCED`，只让直接授权 ID 或授权专家团成员 ID 的更新进入队列，按 ID 合并一个 debounce 窗口内的事件，使 DELETE 优先，并丢弃旧 `changedAt` 事件。授权与资源信号共用同一串行同步队列。

info 日志会记录监听频道、keyspace／poll 模式、授权信号、资源 ID／type／`changedAt`、被忽略的旧事件或未授权事件、入队批次数量和刷新完成；不会记录授权请求头、Redis 凭据、资源正文、Prompt 或 Skill 内容。

目录查询与模板投影分离：`byclaw_list_resources`、路由和变更监听只刷新 Redis 元数据。首次实际使用员工时，只读取该员工；首次使用专家团时，读取该团及必要成员，并调用该团的 `resolve-runtime`。每个用户上下文独立缓存已准备模板的内容与版本，同目标并发请求串行合并，版本未变时跳过重复投影。投影仍使用独占代际协调器原子发布，保留当前上下文已准备且仍获授权的其他模板及 Skill 视图；目标准备失败不会替换现有代次。执行前和投影完成后复核权限，撤权或版本变动拒绝执行，不能用旧模板回退绕过。下一次成功投影清理撤权产物，目录和执行权限不等待文件清理。卸载会拒绝新请求并排空已接收工作。

Skill 同步先读取远端版本；本地 `code + version` 一致时直接复用缓存，签名下载 URL 的刷新不会触发重复下载。只有版本变化才下载 ZIP；超时、限流和服务端 5xx 会有限重试。默认采用降级语义：单个 Skill 最终失败时记录 error、从本代员工/成员模板中跳过该 Skill，并继续启动 Worker。默认联调 profile 还会把投影并发限制为 `2`，把单次超时设为 15 秒且不重试，避免冷启动并发下载压满 Hub。显式设置 `allowSkillSyncFailure=false` 时会拒绝发布本次暂存代并保留上一代缓存，但 Worker 仍会使用可用资源继续启动。

数字员工 Persona 投影遵循 ByClaw 的指令归一化规则：`relPrompt` 优先于 `corePersonaDefinition`，嵌套 JSON 提示记录保留标题，`ability`、`processingFlow` 和 `coreCompetencies` 分别形成独立章节，并在单数字员工与专家团成员提示词中各渲染一次。专家团团长模板先加入不可被覆盖的 DSH 与 AgentTeams 编排、附件、失败处理和结算规则，再追加经授权的 `resolve-runtime` 业务提示词。刷新还会移除遗留的 `byclaw-group-*` AgentTeams 适配器，同时保留无关模板。

数字员工 Skill 按 `baiying-enhance` 的下载语义同步到 `agentTemplateDir/byclaw-skills`。携带凭据的资源目录和 Skill 请求仅访问所配置 `baseUrl` 的同源地址，并禁止自动跟随重定向。插件对原有 Skill 注册表的 `snapshot/list/get` 增加 Agent 作用域视图；DSH 原生 `tool-skill` 仍通过 `skill-catalog` 向上下文注入元数据，并使用标准 `skill` 工具按需加载正文，无需修改 DSH 源码。

开启 `workspaceOnToolEnvironment`（共享 DSH 宿主）时，模型的命令在独立的工具环境中执行，那里看不到本机的 DSH 家目录。因此展示给模型的每个 Hub Skill 目录、以及专家成员的 Skill 副本，会被复制到那里的用户目录（`<byRoot>/.byclaw/skills/<code>`、`<byRoot>/.byclaw/member-skills/...`），并以该路径告知模型；Skill 正文仍由本机提供。复制排在工具环境门面中，等工具环境连上后执行，加载上下文不会因此启动它；副本中的摘要文件使内容未变的目录不再重复复制。成员访问控制把这些路径换回其来源的本机副本再检查。

运行中的数字员工（直达根 Agent、委派模板和 AgentTeams 成员）保留完整的 DSH 原生目录，包括全局、项目、用户、preset 以及插件注册的 bundled Skills，并在其上叠加 **部署内置 Skills + 当前 Redis 关联 Skills**。普通主 Agent 保留原有目录并加入部署内置 Skills。内置目录按 `builtinSkillDir` → `BYCLAW_SKILLS_DIR` → 仓库 `builtin/skills` 解析，只读取一级技能目录中的 `SKILL.md`；Dockerfile 已设置 `/opt/byclaw/builtin/skills`。支持多行 YAML 和标准 invocation 标记。同名时员工关联资源覆盖部署内置资源，部署内置资源覆盖 DSH 原生条目。

Watch 收到员工或关联技能更新后刷新目录并使准备缓存失效，不全量初始化员工。员工 Skill 视图在每次查询时检查当前关联，包括最初没有 Skill、后来新增关联的员工；空 `relSkills` 会撤销关联。新的 Web 根会话重新检查目标定义，不复用旧会话的准备结果。内置 Skill 在插件启动时读取，更新镜像资源后需重启。

这控制的是运行时 Skill 目录和标准加载入口，不是文件系统沙箱。已发出的模型请求与历史消息不会被删除；新的目录及标准加载反映撤销状态，版本变更提示要求不再依赖旧正文。冷态历史会话尚未激活时，Web 技能选择菜单可能仍显示 preset 目录；恢复 Agent 后，实际模型上下文使用上述员工视图。

`byclaw_list_resources` 只向主 Agent 返回路由所需的 `id/code/name/description/template_id/invocation`，专家团额外返回精简成员姓名和角色。子 Agent 的 Skill、工具、Persona、模型和执行参数不会进入路由表；调用 `byclaw_instantiate_template` 后，插件再从本地模板为该 Agent 动态加载这些运行资源。

## 动态模型

`BYCLAW_REDIS_MODEL_ENABLED` 为所有经本插件入站或实例化的 Agent 选择运行态模型来源。该变量默认开启；未设置、空值、`true`、`1`、`on` 或 `yes` 都会启用 Redis 模型解析。开启时：

- 主 Agent：每次 ByClaw 入站时读取 Redis 当前唯一默认 LLM。
- 单数字员工：优先使用员工 `prologue.modelId`，未配置时使用默认 LLM。
- 专家团团长：使用专家团运行配置中的模型 ID。
- 专家团团员：使用对应数字员工的模型 ID，未配置时使用默认 LLM；创建团队时冻结本次运行所用 provider/model。

模型目录来自 Redis Hash `byai:aimodel:typelist` 的 `LLM` 字段，模型连接配置来自 `byai:aimodel:config`。每个模型映射为唯一 provider `baiying-m-<instanceId>`，支持 Anthropic Messages、OpenAI Completions 和 OpenAI Responses。加密鉴权在内存中解密，密钥、Token 和请求头不会写入模板、AgentTeams 文件或 DSH 会话事件。

启用 Redis 模型解析时，按“当前配置 -> 最后一次成功绑定 -> 插件配置的 `provider`/`model`”降级；默认项不唯一、模型缺失或配置无效会在最早可判定位置报错，不静默选择任意模型。

设置 `DSH_LLM_LOG=info`，或设置插件配置 `llmRequestLogLevel: info`，会在每次动态 ByClaw 提供方请求发出前写入一条安全审计记录。记录只包含提供方路由、模型、协议、适配器调用上的推理档位，以及 OpenAI Completions、OpenAI Responses 或 Anthropic Messages 最终 payload 中经过白名单筛选的思考控制字段。调用档位可能已经包含 DSH LLM 服务物化的默认值，因此并不表示用户明确选择了该值。消息、系统提示词、工具、请求头、端点、Token 和鉴权值都不会被检查或记录。默认值为 `off`；显式插件配置会覆盖 `DSH_LLM_LOG`，且不会读取或校验该环境变量。审计失败不会修改 payload 或阻止请求发送，已有的 pi-ai `onPayload` 回调也会保留其替换 payload 和错误行为。

`false`、`0`、`off` 或 `no` 会关闭 Redis 模型解析。此时主 Agent、数字员工、专家团团长和专家团团员全部使用本地配置的 `provider`/`model`；资源中的模型 ID 不参与执行，插件也不会读取 Redis AI 模型 Hash 或注册 ByClaw 动态模型路由。关闭 Redis 模型但没有同时配置两个本地字段，或传入其他开关值，都会导致插件启动失败。

## ByClaw 消息映射

- 入站支持 `extra_payload.agent_id`，按当前用户授权目录匹配数字员工或专家团；数字员工只允许当前用户直接授权的员工，专家团匹配当前用户授权的专家团。`agentId`、`agent_code`、`agent_name` 及其 camelCase 写法，不参与目标选择或一致性校验。没有结构化 ID 时，正文中的唯一 `@资源名称`／`@资源编码`（忽略大小写）可选择目标，纯数字 `@` 不作为名称别名，匹配文本会从任务中移除。目标不存在、未授权或多个正文目标会在执行前拒绝。未指定目标仍走主 Agent。
- ByClaw 对外的 DSH 根会话 ID 与入站 `session_id` 完全一致，续聊和跨系统追踪使用同一个标识。直达时，这个根 Agent 本身就是所选模板实例；同一会话再次指定同一目标会继续原上下文，尝试把在线会话改绑到其他模板则会被拒绝。日志中的 `🎯 入站直达` 和 `scope=direct-root` 可用于确认没有经过主 Agent 的 LLM 回合。
- ByAI 入站可通过 `extra_payload.cwd` 指定新建 DSH 根会话的绝对工作目录；未提供时使用插件 `workspace`。当配置的工作目录以 `/by/projects` 结尾时，插件使用对应的 `/by` 根目录；容器部署继续使用 `/by`。DSH 的 `SessionHeader.cwd` 是权威源码工作目录，根会话不可变身份与模板绑定存放在插件自有的 `byclaw_sessions` storage domain 中；插件不再向 DSH 会话日志追加任何 ByClaw 自定义事件。
- 业务指令保持为未经改写的 `source: user` 消息。`plugin:byclaw-context` 分为会话级和每轮级两层：会话级声明当前用户、项目工作目录、`.sessions/<sessionId>` 会话根、`.shared` 共享根及默认交付目录；每轮级只同步语言、`project_info`、文件附件元数据、`resource_list` 和连接器可用性。`channelExtension`、`groupChat`、multi-agent lane 元数据及认证 Token 不进入该上下文。独立报告、清单和导出文件默认写入当前 `.sessions/<sessionId>`，源码修改仍写入 `cwd`。持久消息按会话和 `messageId` 去重，AgentTeams 团员继承同一命名空间，同时保留独立的 DSH 会话 ID。

### 修复遗留会话日志

修复持久化目录前先停止 DSH。先 dry-run 查看逐文件统计，确认后再执行写入：

```bash
byclaw-repair-legacy-session --dry-run /path/to/dsh/session-persistence
byclaw-repair-legacy-session --apply /path/to/dsh/session-persistence
```

命令保留所有记录，只为遗留的 `byclaw/session-workspace` 和 `byclaw/root-binding` 事件信封补 `ignorable: true`。apply 模式会先验证同目录临时文件，保留带时间戳的备份，再原子替换原文件；重复执行不会再次改写。
- 每条 `AskAgent` 入站会按顺序输出终端可见的生命周期日志：收到命令及其标识；继承的 ByClaw 会话命名空间、DSH ID、实际 `cwd` 和根／委派作用域；新建、恢复或继续会话；不含密钥的模型解析信息（`sourceModelId`、provider、model、protocol 和解析来源）；携带完整指令的任务启动。数字员工根 Agent、专家团根 Agent 或普通委派模板子 Agent 完成组合时，另输出一条日志，列出该模板有效的内置及关联 Skill 名称和本地路径。插件不会额外写入登录授权、Redis 密码、模型端点或模型密钥；由于完整指令可能包含敏感内容，运维方必须把这些日志作为对话数据管理。
- DSH 根 Agent 或入站直达 Agent 的正文 -> `answerDelta/1002`；委派子 Agent 的正文以 `reasoningLogDelta/1002` 挂在自己的状态节点下，不混入最终答案
- DSH 思考过程与注入上下文 -> `reasoningLogDelta/1001`
- 工具开始与结果 -> `reasoningLogDelta/3015` 的状态化工具卡，使用 `objectType=tool_call` 和同一个工具调用消息 ID；JSON 内容遵循当前 FE 的 `title/input/output/status/description` 结构
- `ask_user_question` -> `contentType=3014` 的结构化 ByClaw 提问卡片；`ResumeCommand` 回填并唤醒原调用
- `todo_write` 与兼容工具名 `task_plan` -> `todo/write` 会话事件 -> `contentType=2008` 的任务计划卡片；计划事件使用 `<入站消息ID>:plan`，并把入站消息 ID 作为 `parent_message_id`
- Agent Teams 的计划使用稳定 `team:<teamId>` 标识，并携带任务负责人、attempt 及真实执行会话轮次。成员会话复用时，后端为每轮映射独立消息供历史定位；团长自执行记录使用当前 ByClaw 入站消息。未建立真实执行绑定的旧任务或外部 Worker 任务不推断为最新成员会话。
- 子 Agent 创建、运行、等待、完成或失败 -> `reasoningLogDelta/3009` 的状态化节点；子 Agent 的思考、正文和工具事件都挂在该节点下
- DSH 会话 ID、父会话 ID、委派深度、原始事件类型和序号只进入诊断 metadata，不再占用工具卡展示内容
- Ask 请求成功后，将选中的最终回复正文放入 `AgentTaskResult.content`，由 by-framework 在完成信号之前发送一条 `finalAnswer/1002`。答案仅取负责回复的 Agent 在正常结束轮次的最后一个 Step 中已结算、未中断且不含工具调用块的 Assistant 文本。
- 未提取到最终答案时保持 `content: ""`。原有 `answer` 聚合和历史正文回退继续供调用方使用，但不填入 `content`；Resume 不另发最终答案。模型、语音和会话执行失败在关闭流之前发送带 `_ERROR_` 状态的可见错误；工具环境或文件系统初始化失败使用 `RUNTIME/TURN_EXECUTION_FAILED`，原始异常仅记录在服务端。取消操作不发送运行失败提示。

入站会话 ID 支持非空字符串或正的安全整数，在路由、交互匹配和输出时统一为字符串，会话路由覆盖字段同样处理。超出 JavaScript 安全整数范围的数字 ID 会被拒绝，上游必须将这些 ID 作为字符串发送。

## 会话扩展

`byclaw/session-opening` 向独立管理工作的监听器通知根会话开启或路由请求。每个 header 的首次请求会同步认领监听顺序。普通根会话复用创建流程已有的新建、恢复或复用结果，路由请求的 header 状态查询及监听器通知则作为受管理的后台任务运行。内置群聊监听器排入后台工作后立即返回，正常会话不等待监听器专用的存储查询、监听器、模型分类或文件写入；监听器失败只记录日志，不拒绝用户输入。判定以 `command.header.sessionId` 为准，与 `byclaw_root_session_id` 或内部 Agent ID 无关：只有首次开启且存在 `extraPayload.groupChat.executionId` 时才分类，已有活动会话或持久化会话不参与分类。后台工作在模型调用前将 `{ "schemaVersion": "1" }` 原子写入 `/by/.sessions/<header sessionId>/.byclaw/session-opened.json` 以认领首次开启，包括不带 `groupChat` 的请求，避免后续补带参数时触发分类。该记录在进程重启后仍有效，只有成功认领的 Worker 发起分类。

满足条件的请求通过当前用户配置的默认模型发起独立、无工具的分类调用，然后原子发布 `/by/.sessions/<header sessionId>/.byclaw/group-chat-disposition.json`。文件可能在正常会话返回最终答案之后才出现。JSON 包含 `schemaVersion: "1"`、从 `executionId` 复制的 `dispatchId`，以及只能选 `TASK` 或 `CHAT` 的 `kind`。解析后的 JSON 为 `kind: "TASK"` 时保留非空 `taskName` 及可选的非空字符串 `ackText`；任务名缺失或无效时使用用户请求正文兜底。解析成功但没有有效 kind 时判为 `CHAT`。JSON 解析失败时，响应包含大写字面值 `TASK` 就判为 `TASK`，否则判为 `CHAT`。模型返回的额外字段及非字符串接收语会被忽略，`CHAT` 不包含任务字段。提示词引导生成或修改交付物、可能耗时较长的信息收集请求判为 `TASK`，普通问答和身份询问判为 `CHAT`；身份问题仍由正常会话回答直接自我介绍。分类文本不进入会话输出，`groupChat` 中的凭据不进入辅助分类提示词。

仅在分类流程中，`extraPayload.groupChat.originalContent` 只要已定义就优先使用，包括空值；未定义时才从 `command.content` 提取问题，正常会话 command 不会被修改。存在 `groupChat.groupHistoryPath` 时，插件通过宿主的 `/by` 适配方法解析路径，读取当前用户 ByClaw 根目录内的普通文件，再向无工具的分类模型发送 `{ userRequest, groupHistory: { path, available, content, truncated } }`。模型同时获得原始文件路径及内联历史内容，无需自行调用文件工具即可理解上下文。`groupChatDispositionHistoryMaxBytes` 默认 `65536` 个 UTF-8 字节，较大文件保留最近部分并标记已截取。历史缺失或不可读取时会记录日志并标记 `available: false`，仍使用原始问题继续分类。分类超时预算包含历史加载。

分类流程还会检查 `BYCLAW_GROUP_CHAT_DISPOSITION_ENABLED`：仅去掉首尾空格后等于 `0` 时关闭模型判定，未设置、空值及其他值均开启。开关不能替代首次开启会话和 `groupChat.executionId` 条件。关闭判定时仍记录会话首次开启，之后开启开关不会对已开启的会话补判。可同时配置 `BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL`、`BYCLAW_GROUP_CHAT_DISPOSITION_API_KEY` 和 `BYCLAW_GROUP_CHAT_DISPOSITION_MODEL`，使用独立的 OpenAI 兼容 Chat Completions 接口。URL 是 API 基础地址，例如 `https://api.example.com/v1`，不包含凭据、查询参数或片段。三项均未设置或为空时沿用现有模型解析逻辑。独立连接不读取 Redis 模型记录，也不修改正常会话的模型。配置不完整或无效时记录日志并沿用已有的 `CHAT` 失败兜底，不借用正常模型的凭据。环境变量在分类器安装时读取，修改后需重启 Worker。

模型错误和超时会记录日志，并对已收到的文本使用同样的容错规则；没有可用响应时兜底 `CHAT`。已有状态无效或文件操作失败只记录日志，不打断正常会话，也不覆盖已有文件。首次开启标记防止后续请求自动重复失败的后台尝试。后台工作自行管理插件生命周期内的取消，插件退出时会中止并收尾已接收的任务。路径遵循配置的 `/by` 本地存储映射。在用户树位于独立工具环境的共享 DSH 宿主上，首次开启标记和分流结果经工具环境的排队文件层写入（记录它们不会拉起工具环境），历史文件则在工具环境中读取。插件配置 `groupChatDispositionTimeoutMs` 默认 `30000`，`groupChatDispositionMaxTokens` 默认 `1024`，均为正整数。可运行 `pnpm run verify:group-chat-disposition` 执行无需 API Key 的容错与会话并行回归检查。

`byclaw/session-setup` 是接收输入前等待完成的串行事件，覆盖新建、恢复、复用会话，以及后台工作期间的前台追问。事件提供显式的 Agent 实例及其作用域、可信 command，以及 BE 地址、当前用户登录请求头和 `/by/` 路径解析等宿主适配方法。类型从 `@byclaw/dsh-integration/session-extensions` 导出。监听器必须支持重复装配，不能启动 Agent；监听器失败会阻止本次输入进入会话。可选插件自行管理配置、启用条件和持久状态，Integration 不依赖这些插件。

## 配置

```yaml
- insert:
    - id: byclaw-dsh
      name: '@byclaw/dsh-integration'
      config:
        enabled: true
        userCode: !!js process.env.USER_CODE
```

Redis 连接只读取标准 `REDIS_*` 环境变量。后端地址按以下顺序解析：`BYCLAW_DSH_BASE_URL`、`BYAI_SERVICE_BASE_URL`、Redis 服务注册键 `RegistryKeys.sd_instance_details(BE_DOMAINNAME || "ByaiService")`、插件 `baseUrl`，最后才使用公开默认地址 `http://123.56.153.229:8080`。服务注册记录缺少 `path_prefix` 时自动补 `/byaiService`。Redis 模型模式还需提供用于解密 ByClaw 模型鉴权的 `BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX`。如需运行态只使用本地 DSH 模型路由，请设置 `BYCLAW_REDIS_MODEL_ENABLED=false`，并同时配置 `provider` 和 `model`。DSH 启动器会读取启动工作目录下的 `.env`；已导出的进程环境变量优先于该文件和 `$DSH_HOME/.env`。

本地端到端测试需要让 DSH 读取 ByClaw BE 的本地文件存储时，可在未跟踪的 `.env` 中显式开启映射：

```sh
BYCLAW_DSH_LOCAL_E2E_STORAGE_ENABLED=true
FILE_STORAGE_LOCAL_PATH=/absolute/path/to/byclaw-file
```

开关默认关闭；关闭时即使存在 `FILE_STORAGE_LOCAL_PATH` 也不会改变 DSH 的 `/by` 路径。开启后，沙箱路径 `/by/**` 会映射到 `${FILE_STORAGE_LOCAL_PATH}/byclaw-${USER_CODE}/by/**`。开启但未配置 `FILE_STORAGE_LOCAL_PATH` 时插件会启动失败，避免测试静默退回 `/by`。不要把这些变量或本地路径写入 `cordis.patch.yml`。

可在运行时设置可选变量 `BYCLAW_DSH_WEB_AUTH_TOKEN`，让 DSH Web 在容器重启后使用同一个启动 token。适配器只把根路径的 `?token=` 交换翻译为 DSH 内部随机 token；签名 cookie、Host/Origin 信任校验以及所有 API/WebSocket 鉴权仍由 DSH 原实现负责。镜像不内置默认值；显式空值会让插件启动失败。设置 `BYCLAW_DSH_WEB_AUTH_ENABLED=false` 后，会关闭 Web UI、HTTP API 和 WebSocket 的 token 与签名 cookie 鉴权，启动 URL 也不再包含 token；DSH 的 Host/Origin 信任拒绝仍然生效。该模式允许可信 LAN 客户端直接连接，但任何通过这些信任校验的客户端都可以调用该 profile 授予的 API 和工具。启用开关默认为 true，接受 `true/false`、`1/0`、`on/off` 或 `yes/no`。请通过容器环境或未跟踪的 `.env` 注入这些值。

如需进行隔离的真实链路冒烟测试，可通过 `E2E_TARGET_AGENT_TYPE` 只覆盖测试脚本投递的 Worker 类型。业务路由接口仍然只使用 `--agent-id`，同时可避免测试消息被默认类型下的其他在线 Worker 消费。

未指定目标时，专家团链路可能包含“主 Agent -> 团长 -> 团员”两级委派；直达专家团则是“团长根 Agent -> 团员”一级委派。因此 AgentTeams 配置仍需允许深度 2：

```yaml
- id: agent-teams
  config:
    memberProvider: spawn
    memberMaxDepth: 2
```

常用可选项包括 `catalogDir`、`agentTemplateDir`、`skillCacheDir`、`builtinSkillDir`、`workspace`、`workerId`、`refreshChannel`、`subagentProvider`、`agentPreset`，以及在 Redis 模式中用作降级、在本地模式中作为必填运行模型的 `provider`/`model`。资源同步调优项包括 `snapshotConcurrency`（默认 `8`）、`projectionConcurrency`（`8`）、`authorizationPollMs`（`5000`）、`authorizationPollOnlyMs`（`2000`）、`authorizationMissingGraceMs`（`15000`）和 `resourceDebounceMs`（`250`）；`projectionConcurrency` 限制单次代次中 Skill、员工模型和专家团运行配置请求的合计并发数，运行时可用正整数环境变量 `BYCLAW_DSH_PROJECTION_CONCURRENCY` 覆盖。Skill 同步会对每个缓存目录单独执行原子替换，不再为每个代次复制完整持久化缓存；Agent 与专家团模板目录仍按完整代次原子发布，撤销的 Skill 只会在新模板和运行时 Skill 视图均提交后删除。每个 ByClaw 根会话都会显式挂载 `agentPreset`，默认值为 `standard`；根 Agent 与委派 Agent 获得该 preset 实际组合的编码工具，数字员工的 Skill 目录按前述内置与关联资源规则裁剪。CodeGraph 等运行能力由各自已安装插件注册，ByClaw Integration 不再声明或扫描这些能力。

`agentTypes` 可覆盖 Worker 实际消费的完整 AgentType 列表。缺省时仍注册 `BYCLAW_DSH` 与 `BYCLAW_DSH_<userCode>`。临时替换默认超级助手 Worker 时，以 ByClaw BE 实际报出的目标类型为准；当前默认超级助手入口使用 `['BY_SUPER']`。单一且完全相同的 AgentType 列表会沿用 by-framework 为原 Worker 派生的消费组，避免创建新消费组重放历史消息。接管前必须确认原 Worker 已停止或通过 `WorkerManager.suspendWorker` 暂停，回切时先停止 DSH 再恢复原 Worker。

## 验证

```sh
pnpm verify
```

该命令覆盖资源解析、模型动态装配、Skill 缓存、模板投影、异步暂停/唤醒、`ask_user`、任务计划和 `BYCLAW_DSH` 命令桥。另外运行原生 `skill-catalog`、标准加载、live Watch 更新/撤销和 Web 父工作区集成测试（需要已安装依赖的 DSH 源码目录）：

```sh
DSH_ROOT=/absolute/path/deepseek-harness pnpm verify:skills
```

原生 Web/CLI 会话委派时使用会话头已有的工作区，模板子 Agent 获得与 Worker 数字员工一致的技能隔离。真实环境可在 Worker 上线后执行：

```sh
node scripts/live-e2e.mjs --agent-id 123 '做自我介绍'
node scripts/live-e2e.mjs --agent-code ARCHITECT '分析架构'
node scripts/live-e2e.mjs --agent-name '架构舵手' '分析架构'
E2E_CWD=/absolute/project/path node scripts/live-e2e.mjs --agent-id 123 '做自我介绍'
node scripts/live-e2e.mjs '@架构舵手 分析架构'
node scripts/live-e2e.mjs --main '我有哪些数字员工？请简洁列出他们分别能帮我做什么。'
```

启动 DSH Web 时如果 `.env` 不在当前启动目录，可显式指定：

```sh
cd /path/to/deepseek-harness
set -a
source .env
set +a
pnpm dsh web
```

未设置 `E2E_SESSION_ID` 时，冒烟脚本会随机生成纯数字雪花 `session_id`；如需继续已有 ByAI 会话，则把现有数字雪花 ID 写入 `E2E_SESSION_ID`。

能力验收的入站指令只描述用户业务意图。Agent 是否自主调用 CodeGraph，应在任务结束后通过 DSH 会话事件确认；在入站指令中点名该机制不能证明自动行为。

### 模型请求超时

Redis 模型的 `instanceParam.connectTimeoutSec` 只限制 TCP/TLS 建立连接，不限制连接建立后模型准备响应的时间。`readTimeoutSec` 用于等待响应头以及 Harness 的流空闲看门狗（包括等待首个模型事件）。未配置时使用 `BYCLAW_LLM_IDLE_TIME`，默认 600 秒。例如 connect=32/read=60 时，连接成功后允许响应晚于 32 秒到达，但仍受读取时限约束，不保证慢供应商一定能在 60 秒内响应。

传输层为每次请求使用 Undici dispatcher，在响应读取完成或取消后优雅关闭；流式读取期间仍保留调用方取消能力。调用方自定义 fetch 时保留其传输策略。模型首响应慢应测量延迟后调整读取时限，而非扩大连接超时。

## 工作组任务协调

后端在 Gateway `extraPayload.groupCoordination` 注入 `byclaw.group-coordination/v1`，包含 `mode`、`groupSessionId`、`taskSessionId`、`coordinatorAgentId`、`allowedAgentIds`。该字段由服务端决定，正文中的 `@` 不授权调度。`COORDINATED` 使用当前任务独立的临时模板；团长只能发现、创建和委派这个模板中的员工。`DIRECT` 单独 @ 群组工作助手保留原有 CHAT/TASK 分类。普通员工只看到群组工作助手，并通过 `group_request_assistance(objective, inputs)` 请求缺失输入。

团队内的协助请求持久关联原 `taskId/attemptId`，原任务进入等待状态。团长通过 `agent_teams_send_message` 的 `assistance_request_id` 返回结果，继续同一任务，不再创建新的问答任务。普通单员工的协助使用现有 continuable 子会话及父会话结果恢复。调度范围与员工身份随子会话继承，普通员工不能给同事发调度消息或创建团队。

被委派员工的 `workerAgentType` 在任务 roster 中冻结：本 Worker 注册的类型使用原员工模型及 Skills 的 Harness 子会话；其他类型通过现有 Gateway SDK 在独立执行会话中调用真实 Worker。该桥接不创建平台普通群消息，不使用自动 source 回调；它按执行会话、trace、Worker、消息身份读取已有 DataStream，并核对执行终态，将结果写回原 task/attempt。失败、取消、等待用户输入和缺失产物会明确回传团长；等待用户输入的外部执行取消后，团长补充资料并重新委派。外部 Worker 不提供 Harness 工具回执，相关任务应使用 `required_tools=[]` 和明确的结果验收条件。重启后复用持久化的外部执行身份，重新委派会使旧 attempt 的结果失效。

协调根会话以已经由后端路由到 Harness 的运行渠道为准，不因员工元数据中的历史 Worker 标记再次替换根引擎。普通员工的工具目录和上下文只披露团长；团长的目录只披露本次允许的员工。DIRECT 可以只有团长而没有其他员工。

内部员工的继续聊天通过 `byclaw_root_session_id`（平台任务根）、`dsh_target_session_id`（Harness 子会话）、可选 `dsh_parent_session_id`（真实 Harness 父）路由，运行时校验持久父链及继承的 scope。SDK 外部员工执行会话仅用于结构化任务返回，不是可继续聊天的平台子会话。

回归检查：先构建 AgentTeams 和 integration，再运行 `node scripts/group-coordination-verify.mjs`，覆盖范围约束、工具拒绝、任务隔离、协助结果关联、外部 Worker 身份/终态/取消、重启复用和新 attempt 清理。

群成员授权异步刷新尚未到达 Harness 全局资源缓存时，可信服务端 scope 可按精确员工 ID 读取已有 `DIG_EMPLOYEE_<id>` 元数据并生成 task-private catalog。该回退不扩大全局资源目录，仍受当前任务 scope 限制。

外部 Worker 委派经已有 Gateway 转交本次用户输入的文件和文档引用，支持 COMMON_FILE、KG_DOC_FILE 及兼容 KG_DOC。文件字段与资源字段使用白名单投影，排除员工引用及根员工身份、模型覆盖；文件夹等不支持的资源类型明确失败回传团长。此步骤只转交已有引用，不额外上传文件或增加外部目的地，执行者仍须属于当前任务冻结范围。

存量 ACTIVE 任务首次续聊时，只接受服务端提供的 DIRECT scope 一次性升级；原 employee template、外部任务 ID、cwd、生命周期不变，保留原会话上下文。既有 scope 不能扩大，普通会话不能改绑成 COORDINATED。单员工请求团长的协助子会话不重复输出平台 CHAT/TASK 分类。

成员使用配置中的执行方式：稳定 HARNESS / BYCLAW_DSH 类型在 Harness 内运行；BYCLAW_CODE / BYCLAW_EXE 的 SDK 派发使用当前用户 Worker 后缀，并固定同一类型的在线 Worker；不存在精确 Worker 时失败，不接受跨引擎 fallback。团队成员不继承 ENABLE_DSH 对用户根请求的全局路由覆写。FROM_THIRD 且 INTERFACE/A2A 的成员需要专门的接口任务适配器；当前显式拒绝，不用默认 Worker 替代。


### 群成员的运行态隔离与上下文

完整 AgentTeams 状态、员工模板、全员目录、Skill 缓存与会话存档属于宿主私有运行数据。同步中的 generation stage/backup 放在目标文件系统的固定 `.byclaw-private-generations` 目录，保持原子发布并纳入同一读拒绝边界。普通群成员通过原生工具读取自己的任务、关联输入、已完成依赖结果和邮箱；文件 API 拒绝读取私有路径及其符号链接。成员不使用可任意加载 Node 模块的 `run_code`，跨会话检索与无范围限制的 LSP 也被拒绝，业务 API、普通附件和交付文件仍可使用。自己的 Skill 由可信 scoped registry 提供，helper 脚本与 assets 被复制到按会话隔离的只读资源视图；文件 API 允许当前成员读取自己的视图、拒绝其他成员视图及原全员缓存。资源复制拒绝越界符号链接并剔除缓存 metadata，自己的脚本仍可读普通业务附件并写入交付文件。发布新 Skill 代际或解绑成员时立即撤销旧视图授权；磁盘保留的旧副本不再允许未来 scoped 文件 API 调用读取；命令执行不受这项资源视图检查约束。

群成员的 shell、subprocess（含 grep/glob）和 PTY 直接使用原有执行后端，不再附加 Seatbelt/bubblewrap 包装，也不再要求隔离探测通过。unzip、Python、ffmpeg、npm 和技能渲染按原有命令调用；没有新增解压或隔离诊断工具。镜像保留 bubblewrap 供其他可选 DSH sandbox 后端使用，群成员命令不依赖它。

文件 API 的私有路径检查、团队工具的成员范围限制和 Skill registry 投影仍保留，但不构成命令执行的操作系统边界：命令具有原执行后端提供的文件访问能力，可能读取或改写文件 API 拒绝的路径。已有后端自身的 sandbox、授权和会话文件策略继续由该后端决定。

构建 AgentTeams 与 integration 后运行 `node scripts/group-storage-verify.mjs`，验证 scoped 文件 API 和团队工具限制，同时验证原有 shell、unzip、搜索、Skill helper 与 spawnTerminal 调用正常执行。测试只使用临时数据，spawnTerminal 检查调用路径，不分配真实 PTY。

群成员强制使用不继承父会话的 spawn 后端。每次任务启动显式携带用户目标、自己的任务、公共群历史快照、关联的已完成依赖结果及缺失输入；历史发言中的名称或 @ 文本只表示事实，不赋予调度权限。公共历史剔除目录、persona、model、Skills 等配置字段，并标明快照边界与截断信息；不会自动清理旧会话中已存在的过度披露内容。用户 Ask 或有效 Resume 的消息 ID 标识新的输入修订，成员结果与协助返回沿用原任务和修订，不创建新的用户请求。


### 协助请求、等待用户与任务摘要

异步协助的运行结果必须携带协助子会话 ID，等待器仅在匹配该子会话的结束通知、且团长本轮结束后收口。原生调用通过结果元数据关联；DSH PTC 调用通过结果文本中的 `Assistance session` 行关联（该事件不携带展示元数据）。团队台账保留不应要求模型删除团队。页面回归：向数字员工组发送“叫你的成员出来打声招呼”，分别验证任务卡出现即进入、以及等待交付后再首次进入；两种情况下都应在协助返回和团长答复后恢复发送按钮，`runningStatus` 和 `runningSnapshot` 均返回 `running: false`，且不再反复出现内部巡检。本地等待器测试不替代页面验收。

`group_request_assistance` 的团队请求以原 `taskId/attemptId/requesterId`、规范化缺口目标和真实用户输入 revision 关联。revision 来自 ByClaw 用户消息 ID；模型工具参数、普通提及、员工结果回流和自动恢复轮次不能生成新 revision。相同请求完成后直接返回持久结果，不再暂停等待一个不存在的新回调。单 @ 员工还没有 TeamTask 时使用私有运行目录中的 DIRECT 协助账本，固定请求与团长子会话 ID；`group_resolve_assistance` 将实际结果写回原请求。进程重启也恢复同一请求与子会话，不另建平台任务。

团长返回团队协助时可以传 `assistance_status=blocked` 及 `blocking_reason=missing_user_input/outside_scope/no_progress`，内容说明用户必须补充什么。任务进入显式等待用户；相同输入下不能用 start、reassign、claim、替代任务或模型删除团队来重启这个阻塞。外部 Worker 的 WAITING_USER 同样写入此状态，并取消外部悬挂执行，不按执行故障自动重试。真正的新用户输入到达后，团长可以返回补充资料继续原 attempt，或明确重派。不同的合法缺口可以依次协作，例如先取得脚本，再请求素材；没有新增协作轮数或总规模上限。请求哈希负责结构化相同请求的幂等，无法判定任意改写措辞是否语义相同；真实缺料、范围外能力和无进展仍须返回明确 blocker。

工作组团队启动前必须调用 `agent_teams_set_summary`，记录标题、原目标、交付物及实际任务分工。可以先用 `assignments=[]` 写目标，再创建任务并补齐分工后 start；后续合法增加工作要补充交付物与任务映射。普通非群 AgentTeams 不要求该摘要。平台任务标题接口不新增，团队显示名采用摘要标题。

`agent_teams_finalize_summary` 根据真实任务状态生成完成项、未完成项与阻塞项，不接收模型自报的完成列表。只有整个任务图和真实运行成员均静止后才能收尾；一个分支缺材料不会掩盖另一个仍在运行的员工。即使模型漏调用 final 工具，调度器也会在实际静止时自动保存结构化 final，并将其送入团长邮箱用于最终用户答复。任务状态中的 completed 但没有可用 output 会明确记为未交付，不能宣告成功。

新用户输入使此前产物需重新核对，旧 final 不自动沿用。若用户只是询问进度，团长可通过 `agent_teams_update_task(confirm_output_for_current_input=true)` 明确确认已有产物仍适用，无须再委派员工；原 attempt、原产物和输入来源保留。重派自动更新实际分工，并保留原分工记录。团长在工作组任务中必须经 AgentTeams 任务账本调度，model-facing 模板直派不能绕过范围、等待用户及结果关联规则。

离线回归还包括 `node scripts/group-assistance-summary-verify.mjs`：同步完成缓存、连续不同缺口、显式阻塞与准入、私有账本/邮箱崩溃窗口恢复、真实派生摘要、旧产物确认、外部员工 WAITING_USER 和原生/CodeMode 缓存结束门控。

### 团队成员有效执行路由

后端在可信 `groupCoordination.effectiveWorkerAgentTypes` 中按员工 ID 提供有效路由，复用普通聊天的用户/全局 `ENABLE_DSH` 规则。Harness 创建团队成员前按此路由选择本地子会话或外部 Worker，资源快照中的原始 `workerAgentType` 不被修改。旧服务端未提供此字段时保持原配置行为；修复需要先部署后端，再部署 Harness。路由随根会话元数据和团队 roster 冻结，既有 scope 可一次性补充路由，之后不能改变引擎；调整配置后应创建新任务。外部 Worker 启动失败仍由调度器记为失败并通知团长。

## Jev 路由插件

### 专家组接口与旧 Skill 名称兼容

部分网关的 `/byService` 前缀可以访问 Skill 接口，却没有转发 `/internal/v1/orchestrators/resolve-runtime`。插件仅在该旧路径返回 `404` 且响应类型为 HTML 时，在同一 origin 的 `/byaiService/internal/v1/orchestrators/resolve-runtime` 重试一次；两次请求共享超时预算，均禁止自动重定向。业务 JSON 404、鉴权失败和其他状态不会触发此兼容处理，专家组权限和返回 ID 校验继续生效。

关联 Skill 的元数据若使用 `<skillCode>-<数字版本>` 名称（如 `ppt-master-0.1`），加载时使用稳定的 `skillCode` 作为运行时名称，源文件、描述、正文及资源目录保持原样，并记录名称适配。该兼容只适用于关联 code 为合法名称且前缀匹配的 Skill；无关非法名称、路径字符和空描述仍会报错，同名冲突沿用原有检测逻辑。

开启模型路由后，复用 DSH 输入框原生模型选择器提供 Auto 和模型池。普通会话可选 Auto，并以切换前的真实模型作为回退；ByClaw 员工根会话默认 Auto，始终以员工配置模型作为回退。手动模型跳过自动选模及跨模型回退，选择随会话保存。手动选择不影响员工／专家组路由，也不覆盖子 agent 模型。详细行为和启用条件见[对话模型选择](../byclaw-model-router/README.md#对话输入框的模型选择)。

`@byclaw/byclaw-agent-router` 根据意图选择数字员工/专家组，开关为 `BYCLAW_AGENT_ROUTER_ENABLED`。`@byclaw/byclaw-model-router` 独立选择模型，开关为 `BYCLAW_MODEL_ROUTER_ENABLED`，通过 `BYCLAW_MODEL_ROUTER_MODEL_IDS` 明确提供允许自动选择的模型池。两者共用仓库 `.env.example` 中的 Vercel TypeSafe-compatible Gateway 入口、key、模型 ID 和超时配置。

模型调用失败时先尝试该 agent 原先配置的模型，它也失败后再让 Jev 排除失败项并选择。重选候选的配置失效时，会在剩余次数内继续选择。实际换模使用本仓库构建的 DSH 0.1.5-rc.2 兼容运行时，启用前检查 `reassemble: true` 能力；兼容性、部分输出处理和候选元数据参见 [模型路由插件](../byclaw-model-router/README.md)，强制员工委派参见 [Agent 路由插件](../byclaw-agent-router/README.md)。Gateway 合成请求联调入口参见 [共享客户端](../jev-client/README.md)。

员工路由仅在超级助手根会话委派时强制生效：默认主助手，或可信模板员工编码为 `${USER_CODE}_main` 的根会话。直接选中的普通数字员工不强制 Jev 选人，也不受超级助手通用委派拦截限制；专家组仍遵循组内权限与编排规则。

## Native todo execution checks / 原生 todo 执行约束

Integration now requires `@byclaw/dsh-todo-execution`. Ordinary employee Agent roots bind it before session extensions and input admission; current or persisted group-coordination metadata keeps team sessions unbound. Native `todo_write` and the existing `task_plan({todos})` alias keep their definitions and order; both pass the same sequential checks. Existing `todo/write → 2008` card delivery remains. See [插件说明](../dsh-todo-execution/README.md) for lifecycle, stopping limits and installation.


## 超级助手编排权限

默认 ByClaw 主助手，或员工编码为 `${USER_CODE}_main` 的根会话，使用编排权限。问候、澄清、一般知识解释和基于对话的简短总结可直接回答；外部信息检索、文件/代码/浏览器/命令/业务操作、多步骤分析及专业交付必须委派授权员工或专家组。复杂度由角色提示引导；业务工具权限由执行端强制限制。

超级助手使用原生工具展示，只保留 `byclaw_list_resources`、`byclaw_route_task`（开关开启时）、`byclaw_instantiate_template`、`agent_teams_status`、`ask_user_question`（已注册时）、`super_assistant_read_plan`、`todo_write` 和 `task_plan`。`super_assistant_read_plan` 只读自身最近的原生 Todo 快照，不写入计划，不代表员工进度。Bash、浏览器、文件读写、Skills、代码桥和其他业务工具均从模型请求中移除并由不可被 allow 策略覆盖的 guard 拒绝；普通员工与子 Agent 不受此白名单影响。

超级助手不绑定单 Agent Todo 顺序执行策略，已有未完成 Todo 保留，不阻止调度。超级助手可创建和更新自身调度计划，收到员工交付并核实后才标记完成；员工完成后异步回报，由超级助手汇总或继续委派。Jev 失败或没有候选时说明阻塞，不自行执行复杂任务。无需额外环境开关；Jev 是否介入仍由 `BYCLAW_AGENT_ROUTER_ENABLED` 控制。

INFO 日志 `[byclaw-super-assistant] bound` 显示会话和工具白名单；禁止调用返回 `SUPER_ASSISTANT_EXECUTION_DENIED`。本地验证：`node --import tsx/esm plugins/byclaw-integration/scripts/super-assistant-policy-verify.mjs`。

超级助手先调用 `byclaw_route_task(task)` 获取 Jev 返回的 `template_id`，再用该 ID 和相同任务调用 `byclaw_instantiate_template`。启动时仅校验当前 Agent 最近一次成功选择，不再重新调用 Jev；选择只能使用一次，失败或重启后需重新选人。

### 文生图与文本转语音插件

`byclaw-image` 与 `byclaw-tts` 通过 `byclaw/session-setup` 绑定当前用户的会话工具，使用与 byclaw-context 相同的 workspace registry 读取 `session_root`。图片固定保存到 `session_root/image/`，语音固定保存到 `session_root/tts/`。工具输入不接受路径、端点或凭据。

超级助手允许直接调用这两个已注册的媒体工具；其他命令、浏览器、文件写入与业务工具仍按原策略委派给员工。安装两个 bundle 后才具备能力，白名单本身不会注册工具。

模型从 Redis 已启用的 IMAGE_GENERATION/TTS 默认项解析。部署可用 `BYCLAW_IMAGE_MODEL_ID` / `BYCLAW_TTS_MODEL_ID` 或各插件 `config.modelId` 指定模型 ID。旧配置供应商标记有误时，可在部署层显式设置插件 `config.provider` / `config.protocol`；这不会修改 Redis，全局配置应在模型管理中修正。凭据仍从所选模型读取并使用现有解密方法，不向模型暴露。

供应商、音色及协议限制见 `../byclaw-image/README.md`、`../byclaw-tts/README.md`。不存在的能力会明确报错，前端通用协议标签不代表供应商支持所有功能。

媒体连接器与独立插件：用户连接器投影（`/by/.connector-auth/.model/image.json`、`tts.json`）优先于系统默认模型；仅文件不存在时回退 Redis，损坏或不匹配的配置直接报错。显式部署 modelId 可选择测试/指定模型。连接器协议明确映射到真实供应商适配器，不根据端点猜测。旧 `media-generation` 注册入口不再全局挂载，启用 `byclaw-image` 与 `byclaw-tts` bundle 后，分别使用会话级 `image_generate` 和 `text_to_speech`；旧 `speech_generate` 名称不再自动注册。连接器既有校验及测试保留，生成不会自动重试。

连接器迁移约定：旧 `options.defaultVoice` 在没有显式 `voice`/`speaker` 时映射为默认音色；原 OpenAI 图片显式 Authorization 和火山 TTS 显式 X-Api-Key / X-Api-Resource-Id 保留优先级。新插件将 `readTimeoutSeconds` 作为整个生成调用的总时间预算，最多 30 分钟（更大配置归一到 30 分钟）；不再分别应用旧连接器的 connectTimeoutSeconds / readTimeoutSeconds，也不采用 maxRetryCount 自动重试，避免重复计费。

语音交互：`byclaw-asr` 使用系统启用的全局默认 `ASR` 模型，在主 Agent 接收输入之前固定识别 MP3，保留 `voiceInteraction` 标记并将识别结果作为 `userInput`。SDK/前端的 `VOICE` 消息携带后端已验证归属的音频，原始音频保存在 `session_root/asr/`；重复消息复用识别缓存。by-framework 1.6.0 要求 wire content 非空，纯语音桥接使用 `[语音消息]` 占位，识别后替换成真实文本。正常文字回复之后，运行时使用现有 TTS 默认模型合成口语摘要，保存到 `session_root/tts/` 并追加可播放的受管制品链接；TTS 失败仍保留完整文字回复。手动转写由登录后的后端代理至 `POST /api/byclaw/asr/transcribe`，用户浏览器不持有供应商密钥。协议与接口约束见 `../byclaw-asr/README.md`。

### 启动与 Skill 懒加载

镜像构建阶段编译 DSH 和全部插件，运行时直接执行编译后的 CLI。浏览器、桌面和 byCLI 桥接默认在首次私有 browser 请求或受管 byCLI 浏览器命令时激活；首次请求等待激活完成，后续复用。

Integration 在 Worker 上线前只发现授权资源目录；员工模板、员工模型和专家团运行时延迟到实际选择目标时准备。业务 Skill 的版本请求、下载及解析延迟到当前员工查询 registry list/snapshot/get 时，包括 Skill 工具和提示词目录查询。每次查询检查版本与授权，缓存缺失、不完整或版本变化时下载并原子替换；同版本复用缓存，并发请求合并。下载后复核授权和关联关系，失效的旧代际结果不能重新发布。

内置 Skill 仍从镜像本地加载；专家团临时作用域员工在实际调用时准备。`allowSkillSyncFailure` 决定单个 Skill 失败时跳过还是拒绝查询，之后可重试。首次 Skill 查询承担网络耗时，Worker ready 不代表所有 Skill 已预热。


### 2026-10-22 冷启动投影优化

模板 staging 保留原目录校验与文件命名规则，只复制用户模板、未知文件和子目录；本代际会重新生成的 ByClaw 模板不再先复制后删除。原代际锁、双目录发布回滚、撤权清理及 Skill 懒加载/版本检查不变。`session-metadata-ready` 日志将会话元数据恢复从内置 Skill 加载区间中单独标出。新增 `template-staging-verify.mjs` 覆盖撤权、用户文件保留、目录碰撞拒绝与失败时保留旧代际。

Worker 消息分发不再设置任务并发上限，原 `maxConcurrency` 插件配置不再生效；会话内顺序和 DSH 工具并发仍独立控制。适配器显式关闭已发布 by-framework 版本的默认上限，因此不依赖 framework 升级即可生效。Redis 阻塞读取、消息 ACK、取消、健康检查和退出时等待在途任务均保留。`snapshotConcurrency`、`projectionConcurrency` 仍限制资源同步并发。实际容量取决于任务负载、保留状态、模型配额和 Redis 事件流量，取消分发上限不代表吞吐量没有上限。

### 按需资源准备回归

构建后运行 `node --import tsx/esm scripts/on-demand-resources-verify.mjs` 和 `node scripts/on-demand-projection-verify.mjs`。测试覆盖只读目录、目标读取范围、同目标并发复用、版本更新、授权撤销及投影期间撤权、专家团依赖、失败时保留已有员工，以及原子保留其他模板和 Skill 视图。56 个授权资源的真实文件投影夹具验证：上线阶段 0 次员工模型解析、0 次专家团运行时请求、0 个员工模板；首次员工准备 1 个模板，未变更的重复使用不再投影。这是本地行为验证，不代表线上登录时延已完成验收。

增量投影不按旧模板文件的 Skill 引用删除磁盘 Skill 缓存，因为运行中的员工可能通过实时关联查询新增了 Skill。关联撤销由每次 registry 查询的授权检查生效；缓存文件随用户上下文/沙箱存储生命周期保留，不能把缓存文件存在视为授权。完整代次投影调用仍保留原清理规则。

## 后端到沙箱的发起链路排查

后端与 Harness 使用统一的 `chat_chain` 单行 JSON 日志，按服务端 `invocationId` 关联一次接收、按 `dispatchId` 区分派发重试，记录阶段耗时及租户与实例。初始化使用 `startupId`，回复使用 `replyEventId` 串联 Redis、后端、WebSocket 与前端实际应用对象。字段语义、三个场景的手工排查示例见 [链路日志规范](CHAT-CHAIN.zh.md)。本地验证：`pnpm verify:chat-chain`。
### DSH 项目共享工作目录

网关 `header.metadata.project_info.project_id` 绑定项目时，DSH 根会话和子会话的执行 cwd、相对路径文件操作及默认交付目录统一使用 `/by/.shared/project_{projectId}`，默认项目为 `project_-1`。运行端在工具环境中幂等创建目录；未绑定项目时保留原会话 cwd。`.sessions/<sessionId>` 仍作为内部会话路径存在，不再作为项目会话的默认交付目录。

`plugin:system-prompt` 和 `plugin:byclaw-context` 同时声明执行 cwd、项目共享目录、共享根目录及项目身份。旧会话恢复时在持久化读取边界映射会话头，保留原始日志、历史产物和 AgentTeams 状态；不移动旧文件，不允许从一个项目目录切换到另一个项目目录。运行中的旧根会话在下一次普通请求时关闭旧句柄并恢复到新 cwd，正在执行的任务沿用原路径直到结束。本规则仅作用于 DSH。
