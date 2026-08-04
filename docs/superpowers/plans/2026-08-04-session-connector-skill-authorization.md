# Session Connector Skill Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce inbound `metadata.authConnectorList` as a per-dispatch connector-skill allowlist and inject user-facing guidance for disabled connector intents.

**Architecture:** `byai-channel` normalizes and carries the authorization map, while `baiying-enhance` publishes a process-local resolver that starts from its live dynamic agent skill registration and removes same-named `false` connectors. `byai-channel` passes the resulting whitelist to OpenClaw through `replyOptions.skillFilter`, which isolates the policy to one dispatch without mutating global configuration.

**Tech Stack:** TypeScript, OpenClaw plugin SDK, esbuild, Vitest 3.2.4.

## Global Constraints

- Map keys are exact OpenClaw skill filter names: `dws`, `fws`, `wecomcli`, and future same-named connector skills.
- Only boolean metadata values are accepted; only `false` changes visibility.
- Missing/empty/invalid metadata preserves current behavior.
- `true` never registers or grants a skill absent from the live dynamic registration result.
- Never mutate `openclaw.json` or global `agents.list[].skills` for session authorization.
- Provider failure while at least one connector is disabled fails closed with `skillFilter: []` for that dispatch only.
- Do not log tokens, full inbound metadata, or connector credentials.

---

## File Structure

- Create `byclaw-exe/extensions/shared/src/connector-skill-filter-runtime.ts`: narrow `globalThis` service contract shared by independently bundled extensions.
- Modify `byclaw-exe/extensions/shared/src/index.ts`: export the runtime contract for discoverability.
- Create `byclaw-exe/extensions/byai-channel/src/connector-authorization.ts`: normalize inbound connector maps, list disabled names, and render localized business-rule prompt text.
- Modify `byclaw-exe/extensions/byai-channel/src/types.ts`: carry normalized authorization on inbound messages.
- Modify `byclaw-exe/extensions/byai-channel/src/sdk-app.ts`: parse `metadata.authConnectorList`.
- Modify `byclaw-exe/extensions/byai-channel/src/session-context.ts`: persist the map on `ActiveSdkRequest` and the shared request context.
- Modify `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts`: resolve and pass a per-dispatch `skillFilter`.
- Modify `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.ts`: append the disabled-connector response rule.
- Create `byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts`: normalization and prompt unit tests.
- Modify `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.test.ts`: dispatch filter and overflow-continuation regression coverage.
- Modify `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts`: snapshot-level prompt coverage.
- Modify `byclaw-exe/extensions/byai-channel/src/session-context.multi-agent.test.ts`: active/shared context propagation coverage.
- Create `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.ts`: live dynamic-registration-aware provider.
- Create `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts`: provider behavior and isolation tests.
- Modify `byclaw-exe/extensions/baiying-enhance/src/register-plugin.ts`: register the provider at plugin startup.

---

### Task 1: Shared Runtime Service Contract

**Files:**
- Create: `byclaw-exe/extensions/shared/src/connector-skill-filter-runtime.ts`
- Modify: `byclaw-exe/extensions/shared/src/index.ts`
- Test: `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts`

**Interfaces:**
- Produces `ConnectorSkillFilterRequest`, `ConnectorSkillFilterResolver`, `setConnectorSkillFilterResolver`, and `resolveConnectorSkillFilter`.
- The resolver accepts `{ agentId, disabledConnectorSkills }` and returns `Promise<string[]>`.
- The accessor returns `undefined` when no provider is registered; it does not silently create a permissive filter.

- [ ] **Step 1: Write the failing runtime-contract test**

Add a test that clears the global service, verifies resolution is initially `undefined`, registers a resolver, verifies the request and returned list, then restores `undefined`:

