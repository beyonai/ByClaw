import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { projectGroupCandidateAnswer } from "../src/infrastructure/persistence/group-candidate-answer.js";
import { answer, event } from "./fixtures.js";

// Use a provisioned tenant database. EXPLAIN validates parameter types without writing data.
const databaseUrl = process.env.TENANT_NODE_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("candidate SQL on a real PostgreSQL/openGauss database", () => {
  it.each(["CHAT", "TASK"])("plans the %s disposition and completion update", async (kind) => {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    let planned = false;
    try {
      await projectGroupCandidateAnswer(
        {
          async query(sql, parameters = []) {
            if (sql.startsWith("SELECT * FROM byai.byai_group_chat_execution"))
              return [
                {
                  execution_id: "60",
                  group_session_id: "30",
                  source_message_id: "40",
                  target_agent_id: "42",
                  initiator_user_id: "20",
                  candidate_session_id: "50",
                  status: "RUNNING",
                  disposition: "UNKNOWN",
                  trace_id: "trace",
                  answer_message_id: "101",
                },
              ];
            if (sql.includes("mem_obj_type='AGENT'")) return [{ mem_name: "助手" }];
            if (sql.includes("mem_obj_type='USER'")) return [{ exists: true }];
            if (sql.includes("session_type='hs_as'")) return [{ state: "ACTIVE" }];
            if (sql.includes("SELECT message_id,recalled_at")) return [{ message_id: "40" }];
            if (sql.includes("nextval(")) return [{ id: "102" }];
            if (sql.includes("RETURNING last_seq")) return [{ last_seq: "2" }];
            if (sql.startsWith("UPDATE byai.byai_group_chat_execution SET disposition=")) {
              const result = await client.query(`EXPLAIN ${sql}`, parameters);
              expect(result.rows.length).toBeGreaterThan(0);
              planned = true;
            }
            return [];
          },
        },
        "10",
        event({
          sessionId: "50",
          eventType: "TERMINAL",
          payload: {
            id: "201",
            metadata: {
              groupDisposition: {
                schemaVersion: "1",
                dispatchId: "60",
                kind,
                taskName: "验证任务",
                ackText: "已接收任务",
              },
            },
          },
        }),
        answer({ content: "你好", finalContent: "你好" }),
      );
      expect(planned).toBe(true);
    } finally {
      await client.end();
    }
  });
});
