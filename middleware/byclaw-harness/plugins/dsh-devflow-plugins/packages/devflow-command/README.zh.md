# @zhchxiao123/dsh-devflow-command

[English](README.md) | 中文

面向人的 `/devflow` 干预命令，作用于 [`ctx.devflow`](../devflow/README.zh.md) 任务卡能力缝。插件通过 [`ctx.commands`](../../interaction/commands/README.zh.md) 注册一个全局命令，任何已组合的命令适配器都能发现并执行它，全程没有模型轮次。这是 devflow 设计中的确定性平面：模型经 [`dsh-tool-devflow`](../tool-devflow/README.zh.md) 移动卡片，Web 头部看板只读渲染，而 `/devflow` 承担绝不能依赖模型的干预——查看、阶段移动、租约驱逐、归档，以及两条只读体检报告（`spec` 与 `doctor`，它们什么都不改）。所有入 journal 的效果都携带 actor `{ "kind": "command", "name": "devflow" }`。

## 命令契约

| 输入 | 结果 |
|---|---|
| `/devflow` | 看板：每张活跃卡一行——id、位置（blocked 卡显示被打断的阶段）、revision 与标题。子卡缩进排在它所拆解的需求之下；父卡已离开活跃集的子卡在自己那一行保留反链。看板为空时明确说明。 |
| `/devflow show <id>` | 单张卡：其看板行、父卡反链或缩进的拆分清单、已登记产物、卡片被放弃时的理由，以及 Markdown 正文。归档卡同样可读。 |
| `/devflow move <id> <stage> [reason]` | 按卡片当前 revision 经普通执行器提交一次流转。边合法性、打回 `reason` 要求与 `devflow/transition` 门禁照常裁决——命令没有旁路；领域拒绝把缝的消息作为直接错误返回。 |
| `/devflow takeover <id>` | 强制接管租约：任何过去的心跳都算过期，驱逐以 `claim-expired` 入 journal，租约随即释放，被驱逐持有者下一次带 revision 检查的提交会失败。 |
| `/devflow archive` | 清扫每张符合条件的 `done` 卡入档，并报告归档的 id。 |
| `/devflow archive <id>` | 归档单张卡，连同它已完成的子需求。每种拒绝都指出下一步：非 `done` 的卡报告它当前在哪，需求仍未完成的子卡点名那个需求，已入档的卡指向 `/devflow archived`。 |
| `/devflow restore <id>` | 把一张归档卡送回看板，**停在其 journal 已记录的阶段**——恢复带回的是可见性而非工作，还需要推进就走一次普通的打回。已放弃的卡被拒绝：那个决定是终态。 |
| `/devflow archived [<YYYY-MM>]` | 档案，最新的月份桶在前：每张入档卡一行，标注 `[archived <月份>]` 或 `[abandoned <月份>]`，因为只有前者可以恢复。给出月份则收窄到单个桶。被 store 的上限截断的一页，末尾给出可直接续读的那条命令。 |
| `/devflow archived --cursor <cursor>` | 下一页。游标是 store 自有的编码，原样回传——这个面既不构造也不解析它。 |
| `/devflow spec` | 报告架构文档健康度：多少篇 fresh、哪些 stale 或 unevaluable **以及具体是哪条 anchor 失效**，随后是一份覆盖普查——每个期望的 scope 落在三态之一：已有文档、被某篇点名的文档豁免、没有文档，每一态都与该 scope 的「可锚文件数」并列呈现——并注明这份期望是谁定的（`configured` 手工配置，或 `discovered via <回答了的探测器>`；发现退化到根包时会明说）。文档全部只靠 churn 锚的已覆盖 scope 会带尾注 `churn-only; freshness lags commits`。只读；未挂载文档缝时返回错误而不是一份空报告。 |
| `/devflow doctor` | 分五节报告部署健康度：**Board**（两条 dispatch 前置条件，直接调 worktree fence 自己的检查器，因此报告与否决是同一句话而不是两套话术）、**Leases**（每张被持有的卡的持有者与心跳距今时长——只渲染、不判定、也不回收）、**Worktrees**（每张 dispatch 卡的 worktree，「路径是否存在」与「git 是否认它是 linked worktree」分开回答，因为那里放一个普通目录同样能过 fence，却不带这张卡的任何分支）、**Gates**（哪些可选面已挂载，以及 `.devflow/validation.json` 要求了什么），以及 **Not asked**。只读，不提供 `--fix`。 |

**`Not asked` 一节是主要输出，不是补充说明。** 它永远渲染，逐条列出本次没能回答的问题：哪些 validator 当前真的可用（`ValidatorRegistry` 不公开任何枚举读面）、各 gate 的边是怎么配的（`devflow-gates` 只 provide 一个注册表，review-gate 与 agent-gate 什么都不 provide，所以 review 边是否配了 `baseRef` 从这里读不到）、本部署用哪个 artifact kind 做 dispatch（按插件默认值 `worktree` 假设）、以及 `.gitignore` 的语义（只问 `git check-ignore`）。本次运行自己没能触及的事同样加入这份清单——没有板的工作区、git 答不了的目录、`devflow-gates` 会拒绝的策略文件。一份把「查不了」渲染成「没问题」的报告比没有报告更糟，这正是 `/devflow spec` 对它测不出的覆盖率所持的立场。

未知子命令、畸形参数表、或既非阶段也非 `blocked` 的目标，都在触碰存储之前返回直接的用法错误。

每个子命令都作用于发起会话的工作区根：会话头部带 `cwd` 的读写 `<cwd>/.devflow`，没有的使用 store 配置的默认根——同一会话的 `/devflow` 与模型工具因此永远看到同一张板。

