# Agent Note: spec bootstrap 上板 —— 卡片承载这一趟，普查承载覆盖

Status: implemented

[English](2026-09-15-spec-bootstrap-on-the-board.md) | 中文

## Problem

一次针对八模块仓库的真实冷启动产出了两个 scope 下的三份文档，同时暴露出两个与判断质量无关的缺口。

**这一趟的推理过程活不过这一趟。**一趟 bootstrap 会裁决一份候选主张清单，然后只写下过线的那几条。这份清单按设计就是工作稿——它装的是否决，而文档装的是主张——所以它不进 `.devflow/spec/`。可它只在一个 turn 里被说出来，说完就没了，于是"为什么是三份文档"这个问题，下一个会话读不到任何答案。

**没有任何东西评审锚。**那次实跑写了十三个锚：八个 `symbol`、五个 `churn`、**零个 `content-hash`**。churn 那几个是对的（没有 parser 读得了 `.yml`）。而那八个 `symbol` 里有若干条支撑的是行为性主张——"降级端点只有 POST，所以 GET 打过去得 405"，锚却挂在控制器的类型名上。加一个 `@GetMapping`，主张就假了，类型名却纹丝不动，锚继续报 `fresh`，文档从此陈述着与代码相反的事，而且再没有任何东西会报告它。这正是 anchor 模型存在所要防的那种静默失效，而当时没有任何一层拦住它。

这两个缺口都是卡片板回答得了的形状：留得下来的工作产物，以及在工作被宣布完成之前对它的一次独立检查。

## Decision

bootstrap 可以被放上 devflow 板，作为一条 **opt-in 的部署配置**；为此没有新建任何东西。整条路线是 `dsh-devflow-artifact-gate` 上的一个 `bootstrap-pass` 产物 kind、`dsh-devflow-agent-gate` 上的一条指令，以及原封不动的 `dsh-devflow-parent-gate`。这次变更集是 [docs/devflow.md](../../../../docs/devflow.md) 里的一份配置样例、`devflow-spec-bootstrap` skill 里的一节不编号分支，以及一个直接从该文档里把样例取出来启动的 real-composition 测试。

### 卡片承载一趟的工作，它绝不承载覆盖状态

**没有任何一张卡——父卡也好子卡也好——是"这个仓库还缺什么"的权威来源。**`/devflow spec` 从磁盘实算覆盖，无法漂移；用板跟踪同一个问题则必然漂移，因为 `devflow_write_spec` 本身就是一个完整的提交点——文档落了地，不需要任何一张卡动一下。采用之后不出一天，板上某个 scope 还写着 todo，普查却说它已覆盖，而两个答案都看得见、都像真的。

这同时也是本线自己的规矩，写在 [docs/devflow.md](../../../../docs/devflow.md) 里：状态只在其提交点发布。"这个 scope 有文档了"的提交点是那次写入，不是一次流转，所以一张声称此事的卡片，是一份没人维护的投影。

由此推出三件事，三件都是承重的而非风格问题：

- 父卡的完成判据是**引用**普查——当普查不再把这些 scope 报为 no document 时它才完成——而不是复述一份清单。
- `bootstrap-pass` 这个 kind 有 `Scopes`、`Candidates`、`Verdicts`、`Written`、`Waived` 五节，并且刻意**没有 `Remaining` 节**。这个"没有"就是契约本身：没有格子可填，漂移就无处开始。组合测试断言发布出来的 kind spec 恰好只有这五节。
- skill 的上板分支用祈使句把它说死，因为下一个读到它的人，很可能想把一份 scope 清单抄到父卡上当进度条。

### 这次检查是为了什么

`Verdicts` 被要求非空，`Scopes` 与 `Candidates` 同理。空的裁决节不是"裁决了但为零"，而是"根本没回答"。`Written` 与 `Waived` 只要求存在——没有候选过线的一趟不写任何文档，而多数趟不豁免任何 scope。

结构检查看不到那次实跑真正做错的三件事，所以 agent-gate 的指令判的正是这三件：每条否决都带着针对**这一条**候选的理由，而不是放在任何一行下都成立的套话；行为性主张落在 `content-hash` 而不是 `symbol` 上；以及 `Waived` 里的每个 scope 都由一篇在 `waives` 里点名它的真文档承载。第二条是这道门存在的全部理由——它是"13 个锚里 0 个 content-hash"那个发现，被翻译成了一条准入判据。

### 离开 `developing` 的两条边

