# Agent Note: devflow — 产物种类与 store 代写内容

Status: implemented

[English](2026-08-27-devflow-artifact-kinds-and-store-written-content.md) | 中文

## Problem

产物登记原本只是一条裸路径：调用方把文件写到卡目录下的某处，`attachArtifact` 记下那个字符串。没有任何字段说明这份交付物*是什么*，因此没有消费者能问出"这张卡的评审结论"——而这正是规划中的验收门禁切片需要的词汇。更糟的是，这些文件唯一的写入者是调用 agent 自己的文件工具，而 `dsh-devflow-fs-guard` 刻意在 `.devflow/` 下拒绝它们：想存交付物的模型根本没有合法的写路径。

transition 门禁有一个平行的缺口。已提交的条目至多记录一个人工审批签名（`gate: { approvedBy }`），没有 agent 门禁裁决的落点——而且即便条目有这个落点，`devflow/transition` waterfall 的 `TransitionDecision` 也带不过去，因为 provider 只映射 `approvedBy`。

## Decision

**登记新增代写形式。** `ArtifactRequest` 是联合类型：一如既往的引用形式（`path`），或 `kind` 加 `content`——文件系统 provider 在 journal 追加*之前*于 host 侧以 temp + rename 写出 `tasks/<id>/artifacts/<rev>-<kind>.md`。追加仍是唯一提交点：输掉锁内 revision 复核或取锁预算的登记只留下一个任何读取都不会呈现的无引用文件，同 revision 的重试会覆盖它。`kind` 遵循 slug 语法；否则是稳定的 `invalid-kind` 拒绝，形状同 `invalid-slug`。

**登记不可变；最新者胜。** 同一 kind 再次登记写入新的以 revision 命名的文件，读取方取 revision 最高的记录。没有任何东西被删除或原地编辑，journal 始终是每个交付物版本的真实历史。

**读取呈现记录，而不只是路径。** `foldArtifactRecords`——与 `foldJournal` 并列、基于同一批已解码条目——折出 `DevCard.artifactRecords`（路径、可选 kind、journal revision、登记阶段）；`DevCard.artifacts` 仍是该列表的路径投影，所有既有消费者形状不变。`foldJournal` 自身的返回形状未动，这正是所有 kind 之前的 journal、fixture 与测试能原样回放的原因。

**门禁挖好了槽。** `JournalTransition.gate` 是 `{ approvedBy?, checks? }`——两者皆可选，既有的 `{ approvedBy }` 条目解码不变，而两者皆无的 gate 依旧解码失败。`TransitionDecision` 的放行分支携带 `checks?: GateCheck[]`，provider 把非空列表记入条目；形状现在就被解码测试钉住，先于将来产出裁决的门禁包。

**工具面。** `devflow_attach_artifact` 接受任一形式，混用或残缺的调用在触达缝之前即被拒绝；`devflow_show` 列出登记的 kind、阶段与 revision；新增的 `devflow_read_artifact({ id, kind })` 返回最新一次登记的内容，或稳定的 `no-artifact` 错误。读取工具以 `dirname(card.path)` 加 journal 记录的相对路径定位文件，不复述任何 provider 布局。

## Alternatives considered

**让 agent 写文件、只登记路径。** `dsh-devflow-fs-guard` 存在的意义正是把 agent 文件工具挡在 `.devflow/` 之外；为 `artifacts/` 开口子等于向被围住的执行器重新打开受保护的状态目录。代写形式让防护保持绝对——文件以内容形态穿过缝。

**先追加 journal 条目、后写文件。** 条目将引用一个可能永不出现的文件；两步之间崩溃会产出读者打不开的已登记产物。文件先行把失败模式反转为无引用文件——是垃圾，不是损坏——重试语义靠覆盖顺手清理。

**每个 kind 一个规范的 `artifacts/<kind>.md`，登记即覆盖。** 丢历史、破坏不可变性：刚解析出交付物的消费者不能与一次重写竞速。以 revision 命名的文件让"最新"成为 journal 事实而非 mtime 猜测，代价是被取代的文件会累积到归档为止。

**把记录扩进 `foldJournal` 的状态。** fold 的每个消费者——包括断言其精确形状的仓库外 fixture——都会看到新键；基于同一批条目的并列推导在不动既有词汇的前提下加入新词汇。

**保持 `gate.approvedBy` 必填、把 checks 放在 gate 旁边。** 只有 checks 的门禁——无人在环的 agent 裁决，将来的常见情形——将无法表达，而条目上两个并列可选字段表达的东西不如一个 `gate` 对象。

## Consequences

- `devflow-web` 的 wire 现在隐式携带 `artifactRecords`：路由整体序列化 `DevCard`，provider 一发出该字段它就到达浏览器。看板 UI 的详情表单如今读取这些记录——kind、登记阶段、revision 与同 kind 最新标记——见[详情渲染 Agent Note](2026-08-27-devflow-ui-artifact-and-verdict-detail.zh.md)。
- 输掉的提交可能留下孤儿 `artifacts/<rev>-<kind>.md`。这是被接受的垃圾：任何读取都不可见、被同 revision 的重试覆盖、随卡片整体归档。
- [LLM 准入闸门](2026-08-27-devflow-agent-gate-llm-admission.zh.md)落地后，`gate.checks` 有了生产者：该闸门的裁决就是详情表单时间线渲染的已记录 check。
- `devflow-ui` 的时间线曾假设只要有 `gate` 就有 `gate.approvedBy`；现在只在签名存在时显示审批备注——这是本变更在三包之外触碰的唯一文件，由类型放宽所迫。
