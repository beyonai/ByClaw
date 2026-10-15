# Devflow × Midscene 第一阶段修复方案

状态：实施中。本文补充原 [PRD](2026-09-14-devflow-midscene.md)，以 2026-09-15 的真实运行问题和官方 Skills 文档为依据；不宣称 M1 已通过。方案调整为优先复用官方 Skill/CLI，不启动第二阶段自研逐动作浏览器工具。所有新增接口名称均为拟议契约，实施时按已发布 Harness 入口校验。

## 一、问题与修复目标

真实运行 `5891d8fd-6bd9-4609-827c-381f3b2bfbe9` 的结果为 infrastructure-error，case 0/2、assertion 0/2、buildVerified false、model unconfigured。构建探针 `/devflow/api/build-id` 返回 404，尚未进入页面用例。与此同时，主卡 `0001` 在 revision 12 从 testing 进入 done，transition reason 明确说明携失败报告测试门禁；这是一次错误完成。后来启用 artifact-gate 与 agent-gate，只证明报告审查可拒绝失败证据；当前通用命令门禁仍禁用，`0004` 的完成不代表页面验收通过。

目标是让用户在 Harness 中配置一次验收环境，通过对话发起完整套件，在现有作业界面观察进度、取消、打开报告；对于明确要求 Midscene 验收的完成边，每次转移都执行新的真实验收，失败或不可用不能完成。

完成定义：真实视觉模型跑通看板和卡片详情；刻意错误断言得到 assertion-failed 并拒绝完成；取消与异常退出停止自有浏览器；报告可打开；重启后能读旧证据；未完成记录不变成 passed。普通测试和覆盖率仅是工程门槛。

## 二、范围与架构决定

保留 Playwright + Midscene SDK、隔离 worker、现有卡片/store/journal、Harness jobs 和 transition waterfall。不新增业务阶段状态机，不让 Midscene 自行推进卡片，不接已退役 MCP。

第一阶段分为两条入口，共享配置、身份和作业记录：

- **交互排错**：接入官方 Browser Automation Skill，通过官方 CLI 截图、操作、断言和查看报告。让用户先验证模型能否操作真实页面；这一入口不要求先实现构建端点，结果明确标为探索记录，不能凭此完成卡片。
- **正式验收**：运行认可的版本化套件，验证登录、构建、输入和完整断言；只有这条路径能为完成门禁提供证据。当前 SDK worker 暂时保留，避免尚未验证替代方案就重写执行器。

官方 Skill 提供自由操作的使用方式，并不要求我们自研同名工具集。M2 调整为按实际缺口决定是否增加原生逐动作工具和更深 UI 集成；不再把“能操作浏览器”本身视为必须自研的第二阶段。

### 官方能力复用与限制

