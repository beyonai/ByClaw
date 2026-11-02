# Agent Note: devflow-testenv — 耗时事实与增厚的结果渲染

Status: implemented

*Superseded 2026-09-11：本 note 描述的 testenv 执行层已删除；本包现在只剩
`devflow-e2e-bootstrap-runbook` 这一个 skill——见 [testenv 从执行器退回到一个
runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.zh.md)。保留是为了那些未来的执行器仍会再次面对的推理。*

[English](2026-09-01-testenv-render-enrichment.md) | 中文

## Problem

testenv 工具的首批真实 session 暴露了信息贫困的结果：`integration_test` 失败
只渲染一句结论加一段日志尾，真正的结论——几个测试失败——埋在日志尾底部。
引擎本就掌握阶段阶梯与服务拓扑，但不掌握任何耗时、也不知道一次运行是否复用
了已拉起的环境，而 render 几乎没有投影它所知道的东西。

## Decision

**引擎用单调时钟给自己计时。** subprocess seam 刻意不带计时，因此
`packages/devflow-testenv/src/engine.ts` 一律用 `performance.now()` 差值测量
——绝不用壁钟——与它自持全部 deadline 的方式一致：逐服务，从 spawn 到探针
通过的毫秒数（`readyAfterMs`）；逐次 up 尝试，含回滚的整体耗时
（`durationMs`）；逐次 `status()` 重探，应答耗时（`probeMs`）；逐条
seed/test 命令的运行时长；逐次 `runTest()` 的整次运行耗时。成功的 `up()`
记录完成时刻、耗时与逐服务启动事实；`runTest()` 发现环境已起时报告
`envReused: true` 与 `envUpAgeMs`，自己拉起环境时报告 `envReused: false` 与
`upDurationMs`。

**所有新报告与线上字段均为 optional，render 防御式读取。** 来自不带计时
事实的引擎的报告渲染出与旧版完全一致的文本——无占位符，render 不抛错。

**`integration_test` 的 render 结论前置。** 首行：判定、定局阶段、退出码、
总耗时。随后是环境区——复用/新起的头行加逐服务一行（探针种类与耗时），由
`env_up` 与 `env_status` 共用的同一个 `serviceLines` helper 格式化——再是
带耗时的 ✓/✗ 阶段时间线、runner 自己的汇总行、日志尾。

**runner 汇总提取是纯 render 里的逐行启发式，不是线上字段。**
`packages/devflow-testenv/src/tools.ts` 的 `RUNNER_SUMMARY_PATTERNS` 是一小
组固定正则（pytest 横条行、pytest `-q` 行、vitest/jest 的 `Tests` 行）；对
test 输出尾逐行匹配取最后一条命中，无一命中则完全不渲染汇总行。

**bootstrap skill 正文携带两条文件纪律。** `assets/testenv-bootstrap.md`
写明清单是该 skill 唯一的持久产物（实验文件放 `/tmp` 或用完即删），以及复杂
到不宜内联的命令放进项目已有脚本目录——不为 testenv 新建目录。

## Alternatives considered

**用 `testSummary` 线上字段携带提取的行。** 唯一读者是 render，而该行来源的
日志尾本就在线上；没有其他读者的已发布字段是替谁都不服务的表面。提取留在纯
render 让启发式可随时修订，将来把该行提升到线上也是可加性的。

**真正的 runner 输出解析器，或按框架适配。** 深度解析任一框架的输出没有当前
owner、边界只会膨胀，且在不认识的框架上以噪音方式失败。逐行模式匹配未命中
时退化为安静，代价为零——完整日志尾就在正下方。

**用 `Date.now()` 的壁钟计时。** 每个报告的数字都是时长——两个时刻的差——
单调时钟不受时钟跳变影响；引擎不需要绝对时间戳。

**新字段设为必填。** optional 让更早的报告形状对 render 与导出报告类型的任何
外部消费者都保持合法，代价是 render helper 的防御式读取——而旧形状 render
测试本就要钉住它。

**jobs 集成与测试结果的浏览器界面。** 二者作为本次增厚的第二、第三层被考虑
并明确不做；UI 需求待 gate 集成落地、测试结果自然流入 devflow-ui 看板时
重估。

## Testing

`packages/devflow-testenv/tests/tools.spec.ts` 断言带耗时的首行判定、新起与
复用两分支的环境区、阶段时间线、排在日志尾之前的 pytest 风格汇总行、无命中
时的安静省略，以及通过手工构造 render 值与不带计时事实的引擎替身两条路径的
旧形状报告。`tests/engine.spec.ts` 在真实子进程运行上断言新报告字段，包括
新起运行与重跑之间复用/时长字段的翻转。

## Consequences

结果渲染多出几行，换来的是模型此前要靠额外工具调用才能重推（或根本看不到）
的事实。描述每个字段的五处表面——output schema description、render 文本、
两份 README 的工具表、类型注释——用同一措辞说同一件事，改其一即欠其余。
模式集合刻意保持很小：不认识的 runner 只损失汇总行，支持它只需追加一条
模式。`env_up` 与 `env_status` 的服务条目共用一份 schema，因此 `probeMs`
即便在 env_up 从不设置它的场合也按 env_status 事实来说明。
