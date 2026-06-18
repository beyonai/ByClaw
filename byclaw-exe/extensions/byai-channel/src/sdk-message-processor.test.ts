import { describe, expect, it } from "vitest";
import type { GatewayDataEmitter } from "@byclaw/by-framework";
import { deliverReplyToAgentViaSdk } from "./sdk-message-processor.js";
import {
  clearActiveSdkRequestByTarget,
  getAgentRunEndPromiseResolver,
  markActiveSdkOverflowContinuePending,
  markActiveSdkOverflowLength,
  markActiveSdkRootLifecycleFinished,
  registerSdkEmitter,
} from "./session-context.js";
import { setByaiRuntime } from "./runtime.js";
import type { ResolvedByaiAccount } from "./types.js";

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
    let dispatchCount = 0;

    setByaiRuntime({
      agent: {
        resolveAgentWorkspaceDir: () => "/tmp/byai-channel-test-workspace",
      },
      channel: {
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
            };
          }) => {
            contexts.push(ctx);
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
            markActiveSdkRootLifecycleFinished(String(ctx.SessionKey), "end");
            return { queuedFinal: false, counts: {} };
          },
        },
      },
    } as never);

    const emittedStates: string[] = [];
    registerSdkEmitter(account.accountId, {
      emitChunk: async () => {},
      emitState: async (_sessionId: string, _traceId: string, event: string) => {
        emittedStates.push(event);
      },
    } as unknown as GatewayDataEmitter);

    await deliverReplyToAgentViaSdk({
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
      },
      onReply: async () => {},
    });

    expect(contexts).toHaveLength(2);
    expect(contexts[0]?.MediaPath).toBe("/by/.sessions/user-media/report.png");
    expect(contexts[0]?.MediaPaths).toEqual(["/by/.sessions/user-media/report.png"]);
    expect(contexts[1]?.RawBody).toContain("上一轮回答因对话达到上下文窗口上限而被截断");
    expect(contexts[1]).not.toHaveProperty("MediaPath");
    expect(contexts[1]).not.toHaveProperty("MediaPaths");
    expect(emittedStates).toContain("");

    clearActiveSdkRequestByTarget(account.accountId, "test-agent:user-media");
  });
});
