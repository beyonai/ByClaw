# Connector Authorization Soft-Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve connector skills for intent recognition while making the `byai-channel` hook tell the agent to return the ByClaw unavailable-connector guidance before any tool call, correcting false cross-agent hints, adding diagnostic logs, and verifying Langfuse parent propagation.

**Architecture:** Remove the request-scoped connector `skillFilter` bridge entirely and keep `authConnectorList` only as prompt and observability state. Strengthen the connector prompt into a highest-priority pre-tool decision protocol, narrow cross-agent detection to explicit handoff/review intent, and log policy activity without blocking tools. Preserve the enabled `baiying_call` path and expose a testable Langfuse envelope builder for downstream callAgent metadata.

**Tech Stack:** TypeScript, OpenClaw plugin hooks, Vitest, esbuild, Node.js, Redis-backed ByAI channel gateway, Langfuse/OTel diagnostics.

## Global Constraints

- Connector skills remain visible regardless of authorization state; no connector-derived `skillFilter` is applied.
- Enforcement is prompt-based soft control only; no `before_tool_call` block result and no global tool-policy mutation.
- A disabled-connector intent must be answered with localized ByClaw connection guidance before `memory_search`, `baiying_call`, `byclaw_chat_context`, or any retry.
- Enabled connectors and unrelated tool use remain available.
- Logs include connector and trace correlation identifiers but never credentials, private parameters, full tool payloads, or user content.
- Runtime credentials supplied for local verification remain process-local and are never written to repository files.

---

## File Map

- Modify `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts`: remove connector skill-filter resolution and emit request policy logs.
- Modify `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.test.ts`: prove dispatch no longer receives a connector-derived `skillFilter`.
- Modify `byclaw-exe/extensions/byai-channel/src/connector-authorization.ts`: strengthen localized soft-control prompt and add pure policy-summary helpers.
- Modify `byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts`: cover prompt precedence and safe log summaries.
- Modify `byclaw-exe/extensions/byai-channel/src/chat-context-prompt.ts`: require explicit cross-agent handoff/reference intent.
- Modify `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts`: reproduce the ordinary `@钉钉个人助手` false positive and retain explicit handoff coverage.
- Modify `byclaw-exe/extensions/byai-channel/src/hooks.ts`: add diagnostic-only tool-call policy warnings and concise prompt-injection logs.
- Modify `byclaw-exe/extensions/baiying-enhance/src/register-plugin.ts`: stop registering the obsolete connector skill-filter provider.
- Delete `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.ts` and `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts`.
- Delete `byclaw-exe/extensions/shared/src/connector-skill-filter-runtime.ts` and remove its export from `byclaw-exe/extensions/shared/src/index.ts`.
- Modify `byclaw-exe/extensions/shared/src/call-agent.ts`: extract a pure Langfuse envelope builder used by the real callAgent dispatch.
- Create `byclaw-exe/extensions/baiying-enhance/src/executor/call-agent-langfuse.test.ts`: verify canonical and compatibility parent/trace/session aliases.
- Create `byclaw-exe/extensions/baiying-enhance/src/resource-metadata-context.test.ts`: characterize `baiying_call` resource-context parent propagation.

---

### Task 1: Remove connector-derived skill filtering

**Files:**
- Modify: `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/register-plugin.ts`
- Modify: `byclaw-exe/extensions/shared/src/index.ts`
- Delete: `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.ts`
- Delete: `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts`
- Delete: `byclaw-exe/extensions/shared/src/connector-skill-filter-runtime.ts`

**Interfaces:**
- Consumes: `message.authConnectorList` remains available on `ActiveSdkRequest` for prompt and logs.
- Produces: every `dispatchReplyFromConfig` call receives normal OpenClaw skill resolution with no connector-specific `replyOptions.skillFilter`.

- [ ] **Step 1: Change the delivery regression expectation first**

In `sdk-message-processor.test.ts`, remove the shared resolver setup and require both initial and overflow-continuation dispatches to omit the filter:

