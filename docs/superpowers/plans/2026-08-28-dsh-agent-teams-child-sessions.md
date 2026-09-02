# DSH AgentTeams Child Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist DSH AgentTeams members as real ByClaw child sessions, keep child activity out of the parent transcript, and provide parent/child navigation plus a durable AgentTeams activity panel.

**Architecture:** `byclaw-integration` marks every projected event with a parent/child/team scope while keeping the outer Framework stream session equal to the active ByClaw parent session. The BE intercepts child/team events before normal request-context routing, maps DSH session IDs to `byai_session` children through `byai_session_ext`, persists each child transcript independently, and enriches team snapshots with ByClaw child IDs. The FE reuses the existing chat page, adds hierarchy navigation to `ChatTitle`, and renders AgentTeams snapshots through a dedicated card and drawer.

**Tech Stack:** TypeScript/Node.js, DeepSeek Harness plugin APIs, Java 21/Spring Boot/MyBatis/Redis, React/Umi Max/Ant Design/Less/Jest, Maven, pnpm, Playwright browser automation.

**Spec:** `docs/superpowers/specs/2026-08-28-dsh-agent-teams-child-sessions-design.md`

## Global Constraints

- Do not modify DeepSeek Harness core packages.
- Do not add a database migration; reuse `byai_session.parent_session_id` and `byai_session_ext`.
- Keep `/Users/chenxiaofeng/code/open/deepseek-harness/.env` as the DSH environment source.
- Do not change the configured remote `BYCLAW_DSH_BASE_URL` to a local URL.
- Child sessions are not top-level sidebar sessions.
- Historical AgentTeams state must come from ByClaw-persisted snapshots, not FE polling of DSH.
- Preserve unrelated dirty-worktree changes in all three repositories.
- Never stage or commit secrets, generated credentials, `.env` contents, `.agent-teams/`, or `.cursor/`.

---

### Task 1: Scope DSH projections and stop forwarding child output into the parent stream

**Files:**
- Modify: `/Users/chenxiaofeng/code/open/byclaw-dsh/plugins/byclaw-integration/src/byclaw-presentation.ts`
- Modify: `/Users/chenxiaofeng/code/open/byclaw-dsh/plugins/byclaw-integration/src/session-runtime.ts`
- Modify: `/Users/chenxiaofeng/code/open/byclaw-dsh/plugins/byclaw-integration/scripts/presentation-verify.mjs`
- Modify: `/Users/chenxiaofeng/code/open/byclaw-dsh/plugins/byclaw-integration/scripts/live-e2e.mjs`

**Interfaces:**
- Produces: `DshProjectionScope = 'parent' | 'child' | 'team'`.
- Produces metadata fields `dsh_scope`, `root_dsh_session_id`, `external_parent_session_id`, `dsh_status`, `child_name`, `child_task`, and the existing DSH identity fields.
- Preserves the outer `GatewayDataEmitter.emitChunk(parentByClawSessionId, ...)` session so BE can receive the event on the active Framework stream.

- [ ] **Step 1: Add failing projection assertions**

Add assertions equivalent to:

```javascript
assert.equal(childOutput.options.eventType, EventType.ANSWER_DELTA)
assert.equal(childOutput.options.metadata.dsh_scope, 'child')
assert.equal(parentReasoning.options.metadata.dsh_scope, 'parent')
assert.equal(teamSnapshot.options.metadata.dsh_scope, 'team')
assert.equal(teamSnapshotContent.schemaVersion, 2)
```

- [ ] **Step 2: Run the plugin verification and observe the expected failure**

Run:

```bash
cd /Users/chenxiaofeng/code/open/byclaw-dsh/plugins/byclaw-integration
pnpm run verify
```

Expected: the new scope/schema assertions fail because current metadata has no `dsh_scope` and child output still uses `REASONING_LOG_DELTA`.

- [ ] **Step 3: Add scope to the projection context**

Use the concrete interface:

```typescript
export type DshProjectionScope = 'parent' | 'child' | 'team'

export interface DshProjectionContext {
  sessionId: string
  parentSessionId?: string
  rootSessionId: string
  externalParentSessionId: string
  scope: DshProjectionScope
  depth: number
  sequence: number | string
  eventKind: DshSessionEventKind
  status?: DshSessionStatus
  childName?: string
  childTask?: string
  parentMessageId: string
  messageIdPrefix?: string
}
```

