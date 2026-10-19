# Agent Note: worktree 围栏检查 git 答得了的那两条前提

Status: implemented

[English](2026-09-16-worktree-dispatch-preconditions.md) | 中文

## Problem

worktree 流程有四条前提，而[它自己的 Agent Note](2026-09-16-devflow-worktree-per-card.zh.md) 记下的是：包一条都检查不了——"跳过它们的部署，会在更晚的地方困惑地失败，而不是现在大声地失败。"

本仓库就是这样一个部署。在 `950eed9`，主 checkout 里根本没有 `.devflow`——唯一那块真板躺在一个从未提交的 worktree 里——也就是说，引入这条前提的仓库自己违反了它的第一条。

四条里有两条是 git 答得了的问题，而两条的失败都是无声的：

| 前提 | 跳过后发生什么 | 什么时候才有人发现 |
|---|---|---|
| 板已入库 | worktree 检出一块空板，把新卡从 `0001` 重新编号 | merge 时，两套 `0001` 撞号 |
| 瞬态已 ignore | `claim.json` 随分支旅行，把卡指派给一个从不存在于此的 session | 有人试图 take 这张卡时 |

## Decision

围栏检查这两条，失败就是一次 veto，理由里带的是修好这个仓库的命令，而不是对问题的描述。

`packages/devflow-worktree/src/preconditions.ts` 在 transition 自己的工作区里跑两次只读命令：`git ls-files -- <root>/tasks` 必须列出东西，`git check-ignore -q -- <root>/tasks/<id>/claim.json` 必须命中。板的探测读的是输出而不是 `--error-unmatch` 的退出码——后者的语义在不同 git 版本上不一致，而"输出是否为空"是稳定的。租约的探测点名一个具体路径，因为 `check-ignore` 回答的就是具体路径，也因为问题是"这个部署到底有没有配 ignore 规则"——逐项审计每个瞬态文件是[提交语义文档](../architecture/2026-09-16-devflow-root-commit-semantics.zh.md)的职责，veto 把完整清单指向那里，而不是自己再抄第四份。

`gate.ts` 在派遣 artifact 解析成功之后、here/target/main 比较**之前**调用它：板没入库时，"这是哪个 checkout"这个问题本身就没有值得给的答案，因为 worktree 里那块空板根本不是同一块板。verdict 按工作区目录缓存，理由与 `createMainWorktreeResolver` 缓存自己的那条相同。没有派遣 artifact 的卡碰不到这里的任何一行——监听器仍旧在 artifact 查找处返回，并有一条用例断言这种卡产生的 git 调用次数为零。

两条检查都不是 `Config` 字段。一块从未进过 git 的板会毁掉卡号空间，一份随分支旅行的租约会指派一个幽灵持有者；这些是流程持久化的不变量，不是部署可变的选择，所以一个开关的唯一用途就是绕开它们。

### 两种缺席的方向相反

`maintree.ts` 和 `preconditions.ts` 都吞掉每一种 git 失败，而两者由此得出的含义相反。主工作树解析器的缺席意味着推导不出主工作树，围栏据此**不放行**。前提检查器的缺席——git 不在、目录不是工作树——意味着检查跑不了，而一个跑不了的检查绝不能被报告成一个失败的检查，因此**放行**。两个模块都在各自的 catch 处写明了这一点，否则下一个读的人会把其中一个当成 bug。

### 时机晚了整整一轮，而这条写在明处

派遣仪式是 attach、commit、`git worktree add`——其中没有任何 transition。所以围栏最早能发问的时刻是 worktree 里的 `devflow_take`，那时 worktree 已经建好了。这两条检查依然值得做：它比它所阻止的撞号早了整整一个开发周期，而且此时的修复只是删掉一个 worktree，不是修复一份 journal。

## Alternatives considered

**一个在派遣时检查的 `devflow_worktree_dispatch` 工具。**唯一能在 worktree 建起来之前检查的办法，也是唯一能赢过上面那条时机限制的办法。否决：派遣是 skill 教的仪式，用既有的 `devflow_attach_artifact` 加一段 shell 完成，专用工具等于把仪式硬编码进模型面，并且要求重写 runbook——为了回答一个围栏不用任何新表面就能回答的问题而新增表面。

**只靠 `/devflow doctor`。**doctor 是起了疑心的人主动跑的。而前提对所有从不起疑心的人来说依然是散文。部分采纳：git 答不了的那两条——review 边是否 range 模式、worktree 是否在主 checkout 之外——正该归 doctor，它们不进围栏。

**检查整份瞬态清单而不是一个代表路径。**那会变成对围栏并无利害关系的文件的审计，也意味着这个包自己要携带那份规范清单——正是提交语义那篇 Agent Note 记录的、产生漂移的那种重述。

**加一个关掉检查的 `Config` 开关。**上面已经否决：它的唯一用途，是让一个注定在 merge 时丢掉卡号空间的仓库继续派遣。

## Consequences

- 跳过了任一条前提的部署，会在此前通行的地方开始看到 veto。这正是意图；它今天的替代结局是 merge 时的撞号。
- 两份夹具不得不变成合规的仓库——`fence.spec.ts` 和 `loader-composition.spec.ts` 都在建一个没有 `.gitignore` 的仓库，也就是说，它们本身就是本次改动要 veto 的那种配置错误。`fence.spec.ts` 现在把两条前提都参数化，并保持每一条既有用例的断言不变。
- 围栏的 git 用量现在是可观测的：`fence.spec.ts` mock 掉 `node:child_process` 并对 promisify 后的 `execFile` 调用计数，"没有派遣就零调用"和"按工作区缓存"这两条性质是这样断言的，而不是靠看。
- 另外两条前提仍然是散文，runbook 依旧陈述全部四条。
