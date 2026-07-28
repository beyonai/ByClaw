import { describe, expect, it, vi } from "vitest";
import {
  ByClawBeGroupChatContextError,
  ByClawBeGroupChatContextProvider,
} from "../business/group-chat-context.js";

function contextResponse() {
  return {
    code: 0,
    success: true,
    data: {
      schemaVersion: "byclaw.group-chat-context/v1",
      conversationKey: "conversation-1",
      snapshot: {
        beforeMessageId: "message-3",
        lastIncludedMessageId: "message-2",
        generatedAt: 1_000,
      },
      messages: [
        {
          messageId: "message-2",
          sequence: 2,
          createdAt: 200,
          role: "assistant",
          speaker: {
            type: "agent",
            agentId: "agent-a",
            agentName: "Agent A",
          },
          content: "A 的结论",
        },
      ],
      truncation: {
        truncated: false,
        omittedMessageCount: 0,
      },
    },
  };
}

describe("ByClaw BE group chat context provider", () => {
  it("uses service discovery, current credentials, and a bounded request", async () => {
    const fetchImpl = vi.fn(async () => Response.json(contextResponse()));
    const provider = new ByClawBeGroupChatContextProvider({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: fetchImpl as typeof fetch,
      endpointResolver: {
        resolve: async () => "http://byclaw-be.internal:8086",
      },
    });

    const context = await provider.load({
      conversationKey: "conversation-1",
      beforeMessageId: "message-3",
      beyondToken: "secret-token",
      systemCode: "BYAI",
    });

    expect(context.messages[0]?.content).toBe("A 的结论");
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://byclaw-be.internal:8086/byaiService/internal/api/v1/group-chat/context",
    );
    expect(init?.headers).toMatchObject({
      "Beyond-Token": "secret-token",
      "System-Code": "BYAI",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      conversationKey: "conversation-1",
      beforeMessageId: "message-3",
      maxMessages: 60,
      maxCharacters: 30_000,
    });
  });

  it("rejects a snapshot for a different request boundary", async () => {
    const response = contextResponse();
    response.data.snapshot.beforeMessageId = "wrong-message";
    const provider = new ByClawBeGroupChatContextProvider({
      baseUrl: "http://127.0.0.1:8086",
      timeoutMs: 1_000,
      fetchImpl: vi.fn(async () => Response.json(response)) as typeof fetch,
    });

    await expect(
      provider.load({
        conversationKey: "conversation-1",
        beforeMessageId: "message-3",
        beyondToken: "secret-token",
      }),
    ).rejects.toBeInstanceOf(ByClawBeGroupChatContextError);
  });
});
