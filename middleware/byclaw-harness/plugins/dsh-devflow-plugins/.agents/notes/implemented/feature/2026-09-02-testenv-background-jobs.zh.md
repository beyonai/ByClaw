# Agent Note: devflow-testenv——integration_test 注册为后台 job

Status: implemented

*Superseded 2026-09-11：本 note 描述的 testenv 执行层已删除；本包现在只剩
`devflow-e2e-bootstrap-runbook` 这一个 skill——见 [testenv 从执行器退回到一个
runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.zh.md)。保留是为了那些未来的执行器仍会再次面对的推理。*

[English](2026-09-02-testenv-background-jobs.md) | 中文

## Problem

实测 session 显示：套件一跑长，模型就抛下 `integration_test` 改用
`bash(run_in_background: true)`——bash job 有实时输出、可轮询的 id 和一个
kill 开关，而确定性工具把整个回合堵到套件跑完。每次叛逃都丢掉阶段报告、
seed 编排、环境复用标注、runner 汇总行，以及清单 `test` 命令的唯一事实来源
地位。在体验上输给裸 shell 的确定性工具会不再被使用。

## Decision

**`integration_test` 接受 harness 同名的 `run_in_background: true` 参数，把
整条 up → seed → test 链注册为一个 `ctx.jobs` job**（种类
`testenv-integration`，declaration merging 进 `JobKindMap`；label 为
`integration test`；owner = `exec.agent`，完全沿用 bash 工具的先例）。工具
立即返回 `{ jobId }`；输出 schema 变为 `oneOf`，其同步分支与旧形状逐字节相同。

**引擎只长出一个可观察运行形态，不长第二台状态机。**`runTest()` 现在委托给
私有的 `executeRun(observer?)`；公开的同步路径传 `undefined`，由既有 render
测试钉住不变。`runTestObserved()` 用一个 `ObservedRun` 包住同一条路径：
（a）把阶段标记行与 seed/test 实时输出汇入一个消费型游标——流文本按 spawn
有界内存尾的 offset 增量读取，与 `logs()` 同一机制，lossy 读取明说；（b）持
一个 `AbortController`，其 signal 经 `AbortSignal.any` 并入每次就绪轮询与前
台 spawn，取消因此搭乘 deadline 本来就在用的那些信号。

**取消语义复用既有拆除路径。**up 阶段被取消表现为启动失败（"the run was
cancelled before the service became ready"），走普通 `rollBack` 回滚；
seed/test 阶段被取消经 spawn signal 终止进程树，运行定局后——本次运行自己
拉起的环境经 `down()` 拆回去，复用自先前 `up()` 的环境保持运行，因为它归那
次调用所有。

**job 状态的映射是刻意的**（`src/tools.ts` 的 `observeJob`）：定局的运行即
`completed`，测试红或 up 失败也一样——失败是*结果*，由与同步路径完全同一个
`renderIntegrationTest` 纯函数渲染（从内联 render 提取而来，失败文案因此只
有一份）；`killed` 是被取消的运行；`failed` 留给运行本身出故障（清单非
法——附上 `testenv-bootstrap` 指引，与 `guarded()` 对齐——或引擎状态拒绝
本次运行）。最终 render 既是 `JobOutcome.output`，也是流游标的最后一段增
量，定局那次 `job_output` 读取因此能拿到它。

**`ctx.jobs` 是可选 peer，缺失时诚实。**包把 `@deepseek-ai/dsh-jobs` 声明为
可选 `peerDependency`（仅类型；运行时一律 `ctx.get('jobs')`）。组合无此服务
时后台调用报错并指出同步替代；registry 因无 controller 拒绝时其消息逐字保
留、再附同一替代。绝不静默降级为同步路径。

## Alternatives considered

**为可观察形态复制一份运行循环。**否决：拆除与超时语义是引擎最难挣来的部
分；observer 参数穿过 `up`/`startService`/`runBounded`，正是为了让 job 路径
无法偏离同步路径。

**测试红映射为 `failed`。**读过 jobs 词汇表后否决：registry 把 `failed` 留
给 producer 自身故障，bash 工具也把非零退出映射为 `completed` 加退出码
detail。测试红是 job 的一次成功运行。

**kill 时连复用环境一起拆。**否决：job 只拥有自己创建的东西；用户用
`env_up` 拉起的环境在被杀的运行之后继续存在，正如它在一次失败的同步运行之
后继续存在。

**`env_up` 后台化。**无 owner，超出范围；up 阶段被就绪 deadline 约束，其等
待问题小得多。

## Testing

`tests/engine.spec.ts` 在真实子进程上驱动可观察运行：运行中读到标记与实时
输出（用旗标文件把 test 命令闸住，进程可证明仍在跑）、test 阶段取消（进程
树死、环境 down）、对复用环境取消（保持 up）、up 阶段取消（回滚且指名取
消）、lossy 溢出提示。`tests/tools.spec.ts` 组合真 `LocalJobRegistry`（外加
真 `AgentRegistry` 验证归属围栏）证明：立即返回 job id、运行中 `job_output`
内容、最终输出与同一清单同步 render 相等（时长归一化，绿与红各一例）、
`kill` → `killed` 且无存活进程、清单与引擎缺陷映射为 `failed`、无 jobs/无
controller 两种拒绝、`run_in_background: false` 下同步路径逐字节稳定。
`tests/loader-composition.spec.ts` 经真实 Loader 启动
`@deepseek-ai/dsh-jobs-local`，端到端跑通后台路径。

## Consequences

描述后台契约的五处表面——参数与 schema 描述、render 确认语、两份 README、
类型注释——说同一句话，改一处欠其余四处。流游标按阶段以 `logTailBytes` 有
界，不是全程有界；从不读取的调用方最多拿到每阶段一个有界尾加标记。可观察
句柄的 `done` 绝不把 rejection 传进 registry：`observeJob` 把它转成
`failed`，遵守 `JobHooks.done` 契约。`@deepseek-ai/dsh-jobs` 加入了钉死预发
布版本集合，harness 升版时必须一起动。
