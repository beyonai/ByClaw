import { describe, expect, it } from "vitest";
import {
  excludeAgentFromGroupChatContext,
  fingerprintGroupChatContext,
  parseGroupChatContext,
  parseGroupChatRef,
} from "../src/index.js";

function context() {
  return {
    schemaVersion: "byclaw.group-chat-context/v1",
    conversationKey: "conversation-1",
    snapshot: {
      beforeMessageId: "message-3",
      lastIncludedMessageId: "message-2",
      generatedAt: 1_000,
    },
    messages: [
      {
        messageId: "message-1",
        sequence: 1,
        createdAt: 100,
        role: "assistant",
        speaker: { type: "agent", agentId: "agent-a", agentName: "A" },
        content: "A 的结论",
      },
      {
        messageId: "message-2",
        sequence: 2,
        createdAt: 200,
        role: "assistant",
        speaker: { type: "agent", agentId: "super", agentName: "超级助手" },
        content: "Super 的旧回答",
      },
    ],
    truncation: {
      truncated: false,
      omittedMessageCount: 0,
    },
  };
}

describe("group chat context contract", () => {
  it("parses an opaque conversation reference", () => {
    expect(
      parseGroupChatRef({
        schemaVersion: "byclaw.group-chat-ref/v1",
        conversationKey: " 019fa7bc-1d45-7251-a26e-dadc471b5aa5 ",
        beforeMessageId: " message-10 ",
      }),
    ).toEqual({
      schemaVersion: "byclaw.group-chat-ref/v1",
      conversationKey: "019fa7bc-1d45-7251-a26e-dadc471b5aa5",
      beforeMessageId: "message-10",
    });
  });

  it("validates ordering and excludes Super's own previous answers", () => {
    const parsed = parseGroupChatContext(context());
    const filtered = excludeAgentFromGroupChatContext(parsed, "super");

    expect(filtered.messages.map(({ messageId }) => messageId)).toEqual([
      "message-1",
    ]);
    expect(fingerprintGroupChatContext(filtered)).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.messages).toHaveLength(2);
  });

  it("rejects duplicate or non-increasing messages", () => {
    const invalid = context();
    invalid.messages[1]!.sequence = 1;

    expect(() => parseGroupChatContext(invalid)).toThrow(
      "sequence must be strictly increasing",
    );
  });
});
