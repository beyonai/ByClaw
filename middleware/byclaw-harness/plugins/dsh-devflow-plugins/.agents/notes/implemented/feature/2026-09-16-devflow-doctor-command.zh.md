# Agent Note: /devflow doctor reports the deployment, including what it could not check

Status: implemented

[English](2026-09-16-devflow-doctor-command.md) | 中文

## Problem

没有任何一条路径能回答「我这套 devflow 装对了吗」。每一种配错都延迟到别处才显形：四道 gate 默认 `disabled: true`，你只能读 `devflow-bundle/cordis.patch.yml` 才知道；review 边留在 workspace 模式会把另一张卡的改动算进来，你只能从那次 review 里知道；板未入库会在 merge 时撞号；没人回收的租约会让一张卡永远推不动，直到有人想起 `/devflow takeover`。

其中两条不是假设。`dsh-devflow-plugins-midscene/.devflow/tasks/` 下 `0001` 与 `0004` 至今留着 2026-09-15 的 `claim.json`——因为 `ClaimHolder.heartbeatAt` 在 claim 那一刻写入，而 `heartbeat()` 在这条线上零调用者，那个时间戳只可能是「卡被取走的瞬间」。

## Decision

`/devflow doctor` 是一份分五节的只读报告，全部从已存在的读面推导——`list()`、`holder()`、卡自己的 artifact、`ctx.get` 探测，以及 git。不为它新增任何 store 方法、service 或 seam，照 `/devflow spec` 的做法，那条命令同样只从 `list()` 加 `evaluate()` 推导，理由相同。它是人类面命令而非 model-facing tool，理由也照抄：全集普查与工具面「给索引不给正文」的纪律相反。

### `Not asked` 是主要输出

这一节永远渲染，并以「其中没有任何一条是『没问题』」开头。四条是固定的，因为这条线的任何组合都答不了：validator 可用性（`ValidatorRegistry` 的 providers 私有，不公开任何枚举读面）、各 gate 的边配置（`devflow-gates` 只 provide 一个注册表，`devflow-review-gate` 与 `devflow-agent-gate` 什么都不 provide，所以父任务想要的 `baseRef` 这一问答不了）、dispatch 的 artifact kind（按 worktree 插件的默认值 `worktree` 假设，改过这个 kind 的部署会被整节漏报而不是报出来）、以及 `.gitignore` 的语义（只问 `git check-ignore`——`/devflow spec` 的立场，同一个理由）。本次运行自己没能触及的事同样加入这份清单。

**这条命令的第一版恰恰在这里翻了车，而那次翻车正是这一节存在的理由。** fence 的前置条件检查器对「通过的仓库」与「没能问成的仓库」都回答 `undefined`，这对 fence 是对的——[它自己的 Note](2026-09-16-worktree-dispatch-preconditions.zh.md) 记着：一条没能跑起来的检查绝不可以被报成一条失败的检查。拿 `dsh-devflow-plugins-midscene`（gitdir 指针已失效）一跑，doctor 把那个 `undefined` 渲染成了「板已入库、瞬态已 ignore」。所以 doctor 先确认 git 根本答得了（`git rev-parse --is-inside-work-tree`）再采信共享裁决，并且每一节在答不了时会在「本该是答案的位置」留一个标记，而不是就此沉默。

### 一套实现，一套话术

Board 一节自己调 `createDispatchPreconditionChecker`，因此报告里的措辞与一次流转收到的否决逐字相同；一件事的两套说法会被读成两件事。报告只加框、绝不改写：有卡被 dispatch 时那句话就是活着的否决，没有时报告明说，并点名那张替第一张即将被 dispatch 的卡站位的卡。

### worktree 的独立入口是为了不拖累一个默认插件

`devflow-command` 在 bundle 里默认挂载，`devflow-worktree` 不是，所以引入这个检查器不能让前者的加载依赖后者。worktree 的 index 为注册内置 runbook 而 value-import 了 `@deepseek-ai/dsh-skill`——一个 `devflow-command` 既不声明、读一条 dispatch 记录也用不上的包。因此 `packages/devflow-worktree/src/dispatch.ts` 是一个独立的包入口，导出 `parseWorktreeDispatch`、`createDispatchPreconditionChecker` 与 `WorktreeDispatch`；从它出发可达的一切只 import node 内置模块，所以加载它不挂载任何东西、也不要求任何东西。

