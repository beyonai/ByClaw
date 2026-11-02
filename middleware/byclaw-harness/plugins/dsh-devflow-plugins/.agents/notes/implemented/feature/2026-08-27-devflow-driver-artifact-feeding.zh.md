# Agent Note: devflow — driver 产物喂料与生产模板

Status: implemented

[English](2026-08-27-devflow-driver-artifact-feeding.md) | 中文

## Problem

**当前状态。**本 note 描述的包已不在发布线中；当前边界归[由 Harness 所有的执行决策](../architecture/2026-08-29-harness-owned-workflow-execution.zh.md)所有。本 note 继续保持 active，因为其中的上下文喂料方案和 token 成本权衡会约束未来任何后台编排器的重新引入。

产物契约的检查半边已经闭合——kind 上了缝、[机械门禁](2026-08-27-devflow-artifact-gate-mechanical-contract.zh.md)上了 waterfall、`devflowArtifactStructures` 为生产方发布——但生产方并不存在。被驱动的子代理只拿到卡片正文：开发子代理看不到它要照着实现的已登记 design，返工子代理看不到把卡打回来的 review 结论，也没有任何东西告诉子代理该交付哪个 kind、门禁会要求什么形状。子代理靠工具调用重新发掘上下文或者靠猜，第一个结构缺陷要等工作做完后才以门禁 veto 的形式浮现。

## Decision

**driver 每阶段新增两个可选配置字段：`inputs: string[]` 与 `produces: string`。**每次派发前，驱动器把每个 input kind 的最新登记内联进子代理 prompt——位于卡片正文与固定收尾契约之间，每份产物一行 `--- artifact <kind> (rev N) ---` 分隔符——`produces` kind 则追加用 `devflow_attach_artifact` 的 kind + content 形式登记交付物的指示。"一个 kind 的最新"是 `artifactRecords.filter(kind).at(-1)`，与门禁和读取工具依据的同一条缝保证；文件定位是 `dirname(card.path)` 加 journal 记录的相对路径——同一种推导，不复述任何 provider 布局。

**喂料是尽力而为的，与门禁的 fail-closed 检查相反。**无登记的 kind 静默跳过——返工循环第一轮本来就没有 review，缺席是常态而非缺陷。已登记但读不到的文件告警（带 `devflow-driver:` 前缀）并跳过那一份，派发照常进行：子代理仍可凭卡片正文工作，而拒绝派发会让看板因缺一段 prompt 上下文而停摆。门禁仍是执行点——它会拦住这张卡的下一次移动，直到磁盘交出该文件——所以 driver 再拦一道只会增加停摆，不会增加安全。

**模板来自 `devflowArtifactStructures` 服务，绝不来自第二份定义。**派发时驱动器读 `ctx.get('devflowArtifactStructures')`（可选服务，类型走 type-only 引入），把所产 kind 的 frontmatter 字段与 `## ` 章节标题渲染成骨架，与登记指示并列，让生产方按门禁所检查的同一份规格塑形文件。服务缺席、kind 未声明、或 kind 声明时没有结构，都降级为仅登记指示——子代理仍知道要登记什么，只是不知道它长什么样。

**误配置使加载失败；未配置时 prompt 逐字节一致。**超出缝的 kind 语法（复述：小写字母、数字、短横线，以字母数字开头）的 `inputs` 或 `produces` kind 在 `apply` 即抛错并指名配置项。两个字段都不配置的阶段产出与之前完全相同的 prompt——新增段落是空拼接——因此既有部署与既有测试套件都不受影响。

## Alternatives considered

**像门禁一样对读不到的输入 fail closed。**门禁的读取是它自己拥有的裁决的证据；driver 的读取是工作可以缺席继续的 prompt 上下文。停驻或跳过派发把降级的 prompt 变成停摆的看板，而腐坏仍会浮现——在下一次移动被门禁 veto 时，那里才是可行动的位置。

**让子代理自己通过 `devflow_read_artifact` 取上下文。**工具仍然可用，但子代理不知道哪些 kind 与它的阶段相关——那是部署知识，恰恰是阶段配置所编码的——而且每次派发每份产物都要付一轮模型往返。内联让最新 revision 在生成第一个 token 之前就位。

**自动喂入所有已登记 kind 而非配置清单。**登记随卡片生命周期累积；全部喂入让 prompt 无界增长，还会把测试子代理不需要的设计史塞给它。显式清单让 token 成本保持为部署决策，也让未配置阶段保持逐字节一致。

**在 driver 配置里复述所产 kind 的形状。**定义两处，模板与检查会漂移——正是发布 `devflowArtifactStructures` 服务要防止的失败。driver 读服务或降级；它绝不拥有规格。

**直接 import 门禁的规格值。**跨插件协作走服务名，绝不走值导入；门禁可能整体缺席，服务名以 `undefined` 建模这一点，值导入做不到。

## Consequences

- 配置 `inputs` 的每次派发都要付每份被喂产物的全文，每轮如此——README 的 Model Experience 一节承载 token 记账。约束过大的产物是部署的问题（选好 inputs），不是 driver 的。
- 子代理可能在上下文缺失（kind 未登记、文件读不到）的情况下被派发并在之后倒在门禁上；尽力而为的喂料用那一轮换取看板绝不因一段 prompt 点缀而停摆。
- driver 新增对 `@zhchxiao123/dsh-devflow-artifact-gate` 的 type-only 依赖（规格类型与服务的 Context 条目）；运行时耦合仍是可选服务名，没有门禁的部署只是无模板地运行。
- 缝的 kind 语法有了第三处复述（产物门禁、准入门禁、如今的 driver）；与 provider 的 `ARTIFACT_KIND` 的分歧是副本的缺陷。