```typescript
expect(skillFilters).toEqual([undefined, undefined]);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd byclaw-exe/extensions/byai-channel
npx vitest run src/sdk-message-processor.test.ts
```

Expected: FAIL because the current implementation still passes `['dws', 'ordinary-skill']` into both dispatches.

- [ ] **Step 3: Remove the dispatch filter path**

In `sdk-message-processor.ts`:

- remove the `resolveConnectorSkillFilter` import;
- remove `ConnectorSkillFilterDispatchResolver` and `resolveConnectorSkillFilterForDispatch`;
- remove the pre-dispatch resolver call;
- remove the conditional `skillFilter` property from `replyOptions`.

The final options construction must retain the unrelated options:

```typescript
replyOptions: {
  ...replyOptions,
  abortSignal: deps.abortController?.signal,
  disableBlockStreaming: true,
  // existing callbacks remain unchanged
}
```

- [ ] **Step 4: Remove the obsolete provider and shared bridge**

Remove `registerConnectorSkillFilterProvider(api)` and its import from `baiying-enhance/src/register-plugin.ts`. Remove the shared export, then delete the provider, its tests, and the shared global resolver file. Confirm no references remain:

```bash
rg -n "connector-skill-filter-runtime|resolveConnectorSkillFilterForDispatch|registerConnectorSkillFilterProvider" \
  byclaw-exe/extensions/byai-channel byclaw-exe/extensions/baiying-enhance byclaw-exe/extensions/shared
```

Expected: no matches.

- [ ] **Step 5: Verify GREEN and builds**

```bash
cd byclaw-exe/extensions/byai-channel
npx vitest run src/sdk-message-processor.test.ts
npm run build
cd ../baiying-enhance
npm run build
cd ../shared
npm run typecheck
```

Expected: the focused test and all three compile/build checks pass.

- [ ] **Step 6: Commit**

```bash
git add byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts \
  byclaw-exe/extensions/byai-channel/src/sdk-message-processor.test.ts \
  byclaw-exe/extensions/baiying-enhance/src/register-plugin.ts \
  byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.ts \
  byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts \
  byclaw-exe/extensions/shared/src/index.ts \
  byclaw-exe/extensions/shared/src/connector-skill-filter-runtime.ts
git commit -m "fix(byclaw-exe): preserve connector skills for intent recognition"
```

---

### Task 2: Strengthen the connector hook prompt

**Files:**
- Modify: `byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/connector-authorization.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts`

**Interfaces:**
- Consumes: `buildDisabledConnectorPrompt(language, authorization)`.
- Produces: localized system context that orders intent checking before every tool and immediately ends disabled-connector turns with ByClaw guidance.

- [ ] **Step 1: Add failing Chinese and English behavior assertions**

Add assertions that the generated prompt contains all of these semantic requirements:

```typescript
expect(chinese).toContain("调用任何工具之前");
expect(chinese).toContain("不要调用任何工具");
expect(chinese).toContain("不要搜索记忆或聊天室历史");
expect(chinese).toContain("不要重试");
expect(chinese).toContain("立即回复用户");
expect(chinese).toContain("如果用户当前意图不需要上述未启用连接器");

expect(english).toContain("Before calling any tool");
expect(english).toContain("do not call any tool");
expect(english).toContain("do not search memory or chat history");
expect(english).toContain("do not retry");
expect(english).toContain("reply to the user immediately");
```

In the snapshot test, assert that connector policy appears after chat-context guidance so the last applicable policy is the connector decision protocol.

- [ ] **Step 2: Run tests and verify RED**

```bash
cd byclaw-exe/extensions/byai-channel
npx vitest run src/connector-authorization.test.ts src/prompt-injection-snapshot.test.ts
```

Expected: FAIL because the current prompt only forbids the connector skill and does not establish the full pre-tool protocol.

- [ ] **Step 3: Implement the localized protocol**

Update both normal and fail-closed branches of `buildDisabledConnectorPrompt`. The Chinese branch must state, in substance:

