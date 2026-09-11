# Agent Reach Channel Dispatch Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for bounded delegated tasks and reviews. Keep existing uncommitted work; do not commit or alter unrelated files.

**Goal:** Unified channel dispatch with a skill-owned mail collection facade and unchanged legacy workflows.
**Architecture:** Controlled routing registry, evaluate/resolve/dispatch plan state, fixed workflow executors; mail owns provider selection. Legacy commands preserve arguments and result shapes.
**Tech Stack:** Node.js builtins, existing collection state/artifact writer, Python mail runtime.
**Spec:** docs/superpowers/specs/2026-09-11-agent-reach-channel-dispatch-design.md

## Global Constraints
- agent-reach → mail → provider → backend; no mailbox provider names in top-level routing.
- No database changes, no Dockerfile.byclaw changes, no deployment or commits.
- Preserve legacy scope defaults, public-collect run owner, enterprise output paths, stdout/exit codes.
- Existing edited files belong to earlier authorized work; do not discard them.

## Task 1: mail facade
Files: mail/scripts/collection-facade.mjs and tests (mail-owned helpers allowed).
Expose describeCapabilities(context,selector), execute(request,context,deps) for discover/materialize, safe generic envelope, frozen candidate refs and source/account binding. Mail context contains explicit account bindings from collection session; support projected mail accounts and iwhalecloud browser through current entrypoints. Browser remains context-only and cannot transparently resume materialization after interruption.
- [x] Write tests for missing binding, provider resolution, bounded discovery, full-text mapping, attachment partial status, candidate revision/identity checks.
- [x] Implement and run tests.

## Task 2: router and fixed workflow facades
Files: knowledge-collection/scripts/routing/{channels,dispatcher,plan-store,mail-workflow}.mjs and tests.
Expose evaluateRoute(request,session), resolveRoute(paths,request), dispatchRoute(paths,planId,dependencies). Registry has only public-internet/dingtalk/feishu/wecom/ima/cloud-knowledge/mail, no mailbox providers. Plans are session-local .routing, actor/context/query scope bound, immutable request fingerprint and persisted deadline, independent route lock, no session publication lock across remote call. Route results reuse committed receipts, never reexecute unknown running records. Existing workflows delegated via internal functions, not recursive CLI.
- [x] Establish old test baseline.
- [x] Test no-write evaluate, source scope denial, stale session/selector, unknown channels, duplicate requests, deadline persistence, plan state replay, safe diagnostics.
- [x] Implement plan store and dispatcher; run tests.

## Task 3: CLI, source scope, artifacts and skill routing
Files: knowledge-collection.mjs, command-router.mjs, research-state.mjs, collection-state.mjs, routing/mail-workflow.mjs, SKILL.md, references/agent-reach.md, references/manifest.json, references/sources/public-internet.md.
Add route-evaluate/route-resolve/route-dispatch request-file interfaces. Add explicit mail scope and binding at init; no mail in defaults or enterprise search-all. Mail workflow publishes through existing artifact writer with final authorization channel from trusted plan; errors commit failed bundle. Preserve source/backend provenance, old aliases, default workflow dispatches. Existing commands validate through shared registry without changing their arguments/results.
- [x] Add CLI/schema and integrated mail discover/materialize tests with fake executors.
- [x] Implement references only after runnable routes exist.
- [x] Run baseline suites and new tests; fix regressions.

## Task 4: review and final verification
- [x] Review combined diff against approved design, repair actionable problems.
- [x] Verify source defaults, resume ownership, candidate binding, file containment, no provider coupling.
- [x] Report results and limitations; no production actions.

## Preflight ledger
| Pair | Interface consistency |
| --- | --- |
| 1 / 2 | mail-owned describeCapabilities and execute behind fixed imported facade; provider selector never inspected in router |
| 2 / 3 | trusted session.task scope and mailBindings feed plan; .routing writes are separate from bundle publication |
| 1 / 3 | discovery candidates persist in facade receipt; artifact writer consumes safe items and sourceSkill=mail |
| Tasks 1–4 | Tests exercise own delivered contracts; legacy baseline failures recorded separately |

Ruling: Work in the existing shared checkout without creating a new worktree because the approved mail implementation is uncommitted and is required input; preserve all unrelated edits. Cost if wrong: local changes must be separated before committing.


## 实施与复审结果（2026-09-11）

- 已实现 channels 固定注册、evaluate/resolve/dispatch/status、会话预算、候选授权、原子计划、执行进程中断识别、产物 receipt 校验。
- mail 自有 facade 支持浏览器邮箱与投影账号；未知能力在远程执行前拒绝。账号绑定和 provider 选择不进入顶层路由。
- discovery/物化/附件/发布形成现有 collection bundle；按账号与操作保留真实失败，附件完成度独立随 inventory 更新。正文作为不可信文本保存，附件通过受控文件记录交付。
- 旧公网、企业、联合及 site-crawl 命令通过注册来源保留原工作流；原 limit、默认来源集合、恢复所有者不改变。旧工作流 usage=unknown，不接受无法执行的严格新预算。新 JSON resource 尚无授权引用契约，因此明确拒绝；原 resource/search-all 入口继续可用。
- 投影附件新增仅 attachment 适用的受控 collection-session 参数，兼容 collections 与 .collection-runs；草稿输入路径规则保持原样。
- 多轮独立复审已修复：企业 discover 错误参数、list-only 能力误判、退出进程永久 running、任务预算重置、多账号失败覆盖，以及附件-only discovery partial 无法消除的问题。最后一轮无阻塞发现。

### 验证证据

- 新路由：dispatcher 9 项 + integration 13 项通过；integration 包含实际产物 writer、publish、附件缺失/篡改、双账号部分失败、任务预算及中断状态。
- mail Node：33 项通过；mail Python：175 项通过。
- agent-reach 文档 11 项、knowledge-collection 文档 62 项通过。
- 既有 knowledge-collection、public-collect、unified-search、collection-state、enterprise dispatcher/CLI、IMA、cloud-knowledge、publish-delivery、delivery-state 测试族全部通过。sourceScope schema 断言仅新增 mail，默认集合保持原值。
- CLI 实测 init → evaluate（不创建 .routing）→ resolve → status 通过，无远程来源访问。
- git diff --check 通过。
- 本轮未运行镜像构建、生产部署或真实邮箱读写；未提交设计文档和代码。原 mailbox migration 所在 V0.5.0 与 Dockerfile.byclaw 边界保持用户要求。
