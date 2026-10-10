import { describe, expect, it, vi } from "vitest";
import { MirrorInputWriter } from "../src/infrastructure/persistence/mirror-input.js";
import { event } from "./fixtures.js";

function setup() {
  const candidate: Record<string, any> = {
    execution_id: "60",
    candidate_session_id: "50",
    group_session_id: "30",
    source_message_id: "8000000010000000100",
    initiator_user_id: "20",
    status: "RUNNING",
    disposition: "UNKNOWN",
    trace_id: null,
  };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.startsWith("SELECT * FROM byai.byai_session WHERE"))
      return [
        { session_id: "50", creator_id: "20", state: "GROUP_TASK_CANDIDATE", session_type: "h_as" },
      ];
    if (sql.startsWith("SELECT * FROM byai.byai_group_chat_execution")) return [candidate];
    if (sql.includes("JOIN byai.byai_session_member")) return [{ exists: true }];
    if (sql.startsWith("UPDATE byai.byai_group_chat_execution SET trace_id=")) {
      candidate.trace_id = params[0];
      return [{ execution_id: "60" }];
    }
    if (sql.includes("RETURNING last_seq")) return [{ last_seq: "1" }];
    return [];
  });
  const writer = new MirrorInputWriter({ query }, "10");
  const input = event({
    sessionId: "50",
    eventType: "INPUT",
    payload: {
      id: "100",
      userId: "20",
      messageContent: "hello",
      metadata: { groupPublicContext: { groupSessionId: "999", beforeMessageId: "999" } },
    },
  });
  return { query, writer, input, candidate };
}

describe("tenant candidate input", () => {
  it("binds the first input to its execution and preserves the server-owned public context cutoff", async () => {
    const { query, writer, input } = setup();
    await writer.assertInputAccess(input);
    await writer.insertInput(input);
    const [, params] = query.mock.calls.find(([sql]) =>
      sql.startsWith("UPDATE byai.byai_group_chat_execution SET trace_id="),
    )!;
    expect(params).toEqual(["trace", "101", "50"]);
    const [, values] = query.mock.calls.find(([sql]) =>
      sql.startsWith("INSERT INTO byai.byai_message ("),
    )!;
    const metadata = JSON.parse(
      values.find((v) => typeof v === "string" && v.includes('"groupPublicContext"')) as string,
    );
    expect(metadata.groupPublicContext).toEqual({
      groupSessionId: "30",
      beforeMessageId: "8000000010000000100",
    });
    await expect(writer.assertInputAccess(input)).rejects.toThrow("MIRROR_CONTEXT_MISMATCH");
  });
  it("rejects a different user or a candidate that was never claimed", async () => {
    const { writer, input, candidate } = setup();
    await expect(
      writer.assertInputAccess({ ...input, payload: { ...input.payload, userId: "21" } }),
    ).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    candidate.status = "QUEUED";
    await expect(writer.assertInputAccess(input)).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
});
