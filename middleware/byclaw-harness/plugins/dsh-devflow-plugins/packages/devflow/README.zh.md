# @zhchxiao123/dsh-devflow

[English](README.md) | 中文

**`ctx.devflow` 能力缝的 Service Definition**：以文件为载体、沿固定研发流水线移动的任务卡。本包拥有卡片词汇（`DevCard`、`DevStage`、journal 条目类型、branded 的 `DevflowCardId`）与供所有消费者共用的 journal 解码/回放。存储属于 [`dsh-devflow-filesystem`](../devflow-filesystem/README.zh.md) 这样的 Provider；模型工具是 [`dsh-tool-devflow`](../tool-devflow/README.zh.md)。

## 服务

`DevflowStore` 是注册在 `ctx.devflow` 上的抽象 Cordis `Service`（每个 context 只允许一个实现；重复注册抛错）。

每个操作都携带显式的 **devflow root** 维度：读取带可选的尾参 `root`，请求携带可选的 `root` 字段并解析进各自的 spec，`ClaimOptions` 为租约携带一个。省略的 root 回退到实现配置的默认根，单根部署因此完全不用提它；返回的 `DevCard` 永远标明其所属的已解析 `root`，不同根下 id 相同的卡是不同的卡。调用方传哪个根由调用方决定——模型工具与 `/devflow` 从发起会话推导 `<会话 cwd>/.devflow`，缝本身从不做工作区到目录的映射。按会话取值的那两个读是唯一的例外，因为它们的调用方是绝不能发送路径的浏览器：`listForSession` 与 `detailForSession` 接收*查看会话的 id*，在 host 侧（经可选组合的 `sessions`/`sessionPersistence` 服务读取活跃或持久化会话头部的 cwd）解析成同一个 root 维度；未知会话是稳定拒绝。`detailForSession` 把一张卡的读值、已解码 journal 与租约持有者(`DevCardDetail`)聚合为一次往返，供看板的详情视图使用，并在流转撕开这对读取时重读一次。把这两个读搬到浏览器通道上的是 [`dsh-devflow-web`](../devflow-web/README.zh.md)。

