import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  formatGroupChatMemoryDelta,
  GROUP_CHAT_MEMORY_CURSOR_TYPE,
  parseGroupChatContext,
  prepareGroupChatMemoryUpdate,
} from "../src/index.js";

function context(messageIds: string[], beforeMessageId: string) {
  return parseGroupChatContext({
    schemaVersion: "byclaw.group-chat-context/v1",
    conversationKey: "conversation-1",
    snapshot: {
      beforeMessageId,
      lastIncludedMessageId: messageIds.at(-1),
      generatedAt: 1_000,
    },
    messages: messageIds.map((messageId, index) => ({
      messageId,
      sequence: index + 1,
      createdAt: 100 + index,
      role: "assistant",
      speaker: {
        type: "agent",
        agentId: `agent-${index + 1}`,
        agentName: `Agent ${index + 1}`,
      },
      content: `answer ${index + 1}`,
    })),
    truncation: {
      truncated: false,
      omittedMessageCount: 0,
    },
  });
}

function cursorEntry(
  seenMessageIds: string[],
  beforeMessageId = "message-3",
): SessionEntry {
  return {
    type: "custom",
    id: "cursor-entry",
    parentId: null,
    timestamp: new Date(1_000).toISOString(),
    customType: GROUP_CHAT_MEMORY_CURSOR_TYPE,
    data: {
      schemaVersion: GROUP_CHAT_MEMORY_CURSOR_TYPE,
      conversationKey: "conversation-1",
      beforeMessageId,
      lastIncludedMessageId: seenMessageIds.at(-1),
      seenMessageIds,
      updatedAt: 1_000,
    },
  };
}

describe("group chat Pi memory", () => {
  it("imports the first snapshot and creates a reusable cursor", () => {
    const update = prepareGroupChatMemoryUpdate(
      [],
      context(["message-1", "message-2"], "message-3"),
    );

    expect(update.messages.map(({ messageId }) => messageId)).toEqual([
      "message-1",
      "message-2",
    ]);
    expect(update.cursor.seenMessageIds).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(update.cursor.beforeMessageId).toBe("message-3");
  });

  it("only imports messages after the persisted cursor window", () => {
    const update = prepareGroupChatMemoryUpdate(
      [cursorEntry(["message-1", "message-2", "message-3"])],
      context(
        ["message-1", "message-2", "message-3", "message-4"],
        "message-5",
      ),
    );

    expect(update.messages.map(({ messageId }) => messageId)).toEqual([
      "message-4",
    ]);
    expect(update.cursor.seenMessageIds).toEqual([
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
    ]);
  });

  it("marks imported conversation text as untrusted", () => {
    const snapshot = context(["message-1"], "message-2");
    const formatted = formatGroupChatMemoryDelta(
      snapshot,
      snapshot.messages,
    );

    expect(formatted).toContain("<group_chat_delta>");
    expect(formatted).toContain("untrusted visible conversation data");
    expect(formatted).toContain('"messageId":"message-1"');
  });
});
