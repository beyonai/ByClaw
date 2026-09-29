import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresRunRepository } from "../src/postgres-database.js";

describe("Postgres Run model selection", () => {
  it.each([
    { modelId: "10014488" },
    { modelId: "10014488", fingerprint: "a".repeat(64) },
    { modelId: "10014488", fingerprint: "obsolete" },
  ])("restores a selected model from current and legacy Run snapshots", async (leaderModel) => {
    const pool = {
      query: vi.fn(async () => ({ rows: [runRow({ leaderModel })] })),
    } as unknown as Pool;
    const run = await new PostgresRunRepository(pool, "byai").get("run-1");

    expect(run?.ingressContext?.leaderModel).toEqual({ modelId: "10014488" });
  });
});

function runRow(ingressContext: Record<string, unknown>) {
  return {
    id: "run-1",
    session_id: "session-1",
    input: "work",
    ingress_context: ingressContext,
    attachments: [],
    agent_snapshot: [],
    status: "WAITING_AGENT",
    base_context_revision: 0,
    attempt_no: 1,
    execution_stage: "CONNECTOR_WAITING",
    lease_fencing_token: null,
    version: 1,
    final_answer: null,
    error_message: null,
    created_at: new Date(0),
    updated_at: new Date(0),
    started_at: new Date(0),
    finished_at: null,
  };
}
