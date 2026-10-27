import type { SchemaState } from "../../application/schema/types.js";
import type { ConnectionManager } from "../../application/connection-manager.js";
import type { BeSchemaClient } from "./be-schema-client.js";
import { readMarker, verifyCatalog } from "./catalog.js";
import { DomainError } from "../../domain/errors.js";

const requiredColumns: Record<string, string[]> = {
  // Worker identity, durable attempts and publication bindings are required before admitting business traffic.
  byai_group_chat_forward_request: [
    "request_id",
    "enterprise_id",
    "actor_user_id",
    "backend",
    "source_session_id",
    "client_request_id",
    "mode",
    "request_hash",
    "state",
    "snapshot_version",
    "frozen_json",
    "source_manifest_json",
    "sources_frozen",
    "lease_owner",
    "fencing_version",
    "lease_until",
    "create_time",
    "update_time",
  ],
  byai_group_chat_forward_target: [
    "target_id",
    "enterprise_id",
    "request_id",
    "target_session_id",
    "state",
    "lease_owner",
    "fencing_version",
    "lease_until",
    "checkpoint_json",
    "message_ids_json",
    "error_code",
    "retryable",
    "pending_delivery",
    "create_time",
    "update_time",
  ],
  byai_group_chat_forward_item: [
    "item_id",
    "enterprise_id",
    "request_id",
    "target_id",
    "ordinal",
    "selected_message_id",
    "selected_merged_card",
    "source_message_id",
    "content",
    "speaker_json",
    "source_created_at",
    "references_json",
    "attachments_json",
    "bound_message_id",
    "create_time",
  ],
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
/** 业务结构门禁：BE 审计、库内标记、完整指纹及运行所需字段/索引都一致才放行。 */
export class SchemaReadiness {
  state: SchemaState = { observedVersion: null, auditedVersion: null, verified: false };
  constructor(
    private readonly connection: ConnectionManager,
    private readonly be: BeSchemaClient,
  ) {}
  async check(): Promise<void> {
    const revision = this.connection.schemaRevision;
    this.state.verified = false;
    const auditedVersion = await this.be.currentVersion();
    this.state.auditedVersion = auditedVersion;
    const pool = this.connection.database();
    await pool.exclusive(async (db) => {
      const marker = await readMarker(db, this.connection.identity.enterpriseId);
      this.state.observedVersion = marker?.version ?? null;
      if (!marker || marker.version !== auditedVersion) {
        this.connection.setSchemaReady(false);
        return;
      }
      await verifyCatalog(db, {
        ...marker,
        parentVersion: null,
        engine: "openGauss",
        nodeProtocol: { min: 1, max: 1 },
        sqlSha256: marker.scriptDigest,
        objects: [],
      });
      await this.checkColumns(db);
      await this.connection.guard(pool);
      if (revision !== this.connection.schemaRevision) return;
      this.state.verified = true;
      this.connection.setSchemaReady(true);
    });
  }
  private async checkColumns(db: {
    query(sql: string, parameters?: unknown[]): Promise<Record<string, any>[]>;
  }): Promise<void> {
    const rows = await db.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='byai'",
    );
    for (const [table, columns] of Object.entries(requiredColumns)) {
      if (
        columns.some(
          (column) => !rows.some((row) => row.table_name === table && row.column_name === column),
        )
      )
        throw new DomainError("BUSINESS_SCHEMA_INCOMPATIBLE");
    }
    const indexes = await db.query(
      "SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='byai' AND i.indisunique AND i.indisvalid",
    );
    const required = [
      "uq_forward_request_actor_key",
      "uq_forward_request_tenant",
      "uq_forward_target_group",
      "uq_forward_target_tenant",
      "uq_forward_item_ordinal",
      "uq_tenant_session_business_id",
      "uq_tenant_message_business_id",
      "uq_tenant_message_command",
      "uq_tenant_input_request",
      "uq_tenant_reserved_answer",
      "uq_tenant_answer_run",
      "uq_tenant_message_session_seq",
      "uq_tenant_ask_answer_relation",
    ];
    if (required.some((name) => !indexes.some((row) => row.name === name)))
      throw new DomainError("BUSINESS_SCHEMA_INCOMPATIBLE");
    const [sequence] = await db.query(
      "SELECT c.oid AS id_sequence FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname='byai' AND c.relname='seq_any_table' AND c.relkind='S'",
    );
    if (!sequence?.id_sequence) throw new DomainError("BUSINESS_SCHEMA_INCOMPATIBLE");
  }
}
