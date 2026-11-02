# PRD（提案稿）：devflow 的 worktree 开发支持

状态：调研完成，方案待评审。本文档由 2026-09-15 的三路代码调研支撑，所有断言均带 file:line 出处。

> 注：调研基于 `d2f06ff` 快照；其后 PR #20 已将 `devflow-ocr-gate` 整包改名为 `devflow-review-gate`。文中旧包名与行号为调研当时的事实，实施均已落在改名后的包上。

## 1. 背景与目标

一个仓库里多张卡并行开发时，今天只有两种形态：多会话共用一个 checkout（一条分支，ocr-gate
range 模式互相污染，`packages/devflow-ocr-gate/README.md:93` 已把这一点写成 Known
Limitation），或者人工另开 checkout（devflow 完全不知情）。目标是让"每张卡一个 git
worktree、一条分支"成为 devflow 研发流程里有名字、有约定、有护栏的一等形态：

- 卡在 `developing` 期间的代码改动隔离在自己的 worktree/分支里；
- gate 命令、code review、检查 subagent 都在该 worktree 里执行，diff 只含这张卡的改动；
- 主 checkout 的看板不撒谎：能看出卡已被派往某个 worktree；
- 合并回 main 后，卡的状态与代码一起到达。

## 2. 调研关键结论

1. **root 是 seam 维度，永远等于 `join(<session cwd>, '.devflow')`**，在 9 个消费方各自
   restate（`packages/devflow-tool/src/index.ts:362-365` 等），且有已归档的裁决明确拒绝
   "向上找 git 祖先"和"seam 内做 workspace 解析"
   （`.agents/notes/implemented/feature/2026-08-26-devflow-root-follows-caller.md`）。
2. **`.devflow/` 的存储决策是"随 git 走"**：卡片与归档建议提交，`claim.json` 建议
   gitignore（`.agents/prd/2026-08-26-devflow-workspace-binding-and-chat-creation.md:61`），
   用户故事 14 就是"PR 同时携带代码与卡状态"。
3. **"卡的工作区"在四个包里都是 `dirname(attempt.root)`**：devflow-gates
   （src/index.ts:142）、devflow-ocr-gate（src/index.ts:303）、devflow-agent-gate
   （src/index.ts:150→:599 合成会话 cwd）、devflow-midscene（src/managed.ts:203）。
4. **linked worktree 在 git 层面对现有代码全部友好**：`--show-toplevel` 返回 worktree 自身
   （midscene identity.ts:12 的断言通过）、`--git-dir`/`git log`/`git diff` 全部正确；
   `git rev-parse --path-format=absolute --git-common-dir` + `dirname` 可从任意 worktree
   机械地得到主工作树（本仓库实测验证）。
5. **会话 cwd 是创建时冻结的身份**（`dsh-session` types.d.ts:69），harness 对 git/worktree
   零感知；`workspaceRegistry.resolveByPath` 是 realpath 精确匹配，新 worktree 一定是
   `PROJECT_NOT_REGISTERED`（automation/scheduler/github-sync 全部 19 个工具 + HTTP 面）。
6. **journal 是 append-only jsonl，`foldJournal` 要求 revision 从 1 连续**：同一张卡若在两个
   checkout 各自追加，合并即冲突，坏合并产生 fail-loud 的不可读卡——这既是红线，也是护栏。
7. **claim 租约是 `claim.json` 进程态**（建议 gitignore），不随分支旅行；lock/序列化都按
   root 隔离（devflow-filesystem，root-follows-caller note）。
8. ocr-gate 已把修法写在限制里："需要卡模型携带一个 range"；同时 dispatch.ts:125 存在一个
   自认的 restatement 缺陷：checker cwd 误传了 devflow root 而非其父目录。

## 3. 路线选择

**路线 B（集中板）**：worktree 只是代码沙箱，所有会话的 root 都解析回主 checkout 的
`.devflow`。需要 worktree 感知的 root 解析进入全部 9 个消费方、推翻 root-follows-caller
裁决、gates 增加 per-card workdir、共享 root 下多写者竞争 commit.lock，且救不了
automation（registry 是 realpath 精确匹配）。改动大、逆纹理，否决。

