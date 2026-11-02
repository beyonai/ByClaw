# Agent Note：testenv 从执行器退回到一个 runbook skill

Status: implemented

[English](2026-09-11-testenv-retreats-to-runbook-skill.md) | 中文

## 问题

`devflow-testenv` 过去执行集成测试环境：`testenv.yml` 清单声明有序服务与就绪探针，
引擎负责启动它们、轮询探针、失败回滚、反序拆除；五个工具（`env_up`、`env_status`、
`env_logs`、`env_down`、`integration_test`）跑在 `ctx.subprocess` 上；一条经
`ctx.jobs` 的后台作业路径；每个 workspace root 一个引擎，好让长驻 harness 服务多个项目。
约 2200 行源码，3350 行测试。

这里的每一块都是需要维护的契约：清单语义、覆盖自退出与长驻 `up` 命令的那一条规则、
进程树终止及其宽限、内存日志尾与其偏移、作业状态映射、以及一个缺陷已经逼着重写过一次的
session cwd 根解析。它换来的能力——启动序列的确定性重放——是真实的，但那个序列仍然得
先由 agent 探索出来、写进清单、再证明一遍；而清单只能表达 schema 有字段的那部分。

周遭还有两件事变了。真正值得留存的知识不是「一串服务和端口」，而是整份 runbook：
每一步的成功信号、冷启动与热启动的耗时差、遇到过的失败及其修法、哪个依赖可以 mock、
哪一步需要联网。而这份知识该待的地方是项目自己的仓库——在那里它被评审、被版本化，
且完全不需要挂载本插件就能读。

## 决定

**执行层删除。本包现在就是一个捆绑 skill。**

`devflow-e2e-bootstrap-runbook` 教 agent 产出并维护一份由目标仓库承载的 runbook：
仓库根下一个 `e2e/` 目录，里面是 `README.md` 与并排的 `up.sh`、`check.sh`、`down.sh`。
六个阶段——侦察（CI 配置优先，因为跑通的 job 天然证明了自己的命令）、逐步记录的真实拉起、
每条断言都通过停掉对应组件来反向验证的三层健康探针、分层启动方案识别、先脚本后文档的写作、
以及只读文档的从零复验。承重规则是：runbook 里的每一条命令都必须是作者真正跑过的——
凭源码推断出来的 runbook 比没有更糟，因为下一个 agent 会信任它，然后无声地失败。
当前环境无法验证的步骤标为 `[未验证]` 并写清原因，绝不升格成事实。

`packages/devflow-testenv/src/` 保留 `index.ts`、`skill.ts`、`invariant.ts`；
`engine.ts`、`manifest.ts`、`probes.ts`、`tools.ts`、`types.ts` 连同四套测试一并删除。
`inject` 从 `['tools', 'subprocess', 'skills']` 收窄为 `['skills']`；`Config` 丢掉全部
七个执行期 tunable，变成空的；`yaml` 依赖与 subprocess、tools、jobs 三个 peer 随代码而去。
注册形态改用
[devflow-guidance](../../../../packages/devflow-guidance/src/skill.ts)
的一 skill 一 provider 写法，而不是 testenv 原来的共享 provider——覆盖是按名进行的，
provider 与 skill 同名本身就说明了这一点。

决定内部的四个取舍：

**包名不变。** `@zhchxiao123/dsh-devflow-testenv`、cordis 插件名 `testenv`、
bundle patch id 都保持原样。这个名字已经对不上能力，两份 README 都写明了这一点。
改名会破坏已发布的包名和所有安装它的 profile，换来的只是命名更准——在包的形态已经在
消费者脚下变化的时候，这笔交易不划算。

**skill 正文按中文发布。** 它本就是用中文写成的散文，而这段文字本身就是契约；
翻译它等于由作者以外的人重写一遍。模块文档与两份 README 都记录了这是有意为之，
免得后来的改动去「修」这个语言差异。

**产出物收在一个 `e2e/` 目录里。** 作者原文把它拆在 `docs/agent/e2e-setup.md` 与
`scripts/e2e/` 两处；收拢之后，文档就挨着它必须逐字对应的那些脚本——那是正文里最常被
违反的一条规则，其观察到的失效形态正是路径或数字在两者之间漂移。`e2e/` 撞上已经用它放
Playwright/Cypress 用例的仓库，是好事而不是冲突：runbook 描述的恰恰是怎么把那些用例
需要的环境拉起来。用 `README.md` 而不是 `setup.md`，是因为目录的 README 在网页界面上
点进去就渲染，而 agent 那侧本来就有正文强制要求的 `CLAUDE.md` / `AGENTS.md` 指针来路由。
skill 名与这组路径，是相对作者原文仅有的两处改动。

