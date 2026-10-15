# Agent Note: devflow-testenv — B 档编排范围与统一 up 命令规则

Status: implemented

*Superseded 2026-09-11：本 note 描述的 testenv 执行层已删除；本包现在只剩
`devflow-e2e-bootstrap-runbook` 这一个 skill——见 [testenv 从执行器退回到一个
runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.zh.md)。保留是为了那些未来的执行器仍会再次面对的推理。*

[English](2026-09-01-testenv-orchestration-scope-and-up-rule.md) | 中文

## Problem

集成测试环境在每个 session 里都要重新考古：有哪些服务、各自怎么启动、何时算就绪、
怎么整体拆除。harness 已通过 `bash(run_in_background)` 覆盖"单条后台命令 + tail +
kill"，因此 testenv plugin 只有做出它表达不了的东西才值得存在——带就绪门的有序多
服务拓扑，以及整环境的拆除保证。

引擎的形态由两个问题决定。清单承诺多少编排能力？当一条 `up` 命令是长驻服务
（`pnpm start`）、另一条把工作委托给守护进程后立即退出（`docker compose up -d`）
时，"服务已就绪"意味着什么？

## Decision

**范围取 B 档：按声明顺序串行启动、每服务一个就绪探针、整环境逆序拆除、单一 test
命令。** 清单的 `services` 列表就是启动顺序，也是拆除顺序的倒序。不做依赖 DAG、
不做并行启动、不做端口分配、不做单服务重启、不做自动重试——每一项都因为没有当前
owner 而排除，不是因为难。列表形态让未来的 `dependsOn` 字段可以增量加入。

**一条规则同时覆盖两类 up 命令，清单不设区分字段。**
`packages/devflow-testenv/src/engine.ts` 启动每个服务后同时观察两件事——就绪探针
与进程退出：

- 探针通过即就绪，无论进程是否还活着。这就是 `compose up -d` 的情形：命令可能在
  它委托的守护进程通过探针之前早已退出。
- 进程在探针通过前失败——非零退出、信号致死或 spawn 级错误——立即判该服务失败，
  错误里带退出事实。
- 干净退出（exit 0）让探针继续轮询到该服务的就绪 deadline；只有 deadline 才把
  "退出 0 但始终未就绪"变成失败，且错误信息说明进程早已退出。

任一服务失败，`up()` 返回前先把已启动的服务按逆序回滚。`up()` 成功时把环境注册为
一个 `ctx.effect()`，其 disposer 就是整体拆除，因此 fiber 销毁在结构上不可能留下
服务进程；`down()` 走同一个 disposer。拆除先跑声明的 `down` 命令，但总是以终止 up
进程树收尾（树已消失时幂等无操作），并有界等待整树退出，聚合所有服务的失败而不是
在第一个失败处停下。

所有 deadline——就绪轮询、down 命令、seed/test 运行——由引擎自持，因为 subprocess
seam 刻意不带任何超时。每流 spill 上限是固定常量（16 MiB）而非配置：spill 文件只
用于恢复一次 lossy 的增量读取，面向模型的表面始终是有界的内存尾。

## The workspace root, and rollback residue on the wire

**工作区根是 apply 时一次性捕获的进程 cwd。**
*已于 2026-09-02 被推翻：真实部署里 harness 以 harness 检出目录为 cwd 运行，
而非任何工作区，apply 时捕获把所有会话的清单都解析进检出目录。root 现改为逐调用
从调用方 agent 会话的 cwd 解析，每工作区根一个引擎——见
[会话根解析 note](../bug-fix/2026-09-02-testenv-session-root-resolution.md)。*
原始推理：harness 以工作区根为 cwd 运行——这与 `devflow-filesystem` 默认根依赖
的是同一假设——因此 `apply` 立即解析出根并交给引擎，清单路径与每个服务的 `cwd`
都相对这个捕获值解析。

