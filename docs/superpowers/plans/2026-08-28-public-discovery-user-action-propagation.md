# Public Discovery User-Action Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve a safe, machine-readable `requiresUserAction` through hot-discovery merge and public-discover output while explicitly prohibiting direct HTTP and generic-browser fallback.

**Architecture:** Normalize the hot-discovery action at the existing merge trust boundary, synthesize an immutable fallback policy locally, and expose the normalized action from `runPublicDiscover`. Keep successful SearXNG candidates and existing channel diagnostics unchanged.

**Tech Stack:** Node.js ES modules, `node:test`, `node:assert/strict`.

---

The user explicitly requested that documentation be created without committing it. No commit step is included, and neither documentation nor code will be staged or committed.

## File Structure

- Modify `middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.mjs`: normalize and propagate the action at the merge boundary.
- Modify `middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs`: cover sanitization, fixed policy, and malformed input.
- Modify `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.mjs`: expose the merged action at command-result top level.
- Modify `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs`: cover end-to-end partial-channel propagation.

### Task 1: Specify safe merge propagation

**Files:**

- Test: `middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs`

- [ ] **Step 1: Add the failing propagation and sanitization test**

Add a test next to `merge 对 hot-file 顶层元数据执行白名单`:

```js
test('merge 安全保留 requiresUserAction 并固定禁止降级策略', () => {
  const result = mergeDocuments({
    hotDoc: {
      query: 'agent',
      candidates: [],
      requiresUserAction: {
        kind: 'bridge_unavailable',
        source: 'google',
        errorCode: 'BROWSER_CONNECT',
        message: 'bridge unavailable',
        fallbackPolicy: { allowDirectHttp: true },
        nested: { content: 'BODY' },
      },
    },
    sxDoc: { query: 'agent', results: [] },
    arDoc: null,
    normalizer: n,
  });

  assert.deepEqual(result.requiresUserAction, {
    kind: 'bridge_unavailable',
    source: 'google',
    errorCode: 'BROWSER_CONNECT',
    message: 'bridge unavailable',
    fallbackPolicy: {
      allowDirectHttp: false,
      allowGenericBrowser: false,
      nextAction: 'stop-and-report',
    },
  });
  assert.equal(JSON.stringify(result).includes('BODY'), false);
  assert.match(result.warnings.join('\n'), /禁止使用.*HTTP.*通用浏览器.*降级/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk node --test --test-name-pattern='merge 安全保留 requiresUserAction' middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs
```

Expected: FAIL because `result.requiresUserAction` is `undefined`.

- [ ] **Step 3: Add the malformed-input characterization test**

```js
test('merge 忽略结构无效 hot-file 中的 requiresUserAction', () => {
  const result = mergeDocuments({
    hotDoc: {
      query: 'agent',
      candidates: { invalid: true },
      requiresUserAction: { kind: 'bridge_unavailable', message: 'untrusted' },
    },
    sxDoc: { query: 'agent', results: [] },
    arDoc: null,
    normalizer: n,
  });

  assert.equal(result.requiresUserAction, undefined);
});
```

- [ ] **Step 4: Run the malformed-input test and confirm current behavior**

Run:

```bash
rtk node --test --test-name-pattern='merge 忽略结构无效 hot-file' middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs
```

Expected: PASS under current code. This is a characterization test for the trust boundary, not the RED regression test.

### Task 2: Implement safe merge normalization

**Files:**

- Modify: `middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.mjs`
- Test: `middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs`

- [ ] **Step 1: Add a focused normalizer beside `sanitizeAdapterStats`**

```js
const USER_ACTION_STRING_LIMITS = Object.freeze({
  kind: 100,
  source: 200,
  errorCode: 100,
  message: 1_000,
});

const BLOCKED_FALLBACK_POLICY = Object.freeze({
  allowDirectHttp: false,
  allowGenericBrowser: false,
  nextAction: 'stop-and-report',
});

function sanitizeRequiresUserAction(value) {
  if (!isRecord(value) || typeof value.kind !== 'string' || !value.kind.trim()) return null;
  const action = {};
  for (const [key, limit] of Object.entries(USER_ACTION_STRING_LIMITS)) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      action[key] = value[key].trim().slice(0, limit);
    }
  }
  return { ...action, fallbackPolicy: { ...BLOCKED_FALLBACK_POLICY } };
}
```

- [ ] **Step 2: Normalize the action after validating the hot document**

Add beside `adapterStats` and `hotWarnings`:

```js
const requiresUserAction = invalidHotDoc
  ? null
  : sanitizeRequiresUserAction(hotDoc?.requiresUserAction);
```

- [ ] **Step 3: Include the action and explicit warning in the merged result**

In the returned object, add:

```js
...(requiresUserAction ? { requiresUserAction } : {}),
```

Append this fixed warning only when the action exists:

```js
...(requiresUserAction
  ? ['需要人工处理；禁止使用直接 HTTP 客户端或通用浏览器降级，必须停止并报告。']
  : []),
```

- [ ] **Step 4: Run both focused merge tests and verify GREEN**

Run:

```bash
rtk node --test --test-name-pattern='requiresUserAction' middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 5: Run the complete hot-discovery test file**

Run:

```bash
rtk node --test middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs
```

Expected: all tests PASS with zero failures.

### Task 3: Specify public-discover propagation

**Files:**

- Test: `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs`

- [ ] **Step 1: Add the failing end-to-end test**

```js
test('returns merged user action without discarding successful SearXNG discovery', async () => {
  const { paths } = makeInitializedSession();
  const result = await runPublicDiscover(paths, { query: 'agent' }, {
    runProcess: async (spec) => spec.channel === 'searxng'
      ? {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          results: [{ url: 'https://example.com/a', title: 'A', engine: 'google' }],
        }),
        stderr: '',
      }
      : {
        code: 0,
        stdout: JSON.stringify({
          query: 'agent',
          candidates: [],
          warnings: ['byCLI 浏览器桥接不可用；已停止浏览器适配器并等待人工恢复。'],
          requiresUserAction: {
            kind: 'bridge_unavailable',
            message: 'bridge unavailable',
          },
        }),
        stderr: '',
      },
  });

  const expectedAction = {
    kind: 'bridge_unavailable',
    message: 'bridge unavailable',
    fallbackPolicy: {
      allowDirectHttp: false,
      allowGenericBrowser: false,
      nextAction: 'stop-and-report',
    },
  };
  assert.deepEqual(result.requiresUserAction, expectedAction);
  assert.deepEqual(result.merged.requiresUserAction, expectedAction);
  assert.equal(result.merged.groups.searxngTop.length, 1);
  assert.deepEqual(
    JSON.parse(readFileSync(result.snapshots.merged, 'utf8')).requiresUserAction,
    expectedAction,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
rtk node --test --test-name-pattern='returns merged user action' middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs
```

Expected: FAIL because `runPublicDiscover` does not expose top-level `requiresUserAction`.

### Task 4: Implement public-discover propagation

**Files:**

- Modify: `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.mjs`
- Test: `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs`

- [ ] **Step 1: Expose the merged action in the command result**

Immediately after the existing `merged` property in the returned object, add:

```js
...(merged.requiresUserAction ? { requiresUserAction: merged.requiresUserAction } : {}),
```

- [ ] **Step 2: Run the focused public-discovery test and verify GREEN**

Run:

```bash
rtk node --test --test-name-pattern='returns merged user action' middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the complete public-discovery test file**

Run:

```bash
rtk node --test middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs
```

Expected: all tests PASS with zero failures.

### Task 5: Verify the complete change

**Files:**

- Verify: `middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.mjs`
- Verify: `middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/hot_discovery.test.mjs`
- Verify: `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.mjs`
- Verify: `middleware/openclaw/skills/knowledge-collection/scripts/public-discovery.test.mjs`

- [ ] **Step 1: Run the knowledge-collection test suite**

Run:

```bash
rtk node --test middleware/openclaw/skills/knowledge-collection/scripts/*.test.mjs middleware/openclaw/skills/knowledge-collection/references/online-search/references/hot_discovery/scripts/*.test.mjs
```

Expected: zero failures.

- [ ] **Step 2: Check formatting and unintended edits**

Run:

```bash
rtk git diff --check
rtk git status --short
rtk git diff -- middleware/openclaw/skills/knowledge-collection
```

Expected: no whitespace errors; only the approved implementation and test files are modified. The ignored design and plan documents remain untracked by Git and are not staged.

- [ ] **Step 3: Review requirements against the design**

Confirm from test output and diff that:

- valid hot-discovery actions are safely propagated;
- unknown action fields cannot enter merged output;
- the fixed policy cannot be overridden;
- malformed hot-discovery documents cannot inject actions;
- public-discover exposes the action directly;
- SearXNG candidates remain available;
- no `collect/report` behavior changed.