**路线 A（选定）——"板随分支走"**：worktree 就是一个完整 workspace，`.devflow` 作为已提交
内容随分支 checkout 到 worktree 里，卡的旅程沿着 git 拓扑走。这不是新发明——存储决策定稿
（随 git 走、PR 携带卡状态）已经选了 git 作为卡状态的同步机制，worktree 只是把该决策用到
并行开发上。选它的决定性理由：**核心循环今天就能跑通，零核心代码改动**——

- worktree 会话的 root 自然是 `<worktree>/.devflow`，board/tools/guidance/claim 全部照常；
- gate/review/checker 的工作目录 `dirname(root)` 自然就是 worktree；
- ocr-gate range 模式（baseRef=main）在"一卡一分支"下 merge-base 天然按分支隔离，
  Known Limitation 因拓扑消解，无需卡携带 range；
- root-follows-caller 裁决不需要推翻，一字不改。

## 4. 方案主体：生命周期约定（ceremony）

单卡旅程（standard 类）：

```
主 checkout 会话                          worktree 会话
────────────────────────                 ─────────────────────────
draft → designing → ready
attach worktree 派遣 artifact
git add .devflow/tasks/<id> && commit
git worktree add <path> -b devflow/<id>
        │                                devflow_take（claim + ready→developing）
        │  此后主侧对这张卡零写入            developing …（代码提交在分支上）
        │                                developing→reviewing（gate 在 worktree 跑
        │                                verify；ocr-gate range 审分支 diff）
        │                                reviewing→testing→done（卡状态提交在分支上）
merge PR（代码 + 卡状态一起到达 main）
git worktree remove / branch -d
（如需）对已合并卡做主板收尾/归档
```

核心不变量（本方案唯一的红线）：**派遣 artifact 提交进分支之后，同一张卡只允许它所在的
worktree 写，直到合并完成**。违反它的后果是 journal 合并冲突 + fail-loud 不可读卡（§2.6），
所以该不变量天然带检测器。

关键设计点：

- **派遣 artifact（`worktree` kind）**：frontmatter `{ branch, base, worktree }`，通过现有
  `devflow_attach_artifact` 内容形式写入，artifact-gate 以现有 `kinds` 配置声明结构
  （`packages/devflow-artifact-gate/src/index.ts:34-53`，纯配置，无新代码）。作用：
  (1) 主板诚实——卡停在 `ready` 但带派遣记录，看板可见"已派往 devflow/<id>"；
  (2) 挡重复领取——主 checkout 的第二个会话看到派遣记录就不会再 take；
  (3) 为将来 per-card review base 预留了 ocr-gate 点名的"卡携带 range"的落点。
  attach 在**建分支之前**完成并提交，分支携带它，主侧此后不再写这张卡。
- **claim 语义无损**：`claim.json` gitignore 不随分支走；worktree 里 `devflow_take` 正常
  建立本 root 的租约；跨 worktree 的抢卡由派遣 artifact + 流程约定挡住。
- **新卡只在主板建**：避免 worktree 各自从当前序号分配造成 seq 重复（id 含 slug 不会真冲突，
  但序号语义混乱）。运行手册明确。
- **worktree 位置**：主仓库树外（如 `../<repo>.worktrees/<card-id>`）或 gitignore 的
  `.worktree/`。必须满足 midscene 指纹（`ls-files --others --exclude-standard`）不把它算进
  主 workspace 的约束——树外或被 ignore 均可。
- **review 模式**：worktree 流程要求 ocr-gate 用 range 模式（分支必须提交才能合并，
  workspace 模式"developing 不提交"与之互斥）。运行手册写明配置要求。

## 5. 交付物

### Phase 0 —— 纯约定（无代码）
- 用户仓库 `.gitignore`：`.devflow/**/claim.json`、`.devflow/**/commit.lock`（本来就是
  文档化建议，worktree 流程把它变成前置条件）。
- ocr-gate 配置：目标边使用 range 模式，`baseRef` 指向主干。

### Phase 1 —— 一个新可选包 `devflow-worktree` + 一处缺陷修复
按 testenv 先例（判断力交付，不做执行器，`packages/devflow-testenv/src/index.ts:10-15`），
包内容：
1. **`devflow-worktree` skill（runbook）**：§4 的完整 ceremony——派遣（attach → commit →
   worktree add）、worktree 内开发与 gate 通行、合并回收（merge → worktree remove →
   branch -d）、禁止事项（跨侧写卡、worktree 内建新卡、派遣期间主侧归档）。现有
   devflow-workflow skill 对 git/分支/目录只字未提（assets/devflow-workflow.md 全文无
   git 词汇），这个空白正是本包的位置。