```typescript
it("shares a connector skill filter resolver across extension bundles", async () => {
  setConnectorSkillFilterResolver(undefined);
  await expect(resolveConnectorSkillFilter({
    agentId: "baiying-agent-1",
    disabledConnectorSkills: ["fws"],
  })).resolves.toBeUndefined();

  const resolver = vi.fn(async () => ["dws", "ordinary-skill"]);
  setConnectorSkillFilterResolver(resolver);
  await expect(resolveConnectorSkillFilter({
    agentId: "baiying-agent-1",
    disabledConnectorSkills: ["fws"],
  })).resolves.toEqual(["dws", "ordinary-skill"]);
  expect(resolver).toHaveBeenCalledWith({
    agentId: "baiying-agent-1",
    disabledConnectorSkills: ["fws"],
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd byclaw-exe/extensions/baiying-enhance && npx vitest run src/connector-skill-filter.test.ts`

Expected: FAIL because `../../shared/src/connector-skill-filter-runtime.js` does not exist.

- [ ] **Step 3: Implement the minimal shared service**

Use a stable symbol so separately bundled copies address the same process-local slot:

```typescript
const CONNECTOR_SKILL_FILTER_RESOLVER = Symbol.for(
  "openclaw.baiyingEnhance.connectorSkillFilterResolver",
);

export interface ConnectorSkillFilterRequest {
  agentId: string;
  disabledConnectorSkills: string[];
}

export type ConnectorSkillFilterResolver = (
  request: ConnectorSkillFilterRequest,
) => Promise<string[]>;

export function setConnectorSkillFilterResolver(
  resolver: ConnectorSkillFilterResolver | undefined,
): void;

export async function resolveConnectorSkillFilter(
  request: ConnectorSkillFilterRequest,
): Promise<string[] | undefined>;
```

Store only the resolver function on `globalThis`; deleting/resetting the symbol is allowed for tests and plugin reload.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd byclaw-exe/extensions/baiying-enhance && npx vitest run src/connector-skill-filter.test.ts`

Expected: the runtime-contract test passes; later provider tests may still be pending.

- [ ] **Step 5: Commit**

```bash
git add byclaw-exe/extensions/shared/src/connector-skill-filter-runtime.ts \
  byclaw-exe/extensions/shared/src/index.ts \
  byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts
git commit -m "feat(byclaw-exe): add connector skill filter runtime contract"
```

### Task 2: Parse, Carry, and Explain Connector Authorization

**Files:**
- Create: `byclaw-exe/extensions/byai-channel/src/connector-authorization.ts`
- Create: `byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/types.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/sdk-app.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/session-context.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/session-context.multi-agent.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts`

**Interfaces:**
- Produces `ConnectorAuthorizationMap = Record<string, boolean>`.
- Produces `normalizeConnectorAuthorization(value): ConnectorAuthorizationMap | undefined`.
- Produces `connectorAuthorizationFromMetadata(metadata): ConnectorAuthorizationMap | undefined`, which reads only `metadata.authConnectorList`.
- Produces `disabledConnectorSkillNames(map): string[]` with deterministic input order and no blank names.
- Produces `buildDisabledConnectorPrompt(language, map): string`.
- Adds optional `authConnectorList` to `ByaiSdkInboundMessage`, `ActiveSdkRequest`, and `registerActiveSdkRequest` parameters.

- [ ] **Step 1: Write normalization and localized prompt tests**

```typescript
expect(normalizeConnectorAuthorization({
  " dws ": true,
  fws: false,
  wecomcli: "false",
  "": false,
})).toEqual({ dws: true, fws: false });

expect(disabledConnectorSkillNames({ dws: true, fws: false, wecomcli: false }))
  .toEqual(["fws", "wecomcli"]);

expect(buildDisabledConnectorPrompt("zh_CN", { dws: false }))
  .toContain("连接器当前处于未连接或未授权状态");
expect(buildDisabledConnectorPrompt("en_US", { dws: false }))
  .toContain("currently not connected or authorized");
