# ByAI Channel Language Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make direct `byai-channel` requests consistently obey the normalized channel language without adding ACP behavior or backporting unrelated develop features.

**Architecture:** Keep the current SDK request and `before_prompt_build` flow. Change only language-source precedence in `i18n.ts` and the language-section condition in `hooks.ts`, with focused Vitest coverage around the public resolver and the registered hook boundary.

**Tech Stack:** TypeScript, OpenClaw plugin hooks, `@byclaw/by-framework`, Vitest 3, esbuild, Podman, Redis Cluster.

## Global Constraints

- Do not add or backport ACP language metadata, ACP tools, or ACP adapters.
- Do not backport develop's prompt-injection snapshot, chat-room, multi-agent, or session architecture.
- Preserve the existing Chinese and English mandatory-language prompt wording.
- Do not infer response language from user message text.
- Preserve `languageProvided` as a provenance flag.
- Unknown non-empty locales continue to normalize to `zh_CN`.
- Production changes stay within `byclaw-exe/extensions/byai-channel/src/i18n.ts` and `byclaw-exe/extensions/byai-channel/src/hooks.ts`.
- Redis must finish with exactly one default LLM model: `MiniMax-M3`.

---

## File Structure

- Create `byclaw-exe/extensions/byai-channel/src/i18n.test.ts`: language-source precedence and fallback tests.
- Create `byclaw-exe/extensions/byai-channel/src/hooks.language.test.ts`: registered `before_prompt_build` behavior for default Chinese and explicit English requests.
- Modify `byclaw-exe/extensions/byai-channel/src/i18n.ts`: prefer explicit channel metadata over `LANG`.
- Modify `byclaw-exe/extensions/byai-channel/src/hooks.ts`: inject the mandatory language prompt for every active request.

### Task 1: Make Channel Metadata the Authoritative Language Source

**Files:**
- Create: `byclaw-exe/extensions/byai-channel/src/i18n.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/i18n.ts:52-69`

**Interfaces:**
- Consumes: `resolveLanguage(language?: string): Language`, `getLangFromEnv(): string`.
- Produces: unchanged `resolveInboundLanguage(metadataLanguage?: string): { language: Language; languageProvided: boolean }`.

- [ ] **Step 1: Write the failing precedence tests**

Create `src/i18n.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveInboundLanguage } from "./i18n.js";

describe("resolveInboundLanguage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers explicit channel metadata over LANG", () => {
    vi.stubEnv("LANG", "zh_CN");

    expect(resolveInboundLanguage("en_US")).toEqual({
      language: "en_US",
      languageProvided: true,
    });
  });

  it("uses LANG when channel metadata is empty", () => {
    vi.stubEnv("LANG", "en_US");

    expect(resolveInboundLanguage("  ")).toEqual({
      language: "en_US",
      languageProvided: true,
    });
  });

  it("defaults to zh_CN without metadata or LANG", () => {
    vi.stubEnv("LANG", "");

    expect(resolveInboundLanguage()).toEqual({
      language: "zh_CN",
      languageProvided: false,
    });
  });
});
```

- [ ] **Step 2: Run the tests and verify the first case fails for the expected reason**

Run:

```bash
cd byclaw-exe/extensions/byai-channel
npx vitest run src/i18n.test.ts
```

Expected: the first test fails because the current implementation returns `zh_CN` from `LANG`; the fallback and default cases pass.

- [ ] **Step 3: Implement metadata-first resolution**

Replace the `resolveInboundLanguage` body and update its comment:

```ts
/**
 * UI / hook i18n: prefer explicit `metadata.language`, then `LANG`.
 * `languageProvided` records whether either source supplied a non-empty value.
 */
export function resolveInboundLanguage(metadataLanguage?: string): {
    language: Language;
    languageProvided: boolean;
} {
    const raw = typeof metadataLanguage === "string" ? metadataLanguage.trim() : "";
    if (raw) {
        return { language: resolveLanguage(raw), languageProvided: true };
    }
    const envLang = getLangFromEnv();
    return {
        language: resolveLanguage(envLang),
        languageProvided: Boolean(envLang),
    };
}
```

- [ ] **Step 4: Run the focused tests and verify green**

Run:

```bash
npx vitest run src/i18n.test.ts
```

Expected: 1 file and 3 tests pass.

- [ ] **Step 5: Commit the independently verified resolver change**

