# Agent Note:devflow —— 每条边带自己的执行策略

Status: implemented

[English](2026-08-27-devflow-gate-edge-policies.md) | 中文

## Problem

`dsh-devflow-gates` 对每条边只有一种执行形态:shell 执行器的默认超时与工作目录、命令按序执行、第一个失败即停,以及一条最多带 `maxFailureOutputChars` 个字符输出的否决理由。

它自己的 README 把超时列为待办,说"等有需要它的消费者出现"。那个消费者就是这个包的第一个示例:`'developing->reviewing': ['pnpm run test']`。一个项目的测试套件,恰恰是执行器默认值没有为之设计的东西;而当它被杀死时,门禁会把这次杀死报告成**代码的失败**,而不是自己预算的失败 —— 这是对证据最糟糕的一种解读。

截断从另一侧构成同样形状的问题。要去修复失败门禁的那个 agent,拿到的是 stdout 与 stderr 的一段有界尾巴,别无其他。在最需要信息的时刻,信息最少。

## Decision

**边可以带一份策略:`timeoutMs`、`workdir`、`parallel`。** 不写时各自回落到今天的行为,因此既有部署表现完全一致。这些键与 `edges`、`approvals` 一样校验 —— 未知的边或非正数的超时会让加载失败,而不是等到第一次尝试时才被发现。

**顺序执行仍是默认,`parallel` 需显式开启。** 在已知失败之后继续跑,是把时间花在没人会读的答案上;而且后面的命令常常以前面的通过为前提。当命令确实彼此独立时 —— lint、类型、测试 —— `parallel` 用这个短路换来一次往返,以及一条同时点名全部失败的否决。

**完整输出写进 `<devflow root>/reports/gates/`,由正在流转的卡片派生。** 它曾是部署指定的 `failureLogDir`,且默认不设;后来的一次变更把位置改为派生,让产物落进 `dsh-devflow-fs-guard` 保护的 root 之内,并连同那个开关一起去掉了。写日志失败只告警,否决照常成立 —— 门禁的职责是判定,不是保证日志可靠。

## Alternatives considered

**用 `attachArtifact` 登记输出。** store 已经有这个概念,卡片也正是失败该归属的地方,但调用会死锁:store 按卡片串行化,而这道波布运行在正持有该卡片这一轮的 transition 内部。调用会等待一个正在等待它的 transition。`parkBlocked` 通过不 await 自己的 `transition` 调用躲开了同一循环。

**直接写进卡片目录。** 因分层被否决:磁盘形态属于 provider,策略插件拼出 `root/tasks/<id>/artifacts` 会把一份它并不拥有的布局写死。

## Consequences

要把失败妥善地放到卡片上,需要一个能接受"从自己波布内部发起的写入"的缝。那是一个真实的缺口,现在记在本包的 Known Limitations 里,而不是等下一个人从门禁里调 `attachArtifact`、然后看着自己的 transition 挂住时再发现一遍。

门禁结果仍然既不缓存也不增量:一次返工循环每轮都要为整套付费。复用上一次的结果需要一个"这些命令依赖什么"的概念,而本包没有 —— 这被记为限制,而不是拿近似去糊弄。

`parallel` 让同时运行的门禁命令数量从"永远是一个"变成部署的选择。这里没有任何东西给它设上界;一条带二十个命令的边会起二十个进程。
