# Agent Note：devflow——大需求是一张父卡加若干子卡

Status: implemented

[English](2026-08-26-devflow-requirement-breakdown.md) | 中文

## Problem

卡片模型此前完全扁平：id 是全局分配的目录名，`DevCard` 不持有指向其他卡片的引用，四种 journal 条目也没有一种能表达关系。于是一张卡装不下的大需求只有两种糟糕形态——整份需求塞进一张卡（一个租约、一个 revision，因此无法并行，driver 还会把整份需求当作 objective 交给子代理），或者开 N 张互不相干的卡（没有位置回答"这个需求做到哪了"，`archiveDone` 还会把同族卡片散进不同月份桶）。PRD（`.agents/prd/2026-08-26-devflow-requirement-breakdown.md`）要求引入一条组成边以及围绕它的规则。

## Decision

父卡边是卡片上的数据，创建时固定：

- **边写在 journal 的 `created` 条目里**（`parent`），因此权威、可回放、不可变——`foldJournal` 把它折出为 `DevCard.parent`，frontmatter 的 `parent:` 与 `stage` 一样只是投影。不存在改挂条目类型；挂错了就重开一张卡。
- **一层，同根。** provider 在预定任何目录之前校验请求中的父卡，并以三个稳定 code 拒绝：`unknown-parent`（不在该根的 `tasks/` 里）、`nested-parent`（父卡自身带 parent）、`parent-settled`（父卡已 `done` 或已在该根的归档里）。一层同时消除了环路检测与递归汇总；同根则是"按调用方已解析出的根去校验"的自然结果。
- **读取只收窄，不做聚合。** `CardFilter.parent` 返回一张父卡的子卡；缝没有任何返回树的操作，也不存储 `children` 字段——父卡的拆分永远由一次列表派生，因此不会与卡片本身漂移。
- **消费者投影这条关系，不拥有它。** `devflow_create` 接受 `parent`；`devflow_show` 为子卡返回反链与 `parentTitle`、为父卡返回 `children` 摘要，于是只拿到子卡的智能体能自己读到整个需求，而不必让每张子卡的正文复制一遍上下文；`devflow_list` 每行带 `parent` 并可按其过滤；`/devflow` 把子卡缩进排在父卡之下。父卡已离开活跃集的子卡保留裸反链，而不是让视图失败。Web 侧栏把同一条关系投影为[父需求泳道](2026-08-31-devflow-stage-centric-kanban.zh.md)，紧凑替代视图与悬浮面继续使用缩进行；两者都只从本来就要取的列表派生，因此这套层级不需要任何 Remote 面、也不需要第二次拉取。
- **不变量伴生插件在事件流上强制这一层深度**：`devflow/card-created` 不得把新卡挂到流中已知为子卡的 id 之下（与其他 devflow 关系一样按 root + id 建键）。

完成语义落在缝之外，落在已经存在的扩展点上：

- **门禁是自成一包的 `devflow/transition` 监听器**（`dsh-devflow-parent-gate`），不是 store 规则：只要有子卡不在 `done`，父卡到 `done` 的移动即被否决，理由点名未完成的子卡及其阶段。没有组合该插件的部署保留关系但没有强制。
- **被卡住的边是 `-> done`，不是更早的边。** 在流水线更上游拦住父卡，会让它在切片完成后还要走一遍 `ready → developing → reviewing → testing` 的形式；只卡最后一条边，父卡自己的 `reviewing`/`testing` 就成了对已完成子卡的整合验收。
- **归档搬的是族，不是卡。** 父卡仍在看板上时，已完成的子卡陪它留下；整族落进**父卡**的月份桶——否则一个需求的历史会散进不同月份，而那正是档案本该保住的东西。

## Alternatives considered

- **层级 id（`0007.1-slice`）**——拒绝：它同时破坏全局 `nextSequence` 分配器、branded id 的不透明性与"id 即目录名且永不改变"，换来的只是目录列表更好看。
- **带派生状态机的 `kind: epic` 卡**——拒绝：要么在闭合的 `DevStage` 联合之外再开一套生命周期，要么做跨卡级联提交（一次 transition 写两个 journal、两个 revision），是第一个切片里能选的最贵改动。
- **批量 `devflow_split` 工具**——拒绝：N 次 `devflow_create` 已经够用，批量原子性没有当前消费者，部分失败可以续建。
- **把 epic 存成文档而非卡片**——拒绝：这会让 epic 级验收标准与进度无处安放，"在聊天里创建一个大需求"也就没有对应工具。
- **把完成规则并进 `dsh-devflow-gates`**——拒绝：那个包的角色是在某条边上运行配置好的门禁命令；关于卡片组成的结构性规则是另一种策略、另一套配置（没有配置），应当与它并列而非塞进它。
- **最后一张子卡完成时自动推进父卡**——拒绝：门禁只拒绝，不做决定；需求自身的整合工作并不因切片做完而自动成立。

## Consequences

聊天里可以把一个需求拆成父卡加子卡，命令面能读回这个结构，"需求完成"也有了机器判据：全部子卡完成，加上父卡自己走完流水线。看板（`list`）本来就把 `parent` 送到浏览器，因此 Web 层级视图不需要新增任何 Remote 面。这条边出现之前写下的 journal 照常回放为顶层卡；没有组合父卡门禁的部署仍保留关系，只是不执行完成否决。
