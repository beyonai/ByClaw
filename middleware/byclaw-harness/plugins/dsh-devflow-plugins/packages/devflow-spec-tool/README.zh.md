# @zhchxiao123/dsh-devflow-spec-tool

[English](README.md) | 中文

**[spec 缝](../devflow-spec/README.zh.md)的模型侧半边**：`devflow_write_spec` 提交一篇架构文档。它是 `ctx.devflowSpec` 之上的薄 Consumer——id 合法性、结构契约与 anchor 求值都在缝后面，因此这里的拒绝携带缝自己的稳定 code。

## 契约

`devflow_write_spec({ id, title, description?, body, anchors, replaces?, waives? })` 提交一篇文档，返回它的 id、路径、anchor 数量与被它替换掉的 id。

- `id` 是以斜杠连接的 scope 路径（`@scope/package/backend/error-handling`）；每段必须匹配 `^[@a-z0-9][a-z0-9._@-]*$`，且**拒绝发生在 id 层面，早于任何路径拼接**。
- `body` 必须带 `## Source of truth` 小节，并以 `[[id]]` 引用每一个声明的 anchor。
- `anchors` 至少一条。`symbol` 与 `content-hash` 还需 `symbol`。`content-hash` 通常**省略** `hash`：本线之外没有调用方算得出那个摘要——它取自解析器规范化后的符号体——因此由 store 记录该符号当前的摘要。找不到的符号会让它无法解析，写入被拒绝。
- `replaces` 列出被这篇取代的已有文档；它们会被删除（历史留在 git 里）。列**文档自己的 id 即原地修订**；列**多个 id 即合并一簇**——当两篇文档已经在说同一件事时，该做的是合并而不是添第三篇。这是文档集收缩的唯一途径：写入已存在的 id 而不在此列出，以 `exists` 拒绝；列出的 id 不存在，以 `unknown-replaced` 拒绝。store 对单次写入的**净**增长设预算——新文件字节数减去所有被替换者——超出上限以 `budget-exceeded` 拒绝，因此合并永远不会因为体量大而被拒。
- `waives` 列出本文档裁定为**不需要**属于自己的架构文档的 scope，是精确 id 而非前缀，这样一次豁免不会悄悄罩住尚不存在的包。理由写在正文里。写入不会为它放宽任何一条规则——同样的 `## Source of truth` 小节、同样的 anchor、同样要求全部 fresh——因此**豁免不可能是占位符**，而且它不会比自己的理由活得更久：这些 anchor 不再解析得通时文档变 stale，`/devflow spec` 会把该豁免报成"存疑"。列出文档自己所在的 scope 以 `self-waiver` 拒绝，因为那个 scope 已经有文档，是已覆盖而不是豁免。

写入时每个声明的 anchor 都必须求值为 `fresh`——**一篇文档不得一出生就是过期的**。拒绝以工具错误浮出，前缀是缝的 code，即封闭的 `SpecWriteRejectionCode` 集合：`invalid-id`、`missing-source-of-truth`、`no-anchors`、`duplicate-anchor-id`、`uncited-anchor`、`unknown-anchor`、`unknown-replaced`、`exists`、`anchor-unresolvable`、`budget-exceeded`、`self-waiver`。

本工具要求归属的 agent 会话；没有会话的调用者在产生任何副作用前被拒绝。

**这是文档抵达磁盘的唯一途径**，而且是被强制的而非仅仅"本意如此"：spec 根位于 `.devflow/` 之下，而 [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.zh.md) 拒绝文件工具写入该子树。

`devflow_read_spec({ id })` 把一篇文档读回来，其 anchor 对当前代码求值：正文、摘要字段，以及每个 anchor 一条裁决。**文档不是 `fresh` 时，渲染文本会带一行告警**并点名失效的 anchor——一个只返回正文的读取工具会把本缝赖以存在的那个信号丢在传输层，而读者无从知道它丢了。正文照常返回：一篇过期文档配上告警仍然值得读。读取没有副作用，但仍要求归属的 agent 会话：两个文件系统根都从会话的工作目录解析，从不取进程 cwd——没有会话的调用者根本没有可读的 spec 根。

一份让卡片声明自己触及哪些文档的样例组合——该 kind 的 `References` 条目**不**受结构校验，只校验小节存在，因此条目质量若要强制，属于准入门禁：

```yaml
- name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      spec-refs:
        sections: [Scope, References]
    edges:
      'draft->designing': [prd, spec-refs]
```

