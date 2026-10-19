---
title: 'devflow: 系在代码上的架构文档缝'
labels: [kind/feature, ready-for-agent]
date: 2026-09-02
---

# PRD — devflow：系在代码上的架构文档缝

## Problem Statement

devflow 拥有卡片、产物与门禁，但**没有安放跨卡知识的位置**。「域拒绝 resolve、基础设施失败 throw」这类规则属于某个包，不属于恰好确立它的那张卡；没有归宿，每张卡要么重述，要么依赖一刀切的 `AGENTS.md` 注入。

直接建一个「每包一个 Markdown 目录」会引入一个更糟的失效模式：一篇与代码脱节的架构文档不只是没用，agent 会读它、信它，然后照着早已不成立的规则写代码。引用 `types.ts:195-197` 的散文看起来严谨，但没有任何东西检查那些行号是否还有意义。

## Scope

新增三个包，构成一条与 `ctx.devflow` 平级的能力缝：

- `devflow-spec` —— Service Definition：anchor 词汇、三值裁决、结构谓词。
- `devflow-spec-filesystem` —— Service Provider：`.devflow/spec/` 读写与 anchor 求值。
- `devflow-spec-tool` —— Consumer：`devflow_write_spec`，并随包发布撰写 skill。

改动一个既有包：`devflow-fs-guard` 的拒绝消息按目标分支，spec 路径指向 `devflow_write_spec`。

## Out of scope

- **修订与替换**（`replaces` 及其净变化预算）——本期只做创建，`exists` 拒绝覆盖。
- **读取工具**——缝的读面已存在，但尚无模型侧消费者。
- **求值缓存**——形态已设计并记入 Provider README；目前没有需要它的规模化消费者。
- **健康度读面**（覆盖率、失效清单）与**已有文档的迁移**。

## Acceptance Criteria

1. 一篇文档写入后 `freshness` 为 `fresh`；改掉被锚定的符号后，同一次 `read` 返回 `stale`。这一条经真实 Loader 组合端到端验证。
2. `unevaluable` 从不折叠进 `fresh`：无 git 的 churn anchor、无解析器可读的文件，都如实报告。
3. 结构契约的每条拒绝都有稳定 code，并在写入触及文件系统之前作出。
4. 未加载本缝的部署行为不变；卸载后 `.devflow/spec/` 留在磁盘且不需要清理。
5. 每文件 100% 覆盖；每个新包拥有 `./invariant`；`preflight:tarballs` 通过。

## Decisions

设计决策与被否决的替代方案由两篇 Agent Note 拥有：

- [anchor 模型](../notes/implemented/architecture/2026-09-02-devflow-spec-anchor-model.zh.md)——为什么是 anchor、为什么三值、为什么不做成 artifact、为什么不进 journal、以及「不做可插拔求值器」这笔明知的技术债。
- [AGPL 清洁室边界](../notes/implemented/process/2026-09-02-agpl-clean-room-boundary.zh.md)——撰写 skill 为何从零写成而非改造。
