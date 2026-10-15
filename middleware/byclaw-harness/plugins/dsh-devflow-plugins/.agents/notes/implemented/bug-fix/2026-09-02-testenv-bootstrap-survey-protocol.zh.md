# Agent Note: testenv-bootstrap — survey protocol replaces stop-at-first research

Status: implemented

*Superseded 2026-09-11：本 note 描述的 testenv 执行层已删除；本包现在只剩
`devflow-e2e-bootstrap-runbook` 这一个 skill——见 [testenv 从执行器退回到一个
runbook skill](../feature/2026-09-11-testenv-retreats-to-runbook-skill.zh.md)。保留是为了那些未来的执行器仍会再次面对的推理。*

[English](2026-09-02-testenv-bootstrap-survey-protocol.md) | 中文

## Problem

第一次对深工作区的真实 bootstrap——一个承载 monorepo 的元根目录，内含
`vitest.e2e.config.ts`、`vitest.web.config.ts` 与 Python 套件——产出了单
mock 服务清单，`test` 是一条冒烟命令，其余测试版图从未被盘点或记录淘汰
理由。根因在 skill 正文自己的措辞："stop as soon as the start commands …
are established" 与 "start with the single most upstream service" 对单套件
项目是对的，在其他任何地方都导致过早收敛——第一个能跑通的套件通常是
mock 最重的那个，而且没有任何步骤强制证明所选套件真的依赖环境。

## Decision

`packages/devflow-testenv/assets/testenv-bootstrap.md` 是一个八节勘测协议：
版图盘点并明文禁止提前收敛、逐套件服务绑定分析（全 mock 套件绝不作为
`test`）、套件选型并把淘汰记录写进清单头注释、前置条件盘点、注释完备的
清单（作用域声明加逐条来源标注）、正闭环加负验证、会话内勘测汇报、修复。
旧行为作为有边界的快路径保留：恰好单一测试配置、单一 CI 测试 job、无
workspace/monorepo 结构时跳过第 1–3 节。

负验证取五个工具能诚实表达的形态：没有工具能停掉单个服务，而
`integration_test` 会自己把停着的环境拉起来，所以证伪是 `env_down` 之后
在 shell 里直接跑清单的 `test` 命令——它必须转红，转绿则绑定分析有误，
回到第 2 节重选。文件纪律句（唯一持久产物、never into the harness
checkout、不写 shim 清单）逐字保留；`tests/skill.spec.ts` 钉住新契约句与
"stop as soon as" 的缺席。

## Alternatives considered

**负验证用单服务杀停。** 更真的证伪——只停一个依赖而非全部——但没有
工具能停单个服务，而 shell 侧杀进程会让引擎在服务已死时仍认为环境在
运行。整环境停是现有工具能诚实表达的唯一证伪；单服务停止工具无 owner。

**清单 schema 加多套件 `tests` map。** 能机器可读地记录整个版图，但没有
任何工具读取多于一条 `test` 命令；头注释以零 schema 成本承载淘汰记录。

**把 skill 拆成勘测/编写/修复三个。** 一个步骤彼此喂养的工作流被拆成三个
调用面；快路径已经在勘测不产生价值的地方免除了它的成本。

## Consequences

深仓库上的 bootstrap 在第一次 `env_up` 之前要读得更多，花在给不会去跑的
套件分类上；简单项目经快路径保持旧成本。"绿但无意义"的清单从沉默缺陷
变成可检出的缺陷——该红的那次跑不红。这个证伪刻意保持粗粒度：它证明
套件依赖环境整体，而不是逐个服务。
