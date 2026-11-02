---
title: 'devflow 父子卡片:创建时固定的 parent 边贯通缝、工具与命令面'
labels: [kind/feature, ready-for-agent]
state: closed
date: 2026-08-26
prd: .agents/prd/2026-08-26-devflow-requirement-breakdown.md
---

## Parent

PRD:`.agents/prd/2026-08-26-devflow-requirement-breakdown.md`

## What to build

给卡片之间加一条**组成**边:子卡在创建时指定父卡,关系随即固定,不可改挂。

关系是数据,不是 id 结构——明确不做 `007.1-xxx` 式层级 id(会破坏全局序号分配器、branded id 的不透明性与"id 即目录名且永不变"的不变量)。

- **缝**:创建请求与其 spec 增加可选 `parent`;journal 的 `created` 条目携带 `parent`(因此关系与卡片内容一样可回放、可审计),耐久边界的条目解码器校验它,journal 折叠折出 `DevCard.parent`;读过滤器支持按 `parent` 取一张父卡的全部子卡。`card.md` frontmatter 的 `parent:` 与 `title` 一样只是可读投影,权威永远是 journal。
- **provider 创建路径**:在同一个已解析 root 里查找父卡,给出三个稳定的领域拒绝码——`unknown-parent`(该 root 下没有这张父卡)、`nested-parent`(指定的父卡自身已有父卡,只允许一层)、`parent-settled`(父卡已 `done` 或已归档,不再接受新子需求)。沿用既有约定:领域拒绝 `ok: false` 加稳定码,只有基础设施失败才 reject。
- **模型工具**:`devflow_create` 接受 `parent`;`devflow_show` 在子卡上回父卡 id 与标题、在父卡上回子卡摘要(id / 标题 / 阶段),让子代理只拿到子需求时也能自己拉到全局背景(上下文靠读,不靠把父卡正文复制进每张子卡);`devflow_list` 结果带 `parent` 字段并接受 `parent` 过滤。
- **命令面**:`/devflow` 的板面与 `/devflow show` 呈现父子关系。

不新增批量拆分工具:N 次带 `parent` 的创建已足够,批量原子性没有当前消费者。父卡与子卡都是普通卡,都能被认领、移动、受阻打回、登记产物;本切片不引入任何新规则约束它们的流转(门禁与 driver 跳过属于下一张卡)。

## Acceptance criteria

- [ ] 带 `parent` 创建的卡,其 journal `created` 条目携带父卡 id,回放后 `DevCard.parent` 正确;`card.md` frontmatter 出现 `parent:`
- [ ] 三个拒绝码各自可复现:不存在的父卡、二层嵌套、已 `done`/已归档的父卡;均为 `ok: false` 加稳定消息,不 reject
- [ ] 读过滤器按 `parent` 取回该父卡的全部子卡;多根下同 id 不同 root 的父卡不串
- [ ] 不带 `parent` 的老 journal 与老 frontmatter 照常解析,`DevCard.parent` 缺省即顶层卡,无需迁移
- [ ] `devflow_create({ parent })` 可用;`devflow_show` 子卡回父卡 id+标题、父卡回子卡摘要;`devflow_list` 带 `parent` 字段与过滤
- [ ] `/devflow` 与 `/devflow show` 呈现父子关系;工具与命令均按调用方会话的 root 解析,跨工作区父子不存在
- [ ] 缝层单测 + 工具/命令的真实 Loader 组合测;逐文件覆盖率、双语 README/JSDoc、cordis 与 tool catalog 门禁、Agent Note 同 PR
- [ ] 模型可见文本变化有 keyless 快照覆盖(工具 schema 与结果字段)

## Blocked by

None - can start immediately

## Resolution

Shipped on branch worktree-devflow-prd (`133491c4f1`). `JournalCreated` gained an optional `parent` validated by `decodeJournalEntry` at the durable boundary and folded into `DevCard.parent`; the filesystem provider validates a requested parent against the same resolved root before reserving any directory (`unknown-parent` when neither `tasks/` nor the archive holds it, `parent-settled` when it is done or archived, `nested-parent` when it carries a parent of its own), writes the accepted edge into the `created` entry, and projects it as the frontmatter `parent:`. `CardFilter.parent` narrows a listing to one requirement's breakdown. `devflow_create` takes `parent`; `devflow_show` returns the backlink with `parentTitle` for a child and `children` summaries for a parent (an archived parent degrades to the bare id instead of failing the read); `devflow_list` carries `parent` per row and filters by it; `/devflow` indents children under their parent and `/devflow show` prints the backlink or the breakdown. The invariant companion rejects a `card-created` that hangs a card under an id the stream already knows to be a child.

Verified: store-seam suite (`parent.spec.ts` — edge in journal/read/projection, three rejection codes, filter alone and with a stage, per-root parents, pre-parent journals replaying as top-level), journal decode/fold cases, real Loader tool composition (end-to-end decomposition, board and breakdown rendering, both illegal parents as tool errors, orphan backlink, presentCall), `/devflow` hierarchy rendering, invariant depth test. Per-file coverage 100% on every touched package, typecheck, lint, doc-sync (28 gates) green.

Not met: the keyless-snapshot criterion. The changed model-visible text (tool descriptions, schemas, and rendered results) is pinned verbatim by the generated `docs/tool-catalog.md`, which `doc-sync` gates, but devflow still has no scenario under `apps/web/tests/snapshots/` or the headless snapshot lane — a gap the whole feature has carried since 008, not one this slice introduced.