**没有弃用期，也没有兼容垫片。** 升级过 `0.4.0-dev.7` 的组合会直接失去 `env_*` 工具。
兼容层要想有意义就得让引擎继续活着，而引擎正是被移除的那个东西。

## 考虑过的其他方案

**保留执行层，把 skill 加在旁边。** 两者恰恰在最要紧的那一点上重叠：都在回答
「这个系统怎么拉起来」，一个答进 schema，一个答进项目自己保存的脚本。同时留着，
等于在 runbook 已经让清单变得多余之后，仍然背着清单的维护成本，还逼每个项目在
没有选择规则的情况下二选一。

**把清单当作 runbook 的数据格式**——skill 写 `testenv.yml`，工具去跑它。
否决，因为让 runbook 可信的大部分内容清单都表达不了：冷热启动耗时、该盯哪一行成功信号、
失败与修法的记录、哪条断言被怎样反向验证过。那只会让 schema 变成文档的有损子集。

**把产出物放进 `.devflow/e2e/`，不碰项目自己的目录树。** 很有吸引力——产出物不再改动
仓库布局——但结构上不可行。[`devflow-fs-guard`](../../../../packages/devflow-fs-guard/README.zh.md)
会在 `ctx.fs` 执行之前，拒绝一切目标路径含 `.devflow` 段的 `write` / `edit` /
`str_replace_editor`，并把拒绝引向 `devflow_transition` / `devflow_create` /
`devflow_write_spec`——没有一个能写 shell 脚本。于是恰恰在 devflow 完整组合的部署里，
这个 skill 写不出自己的产出物。唯一的通路是 `bash: cat > .devflow/e2e/up.sh`，因为
guard 是 policy fence 而非内核边界——那等于写一份教 agent 绕过仓库自身防护的 skill。
即使没有这道 guard，另外两条理由也成立：`.devflow/` 是插件持有的持久状态，其唯一写路径
是 `ctx.devflow`；而本包只 inject `skills`，其产出物不该依赖 devflow 被组合。

**把包改名为 `devflow-e2e`。** 命名诚实，但会让已发布的包名半途搁浅；见上。

**把正文翻成英文，与本线其他 asset 保持一致。** 否决：正文的精确性就是产品本身，
而译文是一段新文本，它没有经历过产生这段原文的那些实践。

## 后果

本包需要维护的面，从一个带进程、探针、作业、清单四类契约的执行器，缩到一份散文 asset
加它的注册——三个小源文件、三套测试、无运行期状态、不用 `ctx.subprocess`、不用 `ctx.jobs`。
失效模式随之而去：这里已经不可能遗留孤儿进程、泄漏端口或错误地终止进程树，因为这里不再 spawn。

让出的是重放的确定性。runbook 是另一个仓库里的脚本加散文；这里没有任何闸门去检查
`e2e/README.md` 是否存在、其命令是否还能跑、乃至是否曾经能跑。
这份保证现在完全落在协议自带的闸门上——反向验证的断言与从零复验——那是 agent 的纪律，不是机器检查。
这笔交易可以接受，因为执行器本来也不保证清单**正确**；它保证的只是忠实执行写下来的东西。

`env_up` 及其同伴的消费者在升级时直接断裂，没有迁移路径。若要重新引入，条件大概是：
某个部署需要在没有 agent 在环的情况下，由许多会话以同样方式拉起同一套环境——
定时运行器，而不是某个人的测试循环。目前没有这种形态。

本 note 取代了 testenv 执行层的设计记录：
[编排范围与 up 规则](2026-09-01-testenv-orchestration-scope-and-up-rule.zh.md)、
[渲染增强](2026-09-01-testenv-render-enrichment.zh.md)、
[后台作业](2026-09-02-testenv-background-jobs.zh.md)、
[testenv-author skill](2026-09-02-testenv-author-skill.zh.md)、
[session root 解析](../bug-fix/2026-09-02-testenv-session-root-resolution.zh.md)、
[bootstrap 调查协议](../bug-fix/2026-09-02-testenv-bootstrap-survey-protocol.zh.md)，
以及[活过了自己 teardown 的哨兵](../testing/2026-09-10-testenv-sentinel-outlived-its-teardown.md)。
它们被保留下来，是为了那些未来的执行器仍会再次面对的决策背后的推理。