`metadata(context)` must serialize the exact snake-case field names consumed by BE.

- [ ] **Step 4: Route child output as a child answer**

Change `childOutputProjection()` to use `EventType.ANSWER_DELTA`. In `emitSessionEvent()`, derive `scope` from `session.id === turn.rootSessionId`, pass the root/external parent IDs and child presentation, and keep all child events out of the root visible projection path.

- [ ] **Step 5: Upgrade team snapshots**

Set `schemaVersion: 2`, use `scope: 'team'`, and retain complete `members`, `tasks`, `messageCount`, and `captainInbox` data. Ensure a non-empty or archived snapshot is not suppressed by an earlier empty snapshot ID.

- [ ] **Step 6: Run plugin verification**

Run `pnpm run verify` again. Expected: all plugin checks pass.

- [ ] **Step 7: Commit the plugin task**

Stage only the four listed files and commit in the `byclaw-dsh` repository:

```bash
git commit -m "feat: scope ByClaw AgentTeams session events"
```

### Task 2: Create durable DSH child-session mappings in BE

**Files:**
- Create: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/model/DshChildSessionBinding.java`
- Create: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/DshChildSessionService.java`
- Create: `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/chat/service/DshChildSessionServiceTest.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/session/service/SessionExtService.java`

**Interfaces:**
- Produces: `DshChildSessionBinding ensureBinding(Long parentSessionId, JSONObject metadata)`.
- Produces: `Optional<DshChildSessionBinding> findBinding(Long parentSessionId, String dshSessionId)`.
- Produces: `void updateFromTeamMember(DshChildSessionBinding binding, JSONObject member)`.
- Mapping key: `(parentSessionId, dshSessionId)`.

- [ ] **Step 1: Write failing mapping tests**

Cover:

```java
assertThat(service.ensureBinding(100L, childMetadata()).session().getParentSessionId()).isEqualTo(100L);
assertThat(service.ensureBinding(100L, childMetadata()).session().getSessionId()).isEqualTo(200L);
verify(sessionService, times(1)).save(any(ByaiSession.class));
```

Also verify duplicate events return the same binding, parent ownership fields are copied, different parents do not share a mapping, and blank DSH IDs are rejected.

- [ ] **Step 2: Run the focused test and observe failure**

Run:

```bash
mvn -B -f byclaw-be/pom.xml -Dtest=DshChildSessionServiceTest test
```

Expected: compilation failure because the service and binding do not exist.

- [ ] **Step 3: Add an exact parent-scoped ext lookup**

Add a method to `SessionExtService` that retrieves `dsh_session_id` candidates and filters them by `ByaiSession.parentSessionId`. Do not use the existing globally-scoped `selectByParamCodeAndValue()` as the final identity check.

- [ ] **Step 4: Implement binding creation**

`ensureBinding()` must:

1. validate the parent session and DSH ID;
2. query the existing parent-scoped mapping;
3. serialize first creation by mapping key and re-query;
4. allocate child session and message IDs with `SequenceService`;
5. copy parent creator, enterprise, project, object and session fields;
6. save `dsh_session_id`, `dsh_root_session_id`, `dsh_team_id`, member name/role/status and `dsh_message_id` ext records;
7. return the child session plus stable response message ID.

- [ ] **Step 5: Run the mapping tests**

Expected: `DshChildSessionServiceTest` passes.

- [ ] **Step 6: Commit the mapping task**

```bash
git commit -m "feat: persist DSH child session mappings"
```

Stage only files in this task plus any directly required test fixture.

### Task 3: Persist child event streams independently and enrich team snapshots

**Files:**
- Create: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/DshChildSessionEventService.java`
- Create: `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/chat/service/DshChildSessionEventServiceTest.java`
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/state/domain/chat/service/SessionStreamEventRouter.java`
- Modify: `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/chat/service/SessionStreamEventRouterTest.java`

