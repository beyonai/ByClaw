import { HistoryAccess } from "../../application/history/access.js";
import type { HistoryRepository, Row } from "../../application/history/contracts.js";
import { requireSource, type GroupIdentity } from "../../application/group-forward-eligibility.js";
import type { TargetPage } from "../../application/group-forward-types.js";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";

type ReadRows = (sql: string, args?: unknown[]) => Promise<Row[]>;

/** Forward candidates use strict ownership rules independently of the legacy sidebar. */
export class GroupChatForwardTargetQueryService extends HistoryAccess {
  constructor(
    tenantId: string,
    repository: HistoryRepository,
    private readonly rawRead: ReadRows,
  ) {
    super(tenantId, repository);
  }

  private async read(sql: string, args: unknown[] = []): Promise<Row[]> {
    return (await this.rawRead(sql, args)).map(camel);
  }

  async listTargets(
    actor: string,
    sourceId: string,
    page = 1,
    size = 20,
    keyword?: string,
  ): Promise<TargetPage> {
    requireId(actor);
    requireId(sourceId);
    const normalized = keyword?.trim() ?? "";
    const offset = (page - 1) * size;
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > 100 ||
      !Number.isSafeInteger(offset) ||
      normalized.length > 100
    )
      throw new DomainError("FORWARD_INVALID_REQUEST");

    // Only a current trusted-tenant USER member can distinguish an unresolved source tenant.
    const source = (
      await this.read(
        `SELECT s.session_id,s.enterprise_id,s.session_type,s.state FROM byai.byai_session s
         WHERE s.session_id=$1 AND EXISTS (SELECT 1 FROM byai.byai_session_member u
           WHERE u.session_id=s.session_id AND u.mem_obj_type='USER' AND u.mem_obj_id=$2 AND u.com_acct_id=$3)`,
        [sourceId, actor, this.tenantId],
      )
    )[0] as GroupIdentity | undefined;
    const forwardingActor = { userId: actor, enterpriseId: this.tenantId };
    requireSource(forwardingActor, source ?? null, source != null);
    const authorized = await this.access(actor, sourceId, true);
    requireSource(forwardingActor, authorized as GroupIdentity, true);

    // Use the same predicate and bound literal pattern for both count and page selection.
    const pattern = normalized ? `%${normalized.toLowerCase().replace(/[\\%_]/g, "\\$&")}%` : null;
    const predicate = `FROM byai.byai_session s JOIN byai.byai_session_member u ON u.session_id=s.session_id
      WHERE s.enterprise_id=$1 AND s.session_type='hs_as' AND s.session_id!=$3
      AND u.mem_obj_type='USER' AND u.mem_obj_id=$2 AND u.com_acct_id=$1
      AND (s.state IS NULL OR s.state NOT IN ('GROUP_DISSOLVED','CLOSED','GROUP_CHAT_ROUTING','GROUP_CHAT_DISPATCH'))
      AND (CAST($4 AS TEXT) IS NULL OR LOWER(s.session_name) LIKE CAST($4 AS TEXT) ESCAPE '\\')`;
    const args = [this.tenantId, actor, sourceId, pattern];
    const [rows, count] = await Promise.all([
      this.read(
        `SELECT s.session_id,s.session_name AS name,s.enterprise_id,s.project_id,u.user_role AS role
         ${predicate}
         ORDER BY COALESCE((SELECT MAX(m.create_time) FROM byai.byai_message m
           WHERE m.session_id=s.session_id AND m.archived_at IS NULL),s.update_time,s.create_time) DESC,
           s.session_id DESC LIMIT $5 OFFSET $6`,
        [...args, size, offset],
      ),
      this.read(`SELECT COUNT(*) AS total ${predicate}`, args),
    ]);
    const total = Number(count[0]!.total);
    return {
      pageNum: page,
      pageSize: size,
      total,
      totalPages: Math.ceil(total / size),
      list: rows.map((row) => ({
        sessionId: String(row.sessionId),
        name: row.name,
        enterpriseId: String(row.enterpriseId),
        projectId: row.projectId == null ? null : String(row.projectId),
        role: row.role,
      })),
    };
  }
}

import type { SqlSession } from "../../application/database-ports.js";
import type { ForwardItem, ItemPage } from "../../application/group-forward-types.js";
import { camel } from "./sql-utils.js";
import { forwardResources } from "../../application/history/forward-projection.js";

