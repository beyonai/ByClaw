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

  it("normalizes numeric BE message identifiers to strings", () => {
    const numeric = context() as unknown as {
      schemaVersion: string;
      conversationKey: number;
      snapshot: {
        beforeMessageId: number;
        lastIncludedMessageId: number;
        generatedAt: number;
      };
      messages: Array<Record<string, unknown>>;
      truncation: { truncated: boolean; omittedMessageCount: number };
    };
    numeric.conversationKey = 11024882;
    numeric.snapshot.beforeMessageId = 11024955;
    numeric.snapshot.lastIncludedMessageId = 11024954;
    numeric.messages[0]!.messageId = 11024953;
    numeric.messages[1]!.messageId = 11024954;

    const parsed = parseGroupChatContext(numeric);

    expect(parsed.conversationKey).toBe("11024882");
    expect(parsed.snapshot.beforeMessageId).toBe("11024955");
    expect(parsed.snapshot.lastIncludedMessageId).toBe("11024954");
    expect(parsed.messages.map(({ messageId }) => messageId)).toEqual([
      "11024953",
      "11024954",
    ]);
  });

  it("treats null optional BE fields as absent in an empty snapshot", () => {
    const empty = context() as unknown as {
      snapshot: {
        lastIncludedMessageId: string | null;
      };
      messages: Array<Record<string, unknown>>;
      truncation: {
        truncated: boolean;
        omittedMessageCount: number;
        reason: string | null;
      };
    };
    empty.snapshot.lastIncludedMessageId = null;
    empty.messages = [];
    empty.truncation.reason = null;

    const parsed = parseGroupChatContext(empty);

    expect(parsed.snapshot).not.toHaveProperty("lastIncludedMessageId");
    expect(parsed.messages).toEqual([]);
    expect(parsed.truncation).not.toHaveProperty("reason");
  });

  it("treats null optional BE message fields as absent", () => {
    const nullable = context() as unknown as {
      messages: Array<Record<string, unknown>>;
    };
    nullable.messages[0]!.role = "user";
    nullable.messages[0]!.speaker = {
      type: "user",
      userCode: "adminvip",
      displayName: null,
    };
    nullable.messages[0]!.target = null;
    nullable.messages[0]!.attachments = null;

    const parsed = parseGroupChatContext(nullable);

    expect(parsed.messages[0]?.speaker).toEqual({
      type: "user",
      userCode: "adminvip",
    });
    expect(parsed.messages[0]).not.toHaveProperty("target");
    expect(parsed.messages[0]).not.toHaveProperty("attachments");
  });

  it("rejects duplicate or non-increasing messages", () => {
    const invalid = context();
    invalid.messages[1]!.sequence = 1;

    expect(() => parseGroupChatContext(invalid)).toThrow(
      "sequence must be strictly increasing",
    );
  });
});
