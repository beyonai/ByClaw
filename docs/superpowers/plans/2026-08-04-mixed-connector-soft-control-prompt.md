# Mixed Connector Soft-Control Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the connector authorization prompt execute enabled connector work normally while blocking and reporting only the disabled connectors actually required by the current request.

**Architecture:** Keep `authConnectorList` normalization, visible skills, diagnostic-only hooks, and fail-closed malformed-policy behavior unchanged. Refine only `buildDisabledConnectorPrompt` so a valid policy presents separate enabled/disabled state and gives the model a per-subtask partial-success protocol instead of a turn-wide stop rule.

**Tech Stack:** TypeScript, Vitest, esbuild, OpenClaw plugin hooks, `@byclaw/by-framework` 1.5.2.

## Global Constraints

- `metaData.authConnectorList` remains the conversation-scoped source of truth; explicit `true` is enabled and explicit `false` is disabled.
- Connector skills remain visible; do not add or restore connector-derived `skillFilter` behavior.
- Enforcement remains prompt-based soft control; `before_tool_call` remains diagnostic-only and must never block tools.
- A disabled connector restricts only its own connector-dependent subtask.
- Enabled connector and unrelated subtasks must execute normally even when another connector is disabled.
- A mixed request returns enabled results plus a separate list of only the required disabled connectors and ByClaw connection guidance.
- Connectors absent from `authConnectorList` retain existing compatibility behavior and are not assumed disabled.
- Malformed or oversized authorization policies retain the current fail-closed behavior.
- Do not add credentials, private endpoints, Redis values, or Langfuse secrets to source, tests, logs, documentation, or commits.

---

### Task 1: Encode per-connector partial-success behavior in the prompt

**Files:**
- Modify: `byclaw-exe/extensions/byai-channel/src/connector-authorization.ts`
- Test: `byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts`

**Interfaces:**
- Consumes: `summarizeConnectorAuthorization(authorization): { enabled: string[]; disabled: string[]; failClosed: boolean }`.
- Produces: unchanged `buildDisabledConnectorPrompt(language, authorization): string`, with explicit mixed-state and partial-success instructions.

- [ ] **Step 1: Add failing Chinese mixed-state prompt assertions**

Extend the localized-guidance test with this hand-derived contract:

```ts
const mixedChinese = buildDisabledConnectorPrompt("zh_CN", {
  dws: true,
  fws: false,
  wecomcli: false,
});
expect(mixedChinese).toContain("已启用连接器：`dws`");
expect(mixedChinese).toContain("未启用连接器：`fws`, `wecomcli`");
expect(mixedChinese).toContain("按连接器拆分为独立子任务");
expect(mixedChinese).toContain("已启用连接器对应的子任务必须正常执行");
expect(mixedChinese).toContain("只跳过未启用连接器对应的子任务");
expect(mixedChinese).toContain("先完成已启用连接器和无关子任务");
expect(mixedChinese).toContain("只列出本次请求实际需要但未启用的连接器");
expect(mixedChinese).toContain("不要把已启用连接器描述为不可用");
```

- [ ] **Step 2: Add failing English mixed-state prompt assertions**

```ts
const mixedEnglish = buildDisabledConnectorPrompt("en_US", {
  dws: true,
  fws: false,
  wecomcli: false,
});
expect(mixedEnglish).toContain("Enabled connectors: `dws`");
expect(mixedEnglish).toContain("Disabled connectors: `fws`, `wecomcli`");
expect(mixedEnglish).toContain("split the request into independent connector subtasks");
expect(mixedEnglish).toContain("must execute enabled-connector subtasks normally");
expect(mixedEnglish).toContain("skip only the disabled-connector subtasks");
expect(mixedEnglish).toContain("complete enabled-connector and unrelated subtasks first");
expect(mixedEnglish).toContain("list only the connectors required by this request that are disabled");
expect(mixedEnglish).toContain("Do not describe an enabled connector as unavailable");
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
cd byclaw-exe/extensions/byai-channel
npm test -- --run src/connector-authorization.test.ts
```

Expected: FAIL because the current prompt lists only disabled connectors and contains turn-level `do not call any tool` / `不要调用任何工具` behavior instead of the mixed-state protocol.

- [ ] **Step 4: Implement the minimal valid-policy prompt change**

In the non-fail-closed branch of `buildDisabledConnectorPrompt`, derive both lists from the existing summary:

```ts
const { enabled, disabled } = summarizeConnectorAuthorization(authorization);
if (disabled.length === 0) {
  return "";
}
const enabledConnectors = enabled.length
  ? enabled.map((name) => `\`${name}\``).join(", ")
  : undefined;