2. **worktree 围栏 gate（本包的 runtime invariant）**：`devflow/transition` waterfall 上的
   一个 validator——卡最新 `worktree` artifact 存在时，比较 `realpath(dirname(attempt.root))`
   与 artifact 的 `worktree` 值；不一致且当前 root 不是该仓库主工作树
   （`--git-common-dir` 判定）则 veto。把 §4 的红线从约定升级为机械护栏。读卡走
   `ctx.get('devflow')` + `read()`，waterfall 内只读不写（既有 gate 同款模式，
   devflow-gates/src/index.ts:210-212 的死锁禁令仅针对写）。
3. **artifact-gate 配置示例**：声明 `worktree` kind 结构（bundle patch 注释里给样例，默认
   不强制任何边）。
4. **缺陷修复（顺手，独立提交）**：ocr-gate dispatch.ts:125 checker cwd 传 root 而非
   `dirname(root)`——其自身文档已声明"与 agent-gate 原件不一致即本拷贝缺陷"。
5. **文档**：docs/devflow.md 增 worktree 开发一节；README（双语，遵守 pairing 规则）；
   Agent Note 记录路线选择与"root-follows-caller 无需推翻"的论证。

七处注册清单（new-package-registrations spec）照办；测试按本线标准：per-file 100% 覆盖 +
真组合测试（两个 root 模拟主/worktree 双板，驱动围栏 gate 的 allow/veto 两路径，
devflow-tool/tests/loader-composition.spec.ts:933-990 的双 workspace 形状是现成模板）。

### Phase 2 —— 各自等到有真实消费者再做（明确不进 v1）
- **per-card review base**：仅当"一分支多卡"回潮才需要；落点已留（派遣 artifact 的 `base`
  字段 + ocr-gate index.ts:303/:308 两行）。
- **midscene worktree 验收**：三处 realpath 相等围栏（managed.ts:25-38/:202-205/:213-215）
  把验收钉死在配置的 canonical workspace。v1 明确声明：Web 验收在合并后的主 workspace 做
  （与今天 e2e/README.md 的复验卡模式一致）。
- **automation/scheduler/github-sync 在 worktree 会话不可用**（PROJECT_NOT_REGISTERED）：
  与既有裁决一致（"同 remote 的 worktree 不自动合并"，
  .agents/prd/2026-09-14-project-automation-tabs.md:11）。这些是后台摄入面，不在开发内循环，
  v1 文档声明即可。
- **board 的"已派遣"视觉标记**：v1 靠 artifact 记录可见；UI 徽标待 board 有此需求再做。

## 6. 风险与开放问题

1. **`.devflow` 未提交的部署**：worktree 会得到一块静默的空板，首个 `devflow_create` 会物化
   从 0001 编号的第二块板（devflow-filesystem :1424-1433 静默吞 ENOENT）。v1 把"卡片已提交"
   写为 worktree 流程的前置条件；是否给 guidance 加"linked worktree 无板"提示留待有真实
   踩坑再议。
2. **围栏 gate 的主工作树判定**引入一次 `git rev-parse` 子进程调用，仅发生在带派遣 artifact
   的卡的 transition 上（低频路径），可按 root 缓存。
3. **合并后派遣 artifact 指向已删除的 worktree**：围栏放行主工作树侧写入，故不构成阻塞；
   运行手册的收尾一步可选择 attach 一条回收记录（结构同 kind，`worktree: released`）。
4. **express/emergency 类**：捷径边（draft→developing、developing→done）同样适用本 ceremony，
   emergency 卡通常不值得开 worktree——运行手册按类给建议，不做机制限制。

## 7. 与既有裁决的关系

- root-follows-caller（2026-08-26）：**不推翻，不修改**。本方案没有任何 git 感知的 root
  解析；worktree 是一个普通 workspace，恰好是该裁决设计出的形态。
- harness-owned-workflow-execution（2026-08-29）：无新执行器；worktree 会话依然是唯一的
  workflow 执行者，skill 只交付判断力。
- testenv-retreats-to-runbook-skill（2026-09-11）：worktree 的创建/删除由 agent 在 runbook
  指导下用 shell 完成，插件不持有目录生命周期——本线"没有插件替调用方创建目录"的先例得以
  保持。
