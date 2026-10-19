# Agent Note: devflow-ui — 详情表单上的产物记录与闸门裁决

Status: implemented

[English](2026-08-27-devflow-ui-artifact-and-verdict-detail.md) | 中文

## Problem

S1 把 `DevCard.artifactRecords` 与 `JournalTransition.gate.checks` 放上了 `devflow-web` 的 wire——读取面整体序列化卡片与解码后的 journal——但浏览器里没有任何东西读它们。详情表单只列裸产物路径，把产物模型存在的意义——kind 词汇表与版本历史——藏了起来；时间线呈现人工审批，却把同一条提交条目里并排记录的 agent 闸门裁决悄悄丢掉。没有 reader 的已发布 wire 字段是白白背着的表面；两者都需要自己的 reader。

## Decision

**产物分段经下标对齐读取记录。** `artifacts` 是 `artifactRecords` 的路径投影——同序、逐条对应——因此每一行从自己的下标取登记事实（kind、登记阶段、revision）。每条登记都保持列出，因为 journal 是每个交付物版本的如实历史。同一 kind 的多条登记中，最高 revision 带"最新"标记；只登记过一次的 kind 不带——标记区分的是版本之间，不是成员资格——早于 kind 的纯路径登记以中性占位呈现且永不取得标记。视图保持它一贯的立场：渲染一次拉取交付的内容——不带记录的载荷仍列出裸路径。

**时间线逐条渲染已记录的裁决。** transition 条目的 `gate.checks` 每条 check 渲染一行备注——用时间线其余部分同一套执行者标签，加上原样呈现的 summary，agent gate 缓存命中的 `[cached] ` 前缀因此原封不动到达读者——当该移动同时记录了 `approvedBy` 时与审批备注并列。没有 gate 的条目、只有审批的条目，渲染与之前逐字不变。

新文案走既有的双语 `locales.ts` 机制，表单保持只读：没有新控件，没有变更操作。只动了 `packages/devflow-ui` 一个包；`devflow-web` 早已携带表单所需的一切。

## Alternatives considered

**给每个带 kind 登记的最新一份都打标记。** 孤零零一条登记会带上一个不与任何东西区分的标记；标记只有在其下压着被取代版本时才配得上位置。

**按路径查找把记录接到路径上。** 重复登记的路径会匹配多条记录、需要额外裁定；seam 已把 `artifacts` 文档化为记录的路径投影，因此下标就是契约，不是启发式。

**假定 `artifactRecords` 必在并删掉裸路径回退。** wire 确实总携带该字段，但视图的先例（journal 丢失来源阶段的受阻卡）是渲染送达的载荷而非 fold 的保证——而且正是这个回退让既有 surface spec 一字不改地继续钉住旧渲染。

**给裁决单开时间线条目或独立分段。** check 是一次已提交移动的事实，和它的原因、审批签名一样；从条目上拆走会错报它发生的时刻。

## Consequences

- `artifactRecords` 与 `gate.checks` 现在有了真实的浏览器 reader；[产物 kind Agent Note](2026-08-27-devflow-artifact-kinds-and-store-written-content.zh.md) 里推迟的渲染决策就此做出，其后果行也随之更新。
- agent gate 的 summary 字符串（含 `[cached] ` 前缀）如今是用户可见文案：改动其格式就是改动时间线呈现的内容。
- 看板行未动：登记事实只出现在详情表单上，也不存在内容预览或下载——表单渲染的是 journal 事实，不是产物正文。