## 组合

生产者注入 `commands` 与 `devflow`。自定义应用挂载二者的所有者加本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: devflow
  name: '@zhchxiao123/dsh-devflow-filesystem'
- id: command-devflow
  name: '@zhchxiao123/dsh-devflow-command'
  config:
    # 可选：覆盖发现出的 scope 集。只有 `/devflow spec` 读它，
    # 配置任何条目都会整体取代工作区布局发现。
    specScopes: ['@scope/pkg-a', '@scope/pkg-b']
```

期望的 scope 集先发现、后配置。不配 `specScopes` 时，census 向可选的 `devflowSpecWorkspace` 服务——由 [`dsh-devflow-spec-sentinel`](../devflow-spec-sentinel/README.zh.md) 发布——询问发起会话工作区的包布局，把其 scope id 集当作期望集，并以回答了的生态探测器标注来源，例如 `discovered via pnpm-workspace, pyproject`。没有任何工作区清单被识别、发现只靠根包成立时，标注就说这件事本身——`fell back to the repository root — no workspace manifest recognized`——而不是把兜底装扮成发现；面对早于探测器细节面的旧 sentinel 服务，则沿用较粗的 `discovered from workspace layout`。配置 `specScopes` 则**整体覆盖**发现结果，不是并集：列出 scope 的部署是在说「只问这些」，其中包括把某个被发现的包刻意排除在提问之外的权利，此时报告标注 `configured`。两个来源都没有——或布局解析不出任何包——时，报告会说「覆盖率这个问题没有被问」，这与「没有缺口」不是一回事。

`/devflow spec` 以 `ctx.devflowSpec` 机会性读取，并**从缝已有的读面推导**报告——每篇的汇总新鲜度、对非 fresh 篇目的逐条 anchor 裁决，以及每条摘要自带的 `waives`——因此 store 不为一个消费者想要的报告新增任何方法。覆盖率不只计数，还被限定成色：文档全部只靠 churn 锚的 scope 列在 `covered only by churn anchors` 之下并带尾注 `churn-only; freshness lags commits`——那里的过期只在提交之后才显形，turn 末哨兵永远不响，把这样的 scope 与 symbol 锚的置信度混同呈现就是高估它。它的收尾是一条指令而不是一份清单：列完伤亡就结束，只会训练所有人接受一个正在悄悄腐化的文档集。

**普查对每个 scope 回答的是三个问题，不是一个。** 每个期望的 scope 都有一行，写着 `N document(s)`、`waived by <文档 id>` 或 `no document`，上面是三态各自的计数。「已豁免」这一态正是文档的 `waives` 字段买来的东西：一个「该 scope 不需要架构文档」的刻意决定，由一篇必须说清理由、并把理由锚在代码上的**真文档**承载。只有 `no document` 才算缺口——收尾那句「合并、退役，或把缺的写出来」从不把被豁免的 scope 算进去，因为把一个已经做出的决定推回待办，就是在撤销它。承载豁免的文档不再 `fresh` 时，该豁免报成 `waiver in doubt`，并配一条**不同**的收尾指令：理由所依赖的代码已经动了，所以这是一个要**重做的决定**，不是一个要填的坑。任何东西都不会被无声折叠掉——豁免了一个期望集根本不问的 scope，会单列出来（否则它的作者会一直以为自己决定了什么）；多篇文档豁免同一个 scope，会全部点名；某个 scope 既有文档又被豁免时报成已有文档，并点名那条被盖过的豁免，好让人去退役它。

**每一行都带着它所对照的「可锚文件数」，而没有任何一个数字会做决定。** 扩展名取自挂载的 Provider 的 `anchorableExtensions`——它的求值器真正读得懂的那些语言——因此第六门语言会让这些数字自己变化，这里一行都不用改。跳过 dot 目录与 `node_modules`；不解析 `.gitignore`；打不开的成员目录会写 `could not read <dir>` 而不是记作零；同一个 scope 的多个成员目录汇总成一个数；嵌套 scope 的文件归最内层的那个期望 scope，因此 monorepo 的根不会被灌水。**它是一个分母，不是一个阈值**：3 篇文档对 360 个可锚文件、与 3 篇对 12 个，是两件不同的事，而分辨它们正是这份报告交还给读者的判断——与缝的结构契约刻意不校验「每条论断是否挂了 anchor」划的是同一条线。配置了 `specScopes` 就放弃这些计数，因为一个 id 指不出任何目录，报告会明说这件事，而不是打印一串零。这次目录遍历只发生在这条由人发起的命令上；pre-step 与 turn 末路径上没有任何东西数过文件。

## Model Experience

### Human `/devflow` intervention

#### What the model sees

Nothing directly: the slash input and its direct output are absent from model requests. A committed intervention lands in the card journal, so a model that later reads the board through the `dsh-tool-devflow` tools sees the new location and the `command devflow` actor like any other journal history.

#### Token effect

None. Board and card output is direct command text; later devflow tool reads bill as those tools' results.

#### KV Cache effect

None; command discovery, execution, and output never enter a provider request.

## Known Limitations and Deferred Work

- **不能建卡或编辑卡** — 命令只干预已存在的卡；`card.md` 及其 journal 的创作在能力缝之外。
- **接管信任心跳时间戳** — 过期判断是严格的年龄比较，同一毫秒写入或携带未来时间戳的心跳仍算存活，此时接管会改为报告持有者。
- **命令适配器只随 Web 客户端交付** — headless、ACP 自动化与 JSON-RPC 应用不消费 `ctx.commands`；在那些组合里，干预走模型工具或直接改磁盘。
