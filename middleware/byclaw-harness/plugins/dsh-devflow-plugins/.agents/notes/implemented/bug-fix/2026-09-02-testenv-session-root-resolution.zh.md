# Agent Note：devflow-testenv——工作区根逐调用取自会话 cwd

Status: implemented

*Superseded 2026-09-11：本 note 描述的 testenv 执行层已删除；本包现在只剩
`devflow-e2e-bootstrap-runbook` 这一个 skill——见 [testenv 从执行器退回到一个
runbook skill](../feature/2026-09-11-testenv-retreats-to-runbook-skill.zh.md)。保留是为了那些未来的执行器仍会再次面对的推理。*

[English](2026-09-02-testenv-session-root-resolution.md) | 中文

## 问题

插件在 apply 时用 harness 进程 cwd 一次性捕获工作区根（`src/index.ts` 里的
`resolve('.')`），交给单个引擎，清单路径与每个服务 cwd 都相对它解析。
[编排范围 note](../feature/2026-09-01-testenv-orchestration-scope-and-up-rule.md)
当时的推理是"harness 以工作区根为 cwd 运行"——与 `devflow-filesystem` 默认根
依赖的同一假设。

真实部署推翻了这个假设。常驻 harness 进程的 cwd 是 **harness 检出目录**，
每个 agent 会话以会话元数据携带自己的工作区——于是所有会话的 `testenv.yml`
都解析进 harness 检出目录，无论会话在做哪个项目。观察到的失败形态比报错更糟：
模型被告知清单在错误解析出的路径上缺失后，**往 harness 检出目录里**写了一份
满是绝对路径的 shim 清单来让工具跑起来。正确先例就在本产品线内：`devflow-tool`
每次调用从 `exec.agent.session.header.cwd` 解析各自工作区的根，`devflow-bundle`
正因此不配置 root（"每个调用方自己的工作区解析它——这正是一个 harness 能服务
多个项目的原因"）。

## 决定

**工作区根逐调用解析，取自调用方 agent 会话的工作目录。** 每次工具执行先读
`exec.agent?.session.header.cwd`（`devflow-tool` 的同一来源，会话边界已校验为
绝对路径），用 `path.resolve` 规范化。没有会话 cwd 的调用——非 agent 调用方，
或创建时未带 cwd 的会话——fail loud，错误文案点名两种缺失形态，并明说 harness
进程 cwd 刻意不作回退：回退会让最容易踩中此缺陷的调用方静默复现它。

**每工作区根一个引擎。** `apply()` 建懒建的 `Map<root, TestenvEngine>`；
"单环境实例"语义变为**每工作区一个**。每个引擎仍在其 up 时以 `ctx.effect()`
把运行中环境注册到插件 fiber，因此一次 fiber dispose 拆除所有工作区的环境，
而 `env_down` 只拆调用方自己的。cwd 解析到同一根的多个会话共享同一引擎与其
唯一环境——任一会话的 `env_down` 拆除的都是这份共享环境。Map 本身不持有进程，
无需自己的 effect。

**规范化用 `resolve`，不用 `realpath`。** 会话边界已校验 cwd 为绝对路径；
`resolve` 只把 `.`/`..` 与尾分隔符折叠成稳定的 Map 键。追 symlink 会让
"会话声明的路径"与"引擎运行的路径"分裂，还引入逐调用的文件系统访问；
经不同 symlink 拼写同一目录因此得到两个引擎——文档化的已知边界，与
`devflow-filesystem` 对其 root 的处理一致。

**后台 job 从此一律 owned。** root 解析要求每次调用都有 owning agent 会话，
同一个 `exec.agent` 就成为 `integration_test` job 的 owner——jobs registry 的
归属围栏因此作用于每次 registry 读取。先前可达的"无 agent 调用产生 unowned
job"形态在这些工具上不再出现。

## 考虑过的替代方案

**root 的 `Config` 字段。** 先前已因与 cwd 重复而拒绝；如今双重错误——一个
配置的 root 每份组合仍只服务一个工作区，等于原缺陷多绕一步。

**会话无 cwd 时回退进程 cwd。** 在实际部署形态下是静默的错误；shim 清单事件
正是"可诊断但被容忍"的解析实际产出的东西。错误文案改为携带修复方式（从带
工作区 cwd 创建的 agent 会话调用）。

**显式的 root 工具参数。** 把会话已经做过的路径决定交还给模型，恰恰招来
会话围栏要防止的跨工作区混淆（PRD R6）。

**Map 键做 `realpath` 规范化。** 见上；因分裂声明路径与执行路径、且逐调用
访问文件系统而拒绝。

## 测试

`tests/plugin-shape.spec.ts` 钉住部署形态本身：进程 cwd 指向放着诱饵清单的假
harness 检出目录，会话 cwd 指向工作区——`env_up` 跑的是工作区的清单，marker
落在工作区，诱饵未被读、检出目录零变化；其原先"chdir 往返证明 apply 时捕获"
的测试随它所证明的行为一同废止。同伴用例钉住两种缺失 cwd 形态的 fail-loud
文案。`tests/tools.spec.ts` 用一次注册驱动两个工作区（`env_up`/`env_status`/
`env_down` 互不可见）与 resolve 规范化共享引擎；`tests/loader-composition.spec.ts`
带 agent registry 启动真 Loader，同时运行两个会话工作区，证明 A 的拆除对 B
不可见，并经一次 fiber dispose 拆除两个环境——逐 pid 断言无存活。后台套件
承载 owned-job 后果：读取方带调用 agent 过归属围栏。

## 后果

一个 harness 服务多个项目工作区——这正是插件在真实部署中存在的理由。工具从
"任何调用方可用"变为要求 owning agent 会话——没有会话 cwd 的程序化调用方得到
fail-loud 错误，这是有意的：没有诚实的 root 可给它们。每根一引擎不等于每根
差异化 `Config`（一份组合级 `Config` 服务所有工作区；PRD R6）；生命周期中途
改 cwd 的会话会指向另一个引擎——会话 cwd 是创建期元数据，今天不会发生。捆绑
skill 现在写明这次事件教出的纪律：`testenv.yml` 只属于会话的工作区根，解析到
别处的清单是应上报的部署缺陷，绝不用 shim 绕过。
