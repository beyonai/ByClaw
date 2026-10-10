import { describe, expect, it, vi } from "vitest";
import { CommandContext } from "../src/infrastructure/persistence/command-context.js";
import { claimTask } from "../src/infrastructure/persistence/task-writer.js";
import { command } from "./fixtures.js";

describe("tenant group task claim", () => {
  it("allows exactly one worker to move a queued task to running", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ task_session_id: "60" }])
      .mockResolvedValue([]);
    const context = new CommandContext(
      { query },
      command({
        operation: "CLAIM_TASK",
        payload: { taskSessionId: "60" },
      }),
    );
    expect(await claimTask(context)).toEqual({ claimed: true });
    expect(await claimTask(context)).toEqual({ claimed: false });
    expect(query.mock.calls[0][0]).toContain("turn_status='QUEUED'");
  });
  it("allows exactly one worker to claim a single-mention candidate", async () => {
    let claimed = false;
    const query = vi.fn(async (sql: string) => {
      if (!sql.startsWith("UPDATE byai.byai_group_chat_execution") || claimed) return [];
      claimed = true;
      return [{ execution_id: "70" }];
    });
    const context = new CommandContext(
      { query },
      command({ operation: "CLAIM_TASK", payload: { taskSessionId: "60" } }),
    );
    expect(await claimTask(context)).toEqual({ claimed: true });
    expect(await claimTask(context)).toEqual({ claimed: false });
    expect(
      query.mock.calls.find(([sql]) => sql.startsWith("UPDATE byai.byai_group_chat_execution"))![0],
    ).toContain("status='QUEUED' AND disposition='UNKNOWN'");
  });
});
