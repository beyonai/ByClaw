# Devflow 任务卡

[English](devflow.md) | 中文

文件任务卡缝及其消费者共享的类型。[devflow Agent Note](../../.agents/notes/implemented/feature/2026-08-25-devflow-file-based-task-cards.zh.md) 拥有缝的决策；本页记录 [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts) 中的确切字段与变体。

## 身份与阶段

`DevflowCardId` 是等于卡片目录名（`<seq>-<slug>`，创建后不变）的 [branded id](core.zh.md#branded-ids)。`DevStage` 是闭合的流水线联合；`blocked` 是旁路位置而非阶段，blocked 的卡记住被打断的阶段。

```ts type-equiv
/**
 * The closed set of pipeline stages a card moves through. `blocked` is not a
 * stage: it is a bypass location that remembers the stage it interrupted (see
 * {@link CardLocation}).
 */
type DevStage =
  | 'draft'
  | 'designing'
  | 'ready'
  | 'developing'
  | 'reviewing'
  | 'testing'
  | 'done'
```

```ts type-equiv
/** Where a card currently sits: a pipeline stage, or the `blocked` bypass. */
type CardLocation = DevStage | 'blocked'
```

```ts type-equiv
/**
 * The closed set of service classes a card is created under, each selecting
 * which edges of the pipeline that card may take. Every class is a superset of
 * `standard`, so a class only ever adds a shortcut.
 */
type ServiceClass = 'standard' | 'express' | 'emergency'
```

卡片在创建时归入三个封闭的**服务类别**之一，创建后不可更改，它决定这张卡可以走哪些边。`standard` 是缺省值，走满整条流水线。`express` 可以从 `draft` 直达 `developing`、从 `reviewing` 直达 `done`，跳过设计、就绪与独立验证，但保留同行评审。`emergency` 可以从 `draft` 直达 `developing`、从 `developing` 直达 `done`，连评审一起放弃；它的后续复盘是一张普通的卡，而不是状态机里的一条义务。每个类别都是 `standard` 的超集——类别只增不减——而一个类别跳过的阶段并不是被绕过的门禁，因为卡片根本不经过那条边。这些捷径都是普通的 `from->to` 键，部署方可以像给任何其他边一样给它们配门禁。词表封闭的理由与阶段列表相同；决策由[服务类别 Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-devflow-service-class.zh.md) 拥有。

移动沿流水线顺序进行，另加把卡送回缺陷归属阶段的返工边：`reviewing` 与 `testing` 都可回到 `developing` 和 `designing`，`developing` 可回到 `designing`——实现一份设计正是发现它错了的最常见方式，而在此之前唯一的退路是让卡片经过一次从未发生的评审。每条返工边都要求记录 `reason`。任何非终态位置都可进入 `blocked`，而 blocked 只能恢复到它打断的那个阶段；`done` 不出边。

一张永远不会完成的卡是被**放弃**，而不是被停驻：除 `done` 外的任意位置都接受它，理由是必填的——因为那是这张卡唯一留下来的东西——而卡片离开看板进入归档，不再占着一个没人在做的列。放弃是终态，其后不允许任何 journal 条目——因此已放弃的卡片是唯一无法恢复的归档卡；它是一个人的决策，所以只在人工界面上——`/devflow` 与看板——没有对应的模型侧工具。它连同理由一起，在档案里始终可读。决策由[放弃 Agent Note](../../.agents/notes/implemented/architecture/2026-08-31-devflow-reasoned-abandonment.zh.md) 拥有。

其中两个名字足够常被误读，值得直说。`testing` 指独立验证与验收，不是"到这一步才开始写测试"——本插件线自己的门禁就是每文件 100% 覆盖、测试与实现同处一个变更，所以一张卡带着没写的测试走到 `testing`，它在 `developing` 就已经失败了。`done` 的意思是这个变更在仓库里被证明是好的，不代表用户拿到了它。部署、发布与结果度量都在本模型之外，所以一列排满 `done` 的卡并不构成价值已交付的证据。

## Journal 条目

追加式 journal 是权威的卡片历史；卡片文件的 frontmatter 是可重建的投影。`decodeJournalEntry` 在持久化边界校验每个已解析的行，`foldJournal` 强制 revision 从 1 连续、`created` 必须且只能是首条、transition 必须从当前位置出发、blocked 精确恢复、`abandoned` 之后不得再有条目、只有 `done` 卡可以归档、以及归档卡之后只允许 `restored`。

归档和其他状态变更一样是 journal 事件：入档的卡片带一条 `archived`，被送回的卡片带一条 `restored`。两者都是人的决定，在 `/devflow` 或看板上做出；`archive/<YYYY-MM>/` 下的目录移动发生在追加之后、属于清理，因此 `list` 依据折叠状态而非目录位置来判定谁是活跃的。恢复带回的是可见性，不是进度——一张恢复的 `done` 卡仍然是 done。决策由[归档生命周期 Agent Note](../../.agents/notes/implemented/architecture/2026-09-09-devflow-archive-lifecycle.md) 拥有。

一张卡装不下的大需求拆成一张父卡加每个切片一张子卡。这条边是 `created` 条目的 `parent`，创建时固定、永不改指；它折叠为 `DevCard.parent`、投影为 frontmatter 的 `parent:`、并通过 `CardFilter.parent` 收窄读取。拆分只有一层且从不跨根——两者都由 provider 在创建子卡时强制（`unknown-parent`、`nested-parent`、`parent-settled`）。

```ts type-equiv
/** Who performed a journal action; `command` marks the human-command intervention plane. */
type DevActor =
  | { kind: 'human'; name?: string }
  | { kind: 'agent'; session?: string }
  | { kind: 'command'; name?: string }
```

```ts type-equiv
/** First journal entry of every card; `rev` is always 1. */
interface JournalCreated {
  rev: number
  at: string
  type: 'created'
  by: DevActor
  /** The card this one decomposes, fixed here at creation and never changed. */
  parent?: DevflowCardId
  /**
   * The card's service class, fixed here at creation and never changed.
   * Omitted is `standard`, so a journal written before classes existed reads
   * as one and a `standard` card's first entry keeps its original bytes.
   */
  serviceClass?: ServiceClass
}
```

```ts type-equiv
/**
 * One recorded gate verdict on a committed transition: which actor allowed the
 * move and, optionally, what the check covered. Only permitting verdicts
 * exist — a refusal vetoes the transition instead of being recorded.
 */
interface GateCheck {
  /** The actor that allowed the move. */
  by: DevActor
  verdict: 'allowed'
  /** One-line account of what the check covered. */
  summary?: string
}
```

```ts type-equiv
/**
 * One stage move. A move to `blocked` remembers `from`; the matching recovery
 * must return to exactly that stage.
 */
interface JournalTransition {
  rev: number
  at: string
  type: 'transition'
  from: CardLocation
  to: CardLocation
  by?: DevActor
  reason?: string
  /**
   * Gate facts attached by the transition waterfall: the human approval
   * signature and/or the recorded gate verdicts. At least one is present —
   * a move nothing gated carries no `gate` at all.
   */
  gate?: { approvedBy?: DevActor; checks?: GateCheck[] }
}
```

```ts type-equiv
/** Registration of a stage deliverable produced under `artifacts/`. */
interface JournalArtifact {
  rev: number
  at: string
  type: 'artifact'
  path: string
  stage: DevStage
  by?: DevActor
  /**
   * Deliverable kind of a store-written artifact; absent for a path-only
   * registration and for entries predating kinds.
   */
  kind?: string
}
```

```ts type-equiv
/**
 * The decision to stop: this card will never be finished. Terminal — no entry
 * may follow it — and the card leaves the active board rather than occupying
 * a stage nobody is working in.
 */
interface JournalAbandoned {
  rev: number
  at: string
  type: 'abandoned'
  by: DevActor
  /**
   * Why the work stopped. Required, unlike a transition's reason: a transition
   * leaves the card visible and explicable from where it sits, while this
   * removes it from the board, so the reason is all that is left of it.
   */
  reason: string
}
```

```ts type-equiv
/**
 * A delivered card left the active set for the root's archive. Unlike
 * `JournalAbandoned` this is not terminal: a `restored` entry may follow it,
 * which is what makes archiving reversible. Only a `done` card may carry one,
 * and while it is in force no other entry type may follow.
 */
interface JournalArchived {
  rev: number
  at: string
  type: 'archived'
  by: DevActor
  /**
   * Why the card was archived. Optional, unlike an abandonment's reason: an
   * archived card keeps its complete history, so nothing is lost by silence.
   */
  reason?: string
}
```

```ts type-equiv
/**
 * An archived card returned to the active set. It restores visibility only —
 * the card's stage is whatever its journal already said, so a restored `done`
 * card is still `done` and continuing its work is an ordinary rework
 * transition.
 */
interface JournalRestored {
  rev: number
  at: string
  type: 'restored'
  by: DevActor
  /** Why the card was brought back; recorded when present. */
  reason?: string
}
```

```ts type-equiv
/** Takeover of a stale lease: the previous holder's heartbeat lapsed. */
interface JournalClaimExpired {
  rev: number
  at: string
  type: 'claim-expired'
  previousOwner: DevActor
  by: DevActor
}
```

```ts type-equiv
/** The journal entry union; the discriminant is `type`. */
type DevflowJournalEntry =
  | JournalCreated
  | JournalTransition
  | JournalArtifact
  | JournalAbandoned
  | JournalArchived
  | JournalRestored
  | JournalClaimExpired
```

## 读值

```ts type-equiv
/**
 * Read-side value of one artifact registration: the journal entry's facts
 * without its envelope. Registrations are immutable — the newest record of one
 * `kind` (the highest `rev`) is that kind's current content.
 */
interface ArtifactRecord {
  /** Artifact path relative to the card directory. */
  path: string
  /** Deliverable kind; absent for a path-only registration. */
  kind?: string
  /** Journal revision of the registration; orders records of one kind. */
  rev: number
  /** The stage the deliverable was registered against. */
  stage: DevStage
}
```

```ts type-equiv
/** Read-side value of one card, current state derived by journal replay. */
interface DevCard {
  id: DevflowCardId
  /** Resolved devflow root directory this card belongs to (absolute path). */
  root: string
  /** Human title from the card file's frontmatter. */
  title: string
  /** Current location derived from the journal, never from the frontmatter projection. */
  stage: CardLocation
  /** Revision of the last journal entry; optimistic-concurrency token for transitions. */
  stageRevision: number
  /** The stage a `blocked` card returns to on recovery; absent unless `stage` is `blocked`. */
  blockedFrom?: DevStage
  /**
   * The card this one decomposes; absent for a top-level card. Only one level
   * exists, so a card carrying `parent` is never itself a parent.
   */
  parent?: DevflowCardId
  /**
   * The card's service class, selecting which pipeline edges it may take.
   * Always present: a card whose journal states none is `standard`.
   */
  serviceClass: ServiceClass
  /**
   * Set once the card was abandoned: the work stopped and will not resume.
   * Such a card is off the active board, so `list` never reports one.
   */
  abandoned?: true
  /**
   * Set while the card sits in the root's archive. Off the active board like
   * `abandoned`, but not terminal: a restore clears it. A card archived
   * before archiving became a journal event carries no `archived` entry, so
   * this may be derived from where the card's directory sits.
   */
  archived?: true
  /**
   * The `YYYY-MM` bucket an archived card is filed under — the month its work
   * finished, which is what `CardQuery.month` narrows by. Present exactly
   * while `archived` is; it is not derivable from `updatedAt`, which by then
   * names the archiving itself.
   */
  archivedMonth?: string
  /** Timestamp of the card's first journal entry: when it was created. */
  createdAt: string
  /** Timestamp of the card's last journal entry: when it last moved. */
  updatedAt: string
  /** Markdown body of the card file below its frontmatter. */
  body: string
  /** Display path of the card file. */
  path: string
  /** Artifact paths registered in the journal, in registration order; the path projection of {@link artifactRecords}. */
  artifacts: string[]
  /** Artifact registrations in registration order, each carrying its journal revision, registering stage, and optional kind. */
  artifactRecords: ArtifactRecord[]
}
```

两个卡片读取共用同一套谓词词汇；它们的区别在于分页，而不在于如何选中一张卡。`list` 返回活跃集的全部——它七个消费者里有六个依赖这一点，其中一个还是一道门——而 `query` 分页，并且是抵达档案的唯一途径，因为档案的规模无法承诺。

```ts type-equiv
/**
 * The predicate vocabulary both card reads narrow by. Declared once so
 * `CardFilter` and `CardQuery` can never drift into two dialects of the same
 * idea.
 */
interface CardPredicates {
  /** Only cards currently at this location. */
  stage?: CardLocation
  /** Only cards decomposing this one; an id with no children matches nothing. */
  parent?: DevflowCardId
  /** Only cards with no parent. Mutually exclusive with `parent`. */
  topLevel?: true
  /** Only cards created under this service class. */
  serviceClass?: ServiceClass
}
```

```ts type-equiv
/** Read filter accepted by {@link import('./index.ts').DevflowStore.list}. */
interface CardFilter extends CardPredicates {}
```

```ts type-equiv
/** Which card set a {@link CardQuery} reads. */
type CardSet = 'active' | 'archived' | 'all'
```

```ts type-equiv
/**
 * Narrowing and pagination accepted by
 * {@link import('./index.ts').DevflowStore.query}.
 */
interface CardQuery extends CardPredicates {
  /** Which set to read; omitted reads the active set. */
  set?: CardSet
  /**
   * Only archived cards filed under this `YYYY-MM` bucket. Meaningless
   * against the active set, so pairing it with `set: 'active'` is a usage
   * error rather than an empty result.
   */
  month?: string
  /** Page ceiling; omitted uses the implementation's configured default. */
  limit?: number
  /**
   * The previous page's `nextCursor`, passed back verbatim. Its encoding
   * belongs to the implementation — callers never parse or construct one, and
   * an unparsable cursor is a usage error rather than a silent restart from
   * the first page.
   */
  cursor?: string
}
```

```ts type-equiv
/**
 * One page of {@link import('./index.ts').DevflowStore.query}. Truncation is
 * always stated: a caller that cannot tell a full page from a complete result
 * will report the page as the whole set.
 */
interface CardPage {
  /** The cards of this page, in the set's reading order. */
  cards: DevCard[]
  /** Whether the limit cut the result short. */
  truncated: boolean
  /** Cursor for the next page; absent once the set is exhausted. */
  nextCursor?: string
}
```

## 服务行为

抽象的 [`DevflowStore`](../../packages/devflow/src/index.ts) Service Definition 规定 journal 权威的读面、显式创建/流转请求、迁移 waterfall 与独占 claim 租约。[`FilesystemDevflowStore`](../../packages/devflow-filesystem/src/index.ts) 是文件 Service Provider；[`dsh-tool-devflow`](../../packages/devflow-tool/README.zh.md) 是模型侧 Consumer，Harness agent 通过它创建、查看、登记产物并推进卡片。[`dsh-devflow-fs-guard`](../../packages/devflow-fs-guard/README.zh.md) 保证 store 是受保护卡片状态的唯一写路径。四项策略组合在迁移 waterfall 上：[`dsh-devflow-artifact-gate`](../../packages/devflow-artifact-gate/README.zh.md) 机械检查登记产物并发布主动需求预检；[`dsh-devflow-agent-gate`](../../packages/devflow-agent-gate/README.zh.md) 运行独立的 LLM 准入检查；[`dsh-devflow-gates`](../../packages/devflow-gates/README.zh.md) 运行命令与一次性审批；[`dsh-devflow-parent-gate`](../../packages/devflow-parent-gate/README.zh.md) 防止拆分需求早于其子卡完成。[`dsh-command-devflow`](../../packages/devflow-command/README.zh.md) 是确定性人工干预平面，也承载两条只读体检报告：`/devflow spec` 针对文档集，`/devflow doctor` 针对部署本身——板的 git 前置条件直接调 worktree fence 自己的检查器，每张被持有的卡连同心跳距今时长，每个 dispatch worktree 的存在性与 linked 状态，以及哪些可选面已挂载。两者都以「本次没能回答什么」收尾，因为一份把「查不了」渲染成「没问题」的报告比没有报告更糟；对 `doctor` 而言这份清单恒定包含 validator 可用性与各 gate 的边配置——这条线上没有任何服务发布它们。[`dsh-devflow-web`](../../packages/devflow-web/README.zh.md) 与 [`dsh-client-ui-devflow`](../../packages/devflow-ui/README.zh.md) 提供浏览器通道与看板：读取活跃集与档案，外加一个人对「卡片在看板上的去留」所做的决定——归档一张已完成的卡、清扫全部已完成、放弃一张不会再做的卡。执行类动作不在这条通道上，恢复也仍然留在命令面。系统刻意不设第二套后台执行器：执行与推进归 Harness agent，插件只拥有状态、工具、策略、命令与视图。

## 产物契约

想在流水线上落实产物纪律的部署,组合四个迁移策略,而 Harness agent 继续作为执行器——没有任何策略硬编码契约,整套东西就是配置。这份配置只写一次,就是 [`examples/full-pipeline/cordis.patch.yml`](../examples/full-pipeline/cordis.patch.yml):一份覆盖在 [bundle](../packages/devflow-bundle/README.md) 各行之上的 profile patch,流水线的每条边都带契约,两条边带准入检查,一条边跑验证套件,worktree 行的派发 kind 则钉在 artifact gate 所塑形的那个 kind 上。把它抄进 profile 自己的 `cordis.patch.yml` 即可(harness 的 shell 执行器、subagent 运行时与 default-model 各行照常组合);[`tests/artifact-contract-composition.spec.ts`](../tests/artifact-contract-composition.spec.ts) 用真实 Loader 启动同一组合形态,并驱动一张卡 draft→done 走完全程。

本节余下的内容是「为什么这样配」。配置本身不在这里复述:同一份契约写在两处就会漂移,而没人跑的那一份就是一直错着的那一份。

**加载序就是 waterfall 序。** `devflow/transition` 上的监听按注册顺序运行,所以四个策略的挂载顺序就是裁决顺序,样例的顺序是刻意的:**机械 → agent → 命令 → 审批/完成**,最便宜、最确定的在前。免费的结构检查先否决,checker 才不会在残缺的交付物上花模型预算;checker 先否决,命令门禁才不会在不可靠的工作上花一轮测试套件的墙钟时间;命令跑完才问人。真的配了审批的部署买到的是同一个顺序:人只在每个自动层都点头之后才被问到。[bundle](../../packages/devflow-bundle/README.md) 正是按这个顺序挂载它的策略行,组合测试也断言这个顺序成立——一个机械缺陷派发零个 checker、运行零条门禁命令。

**kind 在一个点定义并裁决。** `devflow-artifact-gate` 的 `kinds` 段是 kind 结构存在的唯一位置；它以只读服务 [`devflowArtifactStructures`](#ctxdevflowartifactspecs--artifactspecs-value-service) 发布，同时由 [`devflowArtifactContract`](#ctxdevflowartifactcontract--artifactcontract-value-service) 在移动前暴露完全相同的出边判定。其余各处只消费这套词汇而不复述其形状：agent gate 的 `inputs` 选择哪些登记喂给检查，模型工具渲染契约服务返回的动态预检——预检不会与真实门禁漂移。

**挂载顺序是 bundle 的,patch 不改变它。** 按 id 寻址已有行的 profile patch——样例就是这种——在行原处配置它。改用 `insert` 重新插入一行则是追加,会把该行的监听挪到 waterfall 末尾;一个部署把机械检查放到它本该省下的 checker 之后,就是这么悄无声息地发生的。

**审批刻意缺席。** `devflow-gates` 接受 `approvals` 列表,而样例一条都没有配:流水线边上的人工审批会拦下每一张经过的卡,而它想抓的缺陷已经是旁边那条命令门禁、以及流水线对每张卡都强制的 `reviewing` 阶段的职责。只给爆炸半径值得拦下所有卡的边加审批,并且把它的代价读作每卡时延,而不是一次性配置成本。

**agent 是生产者,契约里没有任何东西替它生产。** 它读取每次工具结果中的 `artifactGates` 预检,通过 `devflow_attach_artifact` 登记必需 kind,并显式推进卡片。样例里没有任何一行会写交付物或移动卡片。

返工闭环不需要第二个编排器:否决把卡留在原地并带上理由(agent 否决的完整报告落在该卡片的 `.devflow/reports/agent-gate/` 下),Harness agent 登记同一 kind 的修正版本,重试就对照这份最新登记重新检查——输入 revision 变了会错过裁决缓存,agent gate 因此重新派发;而什么都没变的重试复用缓存裁决,不再花第二个 checker。

### 富内容产物:指针 + 分离文件

样例定义的五个交付物 kind 都是纯 md,`sections` 只检查标题存在,不关心标题下内容的语义。测试报告这类交付物想带截图、进度条这类 md 表达力不够的富内容,又不想让大文件(HTML + 截图)撑爆 journal、撞上模型单次输出上限。这里不需要新的机制:已有的 `nonEmptySections` 结构检查加已有的两种 `attachArtifact` 登记形式(kind+content 与 path-only)组合起来就够,以下是一个想开放这个能力的部署可以直接抄的 kind 定义:

```yaml
test-report-html:
  frontmatter: [card]
  nonEmptySections: [Report]
edges:
  'testing->done': [test-report-html]
```

用 `nonEmptySections` 而不是 `sections`:只要求标题存在的 `sections` 会放行一个空章节,等于放行一份没有指向任何文件的"指针";`nonEmptySections` 额外要求标题到下一个标题之间至少一行非空内容,逼着这段指针文本真的写点什么(哪怕只是一行相对路径)。登记的指针内容形如:

```md
---
card: 0001-my-card
---

## Report

HTML report: artifacts/report.html
```

落地这份产物走**"Bash 落盘 + 双登记"**模式,一次落地分三步:

1. **Bash 写文件。** 生成报告的一步用 Bash(不是 Write/Edit 工具)把 `report.html` 和截图写进 `<卡片目录>/artifacts/`。`devflow-fs-guard` 按路径分段名拦截任何工具对 `.devflow` 子树的写入/编辑意图,粒度到 `artifacts/` 子目录,没有例外——模型的 Write/Edit 工具不能直接在卡片目录下新建 `report.html`。该 guard 自己的模块文档说明它是"policy fence over the tool plane, not a kernel boundary",Bash 写入不受它拦截,这正是这个模式要用的口子。
2. **path-only 登记。** `attachArtifact({ path: 'artifacts/report.html', ... })`,不带 `kind`。这条登记不参与 gate 判定(gate 只认 `kind === 'test-report-html'` 的登记),专门负责看板的"打开"可见性——`devflow-ui` 按登记的 `path` 直接打开磁盘上的真实文件,不区分记录有没有 `kind`。
3. **kind+content 登记。** `attachArtifact({ kind: 'test-report-html', content: <指针文本>, ... })`,content 是满足上面 kind 结构规格的一小段文字,正文里带 `artifacts/report.html` 的相对路径。这条登记专门负责满足 `testing->done` 的结构门禁;`content` 只是指针,不是报告本身——把 `report.html` 全文塞进 `content` 会重新引入"大内容进 journal、模型单次输出上限"这两个问题。

两条登记顺序不重要,但缺一不可:只登记 path-only,`testing->done` 仍会被拒绝("test-report-html: no artifact of this kind is registered");只登记 kind+content 能让 gate 放行,但看板上就少了一条指向真实 `report.html` 的可点击行,打开后看到的是指针文本本身,不是报告。这套模式只挂在 `testing->done` 一条边上作为示例;`prd`/`design`/`implement`/`review` 对应的边不需要它,继续用纯 md 就够。

## 架构文档

寿命超过一张卡的知识住在第二条缝 [`ctx.devflowSpec`](../packages/devflow-spec/README.zh.md) 后面，而不在卡片 journal 里。文档存放于 `.devflow/spec/<id>.md`，frontmatter 加正文，每条实质论断都落在一个声明过的 **anchor** 上，store 在每次读取时求值：`symbol`（该名字必须仍被声明）、`content-hash`（该符号经解析器规范化后的体，其摘要必须不变）、`churn`（该文件不得在文档之后被提交）。裁决是三值的——`fresh`、`stale`、`unevaluable`——而第三种绝不折叠进第一种，因为**一个再也跑不动的校验不是一个通过了的校验**。

写入时每个 anchor 都必须求值为 `fresh`，因此此后的 `stale` 永远意味着代码动了，而不是这篇文档从一开始就是错的。未给出摘要的 `content-hash` anchor 取该符号当前的摘要：本线之外没有调用方算得出对规范化后的体取摘要这个值，强制要求它等于让最强的一类 anchor 在模型平面上不可达。

根目录位于 `.devflow/` 之内，而 [`dsh-devflow-fs-guard`](../packages/devflow-fs-guard/README.zh.md) 已拒绝文件工具写入该子树，因此 [`dsh-devflow-spec-tool`](../packages/devflow-spec-tool/README.zh.md) 是唯一写路径——被强制的，而非仅仅本意如此。spec 状态刻意留在 journal 之外：文档的权威是文件本身加 git，因此挂载或移除本缝**永远不会改变任何已提交卡片的回放结果**。相关决策由 [anchor 模型 Agent Note](../.agents/notes/implemented/architecture/2026-09-02-devflow-spec-anchor-model.zh.md) 拥有。

### 对漂移的反应

对漂移的默认反应挂在会话上，不挂在边配置上。[`dsh-devflow-spec-sentinel`](../packages/devflow-spec-sentinel/README.zh.md) 监视每个 turn 的一方 `write`/`edit` 落在哪些文件上；当一个将要结束的 turn 让某篇挂锚文档变为过期时，它强制一个续跑步，点名文档、失效的 anchor 与四个合法出口——经 `replaces` 重写、替换一篇本来就错的文档、经合并退休该论断、或显式 defer。同一篇文档在同一会话内至多打断一次，且没有续跑次数上限：过期的文档是**参考**，读者欠它一次知情的过目，不欠它一场拉锯，因此重构中途让文档合理地过期多个 turn 是一种正当状态——哨兵自己的消息就是这么说的。`churn` anchor 从不触发它——未提交的编辑翻不动 churn，churn 的健康归下面的 census。

那一次打断（或一次 defer）之后，过期只保持可见，不再动用强制。`devflow-spec-map` 运行时上下文在每个模型步之前列出与本会话所触内容相关的文档，只给索引行。两层：文档的 anchor 声称的文件被本会话的写入落中的（stale 的排最前并点名失效 anchor）；以及本会话触过的每个包名下的其余文档——读也算触达，因为读一个文件是"要在这动手"的早期信号。索引有字节上限并由 harness 做 diff；正文仍只经 `devflow_read_spec` 到达模型，告警行随附。零配置即有意义：不挂本缝时哨兵与索引整体惰性，挂上它们也不会强制任何部署未曾以 anchor 写下的东西。

### 到达卡片

以下的声明是**opt-in 的纸面记录**：部署方刻意配置的卡片级契约，叠在上面那条不需要任何配置的自动路径之上。

一张卡通过 `spec-refs` 产物说明自己的工作触及哪些文档——`## Scope` 小节列出 id 前缀。把它配成 `draft->designing` 的必备 kind，卡片不回答就出不了 draft——但只对标准路线成立：`express` 与 `emergency` 经 `draft->developing` 进入工作，根本不经过那条边，所以这份契约照原样写下时约束不到它们的任何一张卡。采用它的部署要么接受只覆盖标准路线，要么把该 kind 同样配在 `draft->developing` 上；两者都站得住，但它必须是一个决定。同一份登记随后成为每个单卡结果上可选 `specRefs` 索引的来源，形状与它旁边的 `artifactGates` 完全同构：id、标题、描述、路径、汇总新鲜度，**从不含正文**。正文经 `devflow_read_spec` 按需到达模型，而那次读取在文档非 fresh 时渲染明确的告警行——只返回散文的读取会丢掉这条缝存在的唯一理由。

从未声明的 scope 保持沉默——**卡片还没说清自己触及什么，是一张普通卡片的正常状态**——所声明的前缀查不到任何文档时同样省略索引，那个覆盖缺口交给 census 报告。但登记存在却读不出 scope——文件读不到、没有 `## Scope` 小节、或小节之下没有条目——会在单卡结果上放一行告警，说明索引没有被提供：这张卡承诺过声明，沉默会被读成「没有文档」。

### 修订与退役

`replaces` 是让集合能缩小的东西。指自身即原地修订；指其他篇即聚类合并并删除它们。增长上限按**净**变化计费，所以三合一从不因"太大"被拒——把合并按纯新增计费，恰恰会拒绝那个唯一缓解压力的动作。所有拒绝都在第一次写之前落定，因此被拒的合并让根目录逐字节不变；这刻意**不是**跨多文件的崩溃原子性：替换先写、删除后做，被打断的合并因此留下重复而不是缺口。

在出口处，`spec-delta` 产物让卡片对产出做分诊：`reference` 在这里成为文档，`obligation` 去往一套常驻并由校验脚本强制的规则集。把它配在**三条**终态边上——服务类别是加边而非替换，只写 `testing->done` 的契约恰好放过那些跳过评审的卡片。与 `spec-refs` 一样，这是 opt-in 的纸面工作：默认组合已经通过哨兵对过期本身做出反应，`spec-delta` 是给那些还想要每卡一份书面分诊的部署准备的。

### 读取集合的健康度

`/devflow spec` 在人类平面报告它：多少篇 fresh、哪些 stale 或 unevaluable **以及具体哪条 anchor 失效**，随后是一份覆盖普查——每个期望的 scope 落在三态之一：已有文档、被某篇点名的文档豁免、没有文档，每一态都与该 scope 下"anchor 指得到的文件数"并列呈现。它由 `list()` 加 `evaluate()` 推导而非新增 store 方法，也不是模型侧工具——全集普查正是卡片结果所遵循的"只下发索引"纪律的反面。期望覆盖先发现、后配置：没有配置 `specScopes` 时，census 向可选的 `devflowSpecWorkspace` 服务——哨兵的工作区布局解析器——询问调用工作区的包布局，并把其 scope id 当作期望集，报告里会说明这一来源。配置 `specScopes` 则整体覆盖发现结果，不做并集——列出 scope 就是在说"只问这些"，其中包括对某个已发现的包"明确不问"的权利。两个来源都没有时，报告会说覆盖问题没有被问过，这与"没有缺口"不是一回事。

"已豁免"这一态正是文档可选的 `waives` 字段买来的东西：一个"该 scope 不需要架构文档"的刻意决定，由一篇必须说清理由、并把这个理由落在 anchor 上的普通文档承载——因此文档变 stale 的那天，该豁免随之存疑，而只有 `no document` 才会被算作缺口。普查里没有任何一个数字是阈值。"这个 scope 够不够"是它交还给读者的判断，与结构契约刻意不校验"每条论断是否挂了 anchor"划的是同一条线；那个文件数是让这个判断成为可能的东西，而不是替你做出判断的东西。

### 把 bootstrap 放上板

给一个大仓库冷启动文档集要跨若干趟、若干会话，而一趟 bootstrap 目前除了文档什么也留不下：它裁决过的候选清单——考虑了什么、否掉了什么、为什么否——说在一个 turn 里就没了，也没有任何东西评审它。想把这份清单留下并被检查的部署，可以把这一整轮放上卡片板，而且**不需要任何新机制**：产物契约、准入门与完成策略已经组合出整条路线，所以下面给的是一份配置样例而不是一个新包。

**卡片承载一趟的工作，它绝不承载覆盖状态。**这是整个形状据以成立的边界，不是风格偏好。`/devflow spec` 从磁盘实算覆盖，无法漂移；用板跟踪同一个问题则必然漂移，因为 `devflow_write_spec` 本身就是一个完整的提交点——文档落地不需要任何人去动卡片。把普查镜像到卡片上还会违反本线自己的"状态只在其提交点发布":"这个 scope 有文档了"的提交点是那次写入，不是一次流转。因此父卡的完成判据是**引用**普查(当普查不再把这些 scope 报为 no document 时它才完成),而不是复述一份；下面的 `bootstrap-pass` kind 也刻意没有 `Remaining` 这一节，不给任何人留下填进度的地方。

这不会新增第四个读取面。普查在人类平面回答"整个集合长什么样";`devflow-spec-map` 预步索引回答"哪些文档与本会话正在改的东西相关";卡片的 `spec-refs` 回答"这张卡的工作涉及哪些文档"。一条 `bootstrap-pass` 登记这三个问题一个都不回答——它根本不是读取面，而是一趟 pass 的决定记录，留下来是为了让门能评审它。

形状是：一张父卡代表这个仓库，每个未覆盖 scope 一张子卡，跨切的那一趟作为父卡自己的直接工作。`dsh-devflow-parent-gate` 已经保证子卡未全部 `done` 时父卡到不了 `done`,所以这里不重写任何完成策略。这类 profile 的 devflow 部分：

```yaml
# 先是 store，然后是这条路线需要的三个策略，按瀑布顺序。
- name: '@zhchxiao123/dsh-devflow-filesystem'

# 第 1 层 —— 机械层：这趟的裁决清单已登记且结构完整。
# `Verdicts` 列进 nonEmptySections，因为空的裁决节不是"裁决了但为零"，
# 而是"根本没回答"；`Scopes` 与 `Candidates` 同理。`Written` 与 `Waived`
# 只要求存在：没有候选过线的一趟不写任何文档，而多数趟不豁免任何 scope。
- name: '@zhchxiao123/dsh-devflow-artifact-gate'
  config:
    kinds:
      bootstrap-pass:
        frontmatter: [card]
        sections: [Written, Waived]
        nonEmptySections: [Scopes, Candidates, Verdicts]
    edges:
      # 离开 `developing` 的**两条**边。服务类别是加边不是换边：
      # `express` 走标准的 `developing->reviewing`，但 `emergency` 走
      # `developing->done`，所以只写前一条的契约恰好放过跑得最快的那批卡片，
      # 让它们一份裁决清单都不交就出去。
      'developing->reviewing': [bootstrap-pass]
      'developing->done': [bootstrap-pass]

# 第 2 层 —— 准入：结构检查看不到的三件事。两条边刻意共用同一份指令；
# 一个对 emergency 路线判得更松的 checker，会把这条捷径变成"绕开评审"，
# 而它本该只是"绕开设计轮"。
- name: '@zhchxiao123/dsh-devflow-agent-gate'
  config:
    edges:
      'developing->reviewing': &bootstrap-check
        provider: claude
        inputs: [bootstrap-pass]
        prompt: |
          Judge this bootstrapping pass's verdict list. The structural check
          has already passed, so every section exists; you are checking
          whether what is written in them is honest. Read the documents named
          under `Written` with devflow_read_spec when you need to see their
          anchors. Judge exactly these three things, and veto naming the
          offending line if any of them fails.

          1. Every candidate has a verdict, and every rejection carries a
          reason about that candidate. A reason that would read the same
          under any other line — "not load-bearing", "the code already says
          this", "out of scope" with nothing specific to the claim — is a
          rejection with the reason left out, and the count of documents
          written is only reviewable when the rejections are real.

          2. Every claim under `Written` rests on an anchor kind that can
          falsify it. A behavioral claim — which methods an endpoint answers,
          what a failure path returns, an algorithm, a validation rule — must
          rest on `content-hash`. A `symbol` anchor watches only the name, so
          adding a handler turns the claim false while the anchor still
          reports fresh, and the document then states the opposite of the
          code with nothing left to report it. `symbol` is right only for a
          claim about what the code is called or how it is shaped, `churn`
          only where no parser reads the file. Veto naming the document, the
          anchor, and the claim the anchor fails to watch.

          3. Every scope under `Waived` is carried by a real document that
          names it in `waives`. Read that document: it has to say why the
          scope needs none and rest that reason on its own anchors. A scope
          listed as waived without such a document is an undocumented
          decision, not a waiver.

          `Scopes` is what this pass took, never what the repository has
          left. Coverage is the `/devflow spec` census's answer and its
          absence here is deliberate, so do not ask for a remaining-scope
          list.
      'developing->done': *bootstrap-check

# 第 3 层 —— 完成：代表仓库的那张卡在每张 scope 卡之后才完成。
# 无需配置；规则就是父子关系本身。
- name: '@zhchxiao123/dsh-devflow-parent-gate'
```

一条能被这些门接受的登记长这样——`Written` 的每行点名 anchor 种类，这正是让第 2 条判据可以只凭产物判定、而不必重读整个 scope 的原因：

```md
---
card: 0002-scope-api-gateway
---

## Scopes

spring-petclinic-api-gateway

## Candidates

- The fallback endpoint answers POST only; a GET through the gateway gets 405.
- `default-filters` attaches a CircuitBreaker and a POST-only Retry to every route.
- A failed visits call degrades to an empty visit list rather than an error.
- The module is a Spring Boot application.

## Verdicts

- fallback method set — pass: a stranger reads the 405 as a routing defect and "fixes" it.
- default-filters — pass: the retry covers POST alone, and no single call site shows that.
- visits degradation — pass: the empty list is designed behaviour and reads as data loss.
- Spring Boot application — reject: the annotation on the class states it, so the claim is not non-obvious.

## Written

- `gateway-fallback-semantics` — claim: the fallback endpoint answers POST only — anchor: `content-hash` on `FallbackController`

## Waived

None.
```

服务类别是每张卡自己做的判断，而那两条被配上契约的边正是为它们存在的：一趟 bootstrap 没有设计轮可跳，所以 `express`(`draft->developing`,再走标准的 `reviewing` 出口)通常是诚实的类别，而 `emergency`(`draft->developing`,再走 `developing->done`)适合那种整个答案就是一次豁免的 scope。两者都仍然要登记这趟的清单，因为两条被配上的边带的是同一份契约。[`tests/spec-bootstrap-board-composition.spec.ts`](../tests/spec-bootstrap-board-composition.spec.ts) 通过真实 Loader 启动的正是这份组合，并驱动一张 `express` scope 卡、一张 `emergency` scope 卡和它们的 `express` 父卡走到 `done`,其中包含锚种类不匹配被否，以及 emergency 那条边上的机械否决。

这一切默认都不开。bundle 里 `devflow-artifact-gate` 与 `devflow-agent-gate` 本就是 disabled,而没有上面那份 `kinds`/`edges` 时，一趟 bootstrap 的行为与完全不上板时一模一样——skill 里的流程、以普查为完成判据、以及哪里都不登记任何东西。[`devflow-spec-bootstrap` skill](../packages/devflow-guidance/README.md) 承载"这条路线什么时候值得它的纸面开销"这个判断：一个一趟就能把缺口补完的仓库不该为此付费。

## 铁律

文档是**参考型**知识——该知道，相关时再读。另一种是**义务**，不遵守就是错，它采取相反的注入策略：[`dsh-devflow-iron-rules`](../packages/devflow-iron-rules/README.zh.md) 让规则正文常驻每一次请求而不是藏在索引后面，因为**模型从未打开的规则就是从未遵守的规则**。规则住在 `.devflow/iron-rules/<id>/`，一份 `RULE.md` 加可选的 `check.sh`；后者在碰过文件的 turn 将要结束时运行，失败以强制续轮返回，直到续轮上限把决定交还给人。

记录要求陈述式分诊——`script` 或 `judgement`，其中 `script` 必须同时给出校验脚本与它监视的路径——因为跳过"脚本能不能判定这件事"正是规则集退化成纯散文的路径。同一条写入路径以 `ctx.devflowIronRules` 发布，因此 `spec-delta` 的 obligation 是一次转发调用，而不是谁手打的一段回执。没有那条缝的部署没有安放义务的地方，必须明说。

<a id="devflow-commit-semantics"></a>

## `.devflow` 的提交语义

这三类知识落在同一个目录里，旁边还有第四样东西，而"这东西该不该进 git"四者没有共同答案。决定每一类的是**它的真相住在哪**，而判错时的失败无一例外是无声的。

| 内容 | `.devflow/` 下的文件 | 入库 | 写入方 |
|---|---|---|---|
| 卡片状态 | `tasks/**/journal.jsonl`、`card.md`、`artifacts/` | 必须 | [`dsh-devflow-filesystem`](../packages/devflow-filesystem/README.zh.md) |
| 仓库知识 | `spec/`、`iron-rules/`、`business/` | 必须 | [`dsh-devflow-spec-tool`](../packages/devflow-spec-tool/README.zh.md)、[`dsh-devflow-iron-rules`](../packages/devflow-iron-rules/README.zh.md)、[`dsh-devflow-business`](../packages/devflow-business/README.zh.md) |
| 部署策略 | `validation.json`、`midscene/settings.json`、`midscene/suites/` | 应该 | [`dsh-devflow-midscene`](../packages/devflow-midscene/README.zh.md) |
| 进程瞬态 | `**/claim.json`、`**/commit.lock` | 绝不 | `dsh-devflow-filesystem` |

**卡片状态的真相是 journal。** `foldJournal` 要求 revision 连续，所以不随分支旅行的看板根本不是看板：从一个忽略 `.devflow/tasks/` 的仓库拉出来的 worktree 从空开始，并把新卡从 `0001` 重新编号。这正是 [worktree 围栏](#worktree-development)守护的前置条件，而不是叠在它上面的第二条规则。

**仓库知识的真相是文件加 git**——spec 那条缝本就立在这句话上，这也是为什么一张已提交的卡和它引用的文档在每个 checkout 里重放结果都一样。

**部署策略的真相是维护者的决定。** `validation.json` 的存在，是为了在没有挂载 Midscene 提供者时必需的验收依然阻止完成；一份从未进过 git 的副本，等于把这条保证从除写它那个 checkout 之外的所有 checkout 手里收走。

**进程瞬态的真相是某个活着的进程**，这让它成为唯一一类跨越机器边界后只剩误导的内容：随分支到达的租约把卡指派给一个从不存在于此的 session，而继承来的 `commit.lock` 会让这张卡的每一次写入 fail closed，直到有人删掉一把从无写入者持有过的锁。它的一般形式可以回答本表没有点名的任何路径——**内容在另一台机器上没有意义的文件，不该进 git。**

如今已没有插件在这个根目录下写瞬态文件：`dsh-devflow-midscene` 的 `operation.lock` 曾经在这里，现在改在该工作目录的私有运行态根目录下，下面第三条 ignore 规则正是为此留下的兜底。保留它是因为这两处改动可能分别到达某个 checkout，而多一条冗余规则没有代价，少一条则是把一个 pid 文件漏进 git。

每个跑 devflow 的仓库都带着同样的三行，而绝不能提交的东西就是这三行：

```gitignore
# devflow 进程瞬态：每一个都由某个活着的进程持有，因此随分支到达的副本
# 描述的是一个从未在这里跑过的进程。第三行守的是今天已经没人写的路径；
# 为那些早于 midscene 锁迁出本根目录的 checkout 保留它。
.devflow/**/claim.json
.devflow/**/commit.lock
.devflow/midscene/operation.lock
```

把 `.devflow/` 整个忽略掉，就是一次把四类全判错。[`tests/devflow-root-commit-contract.spec.ts`](../tests/devflow-root-commit-contract.spec.ts) 在真实仓库上把两个方向都钉住：每一个瞬态路径都被忽略，每一个卡片状态路径都被跟踪。

## Model guidance

这套分类学还有第三种知识：**过程判断**——工作何时该上看板、一张卡该取哪个 service class、需求怎么拆、什么样的产物过得了闸门、被 veto 后如何返工。违背它不是破坏规则，而是把工作流开得很差，因此它采用目录策略而非常驻：[`dsh-devflow-guidance`](../packages/devflow-guidance/README.md) 把它作为 bundled `devflow-workflow` skill 发布，常驻的只有一行目录条目，正文按需加载，并可被同层更低 rank 的同名 provider 覆盖。正文刻意不陈述任何部署的产物契约——工具结果里的 artifact-gate 预检才是那件事的权威，且恰好在适用的时刻送达。第二个 bundled skill `devflow-spec-authoring` 承载架构文档的撰写判断——什么值得成文档、什么该是铁律、anchor 怎么选、id 怎么划 scope、经 `replaces` 修订、读到 stale 后如何应对——且只在组合挂载 `ctx.devflowSpec` 时注册，因此目录永远不会宣传一个教不存在能力的 skill。第三个 skill `devflow-spec-bootstrap` 在同一条件下注册，承载 census 报告"没有文档"的 scope 的冷启动程序——一次做一个 scope、论断从代码而非旧文档中确立、三篇只是一趟的节奏而非该 scope 的总量（census 的文件数正是回到一个大 scope 的路），完成既可以由文档落地达成，也可以由一次豁免裁定该 scope 不需要文档而达成。

同一个包还回答了任何工具描述都答不了的问题——*这个工作区有没有一块值得先读的看板*——靠的是 `devflow-board` 运行时上下文：各阶段计数、被 claim 的卡，加一句指向 `devflow_create` 与 skill 的指引，上限 1024 字节，因为 awareness 不是看板镜像，真正的看板只隔一次 `devflow_list`。pre-step 监听器每步重读看板（没有 `.devflow/` 的工作区只是一次失败的 readdir，因此不贡献任何内容），harness 对渲染结果做 diff，看板不变就绝不重发。两层都不承载义务：单次调用协议留在工具描述里，enforcement 留在闸门上，所以从不加载 skill 或抑制 runtime context 的部署失去的是引导，从不是保证。

## Worktree 开发

多张卡在一个 checkout 里开发就共享一条分支，于是 range 模式对任何一张卡的 review 都会看到两张卡的改动——这正是 [`dsh-devflow-review-gate`](../packages/devflow-review-gate/README.md) 在已知限制里点名的交叉污染。[`dsh-devflow-worktree`](../packages/devflow-worktree/README.md) 用拓扑而非新的状态存储来回答它：一张卡、一条分支、一个 linked git worktree。因为 `.devflow/` 是提交进仓库的，而每个消费方都从会话自己的目录解析 root，worktree 天然就是一个完整的工作区——分支携带卡，卡的工作区就是 worktree，闸门命令、review、检查 subagent 都自然落在那里，没有任何包需要改变它解析目录的方式。[Midscene](../packages/devflow-midscene/README.zh.md) 验收只有 project 模式跟得上，它按会话解析工作区；旧 profile 的 `workspace` 是一个指向主 checkout 的固定绝对路径，被派遣的卡过不了它的作用域校验。

这个包交付判断力和一道围栏。bundled 的 `devflow-worktree-runbook` skill 承载仪式：向 `ready` 的卡 attach 一条派遣 artifact（kind 为 `worktree`，frontmatter 含 `branch`/`base`/`worktree`），提交它，然后创建分支和 worktree——顺序不可颠倒，因为在建分支之后才 attach 的派遣会让分叉两侧同时写这张卡。此后直到合并的 pull request 把代码和 journal 一起送达之前，只有卡自己的 worktree 写它。围栏在 transition waterfall 上强制的正是这条规则：被派遣的卡只能从它指名的 worktree 或仓库的主工作树（按目录经 `git rev-parse --git-common-dir` 推导）发起 transition，其余任何 checkout 都会被 veto，理由里点名两个目录。artifact 登记不在围栏之内，而它在同一条 revision 序列上追加，分叉 journal 的方式与 transition 完全相同；之所以仍然放行，是因为移动后的 worktree 正是靠 attach 一条新派遣来指明当前路径，这半条规则由 runbook 承载。没有派遣 artifact 的卡不受任何影响，所以挂载这一行在有卡真正被派遣之前什么都不改变。这条规则的牙齿是结构性的：两个 checkout 向同一张卡的 journal 追加，合并后就是 `foldJournal` 大声失败的 revision 冲突，围栏强制执行的正是看板自身持久化模型的前置条件。[worktree Agent Note](../.agents/notes/implemented/feature/2026-09-16-devflow-worktree-per-card.md) 持有这项决策。

够到一张被派遣的卡，也是流程自身前提的第一个机械时刻，同一个监听器检查 git 答得了的那两条：板已入库（`git ls-files`）、卡的租约已被 ignore（`git check-ignore`，按[上文](#devflow-commit-semantics)的规则取一个代表路径）。任何一条不成立都以修好仓库的命令 veto，因为没入库的板会把 worktree 的新卡从 `0001` 重新编号，而随分支旅行的租约会把卡指派给一个从不存在于此的 session——两者否则都要晚整整一个开发周期才浮现：或在 merge 时，或在下一次有人试图 take 这张卡时。对一个 git 回答不了的仓库是放行而不是 veto：跑不了的检查不是失败的检查——这与紧挨着它的主工作树推导读法相反，那里的缺席是拒绝的理由。诚实的限制在时机：派遣仪式中没有任何 transition，所以最早的发问是 worktree 里的 `devflow_take`，那时的修复仍然只是删掉一个 worktree，而不是修复一份 journal。[前提检查 Agent Note](../.agents/notes/implemented/feature/2026-09-16-worktree-dispatch-preconditions.md) 持有这项决策；git 做不了的那两条检查——review 边使用 range 模式、worktree 位于主 checkout 之外——仍以散文留在 runbook 里。

[bundle](../packages/devflow-bundle/README.md) 挂载这一行并默认启用，位置在 guidance 行之后、四道策略行之前，而且这是这个包唯一的挂载：被 bundle 收编的包不再自带 patch，因为两个 layer 插入同一个行 id 会组合出一个 Loader 拒绝的重复项。`dsh plugin add @zhchxiao123/dsh-devflow-worktree` 因此只装出一个不挂载任何东西的普通依赖——这是一次移除而不是疏漏，而且代价为零：runbook 从头到尾讲的是一张 devflow 卡的仪式，没有看板的 profile 本来也用不上它。这条规则由 [`tests/bundle-row-ids.spec.ts`](../tests/bundle-row-ids.spec.ts) 对每一个 patch 携带者守住。行的位置则是与启用分开的一项决策：fence 是 `devflow/transition` 上的监听器，挂载顺序即裁决顺序，因此「这个 checkout 到底能不能写这张卡」在任何结构检查、checker 或测试套件被花在一次根本无法被接纳的移动上之前就被回答。[`tests/worktree-dispatch-composition.spec.ts`](../tests/worktree-dispatch-composition.spec.ts) 在真实仓库与真实 linked worktree 上走完整套仪式，它存在的理由是最后那条断言：在分支合并回一个期间自己也向前走过的主 checkout 之后，卡的 journal 仍然折得出来、revision 连续，派遣这张卡的那个 session 能从 worktree 停下的地方继续推进它。同一份 spec 也钉住了那条没有任何机制阻止的限制——在 worktree 里创建的卡会拿到主板同样会发出的序号，而由于两者是不同目录，merge 干干净净，撞号是无声到达的。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` — **which this repository does not carry**: the generator stayed in the harness when this line was extracted, so the block below is maintained by hand against the JSDoc in `packages/*/src` until the script is ported. Treat the source as the authority on any disagreement. The language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdevflow--devflowstore-abstract-seam"></a>

### `ctx.devflow` — `DevflowStore` (abstract seam)

Abstract task-card store registered as `ctx.devflow` (one implementation per context; loading a second throws, cordis' standard duplicate-service behavior). Subclass, implement the abstract methods, and load the subclass as a plugin.

Implementations must honor these read-side semantics:

- Current state comes from journal replay (foldJournal); the card file's frontmatter is a projection. On disagreement the journal wins and the drift is warned, never silently adopted.
- A structurally invalid journal fails the read loudly, naming the file and line; a card is never silently skipped.

```ts cordis-catalog
/**
 * List the cards in the active set of one root — all of them, so a caller
 * that must reason over the whole board (a completion policy, a board
 * snapshot, a parent's progress) can trust the count.
 *
 * That completeness is why this read takes no page: it can be promised for
 * the active set and not for the archive, which grows without bound. Reach
 * archived cards through {@link query} instead.
 * @param filter - optional narrowing; omitted lists every card.
 * @param root - devflow root to list; omitted uses the implementation's default root.
 * @returns cards ordered by id.
 * @throws {Error} when the filter states both `parent` and `topLevel`.
 */
abstract list(filter?: CardFilter, root?: string): Promise<DevCard[]>

/**
 * Read one page of a card set: the same predicates {@link list} narrows by,
 * plus the set to read and where to resume.
 *
 * Implementations stop reading at the limit rather than collecting the set
 * and slicing it. The cost a caller should know: narrowing does not make the
 * read cheaper, because each card must be loaded before its predicates can
 * be judged — a page of five matches out of a thousand cards still loads a
 * thousand cards. What the limit saves is everything after the page fills.
 * @param query - narrowing, set selection, and pagination; omitted reads the
 *   first page of the active set.
 * @param root - devflow root to read; omitted uses the implementation's default root.
 * @returns the page, stating whether the limit cut it short.
 * @throws {Error} for contradictory predicates, a malformed month, a
 *   non-positive limit, or a cursor this store did not issue.
 */
abstract query(query?: CardQuery, root?: string): Promise<CardPage>

/**
 * Read one card.
 * @param id - the card id (its directory name).
 * @param root - devflow root holding the card; omitted uses the implementation's default root.
 * @returns the card with journal-derived current state.
 */
abstract read(id: DevflowCardId, root?: string): Promise<DevCard>

/**
 * Read one card's complete decoded journal, in revision order. The stream
 * is validated like a read: a structurally invalid journal fails loudly,
 * naming the file and line.
 * @param id - the card id (its directory name).
 * @param root - devflow root holding the card; omitted uses the implementation's default root.
 * @returns the decoded entries, oldest first.
 */
abstract history(id: DevflowCardId, root?: string): Promise<DevflowJournalEntry[]>

/**
 * Read the card's current lease holder.
 * @param id - the card id (its directory name).
 * @param root - devflow root holding the card; omitted uses the implementation's default root.
 * @returns the holder facts, or `undefined` while the card is unclaimed; a
 *   corrupt claim record fails loudly.
 */
abstract holder(id: DevflowCardId, root?: string): Promise<ClaimHolder | undefined>

/**
 * Apply implementation-owned defaults to a creation request: the slug when
 * omitted, the devflow root when omitted, and the creation timestamp.
 * @param request - the caller's request.
 * @returns the fully specified spec to hand to {@link create}.
 */
abstract resolveCreate(request: CreateRequest): CreateSpec

/**
 * Create one card in the active set: sequence-number allocation, the
 * exclusive card-directory creation, the journal's first `created` entry
 * (the only commit point), the projection write, then `devflow/card-created`.
 * Sequence numbers continue past archived cards, so an id is never reissued.
 * @param spec - a resolved spec from {@link resolveCreate}, never a raw request.
 * @returns the outcome; domain rejections resolve with `ok: false`.
 */
abstract create(spec: CreateSpec): Promise<CreateResult>

/**
 * Apply implementation-owned defaults to a transition request: the devflow
 * root when omitted and the commit timestamp.
 * @param request - the caller's request.
 * @returns the fully specified spec to hand to {@link transition}.
 */
abstract resolve(request: TransitionRequest): TransitionSpec

/**
 * Commit one stage move: revision check, edge check, the
 * `devflow/transition` waterfall, the journal append (the only commit
 * point), the projection rewrite, then `devflow/stage-changed`. State and
 * notifications publish only after the journal committed.
 *
 * The waterfall's gate commands put real time between those checks and the
 * append, so implementations must re-establish the checked revision at the
 * append itself, under an exclusion another process observes. A card that
 * moved in that window resolves `revision-mismatch`; a card whose commit
 * stayed excluded resolves `write-contended` with nothing written.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the outcome; domain rejections resolve with `ok: false`.
 */
abstract transition(spec: TransitionSpec): Promise<TransitionResult>

/**
 * Take the card's exclusive lease. A stale takeover journals the eviction
 * under the same cross-process commit exclusion as transitions and artifact
 * registration, so concurrent takeover attempts grant at most one holder.
 * @param id - the card to claim.
 * @param owner - the prospective holder, recorded in the lease.
 * @param options - staleness takeover policy and root; omitted never takes
 *   over and uses the implementation's default root.
 * @returns the live handle, or a holder read from the lease. On journal-commit
 *   contention that holder was observed before trying the lock, not freshly
 *   established as the current owner.
 */
abstract claim(id: DevflowCardId, owner: DevActor, options?: ClaimOptions): Promise<ClaimResult>

/**
 * Register a stage deliverable in the card's journal against its current
 * stage, in one of two mutually exclusive forms: the reference form records
 * a `path` the caller already wrote under the card directory, and the
 * store-written form hands over `kind` plus `content` for the
 * implementation to write `artifacts/<rev>-<kind>.md` itself before the
 * journal append — which stays the only commit point, so a registration
 * that loses the commit registers nothing and its unreferenced file is
 * overwritten by a same-revision retry. Registrations are immutable: the
 * newest record of one kind is that kind's current content. A blocked or
 * done card cannot register artifacts, the revision check mirrors
 * {@link transition}, and an ill-formed kind resolves `invalid-kind`.
 * @param request - card, expected revision, actor, and the artifact reference or content.
 * @returns the outcome carrying the registered record; domain rejections resolve with `ok: false`.
 */
abstract attachArtifact(request: ArtifactRequest): Promise<ArtifactResult>

/**
 * File one delivered card in its root's archive: the `archived` journal
 * append is the commit point, and the directory move that follows is
 * cleanup. Archived cards leave {@link list} but keep their complete
 * journal, stay readable through {@link read}, and can come back through
 * {@link restore}.
 *
 * A requirement archives with its finished slices: they share its bucket, so
 * a decomposed piece of work stays one family on disk. A slice cannot go
 * first — hidden while its requirement still runs, it would vanish from that
 * requirement's progress and from the completion policy's view.
 * @param request - card, expected revision, actor, and an optional reason.
 * @returns the outcome; domain rejections resolve with `ok: false`. A cascade
 *   that partially committed is not rolled back: the journal is append-only,
 *   and retrying skips what already filed as `already-archived`.
 */
abstract archive(request: ArchiveRequest): Promise<ArchiveResult>

/**
 * Return an archived card to the active set, at the stage its journal
 * already recorded. Restoring changes visibility, not progress: a restored
 * `done` card is still done, and resuming work on it is an ordinary rework
 * transition. An abandoned card is refused — that decision is terminal, and
 * reversing it means a new card.
 * @param request - card, expected revision, actor, and an optional reason.
 * @returns the outcome; domain rejections resolve with `ok: false`.
 */
abstract restore(request: RestoreRequest): Promise<RestoreResult>

/**
 * Archive every `done` card of one root that is eligible, through the same
 * commit path as {@link archive}.
 * @param root - devflow root to archive; omitted uses the implementation's default root.
 * @returns the archived card ids, in id order.
 */
abstract archiveDone(root?: string): Promise<DevflowCardId[]>

/**
 * {@link list} scoped to a viewing session's workspace, the face every
 * browser channel reads through.
 * @param filter - optional narrowing; omitted lists every card.
 * @param sessionId - the viewing session; its workspace resolves host-side
 *   to the devflow root, so the wire never carries a file path. Omitted
 *   lists the default root.
 * @returns cards ordered by id.
 */
async listForSession(filter?: CardFilter, sessionId?: string): Promise<DevCard[]>

/**
 * One card's detail scoped to a viewing session's workspace: the read value,
 * its complete decoded journal, and the current lease holder in one round
 * trip.
 * @param id - the card id (its directory name).
 * @param sessionId - the viewing session; resolved like {@link listForSession}.
 * @returns the aggregated detail; `holder` is absent while the card is unclaimed.
 */
async detailForSession(id: DevflowCardId, sessionId?: string): Promise<DevCardDetail>
```

Source: [`packages/devflow/src/index.ts`](../../packages/devflow/src/index.ts)

<a id="ctxdevflowartifactspecs--artifactspecs-value-service"></a>

### `ctx.devflowArtifactStructures` — `ArtifactStructures` (value service)

Read-only kind-spec table published by `dsh-devflow-artifact-gate`, registered for the plugin's fiber lifetime and gone when it disposes. Optional service: read it with `ctx.get('devflowArtifactStructures')`, never the property proxy — a deployment without the gate simply has no specs to template against.

```ts cordis-catalog
/**
 * The gate's configured kind specs, published read-only so a producer can
 * shape a deliverable to the same spec the gate will check. Optional
 * service: read it with `ctx.get('devflowArtifactStructures')`.
 */
devflowArtifactStructures: ArtifactStructures

/**
 * Value of the `devflowArtifactStructures` service: the configured specs, deep
 * frozen and normalized (empty lists dropped).
 */
type ArtifactStructures = { readonly [kind: string]: ArtifactKindStructure }

/**
 * Structural requirements of one artifact kind. Both lists are optional and an
 * empty list equals omission; a kind declared with neither is required only to
 * be registered. The lists stay mutable in type for the config validator's
 * sake; the published service value is deep frozen regardless.
 */
interface ArtifactKindStructure {
  /**
   * Frontmatter fields the artifact must carry, each present with a value —
   * a key mapped to nothing counts as missing.
   */
  frontmatter?: string[]
  /** Second-level section titles (without the `## ` prefix) the artifact must contain. */
  sections?: string[]
}

interface PublishedArtifactKindStructure {
  readonly frontmatter?: readonly string[]
  readonly sections?: readonly string[]
}
```

Source: [`packages/devflow-artifact-gate/src/types.ts`](../../packages/devflow-artifact-gate/src/types.ts)

<a id="ctxdevflowartifactcontract--artifactcontract-value-service"></a>

### `ctx.devflowArtifactContract` — `ArtifactContract`（值服务）

artifact gate fiber 生命周期内发布的可选动态预检。`inspectOutgoing(card)` 返回已配置且合法的出边，以及每个必备 kind 的不可变规格、最新登记、`missing | malformed | satisfied` 状态与全部缺陷。transition listener 使用同一个内部 inspection，因此展示缺陷与真实门禁完全一致。

```ts cordis-catalog
interface ArtifactContract {
  inspectOutgoing(card: DevCard): Promise<readonly ArtifactTransitionInspection[]>
}

interface ArtifactTransitionInspection {
  readonly from: CardLocation
  readonly to: CardLocation
  readonly requirements: readonly ArtifactRequirementInspection[]
}

interface ArtifactRequirementInspection {
  readonly kind: string
  readonly status: 'missing' | 'malformed' | 'satisfied'
  readonly spec: PublishedArtifactKindStructure
  readonly artifact?: Readonly<ArtifactRecord>
  readonly defects: readonly string[]
}
```

来源：[`packages/devflow-artifact-gate/src/types.ts`](../../packages/devflow-artifact-gate/src/types.ts)

<a id="devflow-events"></a>

### `devflow/*` events

<a id="devflowcard-created--emit"></a>

#### `devflow/card-created` — emit

A new card entered the active set: its journal committed the first `created` entry. Dispatched once per creation, after the projection write.

```ts cordis-catalog
/**
 * A new card entered the active set: its journal committed the first
 * `created` entry. Dispatched once per creation, after the projection
 * write.
 * @mode emit
 * @param card - the created card, at `draft` with revision 1.
 */
'devflow/card-created'(card: DevCard): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowcard-archived--emit"></a>

#### `devflow/card-archived` — emit

一张卡离开活跃集合、进入档案。每张归档的卡各派发一次，所以一次跨需求子卡的级联会为每张各派发一次。刻意不并进 `devflow/stage-changed`：归档并不移动卡片，硬并进去会让每个监听者都得再判别一次到底发生了哪一种。

```ts cordis-catalog
/**
 * A card left the active set for the archive.
 * @mode emit
 * @param card - the card as of the committed `archived` entry.
 */
'devflow/card-archived'(card: DevCard): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowcard-restored--emit"></a>

#### `devflow/card-restored` — emit

一张归档卡按其原有阶段回到活跃集合。

```ts cordis-catalog
/**
 * An archived card returned to the active set at the stage it already had.
 * @mode emit
 * @param card - the card as of the committed `restored` entry.
 */
'devflow/card-restored'(card: DevCard): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowstage-changed--emit"></a>

#### `devflow/stage-changed` — emit

A card settled at a new location after a committed transition.

```ts cordis-catalog
/**
 * A card settled at a new location after a committed transition.
 * @mode emit
 * @param card - the card after the move, `stageRevision` already advanced.
 * @param from - the location the card departed.
 */
'devflow/stage-changed'(card: DevCard, from: CardLocation): void
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)

<a id="devflowtransition--waterfall"></a>

#### `devflow/transition` — waterfall

Single-decision transition pipeline. The store dispatches this after the revision and edge checks and before the journal commit; a policy listener that owns the decision returns `{ allowed: false, reason }` without calling `next()`, while an observing listener must delegate.

```ts cordis-catalog
/**
 * Single-decision transition pipeline. The store dispatches this after the
 * revision and edge checks and before the journal commit; a policy
 * listener that owns the decision returns `{ allowed: false, reason }`
 * without calling `next()`, while an observing listener must delegate.
 * @param attempt - the resolved transition about to commit, including its departure location.
 * @param next - delegate to the remaining listeners, finally `{ allowed: true }`.
 * @mode waterfall
 */
'devflow/transition'(attempt: TransitionAttempt, next: () => Promise<TransitionDecision>): Promise<TransitionDecision>
```

Source: [`packages/devflow/src/types.ts`](../../packages/devflow/src/types.ts)
<!-- END GENERATED cordis-surface -->