### 对一个 worktree 问两个问题

路径是否存在与 git 是否认它是 linked worktree 分开报，因为在 dispatch 指向的路径上放一个普通目录会让第一问通过、第二问失败——这是今天完全不可见的一种状态，而且 fence 会放行，因为它只比较解析后的目录。

### 租约不定阈值

租约只渲染持有者与心跳距今时长，判断交给读者。定阈值就等于引入一个只有这份报告在用的、随部署而变的可调项，而租约回收是父任务刻意延后的决定。这一节直接说明为什么这些时长长得这样——`heartbeat()` 零调用者——免得读者自行推断「两天前的时间戳＝会话已死」。

## Alternatives considered

**给 `ValidatorRegistry` 加一个 `names()` 读面。** 它会让 Gates 一节真正可用，而且是在本仓自有的类上加一个小增量，不是新开 seam。暂时否决：唯一的消费者就是这份报告，而这里的规矩是「每个抽象都要有当前的所有者和需求」。先按「答不了」落地只花一行诚实的话；如果这一行被反复追问，消费者的需求就被证实而非被假设，那时开读面是一张卡的事。

**给 `devflow-review-gate` 开一个配置投影服务。** 同一笔交易，账单更大——为了让一份报告打印一个字段而开一整个服务。同样否决，态度更坚决。

**从 worktree 包的 index 引入检查器。** 计划里假设的做法。在查清 index 的模块图实际拉进什么之后否决：一个对 `@deepseek-ai/dsh-skill` 的 value import，会把一个默认命令面从不触碰的包放到它的加载路径上。实践中只要挂了 `devflow-guidance`，`dsh-skill` 就在——那是所有部署——但那是一条「依赖另一个插件被挂载」的隐式依赖，正是这条线拒绝的那一类。

**在 `devflow-command` 里重写这两条 git 检查。** 计划里给出的退路：如果那个 import 真的造成耦合就走这条。否决，因为独立入口达成了同样的隔离，却不必放弃「一件事一套话术」——而正是这一点让一次否决与一份报告能被认出是同一件事。

**提供 `--fix`。** 否决：一条会改东西的体检命令会被当成安装脚本用，然后没人知道它改了什么。报告点名的每一条故障改为附上修复它的那条命令。

**给租约定一个「陈旧」阈值。** 上文已否决——无主的可调项，以及一个这份报告没有资格下的判决。

## Consequences

- `devflow-command` 新增对 `@zhchxiao123/dsh-devflow-worktree` 的运行时依赖，只经 `./dispatch` 入口解析。worktree 插件仍然不必被挂载；那个入口里没有任何东西会注册任何东西。
- `devflow-worktree` 多出一个入口，因此它的 `files`、`exports`、tsdown 入口表与根 `tsconfig.base.json` 的 paths 都要在 `index` 与 `invariant` 之外写上 `dispatch`。
- `USAGE` 字符串变了，断言了它完整文本的用例随之更新。
- Worktrees 一节对改过 `artifactKind` 的部署是沉默的。这件事写进 `Not asked` 而不是绕开，它也是这份报告唯一可能「错了却不说」的地方。
- doctor 每次运行最多起三个 git 进程（`rev-parse`、经检查器的 `ls-files`/`check-ignore`、`worktree list`），全部在人发起的路径上。流转、pre-step 与 turn 末路径上不跑其中任何一个。

## Testing

`packages/devflow-command/tests/doctor.spec.ts` 造真 git 仓库、真板、真 `claim.json`。最先写的两个用例正是能让报告说谎的那两个：没有板的工作区，以及没挂载任何可选面的组合。AC4 的用例断言报告里包含 `createDispatchPreconditionChecker` 自己返回的那个字符串，而不是两边各断言各自的字面量，这样两者就不会各自漂移成两套话术。
