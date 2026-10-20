import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeUpdateGate = vi.hoisted(() => ({
  acquire: vi.fn(),
  prepareModel: vi.fn(),
}));

vi.mock("../../shared/src/redis-runtime-update-gate.js", () => ({
  acquireRuntimeExecution: runtimeUpdateGate.acquire,
}));
vi.mock("../../shared/src/session-model-runtime.js", () => ({
  prepareSessionModelForDispatch: runtimeUpdateGate.prepareModel,
}));

beforeEach(() => {
  runtimeUpdateGate.acquire.mockReset().mockImplementation(async () => ({
    release: vi.fn(async () => {}),
    retain: () => async () => {},
  }));
  runtimeUpdateGate.prepareModel.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

vi.mock("openclaw/plugin-sdk/media-runtime", () => ({
  detectMime: vi.fn(async () => "application/octet-stream"),
  fetchRemoteMedia: vi.fn(),
  resolveChannelMediaMaxBytes: vi.fn(() => 10_000_000),
  saveMediaBuffer: vi.fn(),
}));

vi.mock("./utils.js", () => ({
  generateRandomId: vi.fn(() => "generated-id"),
  getAgentNameById: vi.fn(() => undefined),
  clearIncrementalTextSnapshot: vi.fn(),
}));

vi.mock("./diagnostics.js", () => ({
  createByaiSdkDiagnosticTrace: vi.fn(() => ({
    trace: {
      traceId: "00000000000000000000000000000001",
      spanId: "0000000000000001",
      traceFlags: "01",
    },
  })),
  emitByaiSdkDispatchCompleted: vi.fn(),
  emitByaiSdkDispatchStarted: vi.fn(() => Date.now()),
  emitByaiSdkMessageReceived: vi.fn(() => Date.now()),
  runWithByaiSdkDiagnosticTrace: vi.fn(
    (_trace: unknown, callback: () => unknown) => callback(),
  ),
}));
// 头部原有SDK会话溢出媒体处理导入
import type { GatewayDataEmitter } from "@byclaw/by-framework";
import { deliverReplyToAgentViaSdk } from "./sdk-message-processor.js";
import {
  clearActiveSdkRequestByTarget,
  bindActiveSdkRequestRunId,
  getAgentRunEndPromiseResolver,
  markActiveSdkOverflowContinuePending,
  markActiveSdkOverflowLength,
  markActiveSdkRootLifecycleFinished,
  registerSdkEmitter,
  registerActiveSdkRequest,
  recordActiveSdkRootAgentEnd,
  recordActiveSdkDispatchRunId,
  resolveActiveSdkRequestBySessionKey,
  shouldCompleteActiveSdkRequest,
} from "./session-context.js";
import { setByaiRuntime } from "./runtime.js";
import handleAgentEvent from "./agent-event.js";
import type { ResolvedByaiAccount } from "./types.js";
// 新版本新增导入（冲突右侧）
import { isOpenClawContextOverflowDispatchError } from "./dispatch-error.js";

// 冲突HEAD：SDK自动续答不携带原始媒体的测试套件
describe("deliverReplyToAgentViaSdk overflow continuation media handling", () => {
  it("does not attach the original inbound media to the auto-continue dispatch", async () => {
    const account: ResolvedByaiAccount = {
      accountId: "acct-media",
      name: "acct-media",
      enabled: true,
      configured: true,
      config: {
        sessionKeyPerSessionId: false,
        forceReasoningStream: false,
      },
    } as ResolvedByaiAccount;
    const cfg = {
      channels: {},
      session: {},
    } as never;
    const contexts: Array<Record<string, unknown>> = [];
    const skillFilters: Array<string[] | undefined> = [];
    let dispatchCount = 0;

    setByaiRuntime({
      agent: {
        resolveAgentWorkspaceDir: () => "/tmp/byai-channel-test-workspace",
      },
      channel: {
        inbound: {
          runPreparedReply: async ({
            runDispatch,
          }: {
            runDispatch: () => Promise<unknown>;
          }) => ({ dispatchResult: await runDispatch() }),
        },
        routing: {
          resolveAgentRoute: () => ({
            sessionKey: "agent:test-agent:direct:acct-media:user-media",
            agentId: "test-agent",
            channel: "byai-channel",
            accountId: account.accountId,
          }),
        },
        reply: {
          formatAgentEnvelope: ({ body }: { body: string }) => body,
          resolveEnvelopeFormatOptions: () => ({}),
          createReplyDispatcherWithTyping: () => ({
            dispatcher: {},
            replyOptions: {},
          }),
          finalizeInboundContext: (ctx: Record<string, unknown>) => ctx,
          withReplyDispatcher: async ({ run }: { run: () => Promise<unknown> }) => await run(),
          dispatchReplyFromConfig: async ({
            ctx,
            replyOptions,
          }: {
            ctx: Record<string, unknown>;
            replyOptions: {
              onAgentRunStart?: (runId: string) => Promise<void>;
              skillFilter?: string[];
            };
          }) => {
            contexts.push(ctx);
            skillFilters.push(replyOptions.skillFilter);
            dispatchCount += 1;
            const runId = `run-media-${dispatchCount}`;
            await replyOptions.onAgentRunStart?.(runId);
            getAgentRunEndPromiseResolver(runId)?.({ success: true });
            if (dispatchCount === 1) {
              markActiveSdkOverflowLength(String(ctx.SessionKey), true, {
                stopReason: "length",
                usage: { totalTokens: 49_500 },
                contextWindow: 50_000,
              });
              markActiveSdkOverflowContinuePending(String(ctx.SessionKey), true);
            }
            markActiveSdkRootLifecycleFinished(String(ctx.SessionKey), "end", runId);
            return { queuedFinal: false, counts: {} };
          },
        },
        session: {
          recordInboundSession: vi.fn(),
          resolveStorePath: vi.fn(() => "/tmp/byai-channel-test-sessions.json"),
        },
      },
    } as never);

    const emittedStates: Array<{ state?: string }> = [];
    registerSdkEmitter(account.accountId, {
      emitChunk: async () => {},
      emitState: async (
        _sessionId: string,
        _traceId: string,
        event: { state?: string },
      ) => {
        emittedStates.push(event);
      },
    } as unknown as GatewayDataEmitter);

    const result = await deliverReplyToAgentViaSdk({
      account,
      cfg,
      message: {
        messageId: "msg-media",
        sessionId: "user-media",
        userId: "user-media",
        text: "please inspect this file",
        timestamp: Date.now(),
        traceId: "trace-media",
        files: [{ filePath: "report.png", contentType: "image/png" }],
        extraPayload: {},
        accountId: account.accountId,
        language: "zh_CN",
        languageProvided: true,
        authConnectorList: { dws: true, fws: false },
      },
      onReply: async () => {},
    });
    await result.finalize();

    expect(contexts).toHaveLength(2);
    expect(contexts[0]?.MediaPath).toBe("/by/report.png");
    expect(contexts[0]?.MediaPaths).toEqual(["/by/report.png"]);
    expect(contexts[1]?.RawBody).toContain("上一轮回答因对话达到上下文窗口上限而被截断");
    expect(contexts[1]).not.toHaveProperty("MediaPath");
    expect(contexts[1]).not.toHaveProperty("MediaPaths");
    expect(skillFilters).toEqual([undefined, undefined]);
    expect(emittedStates).toContainEqual(expect.objectContaining({ state: "" }));

    clearActiveSdkRequestByTarget(account.accountId, "test-agent:user-media");
  });
});

// 冲突新版本D0.2.0：上下文溢出错误识别工具测试套件
describe("isOpenClawContextOverflowDispatchError", () => {
  it("recognizes OpenClaw recoverable context overflow dispatch errors", () => {
    expect(
      isOpenClawContextOverflowDispatchError(
        new Error(
          "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.",
        ),
      ),
    ).toBe(true);
    expect(
      isOpenClawContextOverflowDispatchError(
        "Context overflow: prompt too large for the model (precheck).",
      ),
    ).toBe(true);
    expect(
      isOpenClawContextOverflowDispatchError(
        "Context overflow: estimated context size exceeds safe threshold during tool loop.",
      ),
    ).toBe(true);
  });

  it("does not classify unrelated dispatch errors as recoverable overflow", () => {
    expect(isOpenClawContextOverflowDispatchError(new Error("Redis connection failed"))).toBe(
      false,
    );
    expect(isOpenClawContextOverflowDispatchError("provider returned HTTP 401")).toBe(false);
  });
});

describe("SDK precheck recovery", () => {
  it.each(["tool-or-answer", "stale-run", "not-dispatching", "mid-turn", "authentication"])(
    "does not recover unsafe or unrelated lifecycle errors: %s", async (scenario) => {
      const request = registerActiveSdkRequest({ accountId: "acct-recovery-guard",
        sessionKey: `agent:test:direct:recovery-guard-${scenario}`, to: `user:${scenario}`,
        sessionId: `recovery-guard-${scenario}`, language: "zh_CN", languageProvided: true });
      bindActiveSdkRequestRunId(request.sessionKey, "current-run");
      request.contextOverflowRecovery.dispatchPending = scenario !== "not-dispatching";
      request.contextOverflowRecovery.replaySafe = scenario !== "tool-or-answer";
      request.contextOverflowRecovery.dispatchRunId = "current-run";
      const error = scenario === "authentication" ? "provider returned HTTP 401"
        : scenario === "mid-turn" ? "Context overflow: prompt too large for the model (mid-turn precheck)."
        : "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model.";
      try {
        await handleAgentEvent({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } } as never, {
          runId: scenario === "stale-run" ? "old-run" : "current-run",
          sessionKey: request.sessionKey, stream: "lifecycle", seq: 1, ts: Date.now(),
          data: { phase: "error", error },
        });
        expect(request.contextOverflowRecovery.precheckError).toBeUndefined();
        if (scenario === "stale-run") expect(request.contextOverflowRecovery.contextFailure).toBeUndefined();
      } finally {
        clearActiveSdkRequestByTarget(request.accountId, request.to);
      }
    },
  );
  it.each([true, false, "lifecycle", "required", "payload", "native-timeout"].flatMap((runStarted) =>
    (["zh_CN", "en_US"] as const).map((language) => ({ runStarted, language })),
  ))("holds finalization and replays original text/media ($runStarted, $language)", async ({ runStarted, language }) => {
    if (runStarted === "native-timeout") vi.useFakeTimers();
    let deliverPayload: (payload: { text: string; isError: boolean }) => Promise<void>;
    const sessionKey = "agent:test-agent:direct:acct-recovery:user-recovery";
    const contexts: Array<Record<string, unknown>> = [];
    const notices: string[] = [];
    const chunks: string[] = [];
    const states: unknown[] = [];
    const cfg = { channels: {}, session: {}, agents: { defaults: { compaction: { timeoutSeconds: runStarted === "native-timeout" ? 1 : 300 } } } };
    const account = { accountId: "acct-recovery", enabled: true, configured: true,
      config: { sessionKeyPerSessionId: false, forceReasoningStream: false } } as ResolvedByaiAccount;
    const precheck = "Context overflow: prompt too large for the model (precheck).";
    let compactCalls = 0;
    const compact = vi.fn(async () => {
      compactCalls++;
      const request = resolveActiveSdkRequestBySessionKey(sessionKey)!;
      expect(shouldCompleteActiveSdkRequest(request)).toBe(false);
      expect(states).toHaveLength(0);
      return compactCalls === 1 ? { ok: false, compacted: false, reason: "Compaction timed out" }
        : { ok: true, compacted: true, result: { tokensBefore: 180000, tokensAfter: 30000 } };
    });
    setByaiRuntime({
      config: { current: () => cfg },
      gateway: { isAvailable: async () => true, request: compact },
      agent: { resolveAgentWorkspaceDir: () => "/tmp/byai-channel-test-workspace" },
      channel: {
        inbound: { runPreparedReply: async ({ runDispatch }: any) => ({ dispatchResult: await runDispatch() }) },
        routing: { resolveAgentRoute: () => ({ sessionKey, agentId: "test-agent", channel: "byai-channel", accountId: account.accountId }) },
        session: { recordInboundSession: vi.fn(), resolveStorePath: () => "/tmp/byai-channel-test-sessions.json" },
        reply: {
          formatAgentEnvelope: ({ body }: any) => body,
          resolveEnvelopeFormatOptions: () => ({}),
          createReplyDispatcherWithTyping: ({ deliver }: any) => {
            deliverPayload = deliver;
            return { dispatcher: {}, replyOptions: {} };
          },
          finalizeInboundContext: (ctx: unknown) => ctx,
          withReplyDispatcher: async ({ run }: any) => run(),
          dispatchReplyFromConfig: async ({ ctx, replyOptions }: any) => {
            contexts.push(ctx);
            const runId = `run-precheck-${contexts.length}`;
            const success = contexts.length === 3;
            if (!success && runStarted === "required") throw new Error("Preflight compaction required but failed: Compaction timed out");
            if (!success && runStarted === "payload") {
              await deliverPayload({ text: "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session.", isError: true });
              return { queuedFinal: false, counts: {} };
            }
            if (!success && runStarted === "native-timeout") {
              await replyOptions.onCompactionStart();
              await new Promise<void>((_resolve, reject) => replyOptions.abortSignal.addEventListener("abort", () => reject(replyOptions.abortSignal.reason)));
            }
            if (runStarted === true || runStarted === "lifecycle" || success) await replyOptions.onAgentRunStart(runId);
            const error = success ? undefined : precheck;
            if (runStarted === "lifecycle" && !success) {
              // Real 2026.7.1 early return: no llm_input or agent_end hook.
              await handleAgentEvent({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } } as never, {
                runId, sessionKey, stream: "lifecycle", seq: 1, ts: Date.now(),
                data: { phase: "error", error: "Context overflow: prompt too large for the model. Try /reset (or /new) to start a fresh session, or use a larger-context model." },
              });
            } else {
              recordActiveSdkDispatchRunId(sessionKey, runId);
              getAgentRunEndPromiseResolver(runId)?.({ success, error });
              recordActiveSdkRootAgentEnd({ runId, sessionKey, success, error,
                messages: success ? [{ role: "assistant", content: "最终结果" }] : [] });
              if (runStarted === true || runStarted === "lifecycle" || success) markActiveSdkRootLifecycleFinished(sessionKey, success ? "end" : "error", runId);
            }
            return { queuedFinal: false, counts: {} };
          },
        },
      },
    } as never);
    registerSdkEmitter(account.accountId, {
      emitChunk: async (_s: unknown, _t: unknown, event: unknown) => { chunks.push(JSON.stringify(event)); },
      emitState: async (_s: unknown, _t: unknown, event: unknown) => { states.push(event); },
    } as unknown as GatewayDataEmitter);
    const pending = deliverReplyToAgentViaSdk({
      account, cfg: cfg as never,
      message: { messageId: "msg-recovery", sessionId: "user-recovery", userId: "user-recovery",
        text: "查一下名单", timestamp: Date.now(), traceId: "trace-recovery", accountId: account.accountId,
        files: [{ filePath: "report.png", contentType: "image/png" }], extraPayload: {},
        language, languageProvided: true },
      onReply: async (text) => { notices.push(text); },
    });
    if (runStarted === "native-timeout") await vi.advanceTimersByTimeAsync(65_000);
    const result = await pending;
    expect(result.finalAnswer).toBe("最终结果");
    expect(compact).toHaveBeenCalledTimes(3);
    expect(contexts).toHaveLength(3);
    expect(new Set(contexts.map((ctx) => ctx.MessageSid)).size).toBe(3);
    for (const ctx of contexts) {
      expect(ctx.RawBody).toBe("查一下名单");
      expect(ctx.MediaPath).toBe("/by/report.png");
      expect(ctx.SessionKey).toBe(sessionKey);
    }
    const recoveryTitle = language === "en_US" ? "Automatically compressing context" : "正在自动压缩上下文";
    expect(notices.filter((text) => text.includes(recoveryTitle))).toHaveLength(3);
    if (language === "en_US") expect(notices.join("\n")).not.toMatch(/\p{Script=Han}/u);
    expect(chunks.join("")).not.toContain(precheck);
    expect(chunks.join("")).not.toContain("Try /reset");
    expect(states).toHaveLength(0);
    await result.finalize();
    expect(states).toHaveLength(1);
  });
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function createUpdateGateDispatchFixture(options: {
  run?: () => Promise<void>;
  currentConfig?: () => any;
  agentId?: string;
  log?: { warn?: (message: string) => void };
} = {}) {
  const account = { accountId: "acct-update-gate", enabled: true, configured: true,
    config: { sessionKeyPerSessionId: false, forceReasoningStream: false } } as ResolvedByaiAccount;
  const initialConfig = { channels: {}, session: {} };
  const dispatch = vi.fn(async ({ ctx, replyOptions }: any) => {
    const runId = `run-update-${ctx.SessionKey}`;
    await replyOptions.onAgentRunStart(runId);
    await options.run?.();
    recordActiveSdkDispatchRunId(ctx.SessionKey, runId);
    getAgentRunEndPromiseResolver(runId)?.({ success: true });
    recordActiveSdkRootAgentEnd({ runId, sessionKey: ctx.SessionKey, success: true,
      messages: [{ role: "assistant", content: "done" }] });
    markActiveSdkRootLifecycleFinished(ctx.SessionKey, "end", runId);
    return { queuedFinal: false, counts: {} };
  });
  setByaiRuntime({
    config: { current: options.currentConfig ?? (() => initialConfig) },
    agent: { resolveAgentWorkspaceDir: () => "/tmp/byai-channel-test-workspace" },
    channel: {
      inbound: { runPreparedReply: async ({ runDispatch }: any) => ({ dispatchResult: await runDispatch() }) },
      routing: { resolveAgentRoute: ({ peer }: any) => ({ sessionKey: `agent:test-agent:direct:${peer.id}`,
        agentId: options.agentId ?? "test-agent", channel: "byai-channel", accountId: account.accountId }) },
      session: { recordInboundSession: vi.fn(), resolveStorePath: () => "/tmp/byai-channel-test-sessions.json" },
      reply: {
        formatAgentEnvelope: ({ body }: any) => body,
        resolveEnvelopeFormatOptions: () => ({}),
        createReplyDispatcherWithTyping: () => ({ dispatcher: {}, replyOptions: {} }),
        finalizeInboundContext: (ctx: unknown) => ctx,
        withReplyDispatcher: async ({ run }: any) => run(),
        dispatchReplyFromConfig: dispatch,
      },
    },
  } as never);
  registerSdkEmitter(account.accountId, { emitChunk: async () => {}, emitState: async () => {} } as unknown as GatewayDataEmitter);
  const invoke = (sessionId: string, abortController?: AbortController) => deliverReplyToAgentViaSdk({
    account, cfg: initialConfig as never, abortController, log: options.log,
    message: { messageId: `msg-${sessionId}`, sessionId, userId: sessionId, text: "test",
      timestamp: Date.now(), traceId: `trace-${sessionId}`, accountId: account.accountId,
      extraPayload: {}, language: "en_US", languageProvided: true },
    onReply: async () => {},
  });
  return { dispatch, invoke };
}

describe("SDK Redis update admission", () => {
  it("finishes model preparation before acquiring an execution lease", async () => {
    const preparation = deferred();
    runtimeUpdateGate.prepareModel.mockReturnValue(preparation.promise);
    const fixture = createUpdateGateDispatchFixture();
    const controller = new AbortController();
    const pending = fixture.invoke("prepare-before-lease", controller);
    await vi.waitFor(() => expect(runtimeUpdateGate.prepareModel).toHaveBeenCalledWith("prepare-before-lease", controller.signal));
    expect(runtimeUpdateGate.acquire).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
    preparation.resolve();
    const result = await pending;
    expect(runtimeUpdateGate.acquire).toHaveBeenCalledWith({ signal: controller.signal });
    await result.finalize();
  });

  it("waits behind an update and reads the applied configuration after admission", async () => {
    const admission = deferred<any>();
    const release = vi.fn(async () => {});
    runtimeUpdateGate.acquire.mockReturnValue(admission.promise);
    let cfg = { channels: {}, session: {}, updateGeneration: 1 };
    const fixture = createUpdateGateDispatchFixture({ currentConfig: () => cfg });
    const pending = fixture.invoke("update-wait");
    await vi.waitFor(() => expect(runtimeUpdateGate.acquire).toHaveBeenCalledOnce());
    expect(fixture.dispatch).not.toHaveBeenCalled();
    cfg = { ...cfg, updateGeneration: 2 };
    admission.resolve({ release, retain: () => async () => {} });
    const result = await pending;
    expect(fixture.dispatch.mock.calls[0]?.[0].cfg).toBe(cfg);
    expect(release).not.toHaveBeenCalled();
    await result.finalize();
    await result.finalize();
    expect(release).toHaveBeenCalledOnce();
  });

  it("holds concurrent model and tool executions through each final output", async () => {
    const model = deferred();
    const tool = deferred();
    const releases = [vi.fn(async () => {}), vi.fn(async () => {})];
    for (const release of releases) runtimeUpdateGate.acquire.mockResolvedValueOnce({ release, retain: () => async () => {} });
    const work = vi.fn().mockReturnValueOnce(model.promise).mockReturnValueOnce(tool.promise);
    const fixture = createUpdateGateDispatchFixture({ run: work });
    const first = fixture.invoke("parallel-first");
    const second = fixture.invoke("parallel-second");
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledTimes(2));
    expect(releases.every((release) => release.mock.calls.length === 0)).toBe(true);
    model.resolve();
    const firstResult = await first;
    expect(releases.every((release) => release.mock.calls.length === 0)).toBe(true);
    await firstResult.finalize();
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(releases[1]).not.toHaveBeenCalled();
    tool.resolve();
    const secondResult = await second;
    expect(releases[1]).not.toHaveBeenCalled();
    await secondResult.finalize();
    expect(releases[1]).toHaveBeenCalledOnce();
  });

  it("retains a cancelled model or tool operation until its actual cleanup finishes", async () => {
    const running = deferred();
    const releaseRoot = vi.fn(async () => {});
    const releaseDispatch = vi.fn(async () => {});
    const retain = vi.fn(() => releaseDispatch);
    runtimeUpdateGate.acquire.mockResolvedValue({ release: releaseRoot, retain });
    const fixture = createUpdateGateDispatchFixture({ run: () => running.promise });
    const controller = new AbortController();
    const pending = fixture.invoke("cancelled-original-dispatch", controller);
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledOnce());
    controller.abort(new Error("user cancelled"));
    await expect(pending).rejects.toThrow("user cancelled");
    expect(releaseRoot).toHaveBeenCalledOnce();
    expect(retain).toHaveBeenCalledOnce();
    expect(releaseDispatch).not.toHaveBeenCalled();
    running.resolve();
    await vi.waitFor(() => expect(releaseDispatch).toHaveBeenCalledOnce());
  });

  it("does not dispatch a managed employee removed while waiting for an update", async () => {
    const admission = deferred<any>();
    const release = vi.fn(async () => {});
    runtimeUpdateGate.acquire.mockReturnValue(admission.promise);
    let cfg: any = { agents: { list: [{ id: "baiying-agent-ready", model: "provider/model" }] },
      models: { providers: { provider: { models: [{ id: "model" }] } } } };
    const fixture = createUpdateGateDispatchFixture({ agentId: "baiying-agent-ready", currentConfig: () => cfg });
    const pending = fixture.invoke("removed-employee");
    await vi.waitFor(() => expect(runtimeUpdateGate.acquire).toHaveBeenCalledOnce());
    cfg = { agents: { list: [] } };
    admission.resolve({ release, retain: () => async () => {} });
    await expect(pending).rejects.toThrow("agent_missing");
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it.each(["root", "dispatch"])("does not fail a completed business result when the %s lease release fails", async (scope) => {
    const releaseRoot = vi.fn(async () => { if (scope === "root") throw new Error("Redis unavailable"); });
    const releaseDispatch = vi.fn(async () => { if (scope === "dispatch") throw new Error("Redis unavailable"); });
    runtimeUpdateGate.acquire.mockResolvedValue({ release: releaseRoot, retain: () => releaseDispatch });
    const warn = vi.fn();
    const fixture = createUpdateGateDispatchFixture({ log: { warn } });
    const result = await fixture.invoke(`release-failure-${scope}`);
    expect(result.finalAnswer).toBe("done");
    await expect(result.finalize()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("execution release failed; updates remain blocked"));
  });
});
