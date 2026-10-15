---
title: 'devflow: 仓库携带的铁律与 turn 收尾强制'
labels: [kind/feature, ready-for-agent]
date: 2026-09-03
---

# PRD — devflow：仓库携带的铁律与 turn 收尾强制

## Problem Statement

`spec-delta` 分诊把一张卡的知识产出分为 `reference` 与 `obligation` 两类。reference 有归宿——spec 缝的索引文档，按需读取；obligation 没有：不遵守就是错的规则需要**常驻**（从未被打开的义务就是从未被遵守的义务）和**不依赖模型自觉的强制**（碰过文件的 turn 收尾跑校验脚本，失败顶回）。原计划转发给 `@byclaw/dsh-iron-rules`，但它不发布任何 cordis 服务、`"private": true` 且属于另一个仓库——本线「只依赖已发布面」与「跨插件走 ctx 服务」两条规矩同时封死这条路。

## Scope

新增一个包，改动一个既有包：

- `devflow-iron-rules` —— 单包函数插件（照 fs-guard / agent-gate 的策略插件形态，不建缝）：`.devflow/iron-rules/<id>/{RULE.md,check.sh}`，四机制——digest 键控的全文常驻、脏 turn 校验强制（`maxRetries` 封顶）、必填 `script | judgement` 分诊、`replaces` 净变化预算与 watch 衰减检测；`devflow_record_iron_rule` 工具与 `devflowIronRules` 服务共用同一条写入路径。
- `devflow-fs-guard` —— 拒绝消息加第三分支：`iron-rules` 段指向 `devflow_record_iron_rule`。

移植自 `@byclaw/dsh-iron-rules`（ByClaw 原创、MIT，与 Trellis 的 AGPL 许可链无关），词汇保持一致、语义分叉视为本包缺陷。改动四处：根解析换 devflow 两级规则（session cwd 优先，不认 git 祖先）、写入路径发布为服务、模型侧文本英文化、删无消费者的 `requireApproval`。

## Scope 补充（2026-09-03 评审决定）

进 `devflow-bundle`，默认启用——无规则目录时插件惰性，安装先于撰写规则是安全的。
执行仓库携带脚本这一信任决定由 bundle 的 patch 注释与 README 行明示，跑不受信
checkout 的部署在 profile patch 里禁用该行。

## Out of scope

- `/iron-rule` 命令（便利面，工具才是能力本体）。
- byclaw-harness 侧的删除与迁移；共存检测（README 明写「只挂一个」）。
- 经 shell 改文件的脏标记（与 fs guard 相同的既有暴露面）。

## Acceptance Criteria

1. `script` 规则经工具落盘，`RULE.md` 与 `check.sh` 各就各位；缺 `check`/`watches` 零写入。
2. `judgement` 带 `check` 被拒——它意味着没有真的分诊。
3. `replaces` 三合一：旧目录在新规则写入后删除；任一校验失败磁盘无变化；指向不存在的 id 零写入。
4. 规则在下一次 pre-step 前进入上下文；同 digest 不重发；compaction 遮蔽后重发。
5. 碰过文件的 turn 收尾跑脚本，失败强制续轮、达上限交还控制权；未碰文件不跑。
6. watches 全失的通过被报为不可能再失败，而非静默通过。
7. 文件工具写 `.devflow/iron-rules/` 被 fs-guard 拒绝且指向 `devflow_record_iron_rule`。
8. 未挂载部署行为不变；挂载不改任何卡片/产物/spec 行为。
9. 每文件 100% 覆盖；real-composition 驱动「记录 → 注入 → 碰文件 → 被顶回」完整回路；`preflight:tarballs` 通过。

## Decisions

设计决策与被否决的替代方案（整包搬运 / 核心声明缝 / 引用而非调用）由
[移植 Agent Note](../notes/implemented/feature/2026-09-03-devflow-iron-rules-port.md) 拥有。
