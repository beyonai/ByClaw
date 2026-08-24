import { describe, expect, it, vi } from "vitest";
import { EventType, SseReasonMessageType } from "@byclaw/by-framework";

vi.mock("openclaw/plugin-sdk/routing", () => ({
  resolveAgentIdFromSessionKey: (sessionKey: string) => sessionKey.split(":")[1] || "test",
}));

vi.mock("./utils.js", () => ({
  generateRandomId: () => "mock-message-id",
}));

vi.mock("./diagnostics.js", () => ({
  emitByaiSdkFirstResponse: vi.fn(),
}));

import {
  clearActiveSdkRequestRecord,
  completeActiveSdkRequest,
  emitSdkChunkTracked,
  markActiveSdkDispatchSettled,
  registerActiveSdkRequest,
  registerSdkEmitter,
  resolveChannelRequestContextBySessionKey,
  resolveActiveSdkRequestBySessionKey,
  resolveActiveSdkRequestByTraceId,
} from "./session-context.js";

function registerLaneRequest(params: {
  accountId: string;
  laneId: string;
  sessionId?: string;
}) {
  const sessionId = params.sessionId ?? "byclaw-session-1";
  return registerActiveSdkRequest({
    accountId: params.accountId,
    sessionKey: `agent:test:direct:${sessionId}:lane:${params.laneId}`,
    to: `test:${sessionId}:lane:${params.laneId}`,
    sessionId,
    traceId: `trace-${params.laneId}`,
    parentMessageId: "caller-message",
    language: "zh_CN",
    languageProvided: true,
    laneMetadata: {
      laneId: params.laneId,
      turnId: "turn-1",
      mode: "parallel",
      agentId: `agent-${params.laneId}`,
      agentName: `Agent ${params.laneId}`,
      clientRequestId: `client-${params.laneId}`,
      queryMessageId: `query-${params.laneId}`,
      answerMessageId: `answer-${params.laneId}`,
    },
  });
}

describe("session-context multi-agent lanes", () => {
  it("keeps connector authorization on the active and shared request contexts", () => {
    const request = registerActiveSdkRequest({
      accountId: "acct-connectors",
      sessionKey: "agent:test:direct:connector-session",
      to: "test:connector-session",
      sessionId: "connector-session",
      traceId: "trace-connectors",
      language: "zh_CN",
      languageProvided: true,
      authConnectorList: { dws: true, fws: false },
    });

    expect(request.authConnectorList).toEqual({ dws: true, fws: false });
    expect(
      resolveChannelRequestContextBySessionKey(request.sessionKey)?.fields.authConnectorList,
    ).toEqual({ dws: true, fws: false });

    clearActiveSdkRequestRecord(request);
  });

  it("clears one active lane without clearing another lane for the same ByClaw session", () => {
    const accountId = "acct-lane-lifecycle";
    const laneA = registerLaneRequest({ accountId, laneId: "a" });
    const laneB = registerLaneRequest({ accountId, laneId: "b" });

    clearActiveSdkRequestRecord(laneA);

    expect(resolveActiveSdkRequestBySessionKey(laneA.sessionKey)).toBeUndefined();
    expect(resolveActiveSdkRequestByTraceId(laneA.traceId)).toBeUndefined();
    expect(resolveActiveSdkRequestBySessionKey(laneB.sessionKey)).toBe(laneB);
    expect(resolveActiveSdkRequestByTraceId(laneB.traceId)).toBe(laneB);

    clearActiveSdkRequestRecord(laneB);
  });

  it("emits APP_STREAM_RESPONSE metadata and completes only the matching lane", async () => {
    const accountId = "acct-lane-complete";
    const laneA = registerLaneRequest({ accountId, laneId: "complete-a" });
    const laneB = registerLaneRequest({ accountId, laneId: "complete-b" });
    const emitter = {
      emitState: vi.fn().mockResolvedValue(undefined),
    };
    registerSdkEmitter(accountId, emitter as any);
    markActiveSdkDispatchSettled(laneA.sessionKey);

    await expect(completeActiveSdkRequest(laneA)).resolves.toBe(true);

    expect(emitter.emitState).toHaveBeenCalledWith(
      laneA.sessionId,
      laneA.traceId,
      {
        state: "",
        metadata: expect.objectContaining({
          laneId: "complete-a",
          turnId: "turn-1",
          mode: "parallel",
          agentId: "agent-complete-a",
          agentName: "Agent complete-a",
          clientRequestId: "client-complete-a",
          queryMessageId: "query-complete-a",
          answerMessageId: "answer-complete-a",
          traceId: laneA.traceId,
        }),
      },
      expect.objectContaining({
        eventType: EventType.APP_STREAM_RESPONSE,
        parentMessageId: "caller-message",
        metadata: expect.objectContaining({
          laneId: "complete-a",
          traceId: laneA.traceId,
        }),
      }),
    );
    expect(resolveActiveSdkRequestBySessionKey(laneA.sessionKey)).toBeUndefined();
    expect(resolveActiveSdkRequestBySessionKey(laneB.sessionKey)).toBe(laneB);

    clearActiveSdkRequestRecord(laneB);
  });

  it("propagates lane metadata through tracked SDK chunk emits without changing event options", async () => {
    const accountId = "acct-lane-emit";
    const request = registerLaneRequest({ accountId, laneId: "emit" });
    const emitter = {
      emitChunk: vi.fn().mockResolvedValue(undefined),
    };

    await emitSdkChunkTracked(request.sessionKey, {
      emitter: emitter as any,
      sessionId: request.sessionId,
      traceId: request.traceId,
      text: "hello",
      options: {
        messageId: "message-1",
        parentMessageId: "-1",
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: SseReasonMessageType.think_text,
        metadata: {
          source: "test",
        },
      },
    });

    expect(emitter.emitChunk).toHaveBeenCalledWith(
      request.sessionId,
      request.traceId,
      {
        content: "hello",
        metadata: expect.objectContaining({
          source: "test",
          laneId: "emit",
          turnId: "turn-1",
          mode: "parallel",
          agentId: "agent-emit",
          agentName: "Agent emit",
          clientRequestId: "client-emit",
          queryMessageId: "query-emit",
          answerMessageId: "answer-emit",
          traceId: request.traceId,
        }),
      },
      expect.objectContaining({
        messageId: "message-1",
        parentMessageId: "caller-message",
        eventType: EventType.REASONING_LOG_DELTA,
        contentType: SseReasonMessageType.think_text,
        metadata: expect.objectContaining({
          source: "test",
          laneId: "emit",
          traceId: request.traceId,
        }),
      }),
    );

    clearActiveSdkRequestRecord(request);
  });

  it("preserves an explicit tool parent instead of replacing it with the command parent", async () => {
    const request = registerLaneRequest({ accountId: "acct-tool-parent", laneId: "tool" });
    const emitter = {
      emitChunk: vi.fn().mockResolvedValue(undefined),
    };

    await emitSdkChunkTracked(request.sessionKey, {
      emitter: emitter as any,
      sessionId: request.sessionId,
      traceId: request.traceId,
      text: "tool detail",
      options: {
        messageId: "tool-detail",
        parentMessageId: "tool-call-id",
        eventType: EventType.REASONING_LOG_DELTA,
      },
    });

    expect(emitter.emitChunk).toHaveBeenCalledWith(
      request.sessionId,
      request.traceId,
      expect.anything(),
      expect.objectContaining({
        messageId: "tool-detail",
        parentMessageId: "tool-call-id",
      }),
    );

    clearActiveSdkRequestRecord(request);
  });
});
