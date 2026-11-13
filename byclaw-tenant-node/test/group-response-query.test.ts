import { describe, expect, it } from "vitest";
import { responseView } from "../src/application/history/group-response-contracts.js";

describe("public group response projection", () => {
  const row = {
    responseId: "execution:60",
    groupSessionId: "30",
    sourceMessageId: "40",
    targetAgentId: "42",
    initiatorUserId: "20",
    status: "RUNNING",
    disposition: "CHAT",
    sourceContent: "hello",
    sourceName: "A",
    sourceCreatorId: "20",
    traceId: "private",
    answerMessageId: "private-answer",
    content: "secret",
  };
  it("keeps CHAT running without exposing candidate content or runtime identifiers", () => {
    const view = responseView(row);
    expect(view.phase).toBe("RUNNING");
    expect(JSON.stringify(view)).not.toContain("private");
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(view.replyTo.speaker.displayName).toBe("A");
  });
  it("uses the committed public reply rather than the candidate answer", () => {
    const view = responseView({
      ...row,
      status: "COMPLETED",
      resultMessageId: "70",
      resultContent: "public",
    });
    expect(view.phase).toBe("CHAT_COMPLETED");
    expect(view.resultMessage?.messageId).toBe("70");
    expect(view.resultMessage?.content).toBe("public");
  });
  it("does not expose text after source recall", () => {
    const view = responseView({
      ...row,
      sourceRecalledAt: new Date(),
      status: "COMPLETED",
      resultContent: "secret",
    });
    expect(view.phase).toBe("CANCELLED");
    expect(view.replyTo.content).toBe("消息已撤回");
    expect(view.resultMessage).toBeUndefined();
  });
  it("supplies a renderable task without requiring an acknowledgement", () => {
    const view = responseView({
      ...row,
      disposition: "TASK",
      taskSessionId: "50",
      taskName: "Report",
      taskStatus: "ACTIVE",
    });
    expect(view.phase).toBe("TASK");
    expect(view.task?.taskSessionId).toBe("50");
  });
});

it("keeps candidates without a task when the database treats empty strings as null", async () => {
  const { readGroupResponses } = await import(
    "../src/infrastructure/persistence/group-response-query.js"
  );
  let sql = "";
  await readGroupResponses(
    {
      query: async (statement: string) => {
        sql = statement;
        return [];
      },
    },
    "10",
    "30",
    "0",
    50,
  );
  expect(sql).toContain("t.status IS NULL OR t.status<>'PRIVATE'");
  expect(sql).not.toContain("COALESCE(t.status,'')");
});
