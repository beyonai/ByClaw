# @zhchxiao123/dsh-devflow-worktree

[English](README.md) | 中文

每卡一 worktree 的开发方式：一张卡、一条分支、一个 linked git worktree。
这个包交付两项贡献——承载仪式的 bundled `devflow-worktree-runbook` skill，
和 `devflow/transition` waterfall 上的一道围栏，把被派遣的卡限制在派遣记录
指名的 worktree 里。

## 安装

这个包**没有自己的 bundle patch**。它作为
[`@zhchxiao123/dsh-devflow-bundle`](../devflow-bundle/README.md) 的
`devflow-worktree` 行随 bundle 到达，默认启用：

```sh
dsh plugin --profile web add @zhchxiao123/dsh-devflow-bundle
```

`dsh plugin --profile web add @zhchxiao123/dsh-devflow-worktree` 只会把这个包
装成一个普通依赖，不挂载任何东西。这是一次移除而不是疏漏：这个包过去确实自带
`cordis.patch.yml`，在 bundle 收编该行时被删掉了。两个 layer 插入同一个行 id
会组合出一个 Loader 拒绝的重复项（`duplicate loader entry id`），所以一个包要
么由 bundle 挂载、要么自带 patch，不能两者兼有——规则由
[`tests/bundle-row-ids.spec.ts`](../../tests/bundle-row-ids.spec.ts) 守住。随
patch 一起失去的东西是零：runbook 从头到尾讲的是一张 devflow 卡的仪式，围栏读
的是卡片 store，所以一个没有 devflow 看板的 profile 本来就用不上那次独立挂载。

**如果你在收编之前独立安装过这个包**，profile 的 `dsh.profile.bundles` 里仍然
留着它的名字。这个条目现在指向一个不带 `dsh.bundle` 的包，启动会大声失败：
`profile bundle "@zhchxiao123/dsh-devflow-worktree" declares no dsh.bundle in
its package.json`。任何一次 `dsh plugin --profile <name> add …` 都会重新核对这
份清单并删掉该条目；要跑的那一条就是添加 bundle。

手工组装的组合直接写插件名，见[配置](#配置)。

## 为什么 worktree 天然就是一个工作区

Devflow 的每个 root 都从调用会话自己的目录解析（`<cwd>/.devflow`），而
`.devflow/` 是提交进仓库的。因此一个 linked worktree 检出的就是一块完整的
看板：分支携带卡，卡的工作区就是 worktree，闸门命令、review-gate review、
agent-gate 检查器全都在那里运行——这些包本来就锚定在卡的 devflow root 的
父目录。这里没有任何东西改变任何消费方解析目录的方式；这个包补上的是过程
（一个 skill），以及过程自身无法承载的那一条保证（围栏）。

## 仪式

runbook 的契约，一段话说完：在主板把卡走到 `ready`；attach 一条派遣
artifact——配置的 kind，默认 `worktree`，frontmatter 含 `branch`、`base`、
`worktree`——然后提交它并 `git worktree add <path> -b <branch>`，顺序不可
颠倒。在工作目录为该 worktree 的会话里开发：在那里 `devflow_take`，把代码
和卡状态一起提交到分支上，驱动卡走完它的边。合并分支让代码和 journal 一起
送达，然后删除 worktree 和分支。从派遣到合并，只有卡自己的 worktree 写这
张卡——两个 checkout 向同一份 journal 追加，合并出的 revision 冲突会让卡
不可读，这是有意的、大声的失败。

## 围栏

每次 transition，围栏读取移动中的卡（通过可选的 `devflow` 服务，按名字取
用），找配置 kind 的最新 artifact。没有这条 artifact：卡不受影响，围栏委
派下去。否则，transition 的工作区——attempt root 的父目录——必须规范化为
派遣记录的 `worktree`，或者该仓库的主工作树；主工作树按目录经
`git rev-parse --path-format=absolute --git-common-dir` 推导并缓存。主工
作树的放行正是让主 checkout 在 worktree 删除后还能归档或跟进已合并的卡的
通道。其余任何 checkout 都被 veto，理由点名两个目录；派遣记录不可读或格式
损坏同样 veto，因为一道靠猜的围栏放行的恰恰是这条记录存在的目的所要拦住的
写入。

## 它检查的前提

够到一张被派遣的卡，也是流程自身的前提第一次能被机械发问的时刻，而四条
里有两条是 git 在 transition 的工作区里就能回答的：板已入库（`git
ls-files`）、卡的租约已被 ignore（`git check-ignore`）。任何一条不成立
都是一次 veto，理由里带着修好这个仓库的命令，因为这两条否则都无声地失
败——没入库的板会给 worktree 一块空板，新卡从 `0001` 重新编号并在 merge
时撞号；随分支旅行的租约会把卡指派给一个从不存在于此的 session。租约的
探测只取一个代表路径，veto 把规范清单指向 walkthrough 里的「`.devflow`
的提交语义」，本包不复述它。verdict 按工作区目录缓存；而对一个 git 根本
回答不了的仓库——没有 git、不是工作树——一律放行：跑不了的检查不是失败
的检查。

## 配置

在 profile patch 里，寻址 bundle 的那一行：

```yaml
- devflow-worktree:
    config:
      artifactKind: worktree   # 必须与 artifact-gate 声明的 kind 一致
```

在手工组装的组合里，作为独立一行：

```yaml
- name: '@zhchxiao123/dsh-devflow-worktree'
  # config:
  #   artifactKind: worktree
```

在部署的 artifact-gate 里声明该 kind 的结构，让派遣不可能被登记成残缺的：

```yaml
kinds:
  worktree:
    frontmatter: [branch, base, worktree]
```

## 已知限制

- **围栏只守 transition。**artifact 登记和建卡不设防：从错误的 checkout
  attach 依然是 runbook 禁止、而围栏看不见的双侧写入。attach 面同时也是逃
  生通道——被挪动的 worktree 靠 attach 一条指名当前路径的 artifact 重新派
  遣自己——把它也围起来会连恢复路径一起关掉。
- **前提的检查晚了一轮。**派遣仪式——attach、commit、`git worktree
  add`——中没有任何 transition，所以围栏最早能发问的时刻是 worktree 里的
  `devflow_take`，那时 worktree 已经建好了。这依然比它所阻止的撞号早了整
  整一个开发周期，而且此时的修复只是删掉一个 worktree，不是修复一份
  journal。
- **非 git checkout 里的派遣一律 veto。**在任何 git 工作树之外的一份看板
  副本没有可放行的主工作树，对一个仪式永远不会产出的 checkout，这是
  fail-closed 的读法。
- **worktree 会话看不到 harness 的工作区注册。**automation、scheduler、
  github-sync 平面把会话目录解析到 harness 工作区注册表，而 worktree 不在
  其中；这些工具在 worktree 会话里会拒绝。它们是后台摄入面，不在开发内循
  环里，主 checkout 的会话继续服务它们。
