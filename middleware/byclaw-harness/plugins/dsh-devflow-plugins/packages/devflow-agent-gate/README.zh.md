# @zhchxiao123/dsh-devflow-agent-gate

[English](README.md) | 中文

[`devflow/transition`](../devflow/README.zh.md) 瀑布上的 LLM 准入策略：配置的边派发一个**一次性 checker 子会话**——与产出这份工作的任何人相互独立——读取卡片与各配置 input kind 的最新登记，回以结构化裁决。放行随提交条目进入 `gate.checks`；否决把完整报告写入该卡片的 devflow root 并在拒绝理由里点名该文件；任何令 checker 无法真正运行的故障一律 **fail closed**：移动被否决且卡片停驻 `blocked`。生产者绝不自证，坏掉的 checker 也绝不放行。

## 行为

对带 `edges` 表项的 `from->to` 边上的尝试，门禁读取移动中的卡片，内联各 `inputs` kind 的最新登记（journal revision 最大的那条），并在配置的 subagent provider 上启动一个与生产者不共享历史的全新 checker 会话。由 agent 发起 transition 时，checker 沿用该在线 agent 最新请求的 provider 与 model，包括部署注入的会话级模型选择；其他场景使用部署当前默认模型。其 prompt 由配置的检查指令、卡片标题与正文、每份 input 及其 `--- artifact <kind> (rev N) ---` 分隔符、以及固定的裁决契约组成——要求一个 fenced JSON 裁决块 `{ "verdict": "allow" | "veto", "summary": "...", "findings": ["..."] }`。回复中最后一个可解析的块才算裁决，checker 引用契约原文不会被误读。

checker 获得一个按卡片工作区定域的合成父代理。该父代理显式携带 `agents` 注入，供后续 subagent prompt 组装读取；门禁本身仍动态解析 `subagents`、`agents` 与 `agentDefaultModel`，因此运行时缺失会让已配置边 fail closed，而不是悄然失去门禁。

- **放行**——门禁委派下游，当瀑布其余部分也放行时，把 `{ by: { kind: 'agent' }, verdict: 'allowed', summary }` 追加到 decision 的 `checks` 上，由 store 记入提交的 journal 条目，与下游策略收集的事实（人工 `approvedBy`、其它 check）同条目共存。下游的否决原样透传。
- **否决**——不委派直接拒绝：完整报告（summary、findings、检查时的 `kind:rev` 清单）写入 `<devflow root>/reports/agent-gate/<card>-<from>-<to>-r<revision>.md`，拒绝理由点名该文件。否决不是提交——无 journal 条目、revision 不变。
- **fail closed**——provider 未注册、subagent 运行时未组合、派发被拒、checker 超过 `checkTimeoutMs` 或异常退出、回复无可解析裁决、已登记的 input 文件读不到、否决报告写不进去：移动被否决且理由说明故障，卡片停驻 `blocked`（actor `command devflow-agent-gate`），让无人值守的运行停下来而不是反复撞同一故障——与 `dsh-devflow-gates` 在人工审批不可达时同一姿态。停驻移动排在被否决 transition 的按卡串行队列之后，绝不在瀑布内同步等待；恢复把卡送回原阶段后，重试正常再过一遍门禁。

没有表项的边不碰 store 直接委派。没有登记的 input kind 跳过而非否决——存在性与结构是 [`dsh-devflow-artifact-gate`](../devflow-artifact-gate/README.zh.md) 的机械契约，部署应把它排在本门禁之前。

## Config

```yaml
- id: devflow-agent-gate
  name: '@zhchxiao123/dsh-devflow-agent-gate'
  config:
    edges:
      'designing->ready':
        provider: spawn
        inputs: [prd, design, implement]
        prompt: Check that the design covers every PRD acceptance criterion and the implementation list starts with its test cases.
    checkTimeoutMs: 600000
```

| 键 | 默认 | 含义 |
|---|---|---|
| `edges` | `{}` | 每条 `from->to` 边的准入检查：checker 启动所用的 subagent `provider`、内联进 prompt 的 `inputs` 产物 kind（可选；未登记的 kind 跳过）、以及作为评判依据的 `prompt` 指令。没有表项的边不检查。 |
| `checkTimeoutMs` | `600000` | 一个 checker 从派发到裁决允许的毫秒数；超时按 fail closed 处理。 |
| `workspaceOnToolEnvironment` | `false` | 通过上下文的 `ctx.fs` / `ctx.subprocess` 读取输入并保存报告与裁决缓存，而不是本进程。 |