expect(buildDisabledConnectorPrompt("zh_CN", { dws: true })).toBe("");
```

Also assert that `undefined`, arrays, strings, empty objects, and non-boolean-only objects normalize to `undefined`.
Assert that `connectorAuthorizationFromMetadata({ authConnectorList: { dws: false } })` returns `{ dws: false }` and unrelated metadata does not produce a policy.

- [ ] **Step 2: Write propagation and prompt-snapshot tests**

Extend `session-context.multi-agent.test.ts` so a registered request with `{ dws: true, fws: false }` exposes the same map on the active request and in `resolveSharedChannelRequestContextBySessionKey(...).fields.authConnectorList`.

Extend `prompt-injection-snapshot.test.ts`:

```typescript
const snapshot = buildPromptInjectionSnapshot({
  request: mockRequest({ authConnectorList: { dws: true, fws: false } }),
});
expect(snapshot.appendSystemContext).toContain("`fws`");
expect(snapshot.appendSystemContext).not.toContain("`dws` 连接器当前");
expect(snapshot.appendSystemContext).toContain("连接器管理页面");
expect(snapshot.appendSystemContext).toContain("连接/授权");
```

Add the English equivalent and assert a request with no disabled entries contains no connector-availability heading.

- [ ] **Step 3: Run the focused byai tests and verify RED**

Run:

```bash
cd byclaw-exe/extensions/byai-channel
npx vitest run src/connector-authorization.test.ts src/session-context.multi-agent.test.ts src/prompt-injection-snapshot.test.ts
```

Expected: FAIL because normalization, request fields, and prompt generation do not exist.

- [ ] **Step 4: Implement normalization and business-rule prompt generation**

The Chinese prompt must state, in substance:

```text
本会话以下第三方连接器当前处于未连接或未授权状态：`fws`。
如果用户意图需要其中任一连接器：不要调用或模拟对应 skill；明确说明无法完成相关操作；引导用户打开 WorkBuddy 连接器管理页面，找到对应连接器，点击连接/授权并完成身份认证；连接成功后请用户重试。
```

The English branch carries the same rules. Build from only the `false` keys.

- [ ] **Step 5: Implement inbound and session propagation**

In `sdk-app.ts`, set:

```typescript
authConnectorList: normalizeConnectorAuthorization(metadata?.authConnectorList),
```

In `session-context.ts`, carry the field into `ActiveSdkRequest` and shared `fields`. Do not add connector authorization to outbound user-visible event metadata.

`buildByaiMultiAgentLaneMessages` already spreads `baseMessage`; add a regression assertion in `multi-agent.test.ts` only if the active propagation test does not prove lane inheritance.

Add the regression assertion unconditionally: every lane produced from a base message with `{ fws: false }` must retain the same normalized authorization values.

- [ ] **Step 6: Add prompt snapshot injection**

Append `buildDisabledConnectorPrompt(params.request.language, params.request.authConnectorList)` to the snapshot `sections` before channel-extension rendering. The builder returns `""` when no connector is disabled, and the existing `.filter(Boolean)`/join behavior must not add blank sections.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the command from Step 3. Expected: all selected tests pass with no warnings.

- [ ] **Step 8: Commit**

```bash
git add byclaw-exe/extensions/byai-channel/src/connector-authorization.ts \
  byclaw-exe/extensions/byai-channel/src/connector-authorization.test.ts \
  byclaw-exe/extensions/byai-channel/src/types.ts \
  byclaw-exe/extensions/byai-channel/src/sdk-app.ts \
  byclaw-exe/extensions/byai-channel/src/session-context.ts \
  byclaw-exe/extensions/byai-channel/src/session-context.multi-agent.test.ts \
  byclaw-exe/extensions/byai-channel/src/multi-agent.test.ts \
  byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.ts \
  byclaw-exe/extensions/byai-channel/src/prompt-injection-snapshot.test.ts