```bash
git add byclaw-exe/extensions/byai-channel/src/i18n.ts \
  byclaw-exe/extensions/byai-channel/src/i18n.test.ts
git commit -m "fix(byai-channel): prefer request channel language"
```

### Task 2: Always Inject the Mandatory Language Prompt for Active Requests

**Files:**
- Create: `byclaw-exe/extensions/byai-channel/src/hooks.language.test.ts`
- Modify: `byclaw-exe/extensions/byai-channel/src/hooks.ts:206-220`

**Interfaces:**
- Consumes: `registerByaiHooks(api)`, `registerActiveSdkRequest(params)`, `clearActiveSdkRequestRecord(request)`.
- Produces: unchanged `before_prompt_build` hook result `{ appendSystemContext?: string }`.

- [ ] **Step 1: Write the failing hook-boundary test**

Create `src/hooks.language.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerByaiHooks } from "./hooks.js";
import {
  clearActiveSdkRequestRecord,
  registerActiveSdkRequest,
  type ActiveSdkRequest,
} from "./session-context.js";

type HookHandler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;

function captureHooks(): Map<string, HookHandler> {
  const hooks = new Map<string, HookHandler>();
  registerByaiHooks({
    on: (name: string, handler: HookHandler) => {
      hooks.set(name, handler);
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as never);
  return hooks;
}

describe("byai-channel language prompt hook", () => {
  const requests: ActiveSdkRequest[] = [];

  afterEach(() => {
    for (const request of requests.splice(0)) {
      clearActiveSdkRequestRecord(request);
    }
  });

  it.each([
    {
      language: "zh_CN" as const,
      languageProvided: false,
      expectedTitle: "## 渠道语言（强制 · 最高优先级）",
    },
    {
      language: "en_US" as const,
      languageProvided: true,
      expectedTitle: "## Channel language (mandatory · highest priority)",
    },
  ])("injects $language for every active request", ({
    language,
    languageProvided,
    expectedTitle,
  }) => {
    const sessionKey = `agent:main:direct:language-${language}`;
    const request = registerActiveSdkRequest({
      accountId: "default",
      sessionKey,
      to: `user:language-${language}`,
      sessionId: `language-${language}`,
      traceId: `trace-language-${language}`,
      language,
      languageProvided,
    });
    requests.push(request);
    const hook = captureHooks().get("before_prompt_build");

    expect(hook).toBeTypeOf("function");
    const result = hook?.(
      { prompt: "hello" },
      { sessionKey, sessionId: request.sessionId, channelId: "byai-channel" },
    ) as { appendSystemContext?: string };

    expect(result.appendSystemContext).toContain(expectedTitle);
  });
});
```

The production mutation this test catches is restoring the `request?.languageProvided` guard, which would omit the default `zh_CN` system instruction.

- [ ] **Step 2: Run the test and verify the default-language row fails**

Run:

```bash
npx vitest run src/hooks.language.test.ts
```

Expected: the `zh_CN` row fails because `languageProvided=false` currently suppresses `buildLanguagePrompt`; the `en_US` row passes.

- [ ] **Step 3: Implement unconditional active-request injection**

In `before_prompt_build`, replace:

```ts
if (request?.languageProvided) {
  sections.push(buildLanguagePrompt(request.language));
}
```

with:

```ts
if (request) {
  sections.push(buildLanguagePrompt(request.language));
}
```

- [ ] **Step 4: Run both language test files and Redis compatibility coverage**

Run:

```bash
npx vitest run \
  src/i18n.test.ts \
  src/hooks.language.test.ts \
  src/redis-compat.test.ts
```

Expected: 3 files and 10 tests pass.

- [ ] **Step 5: Build the plugin**

Run:

```bash
npm run build
git diff --check
```

Expected: esbuild exits 0 and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit the hook and regression test**

```bash
git add byclaw-exe/extensions/byai-channel/src/hooks.ts \
  byclaw-exe/extensions/byai-channel/src/hooks.language.test.ts
git commit -m "fix(byai-channel): always enforce channel language"
```

### Task 3: OpenClaw, SDK, Tool, and Dynamic-Model Verification

**Files:**
- No tracked files.
- Reuse: `openclawConfig/.env`, `openclawConfig/openclaw.json`, `.tmp-openclaw-run-state`.
- Reuse container: `openclaw-dynamic-20260728`.

