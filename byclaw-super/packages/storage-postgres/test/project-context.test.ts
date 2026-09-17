import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresRunRepository } from "../src/postgres-database.js";

describe("Postgres Run project context", () => {
  it.each([false, true])("restores project snapshots with group chat=%s", async (withGroupChat) => {
    const projectContext = {
      project_id: 42,
      project_name: "项目甲",
      workspace: "/by/projects/project-42",
    };
    const ingressContext = {
      projectContext,
      ...(withGroupChat
        ? {
            groupChat: {
              schemaVersion: "byclaw.group-chat-context/v1",
              conversationKey: "session-1",
              snapshot: { beforeMessageId: "message-1", generatedAt: 0 },
              messages: [],
              truncation: { truncated: false, omittedMessageCount: 0 },
            },
          }
        : {}),
    };
    const pool = {
      query: vi.fn(async () => ({
        rows: [
          {
            id: "run-1",
            session_id: "session-1",
            input: "work",
            ingress_context: ingressContext,
            attachments: [],
            agent_snapshot: [],
            status: "QUEUED",
            base_context_revision: 0,
            attempt_no: 0,
            execution_stage: "QUEUED",
            lease_fencing_token: null,
            version: 0,
            final_answer: null,
            error_message: null,
            created_at: new Date(0),
            updated_at: new Date(0),
            started_at: null,
            finished_at: null,
          },
        ],
      })),
    } as unknown as Pool;
    const repository = new PostgresRunRepository(pool, "byai");
    const run = await repository.get("run-1");
    expect(run?.ingressContext?.projectContext).toEqual(projectContext);
    if (withGroupChat) expect(run?.ingressContext?.groupChat).toBeDefined();
  });
});
