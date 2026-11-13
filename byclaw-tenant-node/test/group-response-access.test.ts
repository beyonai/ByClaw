import { describe, expect, it, vi } from "vitest";
import { GroupResponseHistory } from "../src/application/history/group-responses.js";
import type { HistoryRepository } from "../src/application/history/contracts.js";

function setup() {
  const repository = {
    session: vi.fn(async () => ({ enterpriseId: "10", sessionType: "hs_as" })),
    member: vi.fn(async () => ({ memObjId: "20" })),
    responses: vi.fn(async () => [
      {
        responseId: "execution:60",
        executionId: "60",
        groupSessionId: "30",
        sourceMessageId: "40",
        targetAgentId: "42",
        initiatorUserId: "20",
        candidateSessionId: "50",
        traceId: "private",
        answerMessageId: "70",
        status: "RUNNING",
      },
    ]),
    tasks: vi.fn(async () => []),
  };
  return {
    repository,
    history: new GroupResponseHistory("10", repository as unknown as HistoryRepository),
  };
}

describe("group response authorization", () => {
  it("allows another member to discover status but never the private binding", async () => {
    const { history } = setup();
    const result = await history.responses("21", "30");
    expect(result.items[0].canReadContent).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.items[0].stream).toBeUndefined();
    expect((await history.responses("20", "30")).items[0].stream).toMatchObject({
      sessionId: "50",
      traceId: "private",
    });
  });
  it("checks membership and tenant before querying executions", async () => {
    const { repository, history } = setup();
    repository.session.mockResolvedValue({ enterpriseId: "99", sessionType: "hs_as" });
    await expect(history.responses("20", "30")).rejects.toThrow("RESOURCE_NOT_ACCESSIBLE");
    expect(repository.responses).not.toHaveBeenCalled();
  });
  it("rejects unbounded resolution and reports unavailable identities", async () => {
    const { repository, history } = setup();
    await expect(
      history.resolveResponses("20", "30", Array(101).fill("execution:60")),
    ).rejects.toThrow("INVALID_BODY");
    repository.responses.mockResolvedValue([]);
    expect(await history.resolveResponses("20", "30", ["execution:61"])).toEqual({
      items: [],
      unavailableIds: ["execution:61"],
    });
  });
});