`draft->designing` 只是标准路线的边：`express` 与 `emergency` 经 `draft->developing` 进入工作，根本不经过它，所以这份契约照原样写下时约束不到它们的任何一张卡。采用它的部署要么接受只覆盖标准路线，要么把该 kind 同样配在 `draft->developing` 上——两者都站得住，但它必须是一个决定。整条产物路线是 opt-in 的纸面记录：默认组合里对 spec 漂移的反应是 [`dsh-devflow-spec-sentinel`](../devflow-spec-sentinel/README.zh.md) 的 turn 末哨兵与 pre-step 索引，不涉及任何卡片级声明。

### 收口：`spec-delta`

出口处的对应物。`spec-refs` 让卡片说清将要触及什么；`spec-delta` 让它说清工作产出了什么，并对每一条产出说明**该由哪一层强制**。与 `spec-refs` 一样，它是 opt-in 的：默认组合已经通过哨兵对过期文档自动做出反应，这个产物是给那些还想要每卡一份书面分诊的部署准备的：

```yaml
- name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      spec-delta:
        sections: [Changes, Classification, Verdict]
        nonEmptySections: [Classification, Verdict]
    edges:
      'testing->done':    [spec-delta]
      'reviewing->done':  [spec-delta]
      'developing->done': [spec-delta]
```

**三条终态边全配，不是只配 `testing->done`。** 服务类别是**加边**而非替换：`express` 从 `reviewing` 到达 `done`，`emergency` 从 `developing` 到达——只写标准路线的契约，恰好放过了那些跳过评审的卡片，而且是静默放过，没有任何地方会说这张卡从未交过 `spec-delta`。`emergency` 该不该豁免是部署方的决定，但它必须是**一个决定**。

`nonEmptySections` 是让这份必填分诊不止于一个标题的东西。底下什么都没有的 `## Classification` 能通过存在性检查，却什么也没回答。

**Classification 把每条产出分进两个归宿之一。** `reference`（该知道，但不是每次都相关）经 `devflow_write_spec` 成为文档，以索引行的形式到达后续卡片。`obligation`（不遵守就是错）属于一套常驻并由校验脚本强制的规则集；挂了 [`dsh-devflow-iron-rules`](../devflow-iron-rules/README.zh.md) 的部署经 `ctx.get('devflowIronRules')` 的 `record(agent, input)` 转发，回执就是那次调用的返回值，而不是谁手打的一段散文。**没挂那条缝的部署没有安放 obligation 的地方，必须明说**——模板允许一条显式的「本部署无 obligation 去处」裁决，因为另一种结果是 obligation 悄悄变成 reference。

门禁能机械查的到此为止：小节存在、其中两节非空。分诊是否诚实、`no-change` 的理由是否**针对这张卡**、`obligation` 行有没有带上它的规则 id——这些是语义判断，归准入门禁：

```yaml
- name: '@zhchxiao123/dsh-devflow-agent-gate'
  config:
    edges:
      'testing->done':
        prompt: |
          读这张卡的 spec-delta 产物，判三件事。
          1. 每条产出都标了 `obligation` 或 `reference`，没有骑墙的行。
          2. `no-change` 裁决给出的理由针对**这张卡**。「本卡无 spec 变更」不算；
             「改动局限在测试夹具，没有任何文档描述它」算。
          3. 每条 `obligation` 行写明了它被记录成的规则 id，且**不**同时写 spec 文档 id
             ——一条产出同时落在两处，就是两份将来必然打架的事实来源。
          否决时引用不合格的那一行。
```

## 呈现意图

两个呈现器都是参数的纯函数：写入呈现 `edit` 类的 `generic` 卡，`rawInput` 为文档标题；读取呈现 `read` 类的，`rawInput` 为 id。

## Model Experience

### Tool schema

#### What the model sees

两个工具。写入工具的描述明说 anchor 纪律——anchor 正是让一篇文档能自我失效的东西，读者会被告知文档已过期而不是照着它做——因为把 anchor 当成登记手续的模型，会写出通过结构契约却什么都保护不了的文档。它还说明每次写入落地的都是一整篇新文档、修订与合并走 `replaces`，于是被 `exists` 拒绝的模型会伸手去用那个字段，而不是造一个近似重复的 id。`waives` 的描述把篇幅花在"它不是什么"上：把该字段读成"免写文档的逃生舱"的模型，会一路豁免着绕开普查，因此描述明说承载豁免的文档要通过全部普通规则、理由因而必须落在可核查的代码上、以及那段代码一动豁免就转为存疑。读取工具的描述说清裁决的含义：过期的文档必须先对照代码核实再遵循。