**Interfaces:**
- Consumes: `GatewayClient.sendMessage(...)` from `@byclaw/by-framework`, Redis Cluster v2 keys, current bind-mounted plugin build.
- Produces: captured SDK response chunks, OpenClaw logs, model snapshots, and final Redis default-model evidence.

- [ ] **Step 1: Restart the bind-mounted OpenClaw test container**

```bash
podman restart openclaw-dynamic-20260728
podman ps --filter name=openclaw-dynamic-20260728 \
  --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
podman logs --since 2m openclaw-dynamic-20260728 2>&1 | tail -120
```

Expected: the container uses `10.10.168.203:9080/byclaw/byclaw-openclaw:D0.0.5`, starts without configuration-invalid errors, and loads both bind-mounted plugins.

- [ ] **Step 2: Prepare the proven SDK sender as an untracked temporary harness**

Extract the existing develop-only test sender without merging or copying ACP code:

```bash
export BYAI_LANGUAGE_HARNESS=/tmp/byai-channel-language-harness
mkdir -p "$BYAI_LANGUAGE_HARNESS/scripts"
git archive --format=tar origin/develop \
  byclaw-exe/extensions/byai-channel/scripts/send-inbound-message.mjs |
  tar -x -C "$BYAI_LANGUAGE_HARNESS/scripts" --strip-components=4
ln -sfn \
  /Users/chenxiaofeng/code/open/ByClaw/byclaw-exe/extensions/byai-channel/node_modules \
  "$BYAI_LANGUAGE_HARNESS/node_modules"
set -a
source /Users/chenxiaofeng/code/open/ByClaw/openclawConfig/.env
set +a
```

The harness is test-only, stays outside the repository, and is not committed.

- [ ] **Step 3: Verify Chinese channel enforcement with an English query**

```bash
node "$BYAI_LANGUAGE_HARNESS/scripts/send-inbound-message.mjs" \
  --agent-id 10000235 \
  --language zh_CN \
  --content "Briefly introduce your knowledge assistant capabilities." \
  --wait-ms 180000
```

Expected: the final visible answer is primarily Simplified Chinese. Container logs for the generated session contain `## 渠道语言（强制 · 最高优先级）`.

- [ ] **Step 4: Verify English channel enforcement with a Chinese query**

```bash
node "$BYAI_LANGUAGE_HARNESS/scripts/send-inbound-message.mjs" \
  --agent-id 10000235 \
  --language en_US \
  --content "简要介绍你的知识助手能力。" \
  --wait-ms 180000
```

Expected: the final visible answer is primarily English. Container logs for the generated session contain `## Channel language (mandatory · highest priority)`.

- [ ] **Step 5: Verify a real `baiying_call` knowledge-base invocation**

```bash
node "$BYAI_LANGUAGE_HARNESS/scripts/send-inbound-message.mjs" \
  --agent-id 10000235 \
  --language zh_CN \
  --content "请实际调用 baiying_call 工具查询你的知识库，查询“平台管理员adminvip的个人知识库”相关内容。完成后回复 TOOL_CALLED=是，并给出简短摘要。" \
  --wait-ms 180000
```

Expected: logs contain a real `baiying_call` start/result event and a successful tool payload; a knowledge base with no matching content is acceptable, but skipping the tool call is not.

- [ ] **Step 6: Repeat the established Redis dynamic-model sequence**

Define a shell function that updates only the employee's model fields and publishes the normal change event:

```bash
switch_employee_model() {
  node --input-type=module -e '
    import Redis from "/Users/chenxiaofeng/code/open/ByClaw/byclaw-exe/extensions/byai-channel/node_modules/ioredis/built/index.js";
    const instanceId = process.argv[1];
    const modelName = process.argv[2];
    const nodes = process.env.REDIS_CLUSTER_HOST.split(",").map((entry) => {
      const split = entry.lastIndexOf(":");
      return { host: entry.slice(0, split), port: Number(entry.slice(split + 1)) };
    });
    const redis = new Redis.Cluster(nodes, {
      redisOptions: {
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
      },
    });
    const key = "DIG_EMPLOYEE_10000235";
    const employee = JSON.parse(await redis.get(key));
    const prologue = JSON.parse(employee.prologue);
    prologue.modelInfo = {
      ...prologue.modelInfo,
      modelId: Number(instanceId),
      model: modelName,
    };
    prologue.modelId = Number(instanceId);
    employee.prologue = JSON.stringify(prologue);
    await redis.set(key, JSON.stringify(employee));
    await redis.publish("byai:pub:dig_employee_change", JSON.stringify({
      eventType: "DIG_EMPLOYEE_UPDATED",
      resourceId: "10000235",
      resourceBizType: "DIG_EMPLOYEE",
      changedAt: Date.now(),
    }));
    await redis.quit();
  ' "$1" "$2"
}
```