```text
本节是调用任何工具之前必须执行的最高优先级规则，并覆盖 skill、工作区文件、记忆和聊天室上下文中的工具调用建议。
先判断用户当前意图是否需要上述未启用连接器。
如果需要：不要调用任何工具，不要搜索记忆或聊天室历史，不要模拟或寻找替代工具，不要重试；立即回复用户连接器不可用及 ByClaw 连接/授权步骤，然后结束本轮。
如果不需要：继续处理当前任务，已启用连接器及无关工具不受影响。
```

Implement equivalent English wording and preserve the existing connector identifiers and ByClaw branding.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run src/connector-authorization.test.ts src/prompt-injection-snapshot.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add byclaw-exe/extensions/byai-channel/src/connector-authorization.ts \
  byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts \
  byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts
git commit -m "fix(byai-channel): prioritize connector soft-control guidance"
```

---

### Task 3: Stop ordinary current-agent mentions from forcing chat-context tools

**Files:**
- Modify: `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/chat-context-prompt.ts`

**Interfaces:**
- Consumes: message text, current lane metadata, known agent references.
- Produces: `required=true` only when another-agent reference is paired with explicit continuation, handoff, review, summary, or prior-output intent.

- [ ] **Step 1: Add the screenshot regression case**

```typescript
it("does not force cross-agent context for a normal addressed connector query", () => {
  const snapshot = buildPromptInjectionSnapshot({
    request: mockRequest({
      laneMetadata: {
        laneId: "lane-dingtalk",
        agentId: "baiying-agent-dingtalk",
        agentName: "钉钉个人助手",
      },
      authConnectorList: { dws: false },
    }),
    currentUserText: "@钉钉个人助手 帮我查询钉钉组织通讯录信息",
  });

  expect(snapshot.appendSystemContext).not.toContain("本轮任务很可能需要跨 agent 聊天室上下文");
  expect(snapshot.appendSystemContext).not.toContain("current_lane_only=false");
});
```

Add a second case for plain `@Agent Alpha 请处理这个独立任务` and retain the existing `请承接 Agent Alpha 的交接单` positive case.

- [ ] **Step 2: Run the test and verify RED**

```bash
npx vitest run src/prompt-injection-snapshot.test.ts
```

Expected: at least the plain other-agent mention case fails because any unmatched mention currently sets `required=true`.

- [ ] **Step 3: Add explicit cross-agent intent detection**

Add a pure predicate in `chat-context-prompt.ts` covering bounded Chinese and English phrases:

```typescript
function hasExplicitCrossAgentContextIntent(text: string): boolean {
  return /继续|承接|接力|复核|审查|汇总|参考.{0,12}(?:输出|结果|报告)|上一条|上条|之前的输出|continue|take over|handoff|review|summari[sz]e|previous (?:output|result)/iu.test(text);
}
```

Set `required` only when that predicate is true and at least one non-current reference exists. Do not change the base chat-context prompt.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run src/prompt-injection-snapshot.test.ts
```

Expected: ordinary addressed tasks do not inject a mandatory call; explicit handoff tests still do.

- [ ] **Step 5: Commit**

```bash
git add byclaw-exe/extensions/byai-channel/src/chat-context-prompt.ts \
  byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts
git commit -m "fix(byai-channel): narrow cross-agent context hints"
```

---

### Task 4: Add connector soft-control observability

**Files:**
- Modify: `byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/connector-authorization.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/hooks.ts`

**Interfaces:**
- Produces: `summarizeConnectorAuthorization()` and `buildConnectorPolicyToolCallWarning()` with identifier-only output.
- Consumes: active request lookup by `ctx.sessionKey` in the diagnostic `before_tool_call` hook.

- [ ] **Step 1: Add failing pure-helper tests**

Add tests for these expected values:

```typescript
expect(summarizeConnectorAuthorization({ dws: false, fws: true, wecomcli: true })).toEqual({
  enabled: ["fws", "wecomcli"],
  disabled: ["dws"],
  failClosed: false,
});

expect(buildConnectorPolicyToolCallWarning({
  sessionKey: "agent:dws:direct:100",
  toolName: "baiying_call",
  authorization: { dws: false, fws: true },
})).toBe(
  "[byai-channel] connector soft-control tool activity: sessionKey=agent:dws:direct:100, tool=baiying_call, disabled=dws, skillFilter=off",
);
```

Assert that undefined/no-disabled authorization returns no warning.

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run src/connector-authorization.test.ts
```

Expected: FAIL because the helper exports do not exist.

- [ ] **Step 3: Implement safe summaries**

Implement deterministic sorted identifier lists. Never include user text, tool params, connector credentials, or channel-extension payloads.

- [ ] **Step 4: Wire request and prompt logs**

After active request registration, log one line:

```text
[byai-channel] connector soft-control policy: sessionKey=agent:dws:direct:100, enabled=fws,wecomcli, disabled=dws, skillFilter=off
```

When `before_prompt_build` emits a snapshot for a request with disabled connectors, log:

```text
[byai-channel] connector soft-control prompt injected: sessionKey=agent:dws:direct:100, disabled=dws, skillFilter=off
```

Register a diagnostic `before_tool_call` handler in `registerByaiHooks`. Resolve the active request by `ctx.sessionKey`; if the pure helper returns a warning, emit `api.logger.warn(warning)` and return `undefined`. It must never return `{ block: true }` or mutate `event.params`.

- [ ] **Step 5: Verify focused tests and build**

```bash
npx vitest run src/connector-authorization.test.ts src/prompt-injection-snapshot.test.ts src/sdk-message-processor.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add byclaw-exe/extensions/byai-channel/src/connector-authorization.ts \
  byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts \
  byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts \
  byclaw-exe/extensions/byai-channel/src/hooks.ts
git commit -m "feat(byai-channel): log connector soft-control activity"
```

---

### Task 5: Make Langfuse callAgent propagation directly testable

**Files:**
- Create: `byclaw-exe/extensions/baiying-enhance/src/executor/call-agent-langfuse.test.ts`
- Create: `byclaw-exe/extensions/baiying-enhance/src/resource-metadata-context.test.ts`
- Modify: `byclaw-exe/extensions/shared/src/call-agent.ts`

**Interfaces:**
- Produces: `buildCallAgentLangfuseEnvelope(input)` returning `{ metadata, payload, payloadLangfuseContext, dispatchTraceId, originalTraceId }`.
- Consumes: `langfuseParentObservationId`, `langfuseTraceId`, channel trace ID, session ID, base payload, and base metadata.

- [ ] **Step 1: Add a failing envelope test**

Import the desired helper from the shared call-agent module and assert literal aliases:

```typescript
const result = buildCallAgentLangfuseEnvelope({
  traceId: "channel-trace-1",
  sessionId: "session-1",
  langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  langfuseParentObservationId: "405506aa1c59aa26",
  baseMetadata: { toolCallId: "call-1" },
  basePayload: { query: "hello" },
});