git commit -m "feat(byai-channel): propagate connector authorization"
```

### Task 3: Implement the Baiying Dynamic Skill Filter Provider

**Files:**
- Create: `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts`
- Modify: `byclaw-exe/extensions/baiying-enhance/src/register-plugin.ts`

**Interfaces:**
- Produces `filterRegisteredSkills(registeredSkills, disabledSkills): string[]`.
- Produces `createConnectorSkillFilterResolver({ api, loadVisibleSkillNames? }): ConnectorSkillFilterResolver`.
- Registers the resolver once from `registerBaiyingEnhancePlugin`.
- `loadVisibleSkillNames` is injectable for unit tests; production uses OpenClaw's visible workspace skill loader when no explicit agent filter exists.

- [ ] **Step 1: Write failing provider tests**

Cover explicit dynamic registration:

```typescript
const resolver = createConnectorSkillFilterResolver({ api });
await expect(resolver({
  agentId: "baiying-agent-1",
  disabledConnectorSkills: ["fws"],
})).resolves.toEqual(["dws", "ordinary-skill"]);
```

where current config has `skills: ["dws", "fws", "ordinary-skill"]`.

Cover these additional cases:

- `disabledConnectorSkills: ["unknown"]` preserves all registered skills.
- A `true` connector never appears in `disabledConnectorSkills`, so the resolver cannot add it.
- Duplicate/blank registered skill names are normalized away.
- When agent `skills` is absent, injected `loadVisibleSkillNames` returns `['dws', 'fws', 'ordinary-skill']` and `fws` is removed.
- Two concurrent resolver calls with opposite disabled names return independent lists and do not alter the mock config.
- Plugin registration installs the resolver through `setConnectorSkillFilterResolver`.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `cd byclaw-exe/extensions/baiying-enhance && npx vitest run src/connector-skill-filter.test.ts`

Expected: FAIL because the provider module and registration call do not exist.

- [ ] **Step 3: Implement filtering from the live dynamic registration**

Core pure behavior:

```typescript
export function filterRegisteredSkills(
  registeredSkills: unknown[],
  disabledSkills: string[],
): string[] {
  const disabled = new Set(disabledSkills.map((name) => name.trim()).filter(Boolean));
  return mergeSkillNames(registeredSkills).filter((name) => !disabled.has(name));
}
```

Resolver behavior:

1. Read `api.runtime.config.current?.() ?? api.runtime.config.loadConfig()`.
2. Find the exact `agents.list[]` entry by `agentId`.
3. If `entry.skills` is an array, use it as the registered baseline.
4. Otherwise resolve the workspace with `api.runtime.agent.resolveAgentWorkspaceDir(cfg, agentId)`, load visible entries using OpenClaw's skill runtime, and map `entry.skill.name`.
5. Return a new filtered array; never mutate the config or loaded entries.

- [ ] **Step 4: Register the runtime provider**

At plugin startup:

```typescript
setConnectorSkillFilterResolver(createConnectorSkillFilterResolver({ api }));
```

Keep the registration alongside other runtime providers, before request hooks can execute.

- [ ] **Step 5: Run provider tests and verify GREEN**

Run the command from Step 2. Expected: all provider and shared-contract tests pass.

- [ ] **Step 6: Commit**

```bash
git add byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.ts \
  byclaw-exe/extensions/baiying-enhance/src/connector-skill-filter.test.ts \
  byclaw-exe/extensions/baiying-enhance/src/register-plugin.ts