const disabledConnectors = disabled.map((name) => `\`${name}\``).join(", ");
```

Build localized prompt lines with these exact semantics:

```ts
const chineseState = [
  enabledConnectors ? `已启用连接器：${enabledConnectors}。` : "已启用连接器：无。",
  `未启用连接器：${disabledConnectors}。`,
];
```

The Chinese protocol must instruct the model to:

```text
先把当前请求按连接器拆分为独立子任务，并分别判断每个子任务依赖的连接器状态。
已启用连接器对应的子任务必须正常执行；不要因为存在其他未启用连接器而跳过、阻断或降级这些子任务。
只跳过未启用连接器对应的子任务；仅对这些子任务禁止调用或模拟工具、搜索记忆或聊天室历史作为替代方案以及重试。
如果请求同时包含已启用和未启用连接器，先完成已启用连接器和无关子任务，再在最终回复中保留成功结果，并单独说明未完成部分。
对用户只列出本次请求实际需要但未启用的连接器，并给出 ByClaw 连接器管理、连接/授权、身份认证和重试指引；不要提及与本次请求无关的未启用连接器。
不要把已启用连接器描述为不可用，也不要因未启用连接器结束整个混合任务。
```

The English protocol must express the same rules using the phrases asserted in Step 2. Preserve the current disabled-only immediate-response behavior by stating that an immediate no-tool response applies only when every requested connector subtask is disabled and no unrelated work remains.

- [ ] **Step 5: Run focused prompt tests and verify GREEN**

Run:

```bash
cd byclaw-exe/extensions/byai-channel
npm test -- --run src/connector-authorization.test.ts
```

Expected: all connector authorization tests pass.

- [ ] **Step 6: Add prompt-snapshot regression assertions**

In `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts`, extend the disabled-connector snapshot case to use `{ dws: true, fws: false, wecomcli: false }` and assert:

```ts
expect(snapshot.appendSystemContext).toContain("已启用连接器：`dws`");
expect(snapshot.appendSystemContext).toContain("未启用连接器：`fws`, `wecomcli`");
expect(snapshot.appendSystemContext).toContain("已启用连接器对应的子任务必须正常执行");
expect(snapshot.appendSystemContext).toContain("只列出本次请求实际需要但未启用的连接器");
```

Keep the existing assertions that the connector policy is appended after chat context, ACP language metadata, and channel metadata.

- [ ] **Step 7: Run all directly affected tests and build**

Run:

```bash
cd byclaw-exe/extensions/byai-channel
npm test -- --run src/connector-authorization.test.ts src/prompt-injection-snapshot.test.ts src/sdk-message-processor.test.ts
npm run build
```

Expected: all selected tests pass and esbuild exits 0.

- [ ] **Step 8: Commit the prompt behavior**

```bash
git add \
  byclaw-exe/extensions/byai-channel/src/connector-authorization.ts \
  byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts \
  byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts
git commit -m "fix(byai-channel): scope connector soft control per subtask"
```

---

### Task 2: Repackage and verify mixed connector behavior

**Files:**
- Verify: `byclaw-exe/extensions/byai-channel/dist/`
- Verify: `byclaw-exe/extensions/baiying-enhance/dist/`
- Install target: `/Users/chenxiaofeng/.openclaw/extensions/byai-channel/`
- Install target: `/Users/chenxiaofeng/.openclaw/extensions/baiying-enhance/`
- Runtime template: `/Users/chenxiaofeng/code/open/openclaw/openclaw_template.json`

**Interfaces:**
- Consumes: the committed prompt behavior from Task 1.
- Produces: locally installed extension artifacts matching source builds, plus disabled-only, enabled-only, and mixed-state verification evidence.

- [ ] **Step 1: Run package verification from the final tree**

```bash
cd byclaw-exe/extensions/byai-channel
npm test -- --run src/connector-authorization.test.ts src/prompt-injection-snapshot.test.ts src/sdk-message-processor.test.ts
npm run build

cd ../baiying-enhance
npm test -- --run src/executor/call-agent-langfuse.test.ts src/resource-metadata-context.test.ts src/executor/call-agent.test.ts
npm run build

cd ../shared
npm run typecheck
```

Expected: all focused tests, both builds, and shared typecheck exit 0. Record full-suite environment/baseline failures separately rather than presenting them as green.

- [ ] **Step 2: Synchronize built plugins without changing the source template**

```bash
rsync -a --delete \
  byclaw-exe/extensions/byai-channel/dist/ \
  /Users/chenxiaofeng/.openclaw/extensions/byai-channel/dist/
rsync -a --delete \
  byclaw-exe/extensions/baiying-enhance/dist/ \
  /Users/chenxiaofeng/.openclaw/extensions/baiying-enhance/dist/
```

Compare SHA-256 hashes for each source/installed `dist/index.js`; each pair must match.

- [ ] **Step 3: Start an isolated local gateway from a temporary config**

Create a temporary config derived from `/Users/chenxiaofeng/code/open/openclaw/openclaw_template.json`; change only container-only paths to local extension/log paths and the temporary test agent skill list. Load runtime variables process-locally, do not persist them, and start:

```bash
cd /Users/chenxiaofeng/code/open/openclaw
node scripts/run-node.mjs gateway
```

Target only this gateway worker for inbound test messages so other online workers cannot consume the cases.

- [ ] **Step 4: Verify disabled-only behavior**

Send `帮我查询钉钉组织通讯录信息` with:

```json
{"authConnectorList":{"dws":false,"fws":true}}
```

Expected: `dws` remains visible in the skill snapshot; no memory, chat-context, connector, generic, or retry tool call occurs; the reply names `dws` as unavailable and gives ByClaw connection guidance; it does not report `fws` as unavailable.

- [ ] **Step 5: Verify enabled-only behavior while another connector is disabled**

Send the same DingTalk query with:

```json
{"authConnectorList":{"dws":true,"fws":false}}
```

Expected: the DingTalk business path executes normally; the run is not stopped merely because `fws` is disabled; the final reply does not claim `dws` or unrelated `fws` is unavailable.

- [ ] **Step 6: Verify mixed partial-success behavior**

Send `分别查询我的钉钉组织通讯录和飞书组织通讯录` with:

```json
{"authConnectorList":{"dws":true,"fws":false}}
```

Expected: the `dws` subtask executes and its result is retained; no `fws` connector tool is called; the final reply includes the DingTalk result, separately identifies `fws` as the required unavailable connector, and gives ByClaw connection guidance without describing `dws` as unavailable.

- [ ] **Step 7: Stop only the task gateway and inspect repository state**

Terminate the exact gateway PID started in Step 3. Verify no task process remains, `git diff --check` succeeds, tracked worktree state is clean, and no source/template file contains runtime credentials.