Run the sequence:

```bash
switch_employee_model 11000161 MiniMax-M3
sleep 3
node "$BYAI_LANGUAGE_HARNESS/scripts/send-inbound-message.mjs" \
  --agent-id 10000235 \
  --language zh_CN \
  --content "模型切换验证：请只回复 MODEL_M3_OK。" \
  --wait-ms 180000

switch_employee_model -2000 MiniMax-M3-2000
sleep 3
node "$BYAI_LANGUAGE_HARNESS/scripts/send-inbound-message.mjs" \
  --agent-id 10000235 \
  --language zh_CN \
  --content "模型切换验证：请只回复 MODEL_M3_2000_OK。" \
  --wait-ms 180000

switch_employee_model 11000161 MiniMax-M3
sleep 3
```

Inspect the fresh session JSONL files after each SDK call. The first must record provider `baiying-m-11000161`, model `MiniMax-M3`; the second must record provider `baiying-m-neg-2000`, model `MiniMax-M3`.

Do not use `kimi-k2.6`.

- [ ] **Step 7: Verify the final Redis and runtime state**

Run a read-only assertion:

```bash
node --input-type=module -e '
  import Redis from "/Users/chenxiaofeng/code/open/ByClaw/byclaw-exe/extensions/byai-channel/node_modules/ioredis/built/index.js";
  const nodes = process.env.REDIS_CLUSTER_HOST.split(",").map((entry) => {
    const split = entry.lastIndexOf(":");
    return { host: entry.slice(0, split), port: Number(entry.slice(split + 1)) };
  });
  const redis = new Redis.Cluster(nodes, {
    redisOptions: {
      username: process.env.REDIS_USERNAME,
      password: process.env.REDIS_PASSWORD,
    },
  });
  const llm = JSON.parse(await redis.hget("byai:aimodel:typelist", "LLM"));
  const defaults = llm.filter((entry) => Number(entry.isDefault) === 1);
  const employee = JSON.parse(await redis.get("DIG_EMPLOYEE_10000235"));
  const prologue = JSON.parse(employee.prologue);
  console.log(JSON.stringify({
    defaultCount: defaults.length,
    defaultModel: defaults[0]?.modelName,
    defaultInstanceId: defaults[0]?.instanceId,
    employeeModel: prologue.modelInfo?.model,
    employeeModelId: prologue.modelInfo?.modelId,
  }, null, 2));
  if (
    defaults.length !== 1 ||
    defaults[0]?.modelName !== "MiniMax-M3" ||
    String(defaults[0]?.instanceId) !== "11000161" ||
    prologue.modelInfo?.model !== "MiniMax-M3" ||
    String(prologue.modelInfo?.modelId) !== "11000161"
  ) {
    process.exitCode = 1;
  }
  await redis.quit();
'
```

Confirm from the command output and a final fresh SDK session:

- `byai:aimodel:typelist` resolves exactly one default LLM.
- The default model is `MiniMax-M3`, instance ID `11000161`.
- A fresh `baiying-agent-10000235` session records `baiying-m-11000161/MiniMax-M3`.
- OpenClaw logs show no `Config invalid`, unrecognized-key, or Redis `CROSSSLOT` errors for this run.

- [ ] **Step 8: Run final automated verification and inspect scope**

```bash
cd /Users/chenxiaofeng/code/open/ByClaw/byclaw-exe/extensions/byai-channel
npx vitest run \
  src/i18n.test.ts \
  src/hooks.language.test.ts \
  src/redis-compat.test.ts
npm run build
cd /Users/chenxiaofeng/code/open/ByClaw
git diff --check
git status --short
git diff --stat HEAD~2..HEAD
```

Expected: all focused tests pass, build exits 0, only the planned source/tests plus approved design and plan documents are involved, and unrelated untracked files remain untouched.
