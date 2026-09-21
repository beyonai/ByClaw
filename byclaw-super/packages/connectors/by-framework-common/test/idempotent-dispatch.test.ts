import { describe, expect, it, vi } from "vitest";
import { ConnectorDispatchUncertainError, RunCancellationRequestedError } from "@byclaw/by-conductor";
import { RegistryKeys } from "@byclaw/by-framework";
import { createIdempotentCallAgent, requestPendingDispatchCancellation } from "../src/idempotent-dispatch.js";
import { ByFrameworkConnector } from "../src/index.js";
import type { ByFrameworkCallAgentInput } from "../src/index.js";

// Redis 状态在不同 publisher 实例之间共享；故障在服务端提交后、客户端收到响应前注入。
function transport() {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const publications: Array<{ stream: string; command: Record<string, unknown> }> = [];
  let beforePublish: (() => Promise<void>) | undefined;
  let failure: "route" | "registry" | "publish" | undefined;
  const loseResponse = (phase: typeof failure) => {
    if (phase === failure) {
      failure = undefined;
      throw new Error(`response lost after ${phase}`);
    }
  };
  const redis = {
    zadd: vi.fn(async () => 1),
    get: vi.fn(async (key: string) => strings.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      if (!strings.has(key)) strings.set(key, value);
      if (key.startsWith("byclaw-super:dispatch-route:")) loseResponse("route");
      return "OK";
    }),
    hget: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field) ?? null),
    eval: vi.fn(async (_script: string, keyCount: number, ...args: Array<string | number>) => {
      if (keyCount === 1) {
        const [key, mapField, executionId, executionField, serialized] = args.map(String);
        const hash = hashes.get(key!) ?? new Map<string, string>();
        if (hash.has(mapField!) && hash.get(mapField!) !== executionId) throw new Error("execution conflict");
        if (!hash.has(executionField!)) hash.set(executionField!, serialized!);
        if (!hash.has(mapField!)) hash.set(mapField!, executionId!);
        hashes.set(key!, hash);
        loseResponse("registry");
        return 1;
      }
      if (beforePublish) { const hook = beforePublish; beforePublish = undefined; await hook(); }
      const [stream, receipt, cancelled, serialized] = args.map(String);
      if (strings.has(cancelled!)) return "CANCELLED";
      if (!strings.has(receipt!)) {
        publications.push({ stream: stream!, command: JSON.parse(serialized!) });
        strings.set(receipt!, `${publications.length}-0`);
      }
      loseResponse("publish");
      return strings.get(receipt!);
    }),
  };
  const registry = { hasOnlineAgentType: vi.fn(async () => [true, []]) };
  return {
    strings, hashes, publications, redis, registry,
    failAt(phase: typeof failure) { failure = phase; },
    beforePublication(hook: () => Promise<void>) { beforePublish = hook; },
    publisher: () => createIdempotentCallAgent(redis as never, registry as never),
  };
}

const request: ByFrameworkCallAgentInput = {
  sessionId: "external-1", traceId: "trace-1", sourceAgentType: "BY_SUPER",
  defaultParentMessageId: "delegation-1", parentMessageId: "delegation-1",
  messageId: "delegation-1:request", targetAgentType: "BYCLAW_EXE_user-1",
  userCode: "user-1", content: "perform one external operation", waitForReply: true,
  routePolicy: "WAKE_AND_WAIT", metadata: { "Beyond-Token": "credential-must-not-enter-receipt" },
};

