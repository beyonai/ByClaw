import { describe, expect, it, vi } from "vitest";
import { SchemaReadiness } from "../src/infrastructure/schema/readiness.js";
import { ConnectionManager } from "../src/application/connection-manager.js";
import { BeSchemaClient } from "../src/infrastructure/schema/be-schema-client.js";

vi.mock("../src/infrastructure/schema/catalog.js", () => ({
  readMarker: async () => ({ version: "V0.5.0", scriptDigest: "a".repeat(64) }),
  verifyCatalog: async () => {},
}));

// Exercise the real column gate while isolating fingerprint and authority checks.
const columns = {
  byai_session: ["session_id", "enterprise_id", "last_seq"],
  byai_message: [
    "id",
    "message_id",
    "session_id",
    "enterprise_id",
    "created_seq",
    "storage_version",
    "last_mirror_event_seq",
    "last_mirror_event_id",
    "persist_command_id",
    "persist_hash",
    "client_request_id",
    "run_id",
    "answer_message_id",
    "recalled_at",
    "archived_at",
  ],
  byai_message_relobj: ["id", "ask_msg_id", "res_msg_id", "com_acct_id"],
  byai_session_ext: ["ext_id", "session_id", "ext_param_code", "ext_param_value"],
  byai_session_member: ["byai_session_member_id", "last_read_message_id"],
  byai_group_chat_task: [
    "task_session_id",
    "group_session_id",
    "initiator_user_id",
    "current_turn_id",
    "current_turn_trace_id",
  ],
  byai_group_chat_pending_publication: ["task_session_id", "text_content"],
  byai_group_chat_task_publication: ["task_session_id", "message_id", "pending_publication_id"],
  byai_group_chat_topic: ["topic_id", "group_session_id"],
  byai_group_chat_mention: ["group_session_id", "message_id", "mentioned_user_id"],
};
const indexes = [
  "uq_tenant_session_business_id",
  "uq_tenant_message_business_id",
  "uq_tenant_message_command",
  "uq_tenant_input_request",
  "uq_tenant_reserved_answer",
  "uq_tenant_answer_run",
  "uq_tenant_message_session_seq",
  "uq_tenant_ask_answer_relation",
];

function setup(missing?: string) {
  const rows = Object.entries(columns).flatMap(([table_name, names]) =>
    names.filter((name) => name !== missing).map((column_name) => ({ table_name, column_name })),
  );
  const db = {
    query: async (sql: string) => {
      if (sql.includes("information_schema.columns")) return rows;
      if (sql.includes("pg_index")) return indexes.map((name) => ({ name }));
      return [{ id_sequence: "1" }];
    },
  };
  const ready = vi.fn();
  const connection = {
    identity: { enterpriseId: "10" },
    database: () => ({ exclusive: async (work: (value: typeof db) => Promise<void>) => work(db) }),
    guard: async () => {},
    setSchemaReady: ready,
  } as unknown as ConnectionManager;
  const be = { currentVersion: async () => "V0.5.0" } as unknown as BeSchemaClient;
  return { readiness: new SchemaReadiness(connection, be), ready };
}

describe("group task schema readiness", () => {
  it.each(["current_turn_id", "current_turn_trace_id"])(
    "rejects a baseline missing %s",
    async (column) => {
      const { readiness, ready } = setup(column);
      await expect(readiness.check()).rejects.toThrow("BUSINESS_SCHEMA_INCOMPATIBLE");
      expect(readiness.state.verified).toBe(false);
      expect(ready).not.toHaveBeenCalledWith(true);
    },
  );
  it("admits a schema with both turn binding columns", async () => {
    const { readiness, ready } = setup();
    await readiness.check();
    expect(readiness.state.verified).toBe(true);
    expect(ready).toHaveBeenCalledWith(true);
  });
});