| 方法 | 行为 |
|---|---|
| `list(filter?, root?)` | 一个根的卡片，按 id 排序；`filter.stage` 收窄到一个当前位置，`filter.parent` 收窄到一张卡的子卡。 |
| `read(id, root?)` | 一张带 journal 推导状态的卡片；卡片缺失抛错。 |
| `history(id, root?)` | 卡片完整的已解码 journal,从旧到新,流校验与读取一致(结构非法的 journal 指明文件与行号 fail-loud)。 |
| `holder(id, root?)` | 卡片当前租约持有者(`ClaimHolder`:owner 加最后心跳),未认领为 `undefined`;损坏的 claim 记录 fail-loud。 |
| `resolveCreate(request)` | 显式默认值补全：把调用方的 `CreateRequest`（标题、Markdown 正文、可选 slug、actor、可选 parent、可选 root）变成完全确定的 `CreateSpec`——slug 省略时由标题推导，root 解析定型，并盖上创建时间戳。 |
| `create(spec)` | 创建一张卡：父卡校验 → 顺序号分配（越过归档卡续排，id 永不复用）→ 独占目录创建 → journal 首条 `created`（唯一提交点）→ 投影写入 → `devflow/card-created`。领域拒绝以稳定 code（`empty-title`、`invalid-slug`、`exists`、`unknown-parent`、`nested-parent`、`parent-settled`）解析为 `ok: false`；仅基础设施故障才 reject。 |
| `resolve(request)` | 显式默认值补全：把调用方的 `TransitionRequest` 变成完全确定的 `TransitionSpec`，带已解析的 root 与提交时间戳。 |
| `transition(spec)` | 提交一次移动：revision CAS → 边合法性 → `devflow/transition` waterfall → 跨进程 commit lock 与 journal 追加（唯一提交点）→ 投影重写 → `devflow/stage-changed`。领域拒绝以稳定 code（`revision-mismatch`、`illegal-edge`、`reason-required`、`vetoed`、`write-contended`）解析为 `ok: false`；仅基础设施故障才 reject。 |
| `claim(id, owner, options?)` | 取得卡片的独占租约；租约已被持有时解析出当前持有者——除非 `options.staleAfterMs` 判定其心跳已过期，此时一个并发调用者在 commit lock 下写入 `claim-expired` 并替换租约。锁竞争让观察到的持有者保持原位。 |
| `attachArtifact(request)` | 按当前阶段在 journal 登记一个阶段产物，两种互斥形式二选一：引用形式登记调用方已写在卡目录下的 `path`；代写形式交出 `kind` 与 `content`，由实现在 journal 追加之前自行写入 `artifacts/<rev>-<kind>.md`——追加仍是唯一提交点，输掉提交则什么也没登记，其无引用文件会被同 revision 的重试覆盖。登记不可变：同一 kind 最新的记录就是该 kind 的当前内容。`blocked` 或 `done` 时拒绝，并可能返回 `revision-mismatch`、`illegal-edge`、`invalid-kind` 或 `write-contended`；结果携带登记的 `ArtifactRecord`。 |
| `query(query?, root?)` | 读取一个集合的一页：与 `list` 共用的谓词，外加 `set`（`active` / `archived` / `all`）、归档 `month` 桶、`limit` 与不透明 `cursor`。返回的 `CardPage` 始终声明结果是否被 limit 截断。读取在页满时即停，而非全读再切片——但收窄本身并不省 I/O，因为必须先加载卡片才能判定谓词。谓词自相矛盾、月份格式非法、limit 非正整数、或游标并非本 store 签发时抛错。 |
| `archive(request)` | 把一张 `done` 卡归入该根的档案：revision CAS → `archived` journal 追加（唯一提交点）→ 目录移动 → `devflow/card-archived`。需求与其已完成的子卡一同归档并共享同一月份桶；子卡不能先行（`parent-active`）。领域拒绝以稳定 code（`not-done`、`already-archived`、`parent-active`、`revision-mismatch`、`write-contended`）解析为 `ok: false`。级联部分提交后不回滚——journal 是追加式的，重试会跳过已归档的那些。 |
| `abandon(request)` | 记录「不做了」这个决定：`abandoned` 追加是提交点，随后卡片目录按**撤回所在的月份**移入档案。理由必填——一张被撤下看板的卡，理由是它仅存的交代。终止性：其后不可再有任何条目，`restore` 也会拒绝它。子任务仍在进行的需求会被 `children-active` 拒绝并点名它们，因为撤掉它会把子卡留在一张已不存在的卡之下；子任务全部交付的需求可以撤回，并把它们一并归入同一月份桶，记为 `archived` 而非 `abandoned`——它们确实交付过。其余拒绝：`empty-reason`、`already-done`（已交付的卡由归档收走）、`archived`、`revision-mismatch`、`write-contended`。 |
| `restore(request)` | 把一张归档卡按其 journal 已记录的阶段送回活跃集合：`restored` 追加是提交点，目录移回随后发生，然后 `devflow/card-restored`。恢复改变的是可见性，不是进度。拒绝码：`abandoned`（终态，正确做法是新建卡片）、`not-archived`、`revision-mismatch`、`write-contended`。 |
| `archiveDone(root?)` | 通过与 `archive` 相同的提交路径，归档一个根中每张符合条件的 `done` 卡；拆分需求以族为单位归档（已完成的子卡等待其需求，随后并入该需求的桶）。按 id 顺序返回归档的 id。 |