**`env_up` 以 `teardownDetail` 报告回滚自身的残留。** 启动失败会把已启动服务回
滚，该拆除把自身的失败聚合进引擎报告——但工具封闭的输出 schema
（`additionalProperties: false`）没有字段承载它们，于是即使回滚留下了进程或状
态，模型也只被告知"每个已启动服务都已拆回"。这个线上字段把引擎的
`teardownFailures` 各行折叠成一段文本；render 切换判定行并追加残留。错误信息质量
是清单修复流程的生命线，模型看不见的残留就是没人去清理的残留。

## Alternatives considered

**A 档——只有 bootstrap skill、没有引擎。** skill 能教会 session 跑命令，但无法承
诺拆除：没有任何结构把已启动的进程绑到 session 的生命周期上，而这正是 effect 注册
的环境所消灭的孤儿问题。

**C 档——依赖 DAG、并行启动、端口分配。** 能力更强，但每项额外能力都没有当前
owner，而且清单里的 DAG 迫使每个清单作者按图思考，列表已经编码了 B 档做出的唯一
顺序保证。

**用清单字段区分自退出型与长驻型 up 命令。** 这让作者去声明一个引擎本可观察到的事
实，还制造了误声明的失败模式（`compose` 式命令被标成长驻型会在自身成功时被判失
败）。统一规则无需声明，对两种形态都不会误读。

**把任何就绪前退出——包括 exit 0——都判为立即失败。** 只要探针滞后于命令退出就会
判 `compose up -d` 失败，而那正是该命令的正常行为。只有失败的退出才证明服务不可能
再就绪。

**用 `Config` 字段配置工作区根，或按会话解析 cwd。** 配置出来的根重复了 harness
自身 cwd 已经指名的东西，还引来两者漂移；按会话取根（`devflow-tool` 的模式）需要
每次调用都带归属 agent 的身份、每个工作区一个引擎，而这个引擎按设计每 session 一
个环境，工具也不接受会话参数。*按会话解析这个替代方案在 2026-09-02、真实部署证明
cwd 假设不成立后落地——决定归
[会话根解析 note](../bug-fix/2026-09-02-testenv-session-root-resolution.md) 所有。*

**在线上发布结构化的 `teardownFailures` 而非折叠文本。** 读者是逐行阅读渲染输出
的模型；结构化数组没有任何程序化消费者，发布它就是为无人保留线上表面。引擎内部
保留结构化列表，日后提升它是增量的。

## Testing

`packages/devflow-testenv/tests/engine.spec.ts` 用真实 `LocalSubprocessRuntime`
加真实 `sh`/`node` 子进程验证每一条生命周期主张：严格启动顺序、干净退出后就绪、
就绪前失败退出、就绪超时、无进程残留的逆序回滚、两条拆除路径、down 超时降级终
止、失败聚合、status 复测、退出后日志读取、up→seed→test 阶梯，以及经 fiber 销毁
的拆除。脚本化的 `SubprocessHandle` double 只覆盖真实进程无法确定性触达的分支——
spawn 级 rejection、拒绝退出的进程树、进行中的状态守卫。

## Consequences

每个引擎实例一次只有一个环境，拆除承诺是结构性的而非行为性的：销毁 fiber 即足够。
统一 up 规则的代价是：命令退出 0 却始终未就绪的服务要烧完整个就绪 deadline 才失
败——错误信息以"进程早已退出"作为补偿说明。B 档裁剪意味着真正有扇入的服务图必须
在清单里手工线性化；若出现 owner，`dependsOn` 字段可增量重新引入。在 apply 时捕
获根曾把解析的正确性绑在"harness 从工作区启动"之上——部署证明它从别处启动，且那个
"可诊断的失败"导致模型把 shim 清单写进了 harness 检出目录；
[会话根解析 note](../bug-fix/2026-09-02-testenv-session-root-resolution.md)
替换了这次捕获。`env_up` 的输出 schema
现在是 `env_status` 的严格超集：多出的那一个字段只出现在可能发生回滚的调用上。
