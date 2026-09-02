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

  it("marks imported conversation text as untrusted and drops metadata", () => {
    const snapshot = context(["message-1"], "message-2");
    const formatted = formatGroupChatMemoryDelta(snapshot, snapshot.messages);

    expect(formatted).toContain("<group_chat_delta>");
    expect(formatted).toContain("untrusted visible conversation history");
    expect(formatted).toContain("Agent 1(数字员工)");
    expect(formatted).toContain("answer 1");
    // 元数据不再注入模型上下文（去重靠 cursor、审计靠 Run 快照）。
    expect(formatted).not.toContain("messageId");
    expect(formatted).not.toContain("schemaVersion");
  });

  it("renders speakers, targets, attachments, timezone, and folding", () => {
    const snapshot = parseGroupChatContext({
      schemaVersion: "byclaw.group-chat-context/v1",
      conversationKey: "conversation-1",
      snapshot: { beforeMessageId: "m3", generatedAt: 1_000 },
      messages: [
        {
          messageId: "m1",
          sequence: 1,
          createdAt: Date.UTC(2026, 6, 31, 2, 0),
          role: "user",
          speaker: { type: "user", userCode: "U002", displayName: "李四" },
          target: { type: "agent", agentId: "super", agentName: "Super" },
          content: "帮我看下\n销售数据",
        },
        {
          messageId: "m2",
          sequence: 2,
          createdAt: Date.UTC(2026, 6, 31, 2, 1),
          role: "assistant",
          speaker: { type: "agent", agentId: "a-fin", agentName: "财务专员" },
          target: { type: "agent", agentId: "super", agentName: "Super" },
          content: "上月销售额 1230 万",
          attachments: [{ fileId: "f1", fileName: "finance.xlsx" }],
        },
      ],
      truncation: { truncated: true, omittedMessageCount: 3, reason: "message_limit" },
    });

    const formatted = formatGroupChatMemoryDelta(
      snapshot,
      snapshot.messages,
      "Asia/Shanghai",
    );

    expect(formatted).toContain("(更早的 3 条已省略)");
    expect(formatted).toContain(
      "[07-31 10:00] 李四(用户) → Super: 帮我看下 销售数据",
    );
    expect(formatted).toContain(
      "[07-31 10:01] 财务专员(数字员工) → Super: 上月销售额 1230 万 (附件: finance.xlsx)",
    );
  });
});