describe("by-framework atomic dispatch recovery", () => {
  it("cancels the existing framework execution from a replacement connector without redispatch", async () => {
    const state = transport();
    state.failAt("publish");
    await expect(state.publisher()(request)).rejects.toBeInstanceOf(ConnectorDispatchUncertainError);
    const cancelTask = vi.fn(async () => ({ status: "CANCEL_REQUESTED", success: true }));
    const replacement = new ByFrameworkConnector({
      connectorId: "test", targetAgentTypeResolver: () => request.targetAgentType,
      redis: state.redis as never, gatewayClient: { cancelTask } as never,
    });
    await replacement.cancelPending("delegation-1", "user cancelled after publisher crashed");
    expect(cancelTask).toHaveBeenCalledWith(expect.objectContaining({
      messageId: request.messageId, sessionId: request.sessionId, targetAgentType: request.targetAgentType,
      cancelMode: "force",
    }));
    expect(state.publications).toHaveLength(1);
  });

  it("preserves cancellation before route reservation so a later old publisher cannot enqueue work", async () => {
    const state = transport();
    expect(await requestPendingDispatchCancellation(state.redis as never, request.messageId!)).toBeUndefined();
    await expect(state.publisher()(request)).rejects.toBeInstanceOf(RunCancellationRequestedError);
    expect(state.publications).toHaveLength(0);
  });

  it("atomically blocks publication when cancellation arrives after registry initialization", async () => {
    const state = transport();
    state.beforePublication(async () => {
      expect(await requestPendingDispatchCancellation(state.redis as never, request.messageId!)).toEqual({
        sessionId: request.sessionId, targetAgentType: request.targetAgentType,
      });
    });
    await expect(state.publisher()(request)).rejects.toBeInstanceOf(RunCancellationRequestedError);
    expect(state.publications).toHaveLength(0);
  });

  it("locates an accepted task after the publisher dies before externalRef persistence", async () => {
    const state = transport();
    state.failAt("publish");
    await expect(state.publisher()(request)).rejects.toBeInstanceOf(ConnectorDispatchUncertainError);
    expect(state.publications).toHaveLength(1);
    expect(await requestPendingDispatchCancellation(state.redis as never, request.messageId!)).toEqual({
      sessionId: request.sessionId, targetAgentType: request.targetAgentType,
    });
    await expect(state.publisher()(request)).rejects.toBeInstanceOf(RunCancellationRequestedError);
    expect(state.publications).toHaveLength(1);
  });

  it("publishes once when two instances dispatch the same durable Delegation concurrently", async () => {
    const state = transport();
    const results = await Promise.all([state.publisher()(request), state.publisher()(request)]);
    expect(results[0]).toEqual(results[1]);
    expect(state.publications).toHaveLength(1);
    const registry = state.hashes.get(RegistryKeys.session_registry(request.sessionId))!;
    expect([...registry.keys()].filter((key) => key.startsWith("exec:"))).toHaveLength(1);
    expect([...state.strings.values()].join(" ")).not.toContain("credential-must-not-enter-receipt");
    expect([...registry.values()].join(" ")).toContain("credential-must-not-enter-receipt");
    expect(state.redis.zadd).not.toHaveBeenCalled();
    expect(state.publications[0]!.command).toMatchObject({ header: { message_id: request.messageId } });
  });

  it.each(["route", "registry", "publish"] as const)(
    "recovers a crash after %s without losing or duplicating the child task",
    async (phase) => {
      const state = transport();
      state.failAt(phase);
      await expect(state.publisher()(request)).rejects.toBeInstanceOf(ConnectorDispatchUncertainError);
      await expect(state.publisher()(request)).resolves.toMatchObject({ status: "QUEUED" });
      expect(state.publications).toHaveLength(1);
    },
  );

  it("does not reset an already RUNNING or terminal framework execution on a retry", async () => {
    const state = transport();
    await state.publisher()(request);
    const registry = state.hashes.get(RegistryKeys.session_registry(request.sessionId))!;
    const executionId = registry.get(`msg_map:${request.messageId}`)!;
    const record = JSON.parse(registry.get(`exec:${executionId}`)!);
    const completed = { ...record, status: "COMPLETED", worker_id: "worker-b", final_answer: "done" };
    registry.set(`exec:${executionId}`, JSON.stringify(completed));
    state.registry.hasOnlineAgentType.mockImplementation(async () => { throw new Error("worker now offline"); });
    await state.publisher()(request);
    expect(JSON.parse(registry.get(`exec:${executionId}`)!)).toEqual(completed);
    expect(state.publications).toHaveLength(1);
  });

  it("does not guess whether an SDK execution created before upgrade was already published", async () => {
    const state = transport();
    state.hashes.set(RegistryKeys.session_registry(request.sessionId), new Map([[`msg_map:${request.messageId}`, "legacy-exec"]]));
    await expect(state.publisher()(request)).rejects.toThrow("SUPER_DISPATCH_LEGACY_EXECUTION");
    expect(state.publications).toHaveLength(0);
  });

  it("does not publish when ownership was lost while waiting for routing", async () => {
    const state = transport();
    const controller = new AbortController();
    state.registry.hasOnlineAgentType.mockImplementation(async () => {
      controller.abort(new Error("ownership lost"));
      return [true, []];
    });
    await expect(state.publisher()({ ...request, signal: controller.signal })).rejects.toThrow("ownership lost");
    expect(state.publications).toHaveLength(0);
    expect(state.strings.size).toBe(0);
  });
});