配置错误加载即失败并点名配置项：边键不是已知位置名的 `<from>-><to>` 形式、`provider` 或 `prompt` 为空白、input kind 超出缝的 kind 语法（小写字母数字与连字符、字母数字开头）、`checkTimeoutMs` 非正数。

## 裁决缓存

裁决以（边、root、卡片、排序后的 input `kind:rev` 对、指令 hash）为键缓存——这组键决定了 checker 看到的一切，因为卡片正文创建后不变、产物登记按 revision 不可变。完全相同的重试直接复用记录、不再派发：缓存的放行照常放行，journal check 的 summary 前缀 `[cached] `；缓存的否决直接拒绝并指向原报告。任一 input 登记新 revision 即换键、重新派发。

缓存是优化，不是权威。每个文件存完整键明细，命中要求逐字段相等（防文件名 hash 撞车的保险），人也能审计或删除单条缓存裁决；损坏的文件按未命中处理并告警，缓存写失败只告警，写入用 temp + rename 原子完成。故障从不缓存——缓存的只有裁决。

## 产物落在哪

无需配置。每一份产物都落在**正在流转的那张卡片自己的 devflow root** 下：

```
<devflow root>/
  reports/agent-gate/{card}-{from}-{to}-r{rev}.md
  cache/agent-gate/{key-hash}.json
```

落在 root **之内**而不是旁边，因为 [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.zh.md) 按目录名保护 root —— 于是被本闸门判决的那个 agent 无法用自己的文件工具改写这份记录。一个 harness 服务多个项目时，各项目的产物留在各自项目里，没有互相覆盖的路径。

## Model Experience

### Checker prompt

#### What the model sees

每个派发的 checker 的用户消息为：配置的 `prompt` 指令、`You are gate-checking devflow card <id> on edge <from>-><to>.` 一行、卡片标题与 Markdown 正文、各配置 input 的最新内容及其 `--- artifact <kind> (rev N) ---` 分隔符、以及固定的收尾契约：只按指令评判、作为只读 checker 不调用任何 devflow 或写文件工具、以一个 fenced JSON 裁决块结束回复。

#### Token effect

每次缓存未命中派发一个完整的子会话请求，长度与卡片正文加**全部**内联 input 产物加固定契约行成正比——在设计评审边上通常是 PRD、设计与实现清单同处一个 prompt。缓存命中零 token；未配置的边不给任何请求增加内容。

#### KV Cache effect

相互独立：每个 checker 都是全新一次性会话，与生产者或此前的检查不共享任何前缀——input 换 revision 后的重新派发要重新支付整个 prompt。

## Known Limitations and Deferred Work

- **裁决质量是部署的 prompt 责任。**本门禁保证 checker 会运行、是独立的、看得到声明的 inputs、且不可能 fail open——不保证它判得好。含糊的 `prompt` 换来含糊的否决。
- **瀑布顺序就是部署加载顺序。**本门禁应排在 `dsh-devflow-artifact-gate` 之后（缺产物先被机械否决，checker 不用花 token）、`dsh-devflow-gates` 审批之前（agent 都会拒的工作不必去问人）。没有什么强制这个顺序；靠部署的行序。
- **checker 的工具面只在 provider 支持时才被收紧。**provider 声明启动期 `toolFilter` 能力时，门禁 deny 掉 devflow 变更工具与文件写工具（与实际注册的工具求交集，因为运行时会拒绝未知名字）。不支持该能力的 provider 让 checker 拿到部署给子代理的全部工具——裁决契约要求只读行事，但那是指令而非强制，因此子代理工具集仍由部署负责。
- **没组合的门禁什么也不查。**与所有瀑布策略一样，栅栏只在插件加载期间存在；检查时 subagent 运行时缺席会 fail closed，但从未加载本插件的部署，其边是悄然不设防的。
- **缓存的否决指向其原始报告。**删报告而留缓存会留下悬空指针；删报告时把缓存目录（或那一条记录）一并删掉。
