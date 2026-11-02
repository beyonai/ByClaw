# Agent Note: devflow — worktree-per-card development

Status: implemented

[English](2026-09-16-devflow-worktree-per-card.md) | 中文

## Problem

在同一个 checkout 里并行开发的卡共享一条分支。range 模式对任何一张卡的
review 都会看到两张卡的改动，并把发现记到错误的卡名下——这正是
`dsh-devflow-review-gate` 在已知限制里记录的交叉污染，其点名的修法是"卡
模型携带一个 range"。手工另开一个 checkout 可以避开它，但 devflow 对此没有任
何词汇：没有东西记录一张卡正在哪里被开发，没有东西阻止第二个会话领取同一
张卡，也没有东西阻止两个 checkout 同时写一张卡的 journal——那是一份
append-only 文件，合并冲突会让卡不可读。

## Decision

一张卡、一条分支、一个 linked git worktree——由拓扑承载，而不是新的状态
存储。`dsh-devflow-worktree` 交付两项贡献：

- bundled 的 `devflow-worktree-runbook` skill 承载仪式：向 `ready` 的卡
  attach 一条派遣 artifact（配置的 kind，默认 `worktree`，frontmatter 含
  `branch`/`base`/`worktree`），提交，然后创建分支和 worktree——顺序不可
  颠倒；在 worktree 里的会话中开发并推进卡；合并让代码和 journal 一起送
  达；删除 worktree 和分支。插件自身从不创建或删除 worktree，遵循 testenv
  确立的"只交付判断力"先例。
- `devflow/transition` waterfall 上的一道围栏强制执行整个过程赖以成立的那
  一条规则：被派遣的卡只能从它指名的 worktree 或该仓库的主工作树发起
  transition（主工作树按目录经
  `git rev-parse --path-format=absolute --git-common-dir` 推导并缓存）。
  其余一律 veto，理由点名两个目录；派遣记录不可读或损坏同样 veto。没有派
  遣 artifact 的卡不受影响；store 经 `ctx.get('devflow')` 取用——只读，
  因为 waterfall 内的写会死锁在它正在裁决的 transition 后面。

没有任何既有决策被推翻。root 解析在每个消费方保持 `join(cwd, '.devflow')`
——worktree 恰好就是 root-follows-caller 那份决策所设计的按目录工作区——
而 review-gate 的交叉污染因拓扑消解：一条分支现在只承载一张卡，部署级的
`baseRef` 在效果上成为 per-card，无需卡模型携带 range。

同一变更顺带修复了调研浮出的那处 restatement 偏差：review-gate 的
`gateParents` 把 devflow root 传成了合成父会话的 cwd，而 agent-gate 原件
传的是 root 的父目录；检查器现在落在卡的工作区里——对被派遣的卡而言就是
它的 worktree。

## Alternatives considered

- **集中板 + worktree 感知的 root 解析**——所有会话的 root 都走回主
  checkout 的 `.devflow`。否决：它在九个独立消费方推翻已记录的
  root-follows-caller 决策，让 N 个写者挤在同一个 root 的 `commit.lock`
  上，而且依然救不了 automation 平面——那里的工作区注册表是 realpath 精
  确匹配。
- **卡上加 `workspace`/`worktree` 字段**——root-follows-caller note 已经
  否决过：卡的归属就是它所在的目录，存下来的位置是会随仓库移动而漂移的第
  二事实源。派遣 artifact 是随 journal 走的卡*内容*，像任何交付物一样计
  入 revision，不是寻址。
- **只出 skill、不设围栏**——单写者规则就只是文字。违反它在合并前是无声
  的，合并时就是一张被毁的卡；在写入现场的机械 veto 能在错误还只是一次
  transition 时点名它，而不是等它成为冲突。
- **把 artifact 登记也围起来**——否决：attach 面是恢复通道（被挪动的
  worktree 靠 attach 一条指名当前路径的 artifact 重新派遣自己），而围栏
  要防的毁灭性失败是 journal 分叉，那由 transition 主导。

## Consequences

- 并行开发获得按卡隔离，seam、store、root 规则和任何闸门的配置表面零改
  动；围栏作为一个普通的 waterfall 监听器参与组合。
- 这套流程有 runbook 陈述的四条前置条件：`.devflow/tasks/` 已提交（被
  ignore 的看板会给 worktree 一块从 `0001` 重新编号的静默空板）、
  `claim.json` 与 `commit.lock` 已 ignore、review 边使用 range 模式、
  worktree 位于主 checkout 之外或被 ignore。围栏现在在被派遣的卡第一次
  transition 时检查前两条，并以修复命令 veto（见[前提检查 Agent
  Note](2026-09-16-worktree-dispatch-preconditions.zh.md)）；后两条是部署
  自己的配置，仍是散文，跳过它们依然会在之后困惑地失败，而不是现在大声失
  败。
- 在 worktree 里建卡仍只由文字禁止——序号按板分配，合并时会撞号。这次撞
  号现在是一条被断言的行为而不是一句提醒：
  `tests/worktree-dispatch-composition.spec.ts` 在两侧各建一张卡，断言两张
  都拿到 `0002` 且合并干干净净，将来要修它的人因此有一个失败形态可用。
- Midscene 验收只有 project 模式跟着 worktree 走：它按会话解析工作区，并
  按该路径隔离运行态；旧 profile 配置的 `workspace` 指向主 checkout，被派
  遣的卡的 Web 验收只能等到合并之后。worktree 被删除时，它的 inspect 历史
  随之消失——报告本身已归档进卡的 `artifacts/`，随分支一起送达。
  automation/scheduler/github-sync 平面在
  worktree 会话中拒绝（目录未注册），与其 PRD"同 remote 的 worktree 是不
  同项目"的裁定一致。
- 由以下各项验证：跑在真实 git 仓库与 worktree 上的包测试、经真 Loader 组
  合驱动文件系统 store 走 veto 与放行两条路径的组合测试，以及对两项贡献的
  disposal 断言。而这一切之下的那条前提——卡能活着走完 git 往返——由
  `tests/worktree-dispatch-composition.spec.ts` 单独钉住：它在两套组合与一
  个真实 linked worktree 上走完 runbook 的整套仪式，并断言在分支合并回一
  个期间自己也向前走过的主 checkout 之后，`foldJournal` 能重放合并后的
  journal、revision 连续、两侧条目都在，派遣这张卡的会话能从 worktree 停
  下的地方继续推进它。
