import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentState,
  AskAgentCommand,
  MessageHeader,
  ResumeCommand,
  WorkerRunner,
} from "@byclaw/by-framework";
import type { GatewayDataEmitter } from "@byclaw/by-framework";

const {
  deliverReplyToAgentViaSdk,
  getRedisInfo,
  getUserCode,
  finalizeSdkBusinessResult,
  redisClient,
  resolveActiveSdkRequestByTraceId,
} = vi.hoisted(() => {
  const finalizeSdkBusinessResult = vi.fn(async () => undefined);
  return {
    finalizeSdkBusinessResult,
    deliverReplyToAgentViaSdk: vi.fn(async () => ({
      finalAnswer: "final answer",
      finalize: finalizeSdkBusinessResult,
    })),
    getRedisInfo: vi.fn(() => ({ host: "localhost", port: 6379 })),
    getUserCode: vi.fn(() => "user-test"),
    redisClient: {
      quit: vi.fn(async () => undefined),
    },
    resolveActiveSdkRequestByTraceId: vi.fn(() => undefined),
  };
});

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn(async () => undefined),
  },
}));

vi.mock("./sdk-message-processor.js", () => ({
  deliverReplyToAgentViaSdk,
}));

vi.mock("./runtime.js", () => ({
  getByaiRuntime: () => ({
    state: {
      resolveStateDir: () => "/tmp/byai-channel-sdk-worker-test",
    },
  }),
  getRuntimeConfig: () => ({ channels: {} }),
}));

vi.mock("./utils.js", () => ({
  getRedisInfo,
  getUserCode,
}));

vi.mock("../../shared/src/redis-compat.js", () => ({
  applyByFrameworkRedisKeyPatch: vi.fn(),
  createRedisClient: vi.fn(() => redisClient),
}));

vi.mock("./session-context.js", () => ({
  buildSdkChunkEvent: (content: string) => ({ content }),
  buildSdkStateEvent: (state: string, options?: Record<string, unknown>) => ({
    state,
    metadata: options?.metadata,
  }),
  clearActiveSdkRequestRecord: vi.fn(),
  registerSdkEmitter: vi.fn(),
  resolveActiveSdkRequestByTraceId,
  resolveSdkLocalFilePath: (resourceId: string) => `/tmp/${resourceId}`,
  withSdkEmitMetadata: (options: Record<string, unknown> = {}) => options,
}));

vi.mock("../../shared/src/session-key.js", () => ({
  normalizeByaiAgentId: (agentId: string) => agentId,
}));

import { ByaiChannelGatewayWorker, ByaiSdkApp } from "./sdk-app.js";
import type { ResolvedByaiAccount } from "./types.js";

function createWorker() {
  const emitter = {
    emitChunk: vi.fn(async () => undefined),
    emitState: vi.fn(async () => undefined),
  } as unknown as GatewayDataEmitter;
  const account = {
    accountId: "account-test",
    name: "account-test",
    enabled: true,
    configured: true,
    config: {},
  } as ResolvedByaiAccount;
  const worker = new ByaiChannelGatewayWorker({
    workerId: "worker-test",
    agentTypes: ["BYCLAW_EXE_user-test"],
    redis: {} as never,
    emitter,
    account,
    userCode: "user-test",
  });
  const context = {
    emitChunk: vi.fn(async () => undefined),
    getCancellationSignal: () => undefined,
    setFinalAnswerEmitted: vi.fn(),
    setStreamFinished: vi.fn(),
  };
  return { context, emitter, worker };
}