契约同时写了 `developing->reviewing` **和** `developing->done`。服务类别是加边不是换边：`express` 走标准的 `developing->reviewing`，但 `emergency` 走 `developing->done`，所以只写前一条的契约，恰好放过跑得最快的那批卡片，让它们一份裁决清单都不交就出去。这与 `spec-delta` 在三条终态边上记下的是同一个坑；这里再记一次，是因为边集不同，而且这份契约的初稿就是写错的。

## 为什么是 opt-in 而不是默认

这条路线要花一张父卡、每个 scope 一张卡、每趟一次登记、每条被配上的边一次 checker 派发。一个一趟就能把缺口补完的仓库，付掉这一切换来的只是普查早就报告过的事，所以默认保持关闭——`devflow-artifact-gate` 与 `devflow-agent-gate` 在 bundle 里本就是 disabled，而没有上面那份 `kinds`/`edges` 时，一趟 bootstrap 的行为与本次变更之前完全一致。"这份纸面开销什么时候值得"这个判断，落在 skill 里、紧挨着它所限定的那套流程：当这一轮活得比启动它的那个会话更久时，把它放上板。

## Alternatives considered

**新建一个 `devflow-spec-board` 包：不。**这条路线的每一块都已经是配置，而本线关于产物契约的章程正是"没有任何策略把契约写死"。一个包只能把 kind、边和完成规则再用代码复述一遍，而 profile 已经把这些说过一次了。

**用卡片当覆盖视图：不。**这正是整条路线被塑造成现在这样的原因——见上文。普查每次运行都从磁盘推导；板是人往上追加的。

**在产物上加一个从普查填出来的 `Remaining` 节：不。**一份推导结果的快照，在被登记的那一刻就已经过期，而登记是不可变的，于是卡片会攒下一堆互相矛盾的快照，最新的那份靠 revision 而不是靠真假胜出。

**改为配在终态边而不是 `developing` 的出口上：不。**裁决清单是这一趟的工作产物，所以它应当在这趟工作所在的阶段的出口处被交出。改配 `reviewing->done` 与 `testing->done` 会让卡片带着无可评审的内容走进评审。

**在指令里加第四条判据，要求这一趟说明自己留下了什么没覆盖：不。**那是在卡片平面上借 checker 之手把覆盖问题请回来；而"这一趟报告自己覆盖了什么"是 turn 级的义务，skill 已经承载了它。

## Testing

[`tests/spec-bootstrap-board-composition.spec.ts`](../../../../tests/spec-bootstrap-board-composition.spec.ts) **按文本从 `docs/devflow.md` 里取出**那份 YAML 样例，只替换临时路径与脚本化的 checker provider，然后经真实 Loader 启动它。它驱动一张 `express` scope 卡、一张 `emergency` scope 卡和它们的 `express` 父卡走到 `done`，并断言每一层都至少决策一次：两次机械否决（什么都没登记、`## Verdicts` 有标题但为空）且它们背后 checker 派发次数为零、锚种类不匹配的否决连同落盘的报告与没有新增的 journal 条目、emergency 那条边上的机械否决，以及 scope 卡还开着时父卡遭到的完成否决。一次挪动了样例的文档编辑会让这个 suite 失败，并点名它认不出来的那一行。

第二个用例用同一个 store 加完成策略、但两行门禁都不配，驱动一张卡在什么都不登记的情况下走到 `done`——这是反向验证的正面一半；反面一半是其余测试一行都不用改。

## Consequences

`bootstrap-pass` 这套词汇是样例而非已发布的 kind：节名归部署所有，想换节名的部署改自己的 profile 即可。`packages/` 里没有任何东西知道这个 kind 存在。

skill 里这一节不编号，和它旁边的 `## Languages without a parser` 一样，因为它限定的是整套流程而不是在流程里占一步——也因为编号各节正在另一个分支上被重排。

那次实跑自发形成的跨切归属规则现在被写了下来：一条跨模块的主张归到拥有那个契约的 scope，再从别处引用它，于是它是一条挂着一个锚的主张，而不是每个 scope 一份、彼此渐行渐远。这样的一趟归父卡，因为把它当成某张子卡的工作，等于让一个 scope 的卡片去管另一个 scope 的文档。

回滚就是删掉这段配置。已经建出来的卡片留在板上，作为普通卡片，它们的登记留在各自的 journal 里；那些趟写出来的文档不受影响，因为 spec 缝从头到尾就没学过这条路线。