git commit -m "feat(baiying-enhance): provide session connector skill filters"
```

### Task 4: Enforce the Filter on Every ByAI Dispatch

**Files:**
- Modify: `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/sdk-message-processor.test.ts`

**Interfaces:**
- Consumes `disabledConnectorSkillNames` and `resolveConnectorSkillFilter`.
- Produces a request-local `connectorSkillFilter: string[] | undefined`.
- Passes the same value to every `runOneDispatch` call through `replyOptions.skillFilter`.

- [ ] **Step 1: Write the failing normal-dispatch filter test**

Register a shared resolver returning `['dws', 'ordinary-skill']`, deliver a message with `{ dws: true, fws: false }`, capture `dispatchReplyFromConfig.replyOptions`, and assert:

```typescript
expect(resolver).toHaveBeenCalledWith({
  agentId: "test-agent",
  disabledConnectorSkills: ["fws"],
});
expect(capturedReplyOptions.skillFilter).toEqual(["dws", "ordinary-skill"]);
```

Add a legacy request without `authConnectorList` and assert `skillFilter` is absent and the resolver is not called.

- [ ] **Step 2: Write failing continuation and fail-closed tests**

Extend the existing overflow continuation test to collect both dispatch `replyOptions` and assert both contain the same filter.

Add separate tests for provider absence and provider rejection when `fws: false`; both must reach dispatch with `skillFilter: []`, and the rejection path must call `log.warn` without dumping full metadata.

- [ ] **Step 3: Run the focused processor test and verify RED**

Run: `cd byclaw-exe/extensions/byai-channel && npx vitest run src/sdk-message-processor.test.ts`

Expected: FAIL because `skillFilter` is never resolved or passed.

- [ ] **Step 4: Resolve the filter once per inbound request**

Before defining `runOneDispatch`:

```typescript
const disabledConnectorSkills = disabledConnectorSkillNames(message.authConnectorList);
let connectorSkillFilter: string[] | undefined;
if (disabledConnectorSkills.length > 0) {
  try {
    connectorSkillFilter = await resolveConnectorSkillFilter({
      agentId: sessionAgentId,
      disabledConnectorSkills,
    }) ?? [];
  } catch (error) {
    connectorSkillFilter = [];
    log?.warn?.(
      `[byai-channel] connector skill filter failed closed: agentId=${sessionAgentId}, disabled=${disabledConnectorSkills.join(",")}, error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
```

Log a warning for both missing-provider and thrown-provider fail-closed cases. Do not include `message`, tokens, headers, or the complete metadata object.

- [ ] **Step 5: Pass the filter to all dispatches**

Add the property only when filtering was requested:

```typescript
replyOptions: {
  ...replyOptions,
  ...(connectorSkillFilter ? { skillFilter: connectorSkillFilter } : {}),
  // existing callbacks remain unchanged
}
```

Because the value is outside `runOneDispatch`, context-overflow continuation reuses the same immutable array.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 3. Expected: all processor tests pass.

- [ ] **Step 7: Commit**

```bash
git add byclaw-exe/extensions/byai-channel/src/sdk-message-processor.ts \
  byclaw-exe/extensions/byai-channel/src/sdk-message-processor.test.ts
git commit -m "feat(byai-channel): enforce connector skill authorization"
```

### Task 5: Full Verification and Documentation Alignment

**Files:**
- Modify only if verification exposes a defect in a file already listed above.

**Interfaces:**
- Verifies both extension bundles compile with the shared runtime contract and OpenClaw external imports.
- Verifies no unrelated files or user changes are included.

- [ ] **Step 1: Run all byai-channel tests**

Run: `cd byclaw-exe/extensions/byai-channel && npm test`

Expected: Vitest exits 0 with zero failed tests.

- [ ] **Step 2: Build byai-channel**

Run: `cd byclaw-exe/extensions/byai-channel && npm run build`

Expected: esbuild exits 0 and writes the configured `dist` bundles.

- [ ] **Step 3: Run all baiying-enhance tests**

Run: `cd byclaw-exe/extensions/baiying-enhance && npm test`

Expected: Vitest exits 0 with zero failed tests.

- [ ] **Step 4: Build baiying-enhance**

Run: `cd byclaw-exe/extensions/baiying-enhance && npm run build`

Expected: both esbuild invocations exit 0.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat b22eef69..HEAD
```

Expected: no whitespace errors; only the approved connector-authorization implementation, tests, shared contract, and approved docs are present. Leave unrelated pre-existing untracked files untouched.

- [ ] **Step 6: Report verification evidence**

Report exact test counts/build exit status and link the principal changed files. Do not claim completion if any full test or build command fails.