const denied = (): never => {
  throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
};
const invalid = (): never => {
  throw new DomainError("FORWARD_INVALID_REQUEST");
};
const parsed = (value: unknown): any => {
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return denied();
  }
};
/** Current target authorization precedes every item/descriptor read; original source rows are never consulted. */
export class GroupChatForwardMessageQuery {
  constructor(
    private readonly db: SqlSession,
    private readonly tenant: string,
  ) {}
  private async rows(sql: string, args: unknown[]): Promise<Row[]> {
    return (await this.db.query(sql, args)).map(camel);
  }
  private async bound(actor: string, group: string, message: string): Promise<Row[]> {
    requireId(actor);
    requireId(group);
    requireId(message);
    const [session] = await this.rows(
      "SELECT session_id,enterprise_id,session_type,state FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
      [group, this.tenant],
    );
    if (
      !session ||
      session.enterpriseId !== this.tenant ||
      session.sessionType !== "hs_as" ||
      ["CLOSED", "GROUP_DISSOLVED", "GROUP_CHAT_ROUTING", "GROUP_CHAT_DISPATCH"].includes(
        session.state,
      )
    )
      return denied();
    const [member] = await this.rows(
      "SELECT mem_obj_id FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_id=$2 AND mem_obj_type='USER' AND com_acct_id=$3",
      [group, actor, this.tenant],
    );
    if (!member) return denied();
    const [current] = await this.rows(
      "SELECT message_id,usage,recalled_at,archived_at FROM byai.byai_message WHERE session_id=$1 AND message_id=$2 AND enterprise_id=$3",
      [group, message, this.tenant],
    );
    if (
      !current ||
      ![1, 2].includes(current.usage) ||
      current.recalledAt != null ||
      current.archivedAt != null
    )
      return denied();
    const items = await this.rows(
      `SELECT i.*,t.checkpoint_json,t.message_ids_json,r.snapshot_version
      FROM byai.byai_group_chat_forward_item i
      JOIN byai.byai_group_chat_forward_target t ON t.enterprise_id=i.enterprise_id AND t.target_id=i.target_id AND t.request_id=i.request_id
      JOIN byai.byai_group_chat_forward_request r ON r.enterprise_id=t.enterprise_id AND r.request_id=t.request_id
      WHERE i.enterprise_id=$1 AND t.target_session_id=$2 AND i.bound_message_id=$3 AND t.state='SUCCEEDED' AND r.backend='TENANT'
      ORDER BY i.ordinal,i.item_id LIMIT 101`,
      [this.tenant, group, message],
    );
    if (
      !items.length ||
      items.length > 100 ||
      items.some(
        (i) =>
          !parsed(i.messageIdsJson)?.includes(message) ||
          i.snapshotVersion !== items[0]!.snapshotVersion ||
          i.targetId !== items[0]!.targetId,
      )
    )
      return denied();
    return items;
  }
  private item(row: Row): ForwardItem {
    const speaker = parsed(row.speakerJson),
      attachments = parsed(row.attachmentsJson);
    if (
      !speaker ||
      !["USER", "AGENT"].includes(speaker.type) ||
      typeof speaker.name !== "string" ||
      !Array.isArray(attachments) ||
      attachments.length > 100
    )
      return denied();
    return {
      itemId: requireId(row.itemId),
      selectedMessageId: requireId(row.selectedMessageId),
      selectedMergedCard: row.selectedMergedCard === true,
      sourceMessageId: requireId(row.sourceMessageId),
      ordinal: row.ordinal,
      content: row.content,
      speaker: { type: speaker.type, id: requireId(speaker.id), name: speaker.name },
      createdAt: new Date(row.sourceCreatedAt).toISOString(),
      resourceList: forwardResources({ resourceList: parsed(row.referencesJson) }).map((r) => ({
        id: r.id,
        resourceId: r.resourceId ?? null,
        resourceName: r.resourceName,
        resourceType: r.resourceType ?? null,
        resourceCode: r.resourceCode ?? null,
        extData: r.extData ?? null,
      })),
      attachments: attachments.map((a: any) => ({
        fileId: a.fileId ?? null,
        fileName: a.fileName,
        filePath: a.filePath,
        fileUrl: a.fileUrl ?? null,
        cloudResourceId: a.cloudResourceId ?? null,
        mediaType: a.mediaType ?? null,
        size: a.size,
      })),
    };
  }
  async items(
    actor: string,
    group: string,
    message: string,
    size = 20,
    cursor?: string,
  ): Promise<ItemPage> {
    if (!Number.isInteger(size) || size < 1 || size > 100) return invalid();
    const rows = await this.bound(actor, group, message);
    let offset = 0;
    if (cursor !== undefined) {
      if (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) return invalid();
      let value: any;
      try {
        value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      } catch {
        return invalid();
      }
      if (!Array.isArray(value) || value.length !== 7 || value[0] !== 1) return invalid();
      if (
        value[1] !== this.tenant ||
        value[2] !== group ||
        value[3] !== message ||
        value[4] !== rows[0]!.snapshotVersion
      )
        return denied();
      const index = rows.findIndex((r) => r.ordinal === value[5] && r.itemId === value[6]);
      if (index < 0) return denied();
      offset = index + 1;
    }
    const page = rows.slice(offset, offset + size),
      hasMore = offset + size < rows.length,
      last = page.at(-1);
    return {
      items: page.map((r) => this.item(r)),
      pageSize: size,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify([
                1,
                this.tenant,
                group,
                message,
                last.snapshotVersion,
                last.ordinal,
                last.itemId,
              ]),
            ).toString("base64url")
          : null,
    };
  }
}