当前状态永远来自 journal 回放；卡片文件的 frontmatter 是可重建的投影。实现必须在 journal 结构非法时读取即失败（指明文件与行号），在投影漂移时告警并覆盖，且只在 journal 提交之后发布状态与通知。合法边（`isLegalTransition`）：流水线顺序、`reviewing`/`testing` 打回实际拥有缺陷的阶段——实现问题回 `developing`，设计问题回 `designing`——任意非终态进入 `blocked`、且只能恢复到被打断的那个阶段。`done` 双向都是终态：已交付的卡片不会被重新打开，后续工作是新开一张卡而不是复活旧卡。归档卡在恢复之前，任何写入都会得到 `archived` 拒绝码。无 `reason` 的打回边（`isReworkEdge`）以 `reason-required` 拒绝，下一个持有者永远知道要修什么。

## 阶段与 journal

`DevStage` 是闭合联合 `draft | designing | ready | developing | reviewing | testing | done`；`blocked` 是记住被打断阶段的旁路位置（`CardLocation = DevStage | 'blocked'`）。journal 条目联合为 `created | transition | artifact | claim-expired`，由 `decodeJournalEntry`（持久化边界校验器）解码、`foldJournal` 折叠，后者强制：revision 从 1 连续、`created` 必须且只能是首条、transition 必须从当前位置出发、blocked 恢复必须回到被记住的阶段。

`artifact` 条目可以携带 `kind`，指名一次代写登记的产物种类；不带 kind 的条目解码与折叠与从前完全一致。`foldArtifactRecords` 把每次登记折出为一条 `ArtifactRecord`（路径、可选 kind、journal revision、登记阶段），以 `DevCard.artifactRecords` 呈现，`DevCard.artifacts` 仍是其路径投影。`transition` 条目的 `gate` 记录放行这次移动的事实：策略监听器附在放行的 waterfall 决策上的人工审批签名（`approvedBy`）与/或门禁裁决（`checks`）——两个字段皆可选，既有的 `{ approvedBy }` 条目解码不变。

一张卡装不下的大需求拆成**一张父卡加每个切片一张子卡**。这条边就是 `created` 条目的 `parent`，因此创建时即固定、可回放、永不改指；`foldJournal` 把它折出为 `DevCard.parent`，frontmatter 的 `parent:` 是其投影。拆分只有一层——带 `parent` 的卡自身永远不会成为父卡——父卡与子卡始终同根。哪些卡可以接子卡是 provider 的创建期决策（`unknown-parent`、`nested-parent`、`parent-settled`）；缝本身不持有"父卡阶段与子卡阶段如何关联"的任何规则。

## 事件

| 事件 | 模式 | 含义 |
|---|---|---|
| `devflow/transition` | `waterfall` | 提交前的单决策管线，以完整 `TransitionAttempt`（spec 加出发位置）分发；拥有决策的策略监听器不调 `next()` 直接返回 `{ allowed: false, reason }`，放行的决策可携带 `approvedBy` 与 `checks`，记入已提交条目的 `gate`。[`dsh-devflow-gates`](../devflow-gates/README.zh.md) 在此运行命令策略。 |
| `devflow/card-created` | `emit` | 一张新卡进入活跃集合：其 journal 提交了首条 `created`。 |
| `devflow/stage-changed` | `emit` | 一次已提交的流转后，卡片落在新位置。 |

不变量伴生插件校验 emit 流：`card-created` 只宣告从未见过的 id、处于 draft 且 revision 为 1 的新卡，且绝不把新卡挂到流中已知为子卡的卡下；每张卡的 `stage-changed` revision 严格递增，且每次通知都报告真实移动。

## Model Experience

Indirectly, through the model-facing tools in dsh-tool-devflow: the service interface itself registers no prompt or schema.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **档案没有压实机制** — 归档卡会无限累积；`query` 能分页读取它们，但没有任何东西会清理或汇总。
- **创建后无卡片编辑** — `create` 一次性固定标题与正文；改动卡片内容仍是按 Provider 磁盘格式直接编辑其 `card.md`。