describe("ByaiChannelGatewayWorker", () => {
  beforeEach(() => {
    deliverReplyToAgentViaSdk.mockClear();
    finalizeSdkBusinessResult.mockClear();
    resolveActiveSdkRequestByTraceId.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes ASK_AGENT and leaves terminal stream ownership to the channel gate", async () => {
    const { context, worker } = createWorker();
    const command = new AskAgentCommand(
      new MessageHeader("message-ask", "session-ask", "trace-ask", {
        targetAgentType: "BYCLAW_EXE_user-test",
        parentMessageId: "caller-message",
      }),
      "hello",
    );

    await expect(worker.processCommand(command, context as never)).resolves.toMatchObject({
      status: AgentState.COMPLETED,
      content: "final answer",
      replyData: null,
    });

    expect(deliverReplyToAgentViaSdk).toHaveBeenCalledTimes(1);
    expect(deliverReplyToAgentViaSdk.mock.calls[0]?.[0]?.message).toEqual(
      expect.objectContaining({
        messageId: "message-ask",
        parentMessageId: "caller-message",
        sessionId: "session-ask",
        text: "hello",
        traceId: "trace-ask",
      }),
    );
    expect(context.setStreamFinished).toHaveBeenCalledWith(true);
    expect(context.setFinalAnswerEmitted).toHaveBeenCalledWith(true);
    expect(finalizeSdkBusinessResult).toHaveBeenCalledTimes(1);
    expect(context.emitChunk).toHaveBeenCalledWith("final answer", "finalAnswer");
    expect(context.emitChunk.mock.invocationCallOrder[0]).toBeLessThan(
      finalizeSdkBusinessResult.mock.invocationCallOrder[0]!,
    );
  });

  it("duplicates final content into replyData for a callAgent callback", async () => {
    const { context, worker } = createWorker();
    const command = new AskAgentCommand(
      new MessageHeader("message-called", "session-called", "trace-called", {
        sourceAgentType: "BY_SUPER",
        targetAgentType: "BYCLAW_EXE_user-test",
        parentMessageId: "caller-message",
      }),
      "delegated task",
    );

    await expect(worker.processCommand(command, context as never)).resolves.toMatchObject({
      status: AgentState.COMPLETED,
      content: "final answer",
      replyData: "final answer",
    });
  });

  it("dispatches RESUME content as an OpenClaw follow-up", async () => {
    const { context, worker } = createWorker();
    const command = new ResumeCommand(
      new MessageHeader("message-resume", "session-resume", "trace-resume", {
        targetAgentType: "BYCLAW_EXE_user-test",
      }),
      "subagent result",
      AgentState.COMPLETED,
      { source: "child" },
    );

    await expect(worker.processCommand(command, context as never)).resolves.toMatchObject({
      status: AgentState.COMPLETED,
      content: "final answer",
      replyData: null,
    });

    expect(deliverReplyToAgentViaSdk).toHaveBeenCalledTimes(1);
    expect(deliverReplyToAgentViaSdk.mock.calls[0]?.[0]?.message.text).toBe("subagent result");
    expect(context.setStreamFinished).toHaveBeenCalledWith(true);
  });

  it("uses RESUME replyData when the command has no content", async () => {
    const { context, worker } = createWorker();
    const command = new ResumeCommand(
      new MessageHeader("message-resume-data", "session-resume", "trace-resume-data", {
        targetAgentType: "BYCLAW_EXE_user-test",
      }),
      "",
      AgentState.COMPLETED,
      { answer: "child result" },
    );

    await expect(worker.processCommand(command, context as never)).resolves.toMatchObject({
      status: AgentState.COMPLETED,
      content: "final answer",
    });

    expect(deliverReplyToAgentViaSdk.mock.calls[0]?.[0]?.message.text).toBe(
      JSON.stringify({ answer: "child result" }),
    );
  });

  it("fans out every multi-agent lane before completing the framework execution", async () => {
    const { context, worker } = createWorker();
    deliverReplyToAgentViaSdk
      .mockResolvedValueOnce({
        finalAnswer: "answer a",
        finalize: finalizeSdkBusinessResult,
      })
      .mockResolvedValueOnce({
        finalAnswer: "answer b",
        finalize: finalizeSdkBusinessResult,
      });
    const command = new AskAgentCommand(
      new MessageHeader("message-batch", "session-batch", "trace-batch", {
        targetAgentType: "BYCLAW_EXE_user-test",
      }),
      "shared task",
      true,
      {
        multi_agent: {
          turnId: "turn-1",
          mode: "parallel",
          lanes: [
            {
              laneId: "lane-a",
              traceId: "trace-a",
              taskText: "task a",
            },
            {
              laneId: "lane-b",
              traceId: "trace-b",
              taskText: "task b",
            },
          ],
        },
      },
    );

    await expect(worker.processCommand(command, context as never)).resolves.toMatchObject({
      status: AgentState.COMPLETED,
      content: "【lane-a】\nanswer a\n\n【lane-b】\nanswer b",
    });

    expect(deliverReplyToAgentViaSdk).toHaveBeenCalledTimes(2);
    expect(deliverReplyToAgentViaSdk.mock.calls.map((call) => call[0].message.traceId)).toEqual([
      "trace-a",
      "trace-b",
    ]);
    expect(context.setStreamFinished).toHaveBeenCalledWith(true);
    expect(finalizeSdkBusinessResult).toHaveBeenCalledTimes(2);
  });

  it("skips empty lanes and uses stable agent labels in the aggregate finalAnswer", async () => {
    const { context, worker } = createWorker();
    deliverReplyToAgentViaSdk
      .mockResolvedValueOnce({ finalAnswer: "", finalize: finalizeSdkBusinessResult })
      .mockResolvedValueOnce({
        finalAnswer: "review complete",
        finalize: finalizeSdkBusinessResult,
      });
    const command = new AskAgentCommand(
      new MessageHeader("message-labelled", "session-labelled", "trace-labelled", {
        targetAgentType: "BYCLAW_EXE_user-test",
      }),
      "shared task",
      true,
      {
        multi_agent: {
          lanes: [
            { laneId: "coder", taskText: "code" },
            { laneId: "reviewer", agentName: "Reviewer", taskText: "review" },
          ],
        },
      },
    );

    await expect(worker.processCommand(command, context as never)).resolves.toMatchObject({
      content: "【Reviewer】\nreview complete",
    });
    expect(context.emitChunk).toHaveBeenCalledWith(
      "【Reviewer】\nreview complete",
      "finalAnswer",
    );
    expect(finalizeSdkBusinessResult).toHaveBeenCalledTimes(2);
  });

  it("returns empty content without inventing a FINAL_ANSWER when every lane is empty", async () => {
    const { context, worker } = createWorker();
    deliverReplyToAgentViaSdk.mockResolvedValueOnce({
      finalAnswer: "",
      finalize: finalizeSdkBusinessResult,
    });
    const command = new AskAgentCommand(
      new MessageHeader("message-empty", "session-empty", "trace-empty", {
        targetAgentType: "BYCLAW_EXE_user-test",
      }),
      "no visible reply",
    );

    await expect(worker.processCommand(command, context as never)).resolves.toMatchObject({
      status: AgentState.COMPLETED,
      content: "",
    });
    expect(context.emitChunk).not.toHaveBeenCalled();
    expect(context.setFinalAnswerEmitted).not.toHaveBeenCalled();
    expect(finalizeSdkBusinessResult).toHaveBeenCalledTimes(1);
    expect(context.setStreamFinished).toHaveBeenCalledWith(true);
  });

  it("propagates a lane failure without emitting a completed finalAnswer", async () => {
    const { context, worker } = createWorker();
    deliverReplyToAgentViaSdk.mockRejectedValueOnce(new Error("root run failed"));
    const command = new AskAgentCommand(
      new MessageHeader("message-failed", "session-failed", "trace-failed", {
        targetAgentType: "BYCLAW_EXE_user-test",
      }),
      "fail",
    );

    await expect(worker.processCommand(command, context as never)).rejects.toThrow(
      "root run failed",
    );
    expect(context.emitChunk).not.toHaveBeenCalled();
    expect(context.setStreamFinished).not.toHaveBeenCalled();
  });

  it("maps runner cancellation to TaskCancelledError without claiming stream completion", async () => {
    const { context, worker } = createWorker();
    const abortController = new AbortController();
    context.getCancellationSignal = () => abortController.signal;
    deliverReplyToAgentViaSdk.mockImplementationOnce(
      async ({ abortController: sdkAbortController }) => {
        if (sdkAbortController.signal.aborted) {
          return;
        }
        await new Promise<void>((resolve) => {
          sdkAbortController.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    const command = new AskAgentCommand(
      new MessageHeader("message-cancel", "session-cancel", "trace-cancel", {
        targetAgentType: "BYCLAW_EXE_user-test",
      }),
      "cancel me",
    );

    const processing = worker.processCommand(command, context as never);
    abortController.abort("user cancelled");

    await expect(processing).rejects.toMatchObject({
      name: "TaskCancelledError",
    });
    expect(resolveActiveSdkRequestByTraceId).toHaveBeenCalledWith("trace-cancel");
    expect(context.setStreamFinished).not.toHaveBeenCalled();
  });

  it("uses the embedded runner lifecycle without command subscriptions", async () => {
    const initialize = vi.spyOn(WorkerRunner.prototype, "initialize").mockResolvedValue(undefined);
    const start = vi.spyOn(WorkerRunner.prototype, "start").mockResolvedValue(undefined);
    const stop = vi.spyOn(WorkerRunner.prototype, "stop");
    const subscribe = vi.spyOn(WorkerRunner.prototype, "subscribe");
    const app = new ByaiSdkApp({
      account: {
        accountId: "account-lifecycle",
        name: "account-lifecycle",
        enabled: true,
        configured: true,
        config: {},
      } as ResolvedByaiAccount,
      cfg: {} as never,
    });

    await app.start();
    await app.stop();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({ initialize: false });
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({ cancelActiveExecutions: true }));
    expect(subscribe).not.toHaveBeenCalled();
    expect(redisClient.quit).toHaveBeenCalledTimes(1);
  });
});
