# Agent Note: devflow——作为可部署组合的产物契约

Status: implemented

[English](2026-08-27-devflow-artifact-contract-composition.md) | 中文

## Problem

产物契约分四个切片交付——[seam 上的 kind 与 store 代写内容](2026-08-27-devflow-artifact-kinds-and-store-written-content.zh.md)、[机械门禁](2026-08-27-devflow-artifact-gate-mechanical-contract.zh.md)、[LLM 准入门禁](2026-08-27-devflow-agent-gate-llm-admission.zh.md)、[driver 喂入](2026-08-27-devflow-driver-artifact-feeding.zh.md)——每一片都只在自己包的测试套件里被证明过。没有任何东西证明它们能组合起来。没有一个测试把四个迁移策略挂到同一条 waterfall 上;它们必须遵守的挂载顺序——那**就是**裁决顺序,机械门禁的 README 只能把它列为 Known Limitation——没有写在任何部署会照抄的地方;bundle 甚至没有带上两个新门禁包;部署者也没有一份可运行的配置能看到完整契约长什么样。

## Decision

**一条仓库级 real-composition 测试拥有整个故事。** `tests/artifact-contract-composition.spec.ts` 用真实 Loader 启动一份 `cordis.yml`——store、按 waterfall 序的四个策略、跑门禁命令的真实 bash、脚本化的 checker provider——并驱动一张卡 draft→done。每一层至少裁决一次,每个裁决都断言到 journal 或文件层面(否决不产生提交;放行的 `gate.checks` 落进提交条目;否决报告与 store 代写的交付物都从磁盘读回),顺序本身也可观察:一个机械缺陷派发零个 checker、运行零条门禁命令,一次 agent 否决同样运行零条门禁命令。返工闭环完整走过——agent 否决且报告落盘、完全相同的重试由裁决缓存应答而不再派发、修正版本错过缓存后放行——完成层则既否决过(子卡未完成)也放行过(子卡按同一契约推到 done)。测试放在仓库级,因为它证明的是横跨五个包的部署形态,而不是某一个包的行为;组合级的 invariant 套件本来就在那里。

**部署样例是文档,不是口口相传。** `docs/devflow.md` / `.zh.md` 新增"产物契约"一节:一份可照抄的配置,流水线六条边全部带契约;waterfall 顺序的理由(机械 → agent → 命令 → 审批;完成层在它唯一拥有的那条边上殿后——便宜且确定的层先否决,模型预算、墙钟时间与人的注意力才不会被白花);以及单点规则——机械门禁的 `kinds` 是 kind 结构的唯一定义,以 `devflowArtifactStructures` 服务发布,手维护的 Cordis API 块现在记录了它;其余各行只提 kind 名,不复述形状。bundle 以禁用行挂上两个门禁包(空 spec 集什么也不拦;agent 门禁每次检查都花模型预算),并把四个策略行排成文档所写的 waterfall 顺序。

**最后几处权限位故障模拟清除了。** 剩下的三条 `chmod(0o444)` journal 写失败测试(filesystem、gates、driver)现在通过 `tests/fs-fault.ts` 在 journal 路径上注入 `appendFile` 故障,断言不变——注入器为此新增了 `appendFile` 操作。权限位对 root 无效、在 Windows 上不可靠;仓库规则([ci-blocking-gates](../process/2026-08-27-ci-blocking-gates.zh.md))已为读故障禁掉它们,这里补上了写故障的尾巴。

## Alternatives considered

**用代码而不是挂载顺序强制 waterfall 序。** 监听器的优先级字段不在已发布的 harness 表面上,而一个聚合的单体门禁插件会拿四个可独立挂载的策略去换一块铁板。挂载顺序决定监听顺序是框架自己的约定;本线把它写进文档、装进 bundle,并用一条组合测试钉住——Loader 若不再保持该顺序,测试会大声失败。

**把端到端测试放进某个门禁包。** 它断言的是跨包行为——"一次 agent 否决不会运行任何门禁命令"该归哪个包?任何单一归属都低估了所有权,还会把其余包连同运行时栈拖进那个包的 devDependencies。仓库级归属的代价是根 devDependencies 增加五个 harness 包。

**在 bundle 里以启用状态挂新门禁行。** 没有 specs 的产物门禁是一行什么也不拦的配置,agent 门禁每检查一次就花一次模型预算——启用行会让 bundle 开箱就替人付钱。禁用行既保住"一条命令安装"的承诺,又为将来开启它们的部署占好 waterfall 里的位置。

**让 bundle 的 parent-gate 行留在原处(gates 之前)。** 两行的相对顺序只在同时带命令或审批的 `-> done` 边上可观察,但文档写的顺序是完成层殿后,而一份与自己文档相悖的挂载清单正是加载顺序口口相传的开端。这次挪动对所有既有 profile 行为中立,因为两行默认裁决的边集不相交。

## Consequences

- waterfall 顺序现在被三处钉住——文档、bundle、测试——cordis 或 Loader 若改变激活顺序,会表现为这条套件失败,而不是部署的门禁静默换位。
- 根 package 为组合测试新增五个钉死版本的 `@deepseek-ai/*` devDependencies(`dsh-agent`、`dsh-agent-default-model`、`dsh-subagent`、`dsh-subprocess-local`、`dsh-bash-local`);它们随每个包自己的依赖一起走同一次 harness 版本齐步升级。
- 部署样例是对五个包配置 schema 的手维护散文;schema 变更要花一次文档巡检,Cordis API 块里"以源码为准"的规则已为此计价。
- `tests/fs-fault.ts` 现在服务四种操作;需要新可注入操作的 spec 应扩展该联合类型,而不是伸手去拿 `chmod`。