**Interfaces:**
- Produces: `boolean isChildEvent(JSONObject event)`.
- Produces: `boolean isTeamSnapshot(JSONObject event)`.
- Produces: `StreamDispatchResult dispatchChild(JSONObject event)`.
- Produces: `void enrichTeamSnapshot(JSONObject event)`.

- [ ] **Step 1: Write failing child-stream tests**

Test a sequence containing child reasoning, tool start/result, answer and completed status. Assert the generated `ByaiMessageHotDto` uses the child session ID and stable child message ID, while no call reaches the parent `PythonSseService` request context.

Add duplicate-sequence coverage and a restart-style test that hydrates the previous `messageStruct`/`inferLog` before applying the next event.

- [ ] **Step 2: Run focused tests and observe failure**

Run:

```bash
mvn -B -f byclaw-be/pom.xml \
  -Dtest=DshChildSessionEventServiceTest,SessionStreamEventRouterTest test
```

- [ ] **Step 3: Implement child aggregation**

For each binding:

```java
MessageContext context = hydrateOrCreate(binding);
pythonSseService.accumulateEvent(line(eventType, data), context);
context.setMsgStatus(terminal ? 0 : 1);
context.setComplete(terminal);
ByaiMessageHotDtoDto message = memoryMessageService.generateMessage(
    binding.session().getSessionId(),
    ChatUseageEnum.SYSTEM_RESPONSE.getCode(),
    context,
    assistantChatDto(binding)
);
message.setComplete(terminal);
byaiMessageHotService.updateSelective(message);
```

Temporarily install a `LoginInfo` derived from the parent session around message generation, then restore the previous holder in `finally`.

- [ ] **Step 4: Add logical-event deduplication**

Use the exact key:

```text
dsh-child-event:{parentSessionId}:{dshSessionId}:{dshSequence}:{dshEvent}
```

Mark it only after a successful message upsert. Duplicate logical events return handled without changing the message.

- [ ] **Step 5: Enrich team snapshots**

Parse `data.choices[0].delta.content`; for every member with a nonblank DSH session ID, ensure/update the binding and write `byclawSessionId` into that member. Re-serialize the snapshot before it enters normal parent aggregation.

- [ ] **Step 6: Route child/team events before ordinary context recovery**

At the top of `SessionStreamEventRouter.dispatch()`:

```java
if (dshChildSessionEventService.isChildEvent(dataJson)) {
    return dshChildSessionEventService.dispatchChild(dataJson);
}
if (dshChildSessionEventService.isTeamSnapshot(dataJson)) {
    dshChildSessionEventService.enrichTeamSnapshot(dataJson);
}
```

Parent and unrelated events continue through the unchanged normal flow.

- [ ] **Step 7: Run focused tests**

Expected: both test classes pass.

- [ ] **Step 8: Commit the event-routing task**

```bash
git commit -m "feat: route DSH events into child sessions"
```

### Task 4: Expose parent-scoped child sessions without polluting root lists

**Files:**
- Modify: `byclaw-be/src/main/java/com/iwhalecloud/byai/manager/qo/session/ByaiSessionQo.java`
- Modify: `byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/session/ByaiSessionMapper.xml`
- Modify: `byclaw-be/src/test/java/com/iwhalecloud/byai/state/domain/session/service/SessionServiceTest.java`
- Modify: `byclaw-fe/src/service/layout.ts`
- Modify: `byclaw-fe/src/service/__tests__/layout.test.ts`

**Interfaces:**
- Adds query fields `Long sessionId` and `Long parentSessionId`.
- Existing `/byaiService/assiman/qryConversations` supports exact session recovery and parent-scoped child queries.

- [ ] **Step 1: Add failing mapper/service query tests**

Assert SQL/query behavior:

- exact `sessionId` bypasses the root-only predicate;
- `parentSessionId` returns only direct children;
- ordinary queries include `parent_session_id IS NULL OR parent_session_id <= 0`.

- [ ] **Step 2: Implement query selection**

Apply mutually exclusive predicates in this order:

```text
sessionId present      -> a.session_id = ?
parentSessionId present -> a.parent_session_id = ?
otherwise              -> root-only predicate
```

Keep creator and enterprise constraints in every branch.

- [ ] **Step 3: Add typed FE service helpers**

