# Agent Note: devflow——机械产物契约门禁

Status: implemented

[English](2026-08-27-devflow-artifact-gate-mechanical-contract.md) | 中文

## 问题

缝已经有了带类型的交付物——产物 kind、store 代写内容、读值上的 `artifactRecords`——但没有任何东西强制阶段移动要有交付物背书。既有的瀑布策略查的是别的事实：`dsh-devflow-gates` 跑 shell 命令，`dsh-devflow-parent-gate` 数子卡。"这条边需要一份已登记的 design，而且这份 design 至少得长得像个 design"没有对应策略，于是一张卡可以完全没有设计就到达 `ready`，缺口要到几个阶段之后才以评审拉锯的形式暴露。

同一份规格还有第二个消费者在路上：driver 要把模板喂给产出交付物的环节。规格定义在两处，模板与检查就会漂移——产出的文件过得了一边、过不了另一边。

## 决策

**`devflow/transition` 瀑布上的一个只读函数插件**，`@zhchxiao123/dsh-devflow-artifact-gate`，形状照 `parent-gate`（无 store、无状态，一个监听器加不变量伴生）。配置声明 `kinds`——按 kind 的 frontmatter 字段与 `## ` 章节标题——和 `edges`，每条 `from->to` 边必备的 kind。没有表项的边不读卡片直接委派；配置错误（坏边键、kind 超出缝的语法、边引用未声明的 kind、列表里的空白条目）加载即失败并点名配置项，严格度照 `devflow-gates`。

**kind 的最新一份登记是检查对象。** 记录按 revision 顺序回放，一个 kind 的最后一条记录就是它的当前内容——与 `devflow_read_artifact` 的服务规则相同。纯路径登记不带 kind，永不匹配；被取代的登记是历史，不是证据。

**全部缺陷一次否决。** 缺 kind、文件读不到、缺 frontmatter 块或字段、缺章节——每次尝试全部收集，作为一个 `{ allowed: false, reason }` 返回且不调 `next()`，每条 `<kind>: <what>` 并点名文件。返工代理一轮看到全部差距，而不是每次尝试挤出一条。

**登记的文件读不到是否决，不是抛错。** journal 说文件存在而磁盘不给，是部署损坏；但抛错会把 transition 变成基础设施失败，没有任何可操作信息。否决文本点名文件、说明 journal 引用了磁盘不提供的东西，人可以据此修复状态。

**瀑布内严格只读。** 经 `ctx.devflow.read` 读取，文件定位为 `dirname(card.path)` + journal 记录的相对路径——与读取工具同一推导，不复述 provider 布局。这里不可能有任何 store 写操作：store 按卡串行，而瀑布就跑在持有该卡回合的那次 transition 里面，任何写都会进程内死锁。

**规格是服务。** `ctx.effect(() => ctx.provide('devflowArtifactStructures', frozen))` 发布校验后的规格——规范化、深冻结——disposer 随 fiber 移除。生产者经 `ctx.get` 读到门禁所检查的同一个对象，绝不值导入；类型走 type-only。

## 曾考虑的替代方案

**在 provider 的 `transition` 里强制契约。** 那会变成每个部署都要付费、任何部署都无法调节的缝规则。作为瀑布插件它与其他策略完全同构地组合：不装或不配置就是不强制，store 也永远不用学这套词汇。

**产物读不到就抛错。** fail-loud 是读侧规则，但这里的读只是为本插件拥有的裁决服务；抛错会以 transition 基础设施失败的面目出现，卡片卡住、原因埋在没人渲染的 rejection 里。否决通道本来就带着可读文字抵达调用方。

**碰到第一条缺陷就停。** 每次尝试更便宜，但返工循环就得一次一条地摸清契约——正是本门禁要在评审里消灭的挤牙膏。

**用 `foldJournal` 派生的路径而不是 `artifactRecords` 检查。** 路径投影没有 kind；拿文件名去匹配 `<rev>-<kind>.md` 等于复述 provider 的命名方案，而本插件本来对它只字未提。`artifactRecords` 存在的意义正是让消费者按 journal 事实匹配。

**让消费者读本插件的配置来拿规格。** 跨插件读配置不是缝；服务名才是。冻结的值同时保证生产者无法改动它正在对照的契约。

## 后果

- **瀑布顺序就是部署顺序。** 机械层只有排在命令门禁与审批之前才省工作；没有什么强制这一点，靠组合的行序。完整的四层排序叙述属于部署切片，不只属于本包 README。
- 一次被门禁的尝试多付一次卡片读加每个必备 kind 一次文件读；未配置的边零开销。
- `devflowArtifactStructures` 是已发布的表面，其消费者是 driver 的 `produces` 模板（[driver 产物喂料](2026-08-27-devflow-driver-artifact-feeding.zh.md)）；由服务渲染出的模板不可能偏离检查。
- frontmatter 切分是从 provider 复述的（首个 `---` 对，之间是 YAML）而非导入；与 provider 解析的分歧是这份拷贝的缺陷。
