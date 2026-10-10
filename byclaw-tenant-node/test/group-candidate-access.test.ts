import { describe, expect, it, vi } from "vitest";
import { HistoryService } from "../src/application/history.js";
import { SqlHistoryRepository } from "../src/infrastructure/persistence/history-repository.js";

function setup() {
  const session = {
    session_id: "50",
    enterprise_id: "10",
    creator_id: "20",
    parent_session_id: "30",
    session_type: "h_as",
    state: "GROUP_TASK_CANDIDATE",
  };
  const candidate = {
    execution_id: "60",
    candidate_session_id: "50",
    group_session_id: "30",
    source_message_id: "40",
    initiator_user_id: "20",
    target_agent_id: "42",
    status: "RUNNING",
    disposition: "UNKNOWN",
  };
  const state = { session, candidate, member: true, groupState: "ACTIVE" };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM byai.byai_session WHERE"))
      return params[0] === "30"
        ? [
            {
              session_id: "30",
              enterprise_id: "10",
              session_type: "hs_as",
              state: state.groupState,
            },
          ]
        : [session];
    if (sql.includes("FROM byai.byai_group_chat_execution"))
      return params[0] === "50" ? [candidate] : [];
    if (sql.includes("FROM byai.byai_group_chat_task")) return [];
    if (sql.includes("FROM byai.byai_session_member"))
      return state.member ? [{ mem_obj_id: String(params[1]) }] : [];
    if (sql.includes("FROM byai.byai_session_ext")) return [];
    return [];
  });
  return { state, service: new HistoryService("10", new SqlHistoryRepository({ query }, "10")) };
}

describe("tenant candidate access", () => {
  it("exposes the authoritative execution identity only to its initiator in the source group", async () => {
    const { service } = setup();
    await expect(service.access("20", "50")).resolves.toMatchObject({
      groupDispatch: { dispatchId: "60", sourceMessageId: "40", targetAgentId: "42" },
    });
    await expect(service.access("21", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(service.task("20", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("keeps hidden CHAT session history unavailable but permits the internal committed dispatch summary", async () => {
    const { state, service } = setup();
    state.session.state = "GROUP_CHAT_DISPATCH";
    state.candidate.status = "COMPLETED";
    state.candidate.disposition = "CHAT";
    await expect(service.access("20", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(service.dispatch("20", "50")).resolves.toMatchObject({
      disposition: "CHAT",
      status: "COMPLETED",
    });
    await expect(service.dispatch("21", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("denies candidate runtime and diagnostic reads when original group membership is lost", async () => {
    const { state, service } = setup();
    state.member = false;
    await expect(service.access("20", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    await expect(service.dispatch("20", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
  it("denies a foreign tenant candidate even with the correct initiator", async () => {
    const { state, service } = setup();
    state.session.enterprise_id = "11";
    await expect(service.access("20", "50")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
  });
});