[官方 Skills 文档](https://midscenejs.com/zh/skills)提供默认 Puppeteer、CDP、Chrome Bridge 三种浏览器连接方式，并明确要求独立的 Midscene 模型环境变量。它适合快速打通 agent 的页面验证流程，但没有提供 Devflow 卡片门禁契约。

[Browser Automation Skill 源文件](https://github.com/web-infra-dev/midscene-skills/blob/main/skills/browser/SKILL.md)已涵盖操作、视觉断言和报告转换。接入时保留逐命令观察结果的顺序；Harness job 可以记录长任务，但不能让 agent 不等命令结果就继续下一步。CDP/Bridge 借用浏览器时只断开连接，不能套用自有 Chromium 的整进程清理。

[官方 Vitest E2E Skill](https://github.com/web-infra-dev/midscene-skills/blob/main/skills/vitest-midscene-e2e/SKILL.md)提供基于 Playwright 的 Web 测试组织方式，适合把探索结果沉淀成回归用例。先做等价性验证，确认失败退出码、断言计数、报告、取消与身份绑定能满足正式验收，再决定是否迁移现有 JSON suite；修复期不同时维护两套正式格式。

本地核查：当前安装的 `@midscene/web` 1.12.6 已有 `midscene-web` bin，以及 Puppeteer/CDP/Bridge 分支；这仅证明包中存在入口，尚未证明最新版 Skill 的每个参数与当前包兼容。实施时固定官方 Skill commit 和 CLI 精确版本，保留来源与许可证，跑兼容性探测；不能在每次验收时通过浮动 `npx @...@latest` 更新依赖。

通过当前 Harness `ctx.skills.registerProvider` 加载已审阅的官方 Skill 资源及必要适配，验证资源相对路径、shell 调用和截图读取。官方通用安装命令并不能证明 Harness 会自动发现技能；方案阶段仅调研；现已在隔离 worktree 中实现并验证注册，部署验收另行记录。插件适配模型变量和任务上下文，官方 Skill 负责浏览器用法，Devflow 补充 Skill 负责证据登记与转移规则，避免多个技能给出冲突的完成指令。

| 模块 | 职责与拟议修改 |
|---|---|
| devflow-midscene | 官方 Skill/CLI 适配、配置、预检、登录态、受控套件执行、模型适配、证据及验收 validator；暂留正式 worker |
| devflow-gates | 增加可注册的具名 validator；必需 validator 缺失时拒绝；保留已有 shell 命令门禁与人工批准 |
| devflow-web | 受现有认证保护的构建身份读取、受限的验收报告读取入口 |
| devflow-ui / Midscene 客户端扩展 | 显示验收配置摘要、当前作业、最近预检与最近门禁运行、报告和故障原因；复用现有卡片详情结构 |
| Harness 已发布服务 | 模型能力与凭证读取、真实调用者/会话解析、jobs、取消及配置展示；不直接解析其内部凭证 YAML |
| e2e | 实际 Devflow 看板/详情用例、登录与环境 runbook、正向/负向/取消验收 |

### 门禁接法的选择

目标采用具名 validator 接法。当前命令门禁配置是部署级的 edge/cards 字符串列表，card id 不是跨项目唯一身份；也没有把运行时模型引用、真实调用者、当前 revision 和任务取消信号统一交给 Midscene 的类型化契约。R0 先验证能否用现有 shell gate 加薄适配满足同一契约；若能完整证明作用域、fresh run 和 fail-closed，则优先复用，暂缓注册机制扩展。不能为了复用而放弃这些完成条件。

validator 仍由现有 transition waterfall 调用，返回允许/拒绝与本次 runId，不形成第二个执行编排器。手动完整套件检查与 validator 调用同一个执行核心；CLI 保留为独立项目和排错入口。通用命令门禁继续用于 typecheck、测试等项目命令。

部署必须区分“未要求验收”和“要求验收但能力不可用”。前者可以按现有规则完成但不得显示 Midscene 已验证；后者必须拒绝。启用策略时检查门禁引擎与 validator 挂载，不能配置为 required 后因插件缺失而退化为空命令放行。管理员显式撤销策略是配置变更，不伪装为验收通过。

## 三、用户流程

交互排错先走短路径：选择兼容视觉模型 → 选择专用浏览器或明确连接的 Chrome → 官方 Skill 打开页面并执行一个正向和一个故意失败的断言 → 展示截图与结果。无需先完成正式构建身份服务；界面明确提示该记录不满足完成门禁。

正式验收流程如下：

1. 选择工作区，在 Midscene 验收设置中选择视觉模型、目标 URL、登录态、suite、报告目录和适用完成边。配置中只展示凭证引用和已配置状态，不展示密钥。
2. 执行“检查验收环境”：分别给出模型、登录、构建身份、浏览器、套件和门禁配置结果；一次列出全部缺项。网络模型探测作为明确的可计费检查，使用合成图片，不默认上传业务截图。
3. 通过对话发起“运行此卡片的 Midscene 验收”。工具根据真实会话定位工作区与卡片，返回现有 job id。界面显示阶段、当前 case/step、输出和取消入口。
4. 完成后生成可打开报告，通过 Devflow 工具登记 Markdown test-report。失败时给出具体故障和下一步，不把“完成诊断”写成“验收通过”。
5. 请求完成卡片时，门禁另起新的 runId 重跑；历史手动 passed 或 LLM allow 不替代这次运行。
6. 门禁运行失败则保留原阶段及证据；通过后由 store 提交 transition。报告登记不能在同一卡片的 transition 锁内重入；门禁 runId 随 decision 提交关联，完整产物通过锁外、可重试的正常工具路径登记。

## 四、具体修复

### A. 视觉模型与凭证接入

新增独立 acceptance profile，明确区分“对话模型”和“验收视觉模型”，允许选择同一个兼容模型，但不默认假定兼容。配置至少包含 provider/model、Midscene 模型家族、连接协议、endpoint、credentialRef、超时与步骤上限。

复用已发布的模型能力查询与凭证服务；模型支持图片不等于其协议受 Midscene 支持。实施前验证模型元数据、端点和密钥引用能否从发布版公开接口完整获得。若不能完整转换，M1 使用独立 endpoint + credentialRef 配置，并在界面明确说明；不读取 Harness 私有存储、不临时修改全局 process.env、不偷偷升级 Harness。

每次运行解析一次配置与凭证，固定到本次 worker；更新凭证影响下一次运行，不改变已运行任务。秘密只通过受控 IPC/子进程环境传递，不能进入命令行、工具参数、job 可见字段、manifest、prompt 或报告。CLI 外部使用可通过受保护文件或环境变量配置，不自动读取任意用户配置文件。

官方 CLI 适配必须生成 `MIDSCENE_MODEL_API_KEY`、`MIDSCENE_MODEL_NAME`、`MIDSCENE_MODEL_BASE_URL`、`MIDSCENE_MODEL_FAMILY` 等与所选模型匹配的运行环境；“Harness 对话模型配置好了”不等于这些变量存在。官方 CLI 会读取 cwd 的 `.env`，因此托管调用使用受控运行目录、显式输出目录与工作区路径，验证配置优先级，避免意外继承另一项目配置；不向项目写入含密钥的 `.env`。

能力状态使用 available/unavailable/unknown；静态信息未知时允许显式进行小规模真实视觉探测。401/403、模型不存在、协议不支持、视觉能力缺失、超时分别报告，不强迫用户猜测通用 infrastructure-error。

### B. 认证与隔离浏览器

增加 `--storage-state <file>` 或等价 profile 引用。文件位于工作区外的受保护目录，在读取时验证格式、实际路径与访问权限；不提交 Git，不把内容带到报告，不开放任意跨项目凭证文件读取。

首版采用用户在专用浏览器 context 登录后导出 Playwright storage state 的方式；本地 Harness 可在受控登录助手中使用启动登录 URL 完成 token→cookie 交换，但 token 仅由凭证通道传入，不出现在 suite、job 参数或报告中。不关闭认证，不复用用户日常浏览器的全部个人资料。

交互排错可按官方方式连接已登录 Chrome：CDP 需要可达的调试端点，Bridge 需要扩展及连接确认。当前 Codex 内置浏览器打开了 3082，并不代表它能被这两种方式连接，也不能假定 cookie 已共享。选定目标标签页后再导航，避免覆盖用户正在操作的页面。借用浏览器默认只用于探索；正式套件仍使用专用 context 和明确登录快照，直到借用模式的隔离与复现条件另行验收。

登录状态必须同时用于构建探针请求与每个 case 的 browser context。现在 worker 的 probe context 与 case context 都是空状态，不能只修页面导航。每个 case 从同一初始登录快照创建独立 context，避免上一用例影响下一用例。

运行前检查登录是否有效、目标页面是否为预期应用；401/403、跳回登录页、错误账户或工作区应报 AUTH_REQUIRED/AUTH_EXPIRED/TARGET_CONTEXT_MISMATCH。登录失效时不自动索取或打印密码。保留同源导航限制；需要外部 SSO 时由登录助手完成，不顺便允许验收期间任意跨源操作。

### C. 真实构建身份

在 devflow-web 增加遵守现有 POST JSON 路由和认证约定的构建身份读取方法；同时扩展 suite 的 buildProbe，支持 JSON、method 和显式字段匹配，保留原有纯文本协议兼容性。

身份来自构建与启动记录，而非 suite 声明或一个随手配置的版本字符串。建议返回：schemaVersion、buildId、相关构建包版本/产物摘要，以及 instanceId（用于运行前后识别服务重启）。不暴露绝对路径或敏感配置。buildId 以实际加载的服务端和 UI 构建产物为依据；同为 0.4.0-dev.7 的不同 worktree/tarball 必须可区分。开发热更新使原证明失效时返回不可用，不能继续报告旧身份。

通过明确的部署记录绑定“工作区/源码指纹→产物摘要→运行构建”，避免把当前源码与一个无关的旧服务当作同一版本。期望 buildId 来自部署记录；不得仅把探针刚读到的值抄回 expected 就称为验证。构建不匹配须重新部署或明确切换被测目标。

正式运行前和提交通过结果前都复核构建/instance 及源码/suite 指纹。服务中途重启、重新部署或输入变化时，不允许沿用成功结果。

### D. 必需验收与门禁结果

策略按可信 workspace/project 身份 + 适用边配置，不能只按 `0001` 这样的 card id 匹配。可覆盖 testing→done、express/emergency 完成边和父卡集成验收；未要求的路径清楚标记“不要求视觉验收”。

拟议 validator 输入：真实工作区根与卡片 id、expectedRevision、from/to、真实 actor/session、policyId/config 指纹、取消信号和截止时间。参数来自 gate/store 上下文，不信任模型自行声明 owner、revision 或 passed。

只有以下条件全部满足才允许：本次 fresh run passed；所有必需 cases/steps/assertions 完整；构建和输入一致；清理已确认；报告完整可读；执行身份与当前转移相符。其余状态，包括缺配置、validator 缺失、零用例、部分执行、取消、超时、unknown 和旧 manifest 均拒绝。

拒绝写入 gate decision 与可查询运行记录；成功只是一项准入条件，后续门禁仍可否决。LLM 审查不得覆盖机械验收的失败。项目配置由用户/维护者管理，开发 agent 不能通过改 suite、移除断言或编辑部署策略来满足本次验收；验收输入需要被认可并绑定哈希，合法修改必须重新确认与重新执行。

同一 profile 服务多个工作区、相同 card id、多个会话及并发不同卡片时必须隔离。卡片原有锁/租约/revision 规则不变；门禁期间外部事件导致身份失效时拒绝，不盲目重试卡片写入。

### E. 报告、可见结果与错误表达

保留现有有限结果分类，增加稳定 reasonCode：MODEL_NOT_CONFIGURED、MODEL_INCOMPATIBLE、AUTH_REQUIRED、AUTH_EXPIRED、BUILD_UNAVAILABLE、BUILD_MISMATCH、INPUT_CHANGED、GATE_UNAVAILABLE、REPORT_UNAVAILABLE 等。诊断信息包含失败阶段和修复建议；保留脱敏后的底层原因。

记录 runId、jobId、policyId、project/card、触发原因（手动或门禁）、输入 revision、模型及适配器身份、suite/config/build 指纹、时间、有限计数、usage 和 cleanup。认证证据只保存配置引用和有效性，不保存 cookie/token/可被离线试猜的低熵秘密摘要。

把产物写入工作区外的持久目录。增加受现有认证及项目授权约束的报告读取入口，只按受信任 runId/产物名查找注册记录，拒绝任意路径、路径穿越和 symlink 逃逸。原始 SDK HTML 应在隔离 sandbox 中打开，不能以与 Harness 等权的可执行页面提供；截图/报告要按敏感测试数据处理。

任务详情区分“上次手动验收”“本次完成门禁”和“卡片状态”。未配置策略、验收不可用和 passed 不能共用绿色完成提示。历史报告失效明确显示不可用；不会因此悄悄改写已经提交的历史卡片结论。

### F. 取消、恢复与资源

取消信号和单一截止时间贯穿预检、模型请求、探针、浏览器步骤、报告生成与可达性检查。沿用已实现的 worker/browser 所有权跟踪及有界进程树清理，覆盖 Windows、POSIX detached 浏览器及 worker 异常退出。

重启后只恢复结果查询，不自动重放有副作用的页面操作。非终态运行显示 interrupted/unknown；手动重跑创建新 runId。若秘密临时文件被使用，正常结束删除本次私有临时文件，崩溃残留在明确所属目录中清理，不删除用户提供的登录态/凭证文件。

## 五、现有数据纠正与部署

实施开始前备份独立 profile 的配置、验收记录与相关卡片 journal，并记录当前 revision。通过现有受控 Devflow 命令/工具把 `0001` 重新打开到合法阶段，附原因和旧失败 runId；不直接编辑 card.md/journal，也不把已提交历史伪造成从未完成过。若现有公共入口不允许 done→testing，采用其支持的重新打开流程，或创建关联的重验收卡并明确标记原卡错误完成；不得自创非法转移。

保留 `0004` 的原结论，它只证明门禁拒绝实验；关联到修复记录，不能充当页面验收证据。`0002` 登录与 `0003` 构建端点继续作为本修复的子工作，不重复创建同义任务。用户本轮产生的 e2e 文件保留并审阅，不覆盖其修改。

只升级端口 3082 的独立 profile。全部相关包从同一 worktree 构建、打包、固定 overrides，记录 tarball SHA256、实际已安装哈希与 dump-config。保持原 3080 实例不受影响。部署前告知重启会中断活动会话，在可安全重启点操作；必要时用新端口完成最后验收后切换。

回退保留配置备份、旧包集和报告；旧格式 manifest 仍只读可查。新能力缺失不能把 required 策略降级为通过。若必须停用策略，由维护者显式修改并记录“未执行视觉验收”，不能以回退冒充验收成功。

## 六、按纵向切片实施

| 切片 | 交付物 | 必须证明 |
|---|---|---|
| R0 现场与契约 | 备份、纠正方案、认可的 suite、公开 API 核查；官方 Skill/CLI 版本契约与 shell gate 可行性 | 能复现“失败证据却 done”；明确最小适配边界，未依赖私有存储 |
| R1 官方入口与模型 | 官方 Skill 适配、profile、doctor、CLI 子进程环境、专用浏览器或已确认 CDP/Bridge | 真实页面截图、正向及错误断言可见；无需 build-info 即可排错；不产生卡片完成证明 |
| R2 登录与构建 | storage state、登录助手、受保护 build-info、源码-部署绑定 | 从真实受保护 3082 打开正确工作区，确认测试的是当前部署 |
| R3 完整套件作业 | 受控运行入口、job 状态、报告路由、实际看板/详情用例 | 真实视觉模型正向通过，有可打开截图和报告 |
| R4 完成门禁 | 具名 required validator、作用域、fresh run、结果关联 | 旧 passed 无效；故意错误断言使本次完成转移被拒；缺 validator 也拒绝 |
| R5 故障与交付 | 并发/取消/崩溃/重启、跨平台、打包/profile 回归和真实 M1 记录 | 全矩阵通过；独立部署可回退；M1 证据齐全才进入 M2 |

每片均包含代码、对应测试和使用说明。先交付 R1 的官方 Skill 最小闭环，再推进 R2–R5 的正式验收闭环。R2 依赖 R1 的配置契约，R3 依赖 R1/R2，R4 复用 R3 执行核心，R5 汇总真实验收；修复过程中已有门禁保持拒绝不可用证据。

## 七、验收矩阵与交付门槛

| 场景 | 期望 |
|---|---|
| 官方 Skill 发现、资源读取、CLI 版本不匹配 | Harness 可发现正确资源；不支持的参数明确失败，不静默更新依赖 |
| 官方交互断言通过但缺正式构建证明 | 探索记录可查看，不能作为 required 门禁通过 |
| 借用 Chrome 后取消或断开 | 用户浏览器仍运行，连接释放；不关闭非本任务标签页 |
| 未选择视觉模型、仅对话模型已配置 | 明确报缺配置，不发起正式视觉用例 |
| 非视觉模型、错误协议、错误 key、超时 | 分类失败，凭证不泄漏，不产生 passed |
| 缺登录态、登录过期、错误目标上下文 | 预检失败，不把登录页面当作业务页面 |
| 缺构建端点、旧 tarball、运行中服务重启 | 不可用/不匹配，拒绝放行 |
| 两个真实页面用例正确 | 完整 passed，计数、截图、HTML、用量和身份齐备 |
| 故意修改视觉预期 | assertion-failed，非零，完成转移被拒 |
| 零用例、删断言、部分完成、伪造 manifest | 无法满足 required 验收 |
| 正向手动运行后完成 | 新 runId 真正重跑；改坏应用后不能沿用旧通过 |
| 只有 LLM allow、required validator 缺失 | 仍拒绝；不退化为空门禁 |
| 两工作区相同 card id、并发不同卡片 | 配置、凭证、浏览器和报告隔离 |
| 任意阶段取消、worker 崩溃、父进程丢失 | 不返回 passed，自有浏览器停止或清理未知明确报出 |
| 重启后读取历史/未完成记录 | 旧报告可查，非终态不推断通过、不自动重放 |
| 报告删除/迁移、路径穿越、恶意 HTML | 不可用或拒绝访问；不获得 Harness 页面的权限 |
| express/emergency、父子卡片 | 按明确策略执行；未执行不标已验证；父卡另做集成验证 |
| 报告登记遇到 revision 冲突 | 重新读取并判断证据适用性，不盲目覆盖 |

工程门槛保持 typecheck、包测试类型检查、lint、普通/组合测试、逐文件四项 100% 覆盖、build 和 tarball preflight；不通过排除 CLI/worker、降低阈值或 mock 视觉模型来宣布真实 M1 完成。至少一轮实际受保护 Devflow UI 的真模型成功、一轮真模型错误断言失败、一次真实取消和一次重启读取，是单独的发布证据。

最终交付包括：修复代码、本地 PRD/决策说明、真实 fixture 与 runbook、配置和迁移说明、部署包/哈希、正负向 runId/报告/用量、门禁拒绝与成功的 journal 关联，以及剩余限制。没有这些证据，维持 M1 in_progress。

## 实施跟踪

修复代码、五个托管工具、卡片摘要、认证/部署/报告与必需 validator 已落入当前 worktree。工程检查与独立 3082 部署继续验证；最终可复现运行记录位于 `../.scratch/midscene-runtime/remediation-verification.md`，该运行记录在工作区外，避免验收自身写入改变源码身份。未达到全部工程及真实运行门槛前，M1 保持 in_progress。
