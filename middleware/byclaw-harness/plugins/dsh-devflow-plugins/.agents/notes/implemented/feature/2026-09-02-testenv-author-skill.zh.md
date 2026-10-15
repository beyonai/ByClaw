# Agent Note: testenv-author——为零套件项目补上第二个 skill 与两道同意门

Status: implemented

*Superseded 2026-09-11：本 note 描述的 testenv 执行层已删除；本包现在只剩
`devflow-e2e-bootstrap-runbook` 这一个 skill——见 [testenv 从执行器退回到一个
runbook skill](2026-09-11-testenv-retreats-to-runbook-skill.zh.md)。保留是为了那些未来的执行器仍会再次面对的推理。*

[English](2026-09-02-testenv-author-skill.md) | 中文

## Problem

`testenv-bootstrap` 的零候选出口诚实但到此为止：勘测报告 testenv 不适用，并
指名需要改变什么——一个服务绑定的套件——却没有任何东西负责促成这个改变。没有
集成测试的项目得到的是诊断而非路径；被催着继续的模型要么就此停下，要么在没有
方案、没有证据纪律、没有用户同意的情况下即兴写测试代码。

## Decision

`packages/devflow-testenv/assets/testenv-author.md` 是第二个捆绑 skill，与
bootstrap 由同一 provider 以同一 rank 从同一 assets 目录提供。正文是五阶段
协议：勘测代码（服务面、持久状态数据流、既有测试惯例——从仓库枚举，绝不假
设），推导方案且每个场景必带代码锚点（无锚点不入方案），汇报方案并停在批准
门，写码并实证获批场景（穿过服务边界的产品行为断言、端点取自环境或配置、代码
意图与运行行为不一致作为发现上报而非默写进断言），再交回 bootstrap——其快路径
随即选中新套件。勘测发现没有值得集成测试的接缝时，汇报不适用而不硬造。

分工是刻意的：author 写测试，清单及其证明只归 bootstrap——每个工件一个
owner。

两道同意门连接两个 skill，任何一道都不自动化。bootstrap 的零候选段把 author
作为下一步建议给用户、由用户决定是否走（门一；开场就要求"补集成测试"的用户
直接进入），author 的方案报告在写任何代码之前必须获批（门二，即便 skill 由
用户发起也照样成立）。`tests/skill.spec.ts` 钉住两份正文的契约句和按名覆盖
语义：更低 rank 的 `testenv-bootstrap` 竞争者只顶掉 bootstrap，插件 fiber
dispose 则同时撤下两个 skill。

## Alternatives considered

**把 authoring 协议并进 `testenv-bootstrap`。** 只剩一个调用面，但两份正文回
答的是不同问题——为既有套件选型并记录，对比推导并新写一个套件——且触发面从不
重叠：bootstrap 由清单问题与清单错误触发，author 由任何套件的缺席触发。合并
正文会让每次清单修复都先路过 authoring 协议，也会糊掉现在每个 skill 各自那
条诚实的触发描述。

**自动连锁——bootstrap 零候选时自动调 author，或 author 结束时自己跑
bootstrap。** 往仓库里写测试代码是产品决策，不是勘测结果的机械后果：零候选
只证明 testenv 今天不适用，项目到底该不该添置集成套件是用户的裁决。因此两处
衔接都只是供用户采纳的建议，而批准门留在 author 内部——即便用户发起的运行也
不能从方案滑进代码而不经过一句明确的同意。

**测试代码模板/脚手架库。** 项目自己的 runner、fixture 与断言方言就是模板——
第一阶段专门去挖它们——而随包分发的脚手架会独立于每个被粘贴进的项目老化。与
其他非目标一并排除（本特性不带任何 tool 或 schema 改动；只是散文加一条
provider 条目）。

## Consequences

零候选的 bootstrap 现在以一条路径而非死胡同收尾，代价是任何测试落地前要过两
次明确的用户决定——刻意如此，因为两道门守的是不同的判断（要不要投入、认不认
这份方案）。交接在结构上闭环：author 写出的套件要过 bootstrap 的证伪（环境
全停，套件必须转红），只断言连通性的套件在选型时就被抓住而不是被信任。两个
skill 共乘一个 provider 名，因此项目覆盖 `testenv-bootstrap` 后捆绑的
`testenv-author` 仍在——除非把这个名字也覆盖掉。
