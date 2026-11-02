# @zhchxiao123/dsh-devflow-review-gate

[English](README.md) | 中文

[`devflow/transition`](../devflow/README.zh.md) waterfall 上的代码评审策略：已配置的边用 [open-code-review](https://github.com/alibaba/open-code-review) 的 **delegate 模式**完成评审中不该交给模型的那部分 —— 哪些文件在范围内、每个文件适用哪条规则 —— 然后按规则组各派发一个只读 checker subagent，并用该边配置的严重度阈值裁决。达到或超过阈值的意见否决流转；无论通过还是否决，每次评审都会把完整报告写进该卡片的 devflow root。

这个分工是整件事的要点。`ocr delegate` 从不调用 LLM：它确定性地回答"审什么"，所以大变更无法被选择性跳过，覆盖率的账目属于 CLI 而不属于评审者。判断由 checker 提供，和这条线上其他 agent 一样走部署自己的默认模型。不需要第二套模型配置，也不需要它自己的 API key。

**`ocr` 二进制不随本插件分发，也不由它安装。** 需要这个闸门的部署自行安装 `ocr`（`npm i -g @alibaba-group/open-code-review`，v1.9.0 或更新），然后配置一条边。没有 entry 的边原样 delegate，所以什么都不配的部署就是本插件不影响的部署。

## 行为

对已配置 `edges` entry 的边 `from->to`，闸门会：

1. 确认已安装的 CLI 能输出 JSON（`ocr --version`，下限 v1.9.0）。
2. 运行 `ocr delegate preview --format json` —— 边上配了 `baseRef` 走 **range 模式**（`--from <baseRef> --to HEAD`），否则走 **workspace 模式**审未提交变更。结果是权威文件清单，闸门绝不往里添东西。
3. 只把**可审**路径喂给 `ocr delegate rule --format json`，diff 从 git 取 —— 以 preview 解析出的 `merge_base` 为准，而不是以请求的那个 ref 为准。workspace 模式下的 untracked 文件没有 diff，用全文顶上。
4. 按规则组各派发一个 checker，同时最多 `groupConcurrency` 个，共享一个 `reviewTimeoutMs`。每个 checker 只看到卡片、它自己那条规则的原文、以及它自己的文件。
5. 用 CLI 的文件清单核账：每个 previewed 路径必须以 `reviewed` 或带原因的 `skipped` 回来。两边都没有的路径是故障。
6. 把报告写进该卡片的 devflow root —— **两种结局都写**。
7. 有任何意见达到或超过 `vetoAtOrAbove` 即否决并点名报告文件；否则 delegate、把覆盖率账目追加到已提交条目的 `gate.checks`，并在配了 `artifactKind` 时于流转提交后把报告登记到卡片上。

**Fail closed。** CLI 缺失、版本过低、执行失败、输出不是 JSON；git 失败；subagent 运行时未组合；provider 未注册；派发被拒；checker 异常结束、超时、或回复里没有可解析的裁决；有文件没被核账；报告写不进去 —— 每一种都否决流转并把卡片 park 成 `blocked`（actor `command devflow-review-gate`），让无人值守的运行停下来而不是反复撞进同一个故障。闸门的全部价值就在于：跑不起来的检查不是通过的检查。

## 配置

```yaml
- id: devflow-review-gate
  name: '@zhchxiao123/dsh-devflow-review-gate'
  config:
    edges:
      'developing->reviewing':
        provider: spawn
        baseRef: main
        vetoAtOrAbove: high
    command: ocr
    exclude: ['**/testdata/*']
    reviewTimeoutMs: 900000
    groupConcurrency: 4
    artifactKind: review-report
```

| 键 | 默认 | 含义 |
|---|---|---|
| `edges` | `{}` | 每条 `from->to` 边的评审策略。无 entry 的边原样 delegate。 |
| `edges[].provider` | — 必填 | checker 起在哪个 subagent provider 上。 |
| `edges[].baseRef` | 未设 | 设了走 range 模式；省略则审工作区未提交的变更。 |
| `edges[].vetoAtOrAbove` | `high` | 触发否决的最低严重度：`critical`、`high`、`medium`、`low`、`never`。 |
| `command` | `ocr` | 可执行文件：`PATH` 上的名字，或绝对路径。 |
| `exclude` | `[]` | 传给 `ocr delegate` 的排除模式，与仓库自身 `rule.json` 的 excludes 合并。 |
| `reviewTimeoutMs` | `900000` | **整轮**评审的毫秒预算，所有组共享。 |
| `groupConcurrency` | `4` | 同时在跑的 checker 上限。 |
| `artifactKind` | 未设 | 流转提交后报告登记用的产物 kind。未设则报告只留在闸门的报告目录里。 |

误配置会让加载失败并点名配置项：边键不是 `<from>-><to>` 形式或位置名未知、`provider` 或 `baseRef` 为空、`vetoAtOrAbove` 不在梯度内、`command` 为空串、`artifactKind` 不合 seam 的 kind 文法、`reviewTimeoutMs` 或 `groupConcurrency` 非正整数。

**`vetoAtOrAbove: never` 是最该先用的那一档。** 照常评审、照常出报告、从不拒绝 —— 团队可以先读几周真实报告，再决定让闸门卡不卡。

**`reviewTimeoutMs` 覆盖的是整轮评审，不是每个 checker。** 部署真正关心的是一次流转最多阻塞多久；按 checker 计时会随变更碰到的规则数翻倍。

## 裁决缓存

裁决的键包含决定了"checker 看到什么、按什么标准判"的全部信息：边、root、卡片；preview 模式与 merge base；每个可审文件及其 status 和增删行数；全部规则正文的摘要；否决阈值；以及解析出这一切的 `ocr` 版本。完全相同的重试直接复用记录、不再派发，其 journal check 摘要前缀为 `[cached] `。否则返工循环每一轮都要付一次完整的 checker 扇出。

缓存是优化，从不是权威。每条记录存了完整的键，所以命中要求逐字段相等，而不是信任一个截断的文件名哈希；损坏的记录算作已告警的未命中；目录写不进去只告警。**故障从不缓存** —— 故障意味着评审没有发生，重试就必须真的重试。

## 产物落在哪

无需配置。每一份产物都落在**正在流转的那张卡片自己的 devflow root** 下：

```
<devflow root>/
  reports/review-gate/{card}-{from}-{to}-r{rev}.md
  cache/review-gate/{key-hash}.json
```

落在 root **之内**而不是旁边，因为 [`dsh-devflow-fs-guard`](../devflow-fs-guard/README.zh.md) 按目录名保护 root —— 于是被本闸门判决的那个 agent 无法用自己的文件工具改写这份记录。一个 harness 服务多个项目时，各项目的产物留在各自项目里，没有互相覆盖的路径。

## Model Experience

### Checker 提示词

#### 模型看到什么

每个 checker 的 user message 是：`You are reviewing devflow card <id> on edge <from>-><to>.` 这一行、卡片标题与正文、它那个规则组的**原文**、它自己每个文件在 `--- file <path> (<status>) ---` 分隔符下的 diff（新文件则是全文），以及固定的收尾契约 —— 只按上面这条规则审上面这些 diff、以只读评审者身份行事、每个文件必须以 `reviewed` 或带原因的 `skipped` 结账、回复以恰好一个 fenced JSON 裁决块结束。

规则正文原样透传，因为当 `.opencodereview/rule.json` 提供它时，那就是仓库自己的标准。契约里只就它加了一句说明：`ocr` 的内置规则写的是**它自己**评审 agent 的工具名（Go 规则集里写着用 `file_read` 和 `code_search`），而这里的 checker 没有这两个工具，所以契约说明按等价能力使用当前实际持有的工具。在契约里消歧而不是改规则，是"解释项目的标准"和"改写项目的标准"之间的区别。

卡片正文进的是这段提示词，而不是走 `ocr delegate --background`：那个 flag 只是把文本原样回显给调用方，而组装提示词的调用方就是这个闸门，绕一圈毫无收益却要吃下该 flag 的尺寸限制。

#### Token 影响

每次缓存未命中时，每个规则组一次完整的 subagent 请求，各自与卡片正文加该组的规则和 diff 成正比。由于 CLI 按规则内容分组，规则文本是每组发一次而不是每文件发一次。缓存命中零 token；未配置的边不给任何请求增加内容。

#### KV Cache 影响

独立：每个 checker 都是全新的一次性会话，与生产者和其他组都不共享前缀。

## 已知限制与遗留工作

- **range 模式下，同一条分支上多张在飞的卡会互相串味。** 卡片自身不带 git 身份，所以 `baseRef` 是部署级别对"这张卡改了什么"的回答。当两张卡在同一条分支上推进时，对第一张卡的评审也会看到第二张卡的改动，并把意见记在第一张卡头上。workspace 模式没有这个问题，代价是要求 `developing` 阶段不提交。根治需要卡片模型带上范围信息，那是比本包更大的一次变更。
- **缓存命中需要文件清单、行数和规则完全不变**；其余情况一律重新评审。
- **意见质量是部署和规则集的责任。** 闸门保证评审真的跑了、覆盖被核了账、故障绝不放行 —— 不保证判断本身有多好。
- **checker 的工具面只在 provider 支持时受限。** 支持 start-time `toolFilter` 时，闸门拒掉 devflow 变更工具与文件写工具（与实际注册的工具求交，因为运行时会拒绝未知名字）。不支持的 provider 会让 checker 拿到部署给子 agent 的全部工具；契约要求只读行事，但那是指令不是强制。
- **把报告登记到卡片上是尽力而为。** 它发生在流转已经提交之后，所以登记失败只告警 —— 无论如何报告目录都持有权威副本。
- **要求 `ocr` v1.9.0 或更新**，那是 `delegate` 子命令开始接受 `--format json` 的首个版本。没有文本输出的退路：解析人读格式等于凭空发明 CLI 从未承诺过的结构。
- **参数用 POSIX 单引号转义。** `ctx.shell` 接的是命令字符串而不是参数向量，所以每个插入的路径都在这里转义，而不是作为 argv 条目传递。已发布的 shell surface 没有给出分平台的引号契约；CI 在 Linux、macOS 和 Windows 上都跑这套测试，其中包含一个含引号、`$` 和反引号的路径用例。
- **没有被组合进来的闸门什么都不审。** 和所有 waterfall 策略一样，这道篱笆只在插件加载且边已配置时存在。