```typescript
export const getSessionById = (sessionId: string) =>
  qryConversations({ sessionId, pageNum: 1, pageSize: 1 });

export const getChildSessions = (parentSessionId: string) =>
  qryConversations({ parentSessionId, pageNum: 1, pageSize: 100 });
```

- [ ] **Step 4: Run BE and FE focused tests**

Run Maven focused tests and:

```bash
cd byclaw-fe
pnpm test -- --runInBand src/service/__tests__/layout.test.ts
```

- [ ] **Step 5: Commit the query task**

```bash
git commit -m "feat: query DSH child conversations"
```

### Task 5: Add reusable parent/child navigation to the chat title

**Files:**
- Create: `byclaw-fe/src/components/ChatLayoutComp/AgentTeamsSessionNav.tsx`
- Create: `byclaw-fe/src/components/ChatLayoutComp/AgentTeamsSessionNav.module.less`
- Create: `byclaw-fe/src/components/ChatLayoutComp/__tests__/AgentTeamsSessionNav.test.tsx`
- Modify: `byclaw-fe/src/components/ChatLayoutComp/ChatTitle.tsx`
- Modify: `byclaw-fe/src/components/ChatLayoutComp/index.tsx`
- Modify: `byclaw-fe/src/components/ChatLayoutComp/index.module.less`
- Modify: `byclaw-fe/src/typescript/session.d.ts`

**Interfaces:**
- Produces `openSession(session: ISession): void` inside the navigation component.
- Consumes `getSessionById()` and `getChildSessions()`.

- [ ] **Step 1: Write failing navigation tests**

Cover parent count/menu, child breadcrumb, loading failure/retry, opening a child, returning to parent, and no rendering for ordinary sessions without children.

- [ ] **Step 2: Run the test and observe failure**

```bash
cd byclaw-fe
pnpm test -- --runInBand src/components/ChatLayoutComp/__tests__/AgentTeamsSessionNav.test.tsx
```

- [ ] **Step 3: Implement session recovery and navigation**

When the current `sessionId` is missing from Redux, recover it through `getSessionById()` and add/update it in the session model. For a parent, load direct children. For a child, recover its parent. Opening a session must update the session cache before calling `setSessionId()`.

- [ ] **Step 4: Render title hierarchy**

Parents show `N 个子代理`; children show a clickable parent name followed by the member name. Child rows show name, role, status and unread count from `sessionExts`.

- [ ] **Step 5: Make DSH child sessions read-only**

In `ChatLayoutComp`, detect the `dsh_session_id` ext on a session with `parentSessionId > 0`, include it in `effectiveReadOnly`, and render a notice telling the user to return to the parent session to issue new team tasks.

- [ ] **Step 6: Run navigation tests and lint the touched files**

Expected: tests and non-mutating JS/style/prettier checks pass for the touched paths.

- [ ] **Step 7: Commit the navigation task**

```bash
git commit -m "feat: navigate AgentTeams child sessions"
```

### Task 6: Render AgentTeams cards and the activity panel

**Files:**
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/types.ts`
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/model.ts`
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/AgentTeamsCard.tsx`
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/AgentTeamsCard.module.less`
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/ActivityPanel.tsx`
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/ActivityPanel.module.less`
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/AgentTeamsCard.test.tsx`
- Create: `byclaw-fe/src/components/MessagesComp/AgentTeams/model.test.ts`
- Modify: `byclaw-fe/src/components/MessagesComp/ToolCall/index.tsx`

**Interfaces:**
- Produces `isAgentTeamsSnapshot(value: unknown): value is AgentTeamsSnapshot`.
- Produces `AgentTeamsCard({ snapshot }: { snapshot: AgentTeamsSnapshot })`.
- Consumes member `byclawSessionId` enriched by BE.

- [ ] **Step 1: Write failing model and rendering tests**

Cover schema detection, progress counts, failure/cancel status, card summary, panel opening, all panel sections, member navigation, and fallback rendering for ordinary tool calls.

- [ ] **Step 2: Run focused tests and observe failure**

```bash
cd byclaw-fe
pnpm test -- --runInBand \
  src/components/MessagesComp/AgentTeams/model.test.ts \
  src/components/MessagesComp/AgentTeams/AgentTeamsCard.test.tsx
