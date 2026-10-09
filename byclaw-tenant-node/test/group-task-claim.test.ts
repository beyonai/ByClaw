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
});