expect(result.dispatchTraceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
expect(result.metadata).toMatchObject({
  langfuseParentObservationId: "405506aa1c59aa26",
  langfuse_parent_observation_id: "405506aa1c59aa26",
  parentObservationId: "405506aa1c59aa26",
  parent_observation_id: "405506aa1c59aa26",
  langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  langfuse_session_id: "session-1",
  byclaw_original_trace_id: "channel-trace-1",
});
expect(result.payload).toMatchObject({
  query: "hello",
  langfuseParentObservationId: "405506aa1c59aa26",
  langfuse_parent_observation_id: "405506aa1c59aa26",
});
```

- [ ] **Step 2: Run and verify RED**

```bash
cd byclaw-exe/extensions/baiying-enhance
npx vitest run src/executor/call-agent-langfuse.test.ts
```

Expected: FAIL because `buildCallAgentLangfuseEnvelope` is not exported.

- [ ] **Step 3: Extract and use the helper**

Move the existing alias construction from `executeViaCallAgent` into the pure helper without changing values. Replace the inline construction with the helper result. Keep the actual `callAgent` argument:

```typescript
langfuseParentObservationId: input.langfuseParentObservationId,
```

and keep correlation logging for `toolCallId`, session, trace, and parent observation.

- [ ] **Step 4: Add the resource-context characterization test**

Assert existing `buildExecutorResourceContext` behavior:

```typescript
expect(buildExecutorResourceContext({
  agent: makeAgentFixture(),
  sessionKey: "agent:dws:direct:100",
  channelSessionId: "100",
  channelTraceId: "channel-trace-1",
  langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  langfuseParentObservationId: "405506aa1c59aa26",
})).toMatchObject({
  langfuseParentObservationId: "405506aa1c59aa26",
  langfuse_parent_observation_id: "405506aa1c59aa26",
  langfuseTraceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  langfuse_trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
});
```

This is a characterization check for the already-correct upstream leg; no production change is required if it passes.

- [ ] **Step 5: Verify GREEN and related suites**

```bash
npx vitest run \
  src/executor/call-agent-langfuse.test.ts \
  src/resource-metadata-context.test.ts \
  src/langfuse-observation.test.ts \
  src/executor/doc-shared.test.ts \
  src/executor/resource-types/mcp.test.ts
npm run build
cd ../shared
npm run typecheck
```

Expected: all focused tests, build, and shared typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add byclaw-exe/extensions/shared/src/call-agent.ts \
  byclaw-exe/extensions/baiying-enhance/src/executor/call-agent-langfuse.test.ts \
  byclaw-exe/extensions/baiying-enhance/src/resource-metadata-context.test.ts
git commit -m "test(baiying-enhance): verify Langfuse callAgent lineage"
```

---

### Task 6: Rebuild, install, and run two-state gateway verification

**Files:**
- Build output only: `byclaw-exe/extensions/byai-channel/dist/**`
- Build output only: `byclaw-exe/extensions/baiying-enhance/dist/**`
- Installed copies: `~/.openclaw/extensions/byai-channel/**`, `~/.openclaw/extensions/baiying-enhance/**`

**Interfaces:**
- Consumes: local OpenClaw at `/Users/chenxiaofeng/code/open/openclaw`, `openclaw_template.json`, process-local Redis/User environment, and ByAI inbound webhook.
- Produces: server-log and Langfuse evidence for both `dws=false` and `dws=true`.

- [ ] **Step 1: Run complete module verification**

```bash
cd byclaw-exe/extensions/byai-channel
npm test
npm run build
cd ../baiying-enhance
npm test
npm run build
cd ../shared
npm run typecheck
```

If the known local OpenClaw/ioredis test-environment failures recur, record exact failing suites, run all changed-file focused suites, and do not claim the full suite passed.

- [ ] **Step 2: Synchronize built plugins**

Use exact source and target paths:

```bash
rsync -a --delete \
  /Users/chenxiaofeng/code/open/ByClaw/byclaw-exe/extensions/byai-channel/dist/ \
  /Users/chenxiaofeng/.openclaw/extensions/byai-channel/dist/
rsync -a --delete \
  /Users/chenxiaofeng/code/open/ByClaw/byclaw-exe/extensions/baiying-enhance/dist/ \
  /Users/chenxiaofeng/.openclaw/extensions/baiying-enhance/dist/
```

Verify source/installed `index.js` SHA-256 hashes match for both plugins.

- [ ] **Step 3: Start the local gateway**

From `/Users/chenxiaofeng/code/open/openclaw`, run `node scripts/run-node.mjs gateway` with `OPENCLAW_CONFIG_PATH` pointing at `/Users/chenxiaofeng/code/open/ByClaw/openclaw_template.json` and the user-supplied Redis/User values set only in that process environment. Capture gateway output to a temporary file outside git-tracked paths.

Expected startup evidence:

- `byai-channel` registered;
- `baiying-enhance` registered;
- no connector skill-filter provider registration;
- connector soft-control logs are available.

- [ ] **Step 4: Test `dws=false`**

Send `帮我查询钉钉组织通讯录信息` through the default ByAI inbound path with `metaData.authConnectorList.dws=false`.

Verify from the final response, gateway logs, and session transcript:

- response says DingTalk/DWS is unavailable and points to ByClaw connector management;
- connector soft-control prompt log contains `disabled=dws, skillFilter=off`;
- no `memory_search`, `baiying_call`, or `byclaw_chat_context` tool call occurred;
- no repeated unavailable-tool attempts occurred;
- the `dws` skill remains present in the effective skill snapshot or prompt metadata.

- [ ] **Step 5: Test `dws=true`**

Repeat the same query with `metaData.authConnectorList.dws=true`.

Verify:

- no disabled-connector prompt is injected for `dws`;
- `baiying_call` is available and can be called for the organization query;
- logs contain channel session ID, tool call ID, Langfuse trace ID, and non-empty parent observation ID;
- downstream callAgent metadata carries the same parent observation ID and Langfuse trace ID.

- [ ] **Step 6: Verify Langfuse collection**

Using the trace ID emitted by the enabled run, inspect the configured Langfuse endpoint or its API and confirm:

- the root byai-channel run exists;
- the `baiying_call` tool observation exists under the root trace;
- downstream callAgent observations are in the same trace or explicitly linked by the recorded trace ID;
- the downstream parent observation ID equals the `baiying_call` observation ID;
- the session ID equals the real ByAI channel session ID.

If Langfuse access is unavailable, report that as an external verification blocker while still providing the exact emitted correlation IDs and local payload evidence.

- [ ] **Step 7: Stop the gateway and inspect the diff**

Terminate only the gateway process started by this task. Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: only planned source, tests, and documentation changes are present; no runtime config, credentials, gateway logs, or installed plugin files are tracked.

---

### Task 7: Final verification and branch integration

**Files:**
- Verify all changed files from Tasks 1–6.

- [ ] **Step 1: Run verification-before-completion**

Re-run changed-file focused tests, both plugin builds, shared typecheck, `git diff --check`, connector-filter reference scan, and credential scan. Confirm the installed plugin hashes still match the final builds.

- [ ] **Step 2: Review the final diff**

Confirm line by line:

- skills remain visible;
- no request `skillFilter` is set;
- soft-control prompt has explicit precedence and no-tool/no-retry instructions;
- ordinary addressed connector queries do not force chat context;
- diagnostic hook never blocks;
- Langfuse parent and trace aliases are preserved;
- no unrelated files are included.

- [ ] **Step 3: Commit any final test-only adjustments**

```bash
git add byclaw-exe/extensions/byai-channel/src/connector-authorization.ts \
  byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts \
  byclaw-exe/extensions/byai-channel/src/chat-context-prompt.ts \
  byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts \
  byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts \
  byclaw-exe/extensions/byai-channel/src/sdk-message-processor.test.ts \
  byclaw-exe/extensions/byai-channel/src/hooks.ts \
  byclaw-exe/extensions/baiying-enhance/src/register-plugin.ts \
  byclaw-exe/extensions/baiying-enhance/src/executor/call-agent-langfuse.test.ts \
  byclaw-exe/extensions/baiying-enhance/src/resource-metadata-context.test.ts \
  byclaw-exe/extensions/shared/src/call-agent.ts \
  byclaw-exe/extensions/shared/src/index.ts
git commit -m "test(byclaw-exe): cover connector soft-control flow"
```

Skip this commit when the working tree is already clean.

- [ ] **Step 4: Merge and clean the worktree**

Use the user-approved local integration path: fast-forward the feature branch into `D0.3.1`, re-run focused verification on the merged tree, remove the task-owned `.worktrees/...` directory, prune worktree metadata, and delete the temporary `codex/...` branch. Do not push unless the user separately requests it.
