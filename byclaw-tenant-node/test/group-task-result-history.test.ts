import { expect, it, vi } from "vitest";
import { displayMessages } from "../src/application/history/timeline-format.js";
import type { HistoryRepository } from "../src/application/history/contracts.js";

it("recognizes legacy automatic group replies as results without rewriting stored messages", async () => {
  const row = {
    sessionId: "30",
    messageId: "99",
    usage: 2,
    creatorId: "42",
    messageRef: "40",
    messageContent: "你好",
    metadata: JSON.stringify({ scene: "GROUP_CHAT", taskId: "50", targetAgentId: "42" }),
  };
  const repository = {
    messages: vi.fn(async () => [
      { sessionId: "30", messageId: "40", usage: 1, creatorId: "7", messageContent: "你好" },
    ]),
    tasks: vi.fn(async () => [
      { taskSessionId: "50", publishMessageId: "99", initiatorUserId: "7" },
    ]),
    acknowledgements: vi.fn(async () => []),
  } as unknown as HistoryRepository;
  const [result] = await displayMessages(repository, [row], "7");
  expect(result).toMatchObject({
    kind: "TASK_RESULT",
    taskId: "50",
    replyTo: { messageId: "40", content: "你好" },
  });
  expect(JSON.parse(row.metadata).kind).toBeUndefined();
});

it("does not turn task acknowledgements or unrelated messages into results", async () => {
  const repository = {
    tasks: vi.fn(async () => [{ taskSessionId: "50", publishMessageId: "99" }]),
    acknowledgements: vi.fn(async () => []),
  } as unknown as HistoryRepository;
  const result = await displayMessages(repository, [
    {
      sessionId: "30",
      messageId: "98",
      usage: 2,
      metadata: '{"scene":"GROUP_CHAT","taskId":"50","kind":"TASK_ACK"}',
    },
    {
      sessionId: "30",
      messageId: "97",
      usage: 2,
      metadata: '{"scene":"GROUP_CHAT","taskId":"50"}',
    },
  ]);
  expect(result.map((message) => message.kind)).toEqual(["TASK_ACK", undefined]);
});