```

- [ ] **Step 3: Implement pure snapshot projections**

Keep all task/member status calculations in `model.ts`; React components consume already-derived totals and labels. Treat failed/cancelled separately from completed.

- [ ] **Step 4: Implement card and panel**

The card shows team name, member count, completed/total tasks, status, member shortcuts and an “活动面板” button. The Ant Design drawer shows team overview, captain dispatch relation, total progress, member rows and task dependencies. Member navigation uses the same session-cache/update sequence as title navigation.

- [ ] **Step 5: Branch the 3015 renderer safely**

Refactor the existing standard tool UI into a child component, then make the exported wrapper choose AgentTeams only when `eventKind === 'agent-teams/snapshot'` and `schemaVersion >= 1`. Do not call hooks conditionally in a component whose branch can change.

- [ ] **Step 6: Run focused tests and FE verification**

Run focused tests, `pnpm run lint:js`, `pnpm run lint:style:check`, `pnpm run lint:prettier`, and the relevant build/type check.

- [ ] **Step 7: Commit the activity-panel task**

```bash
git commit -m "feat: add AgentTeams activity panel"
```

### Task 7: Synchronize the plugin and run automated verification

**Files:**
- Synchronize the changed `byclaw-integration` source/scripts into `/Users/chenxiaofeng/code/open/deepseek-harness/plugins/byclaw-integration`.
- Do not modify `/Users/chenxiaofeng/code/open/deepseek-harness/.env` unless a discovered build requirement is unrelated to `BYCLAW_DSH_BASE_URL` and contains no secret.

- [ ] **Step 1: Compare both plugin trees**

Use `git status`, `git diff --no-index`, and explicit file lists. Preserve unrelated local changes.

- [ ] **Step 2: Apply the same patch to the DSH source plugin**

Use `apply_patch` or a verified formatting/build copy for only the files from Task 1.

- [ ] **Step 3: Verify both plugin copies**

Run `pnpm run verify` in both copies and compare the modified files byte-for-byte.

- [ ] **Step 4: Run BE focused and full verification**

First run the new/modified test classes, then:

```bash
mvn -B -f byclaw-be/pom.xml verify
```

Record unrelated baseline failures separately; do not hide them.

- [ ] **Step 5: Run FE tests, lint and build**

Run the touched tests, non-mutating lint commands, and `pnpm run build`.

### Task 8: Execute the real BE/FE/DSH end-to-end test

**Files/Runtime:**
- BE/FE environment: `/Users/chenxiaofeng/code/open/ByClaw/envs/229/.env`
- DSH environment: `/Users/chenxiaofeng/code/open/deepseek-harness/.env`
- JDK: `/Users/chenxiaofeng/software/jdk-21.0.9.jdk/Contents/Home`

- [ ] **Step 1: Restart services from verified sources**

Stop only the task-owned BE/FE/DSH processes, restart them with their required environment sources, and verify health/ports without printing secret values.

- [ ] **Step 2: Confirm routing prerequisites**

Verify `ENABLE_DSH=1`, `BYCLAW_DSH_<userCode>` online, and the DSH process still uses the configured remote `BYCLAW_DSH_BASE_URL`.

- [ ] **Step 3: Create a fresh project conversation**

In 《测试研发项目》 send:

```text
@ByClaw研发专家团：让成员分别做下自我介绍
```

- [ ] **Step 4: Verify parent behavior**

Assert the parent shows four child agents, the AgentTeams card/panel, correct progress and final captain summary, while child reasoning/tools/output do not appear in the parent message tree.

- [ ] **Step 5: Verify every child session**

Open all four children through the header/card/panel. Assert each transcript contains only that member's output/reasoning/tools, is read-only after completion, and can return to the parent.

- [ ] **Step 6: Verify persistence and recovery**

Refresh the browser, reopen the parent and children, then restart BE/DSH if safe. Confirm the hierarchy, transcripts and archived panel remain correct and no unsupported message appears.

- [ ] **Step 7: Collect final evidence**

Capture test/build outputs, relevant non-secret log lines, session IDs, screenshots, Git statuses, remaining baseline failures and any non-committed runtime artifacts.
