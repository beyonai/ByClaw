# Agent Note: `.devflow` 装着四类内容，每一类对 git 只有一个答案

Status: implemented

## Problem

四类 git 语义截然不同的内容堆在同一个目录下，而从来没有任何一份文档把它们分开过。两个包各自推断答案，得出了相反的结论：

- `packages/devflow-worktree/assets/devflow-worktree-runbook.md` 把"看板已提交"列为第一条前置条件——"A branch checked out from a repository that gitignores its board gives the worktree an empty board that silently renumbers new cards from `0001`."
- `packages/devflow-midscene/tests/devflow-composition.spec.ts` 用内容为 `.devflow/` 的 `.gitignore` 搭建它的工作区。

两者各自自洽，合起来就是矛盾。midscene 那一行也不是随手写下的夹具细节：**它是那个包唯一一处声明自己对仓库布局假设的地方**，因此它就是该包在这个问题上的立场。

同一个缺口已经造成过一次更小的代价。runbook 的忽略清单点名了 `claim.json` 与 `commit.lock`；`.devflow/midscene/operation.lock` 随 `packages/devflow-midscene/src/project-settings.ts` 后到，没人把它补进去——因为这份清单没有主人。

## Decision

`docs/devflow.md` 及其中文页承载唯一一节「`.devflow` 的提交语义」，点名这四类内容，以及决定每一类的那个问题：**这个文件的真相住在哪。**

| 内容 | 入库 | 因为它的真相是 |
|---|---|---|
| 卡片状态——`tasks/**/journal.jsonl`、`card.md`、`artifacts/` | 必须 | journal，而 `foldJournal` 只在 revision 连续时读得出它 |
| 仓库知识——`spec/`、`iron-rules/`、`business/` | 必须 | 文件加 git，spec 那条缝本就立在这句话上 |
| 部署策略——`validation.json`、`midscene/settings.json`、`midscene/suites/` | 应该 | 维护者的决定，而 `validation.json` 的存在正是为了在没有挂载提供者时这条决定依然生效 |
| 进程瞬态——`**/claim.json`、`**/commit.lock`、`midscene/operation.lock` | 绝不 | 某个活着的进程，因此旅行到别处的副本描述的是一个从未在那里跑过的进程 |

第四行的规则在文档里以一般形式陈述，因为它要裁决表中没有点名的路径：**内容在另一台机器上没有意义的文件，不该进 git。**

这一节同时承载规范 `.gitignore` 片段。其余文档引用这一节，而不是重述这套分类——片段本身则被复制，因为片段就是拿来复制的，而 `tests/devflow-root-commit-contract.spec.ts` 断言每一份副本归约出的 pattern 与 `docs/devflow.md` 里那份完全一致。

`.devflow/midscene/operation.lock` 按它当前的路径列出。把它挪到运行时根目录是另一件事；在它挪走之前，少一行是持久状态泄漏进 git，而挪走之后多留一行不花任何代价。

### 测试钉住了什么

`tests/devflow-root-commit-contract.spec.ts` 在一个带着该片段的真实 git 仓库上通过真实 Loader 启动 store，把一张卡推进到留下租约与已登记产物的程度，然后断言**两个方向**：每一个瞬态路径都被 `git check-ignore` 命中，每一个卡片状态与策略路径在 `git add -A` 之后都被跟踪。只断言"瞬态被忽略"会漏掉 runbook 第一条前置条件警告的那一半——而那正是真实发生过的失败。

## Alternatives considered

**各包自己的 README。** 这正是矛盾的成因。两个包写同一个目录，各自描述自己碰到的那一部分，谁都没有理由注意到对方的答案。

**放在规划工作区而非本仓库的一篇跨包 spec。** 这是最短的路径，因为决策本就是在那里做的。它失去的是读者：规划笔记不随包发布，装了 bundle 的部署永远看不到一条它必须遵守的规则。

**在 runbook 和 midscene README 里重述这套分类，而不是引用它。** 一套分类的三份副本会漂移，而且漂移是无声的——`operation.lock` 从唯一存在的那份清单里缺席，走的正是这条路。

**像 midscene 夹具实际主张的那样，整个忽略 `.devflow/`。** 它让瞬态问题消失的方式是让看板一起消失：卡不再随分支旅行，worktree-per-card 无处开发，而门禁策略在除写它那个 checkout 之外的所有地方都不再生效。

## Consequences

- runbook 的前置条件 2 现在点名了完整清单，照它搭起来的仓库不会再泄漏 `operation.lock`。`packages/devflow-worktree/tests/skill.spec.ts` 把第三行与前两行一起钉住。
- 改动 `docs/devflow.md` 里的片段会让契约测试红掉，直到每一个承载方跟上。这是目的，也是代价：新增一个承载方意味着要把它加进那个测试的清单。
- `packages/devflow-midscene/tests/devflow-composition.spec.ts` 现在跑在每个部署真实拥有的布局上。它的验收流程未经改动即通过，这就定论了旧夹具那一行是一个假设而不是一项依赖。
- `.devflow/reports/` 与 `.devflow/cache/`——门禁产物的位置——不在表中。文档的判据可以回答它们，但把它们点名入表是一项还没有人做出的决定；本表陈述的是各包当时正在互相矛盾的那四类。
