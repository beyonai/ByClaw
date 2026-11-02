# @zhchxiao123/dsh-devflow-tool

[English](README.md) | 中文

模型侧的 devflow 工具：**`devflow_list`** 概览工作区任务看板，**`devflow_show`** 读取单张卡片，**`devflow_create`** 把聊天中商定的需求落成一张新 draft 卡，**`devflow_take`** 认领 ready 卡进入开发，**`devflow_transition`** 提交一次阶段移动，**`devflow_attach_artifact`** 登记阶段产物，**`devflow_read_artifact`** 读回一个 kind 最新的登记。全部是 [`ctx.devflow`](../devflow/README.zh.md) 之上的薄 Consumer；journal 回放、边合法性与拒绝语义都在缝后面，因此结构非法的 journal 会以指明文件与行号的工具错误浮出。每个工具都作用于调用会话的工作区：会话头部带 `cwd` 的 agent 读写 `<cwd>/.devflow`，没有的调用者使用 store 配置的默认根——同一 host 上不同工作区的会话看到不同的看板。

## 契约

`devflow_list({ stage?, parent?, topLevel?, serviceClass?, set?, month?, limit?, cursor? })` 返回**一页**：`{ cards, truncated, nextCursor? }`——每张卡的 id、标题、当前阶段、`stageRevision` 与可选的 `parent`。`stage` 收窄到一个位置（流水线阶段或 `blocked`），`parent` 收窄到一个需求的拆分，`topLevel` 只要需求本身而不要其切片，`serviceClass` 收窄到走捷径的流水线；`parent` 与 `topLevel` 选中的是互斥的集合，同时给出是用法错误而非空页。`set: 'archived'` 读取已入档的交付工作——这是拆解类似需求时的正当上下文——`month` 再把它收窄到某个 `YYYY-MM` 桶。被截断的一页会渲染出可直接续读的那次调用，因为一页不声明自己被截断，读起来就是整块看板。它保持精简，并指引模型在移动选中的卡片前先 show。

归档与恢复**不在**这里：它们和放弃一样是决策，只在 [`/devflow`](../devflow-command/README.zh.md) 命令面上。本工具读取档案；模型面没有任何东西写入它。`devflow_show({ id })` 返回卡片标题、阶段、`stageRevision`、可选的 `blockedFrom`、`parent` 及该卡的 `parentTitle`、`children` 摘要、卡片文件路径、已登记产物、可选的当前 artifact-gate 预检与完整 Markdown 正文——因此模型既能理解父子需求，也不必尝试一次 transition 才发现交付物契约。`devflow_read_artifact({ id, kind })` 返回该 kind 最新一次登记——路径、revision、登记阶段与内容；没有登记的卡以稳定的 `no-artifact` 消息报错。

挂载 `dsh-devflow-artifact-gate` 且当前阶段存在已配置、合法的出边契约时，`devflow_create`、`devflow_show`、成功的 `devflow_transition`、成功的 `devflow_take` 与 `devflow_attach_artifact` 都会带上 `artifactGates`：边、各必备 kind 的 `missing | malformed | satisfied` 状态、结构模板、最新登记与缺陷。创建结果还会渲染初始 `stageRevision`，模型无需额外读取即可登记第一份必需产物。创建和成功移动因此立即宣布目标阶段的工作；attach 则在不回滚不可变 journal 登记的前提下立即指出格式错误。没有适用契约时，可选字段及其渲染文本完全省略。

挂载 [`ctx.devflowSpec`](../devflow-spec/README.zh.md) 且卡片最新的 `spec-refs` 登记声明了 `## Scope` 小节时，同样这五个结果还会带上 `specRefs`：所声明的 id 前缀之下每篇架构文档一行，携带 id、标题、可选描述、路径与汇总后的 `fresh | stale | unevaluable` 新鲜度。**索引不携带正文**——正文经 `devflow_read_spec` 按需取，因此一张 scope 覆盖整包文档集的卡片在这里只花几行，而不是那些文档本身。scope 小节里每个非空行以它的第一个 token 作为 id 前缀，因此条目后面跟一段理由是可以的，列表止于下一个标题；前缀相互覆盖时同一篇文档仍然只有一行。缝未挂载、没有登记、或所声明的前缀查不到任何文档时，整个字段省略且不报错——卡片还没说清自己触及什么，是一张普通卡片的正常状态。登记存在却读不出 scope——文件读不到、没有 `## Scope` 小节、或小节之下没有条目——则改为携带一行 `specRefsWarning`，说明索引没有被提供：这张卡承诺过声明，沉默会被读成「没有文档」。本插件不把 spec 缝写进 `inject`，因此没有它的部署照常加载、渲染逐字节不变。