#### Token effect

插件激活期间固定的 schema 成本。写入结果是四个短字段；读取结果携带整篇正文，成本随文档大小变化。

#### KV Cache effect

插件作用域不变时前缀稳定；激活或卸载可能使工具 schema 段及其后的复用失效。

## 撰写 skill

本包附带 [`skills/dsh-write-spec`](skills/dsh-write-spec/SKILL.md)：一篇文档该论断什么、哪一类 anchor 才抓得住你真正担心的那种变化、以及什么情况下一条论断根本不配拥有一篇文档。给一个包写第一篇文档之前先读它——结构契约分辨不出「锚得好的文档」和「随手锚了容易锚的东西的文档」。

## 哪个面回答哪个问题

`devflow_read_spec` 是正文面，而且刻意不是发现面。跨三个包的四个面回答四个不同的问题，问错面正是「这个 scope 有哪些文档」被当成「这个 scope 覆盖够了没有」的方式：

| 问题 | 回答者 | plane | 默认组合里 |
|---|---|---|---|
| 这次会话触达过的文件被哪些文档主张，以及这些包还有哪些文档 | [`dsh-devflow-spec-sentinel`](../devflow-spec-sentinel/README.zh.md) 的 pre-step 索引 `devflow-spec-map` | 模型面，推送 | 开 |
| 这张卡声明的前缀下有哪些文档 | [`dsh-devflow-tool`](../devflow-tool/README.zh.md) 在单卡结果上携带的 `specRefs` 索引 | 模型面，随单卡结果 | 关 |
| 整个集合是什么样，每个期望 scope 覆盖到什么程度 | `/devflow spec` 的普查（[`dsh-devflow-command`](../devflow-command/README.zh.md)） | 人面 | 开 |
| 这一篇文档说了什么 | `devflow_read_spec` | 模型面，按需应答 | 开 |

**pre-step 索引是推送的，问不了它。** 它不花工具调用，无话可说时整段从 prompt 里消失；但一个 scope 只能靠会话真正发生过的第一方 `read`/`write` 进入它——`grep` 不算入场。触达集每层保留固定的 64 条 recency 窗口，渲染后的索引按字节封顶：承载「这个包还有哪些文档」的 scope 层是**第一个被丢**的，而且每次丢弃都在索引里声明。

**卡片索引同样是声明出来的，不是问出来的。** 单卡结果携带它需要四件事同时成立：`devflowSpec` 缝已挂载、当前有一张卡、这张卡登记过 `spec-refs` 产物、且该产物可读并在 `## Scope` 标题下至少有一条目。登记通常来自 `dsh-devflow-artifact-gate`，而它在默认组合里是禁用的。

**普查只给计数，不给清单。** 它不接参数，而且 `documented` 的 scope 那一行给的是文档**数量**而非 id——一篇覆盖着期望 scope 的 fresh 文档，它的 id 在整份报告里根本不出现。id 只因两种原因露面：文档不是 `fresh`，或者文档豁免了某个 scope。普查拥有的是另一样东西：每个期望 scope 的三态裁决，以及它被度量于其上的可锚文件计数——「覆盖够不够」正是据此判断的。

## Known Limitations and Deferred Work

- **没有按 scope 列举的工具。** `devflow_read_spec` 需要一个 id，而这里没有任何东西接受一个 scope。但缺的这块比听上去窄：一个已经在某 scope 里干活的会话是被**告知**而非发问的——pre-step 索引在每一步之前推送该包的其余文档，默认组合里就开着，且不花工具调用；而「这个 scope 覆盖够了没有」是一个 coverage 问题，归 `/devflow spec` 在人面回答。真正缺的是：模型侧没有办法去问一个本会话**未曾触达**、也没有卡片声明过的 scope。这件事没有当前消费者，而且要诚实地回答它，就得携带期望 scope 集（一个期望之内却没有文档的 scope，与一个根本没人期望的 scope 不是一回事）并做一次全集扫描以找出豁免（豁免一个 scope 的文档住在另一个 scope 下）——那是一台按 scope 切片、架在模型面上的普查，被拒绝的理由与全集普查不做成工具的理由是同一条。

- **没有局部编辑。** 存储以整篇文档为单位：经 `replaces` 修订意味着重新给出完整正文，而不是修补其中一部分。
