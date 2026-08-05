import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMock = vi.hoisted(() => {
  const state = {
    store: {} as Record<string, Record<string, unknown>>,
  };
  return {
    state,
    resolveStorePath: vi.fn(() => "/tmp/openclaw-sessions.json"),
    patchSessionEntry: vi.fn(async (params: {
      sessionKey: string;
      fallbackEntry?: Record<string, unknown>;
      update: (
        entry: Record<string, unknown>,
      ) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
    }) => {
      const existing = state.store[params.sessionKey] ?? params.fallbackEntry;
      if (!existing) {
        return null;
      }
      const patch = await params.update({ ...existing });
      if (!patch) {
        return existing;
      }
      const updated = { ...existing, ...patch };
      state.store[params.sessionKey] = updated;
      return updated;
    }),
  };
});

vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: vi.fn(() => "managed-agent"),
}));

vi.mock("./runtime.js", () => ({
  getByaiRuntime: () => ({
    agent: {
      session: {
        resolveStorePath: runtimeMock.resolveStorePath,
        patchSessionEntry: runtimeMock.patchSessionEntry,
      },
    },
  }),
}));

import { ensureSessionReasoningStream } from "./reasoning-stream.js";

const sessionKey = "agent:managed-agent:byai-channel:direct:conversation-1";

describe("ensureSessionReasoningStream", () => {
  beforeEach(() => {
    runtimeMock.state.store = {};
    runtimeMock.resolveStorePath.mockClear();
    runtimeMock.patchSessionEntry.mockClear();
  });

  it("通过 Plugin Runtime 为新会话启用 reasoning stream", async () => {
    const result = await ensureSessionReasoningStream({
      cfg: {} as never,
      sessionKey,
    });

    expect(runtimeMock.resolveStorePath).toHaveBeenCalledWith(undefined, {
      agentId: "managed-agent",
    });
    expect(runtimeMock.patchSessionEntry).toHaveBeenCalledOnce();
    expect(result).toEqual({
      changed: true,
      created: true,
      healed: false,
      sessionId: expect.any(String),
    });
    expect(runtimeMock.state.store[sessionKey]).toEqual(
      expect.objectContaining({
        sessionId: result.sessionId,
        reasoningLevel: "stream",
        chatType: "direct",
        updatedAt: expect.any(Number),
      }),
    );
  });

  it("修复缺少 sessionId 的已有会话并保留原有字段", async () => {
    runtimeMock.state.store[sessionKey] = {
      chatType: "group",
      customField: "preserved",
    };

    const result = await ensureSessionReasoningStream({
      cfg: {} as never,
      sessionKey,
    });

    expect(result).toEqual({
      changed: true,
      created: false,
      healed: true,
      sessionId: expect.any(String),
    });
    expect(runtimeMock.state.store[sessionKey]).toEqual(
      expect.objectContaining({
        sessionId: result.sessionId,
        reasoningLevel: "stream",
        chatType: "group",
        customField: "preserved",
      }),
    );
  });

  it("会话已经正确配置时不重复写入", async () => {
    runtimeMock.state.store[sessionKey] = {
      sessionId: "existing-session-id",
      reasoningLevel: "stream",
      chatType: "direct",
      updatedAt: 123,
    };

    const result = await ensureSessionReasoningStream({
      cfg: {} as never,
      sessionKey,
    });

    expect(result).toEqual({
      changed: false,
      created: false,
      healed: false,
      sessionId: "existing-session-id",
    });
    expect(runtimeMock.state.store[sessionKey]?.updatedAt).toBe(123);
  });
});