变更类工具要求归属的 agent 会话（非 agent 调用者在产生任何副作用前被拒绝）。`devflow_create({ title, body, slug?, parent? })` 以新分配的顺序号在 `draft` 创建一张卡——正文承载需求与验收标准，省略的 slug 由标题推导，`parent` 把这张卡挂到它所拆解的更大需求下；空标题、格式非法的 slug、输掉的顺序号竞争或非法父卡（不存在、本身是子卡、已结束）以携带缝的稳定消息的工具错误返回。`devflow_transition({ id, to, expectedRevision, reason? })` 解析并提交一次移动；过期的 revision、非法边、缺失的打回理由或策略否决以携带缝的稳定消息的工具错误返回。`devflow_take({ id, expectedRevision })` 取得卡片独占租约并将其从 `ready -> developing`；移动失败会在拒绝到达模型前释放租约，因此失败的 take 无副作用。`devflow_attach_artifact({ id, expectedRevision, ... })` 按当前阶段把阶段产物记入卡片历史，两种形式工具拒绝混用：`path` 登记调用方已写在卡目录下的文件；`kind` 加 `content` 由 store 自行写入 `artifacts/<rev>-<kind>.md`；登记不可变，同一 kind 再次登记写入新的以 revision 命名的文件，读取方取最新。每次移动的权威都是卡片的 `.devflow` journal，而调用 agent 的会话日志本来就以 `tool/call` 与 `tool/result` 记下了每次调用与它的结果；这些工具自己不再追加任何 devflow 形状的会话事件。

## 渲染意图

读取是 `read` 类的 `generic` 卡；变更是 `edit` 类的 `generic` 卡，以关键参数作为 `rawInput`。呈现器是参数的纯函数。

## Model Experience

### Tool schemas

#### What the model sees

生成的 [`devflow_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-devflow)：两个读取、建卡，加三个带 revision 校验的变更，描述携带阶段流水线（`draft, designing, ready, developing, reviewing, testing, done` 加 `blocked` 旁路）、拆分需求的 `parent` 关系、乐观并发契约与声明的输出 schema。描述只陈述单次调用的机制与义务；跨工具判断——何时建卡、如何拆分需求、被 veto 后如何返工——放在 [`dsh-devflow-guidance`](../devflow-guidance/README.md) 的 `devflow-workflow` skill 里按需加载，而不常驻每个请求。适用的单卡结果还会带上 artifact 预检，并在任一要求未满足时渲染明确的停止流转提示；还会带上按 scope 索引的文档清单，每行标注新鲜度——失效的文档绝不会被当作现行的交出去。

#### Token effect

插件激活期间每次请求固定的 schema 成本；结果与列出的卡片或所示卡片正文成正比。

#### KV Cache effect

插件作用域不变时前缀稳定；激活或卸载可能使工具 schema 段及其后的复用失效。

## Known Limitations and Deferred Work

- **无编辑器跟随定位** — 呈现器是调用参数的纯函数，而卡片路径是 Provider 的部署状态，所以 `presentCall` 无法指名卡片文件；show 的结果值以 `path` 字段代替。
- **工具不为已取租约心跳** — `devflow_take` 只认领不做后台心跳；`/devflow takeover` 是遗留持有者的显式恢复平面。
- **scope 列表是约定而非契约** — 产物门禁可以要求 `spec-refs` 登记带上 `## Scope` 小节，但没有任何东西检查小节里的 id 指向真实存在的文档。前缀写歪了就查不到任何东西，索引直接不出现：是沉默，不是缺陷报告。
- **文档新鲜度在每次单卡调用时重新求值** — 没有缓存，所声明的 scope 覆盖多少篇文档，索引就是多少次求值。
