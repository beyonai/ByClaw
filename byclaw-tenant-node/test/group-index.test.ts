import { describe, expect, it, vi } from "vitest";
import { indexGroupMessage } from "../src/infrastructure/persistence/group-message-index.js";
import { answerFields } from "../src/infrastructure/persistence/message-fields.js";
import { event } from "./fixtures.js";
describe("existing group projections", () => {
  it("creates a topic on the first reply and indexes mentions once", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT m.*"))
        return [{ session_id: "30", session_type: "hs_as", create_time: new Date(1000) }];
      if (sql.includes("SELECT message_id"))
        return [{ message_id: "100", message_ref: null, topic_id: "100", usage: 1 }];
      return [];
    });
    await indexGroupMessage(
      { query },
      "10",
      "101",
      "100",
      event({
        eventType: "INPUT",
        payload: { id: "201", userId: "20", mentionedUserIds: ["21", "21", "20"] },
      }),
    );
    expect(
      query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO byai.byai_group_chat_topic")),
    ).toHaveLength(1);
    expect(
      query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO byai.byai_group_chat_mention")),
    ).toHaveLength(1);
  });
  it("rejects a cyclic reply chain", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("SELECT m.*")
        ? [{ session_id: "30", session_type: "hs_as" }]
        : [{ message_id: "100", message_ref: "101", topic_id: null, usage: 1 }],
    );
    await expect(indexGroupMessage({ query }, "10", "101", "100")).rejects.toThrow(
      "INVALID_REPLY_CHAIN",
    );
  });
  it("keeps absent speaker and attachment fields unchanged during delta updates", () => {
    expect(answerFields({}, false)).toEqual({});
    expect(answerFields({ creatorId: "40", relatedResources: [] }, false)).toEqual({
      creator_id: "40",
      related_resources: "[]",
    });
  });
});
