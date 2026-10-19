import type { SqlSession, SqlRow } from "../../application/database-ports.js";
import type {
  SourceMessage,
  SourceAuthority,
  LocatorCandidate,
} from "../../application/group-forward-types.js";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";

const denied = (): never => {
  throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
};
const unresolved = (): never => {
  throw new DomainError("FORWARD_RESOURCE_UNRESOLVABLE");
};
const parse = (value: unknown, fallback: any): any => {
  if (value == null || value === "") return fallback;
  try {
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return unresolved();
  }
};
/** Only selector fields cross the internal route; credentials and arbitrary execution metadata do not. */
function entry(raw: any): LocatorCandidate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unresolved();
  const result: Record<string, string> = {};
  for (const field of [
    "id",
    "resourceId",
    "resourceName",
    "resourceType",
    "attachmentId",
    "fileId",
    "fileName",
    "filePath",
    "directoryPath",
    "datasetId",
    "cloudResourceId",
  ]) {
    if (
      (typeof raw[field] === "string" || typeof raw[field] === "number") &&
      String(raw[field]).length <= 4096
    )
      result[field] = String(raw[field]);
  }
  if (
    typeof raw.resourceCode === "string" &&
    raw.resourceCode.length <= 16384 &&
    raw.resourceCode.startsWith("{")
  ) {
    try {
      const code = JSON.parse(raw.resourceCode);
      for (const key of ["datasetId", "directoryPath"]) {
        if (
          (typeof code[key] === "string" ||
            (typeof code[key] === "number" && Number.isSafeInteger(code[key]))) &&
          String(code[key]).length <= 4096 &&
          result[key] === undefined
        )
          result[key] = String(code[key]);
      }
    } catch {
      /* Invalid hints do not establish source authority. */
    }
  }
  return result;
}
function entries(raw: unknown, maximum = 100): LocatorCandidate[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > maximum) return unresolved();
  return raw.map(entry);
}
const camel = (row: SqlRow): SqlRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );

/** Uses the caller's SqlSession, including Task7's prepare transaction; never owns a connection or file stream. */
export class SqlForwardSourceAuthorityReader {
  constructor(
    private readonly db: SqlSession,
    private readonly tenantId: string,
  ) {
    requireId(tenantId);
  }
  private async rows(sql: string, args: unknown[]): Promise<SqlRow[]> {
    return (await this.db.query(sql, args)).map(camel);
  }
  private async session(
    actor: string,
    id: string,
    group: boolean,
    visited = new Set<string>(),
  ): Promise<SqlRow> {
    if (visited.has(id) || visited.size >= 32) return denied();
    visited.add(id);
    requireId(actor);
    requireId(id);
    const [session] = await this.rows("SELECT * FROM byai.byai_session WHERE session_id=$1", [id]);
    if (!session) return denied();
    const [member] = await this.rows(
      "SELECT * FROM byai.byai_session_member WHERE session_id=$1 AND mem_obj_type='USER' AND mem_obj_id=$2 AND com_acct_id=$3",
      [id, actor, this.tenantId],
    );
    if (session.enterpriseId == null && member) throw new DomainError("FORWARD_TENANT_UNRESOLVED");
    if (
      session.enterpriseId !== this.tenantId ||
      [
        "CLOSED",
        "GROUP_DISSOLVED",
        "GROUP_CHAT_ROUTING",
        "GROUP_CHAT_DISPATCH",
        "GROUP_TASK",
        "GROUP_TASK_CANDIDATE",
      ].includes(session.state)
    )
      return denied();
    if (group && session.sessionType !== "hs_as") return denied();
    if (session.sessionType === "hs_as" ? !member : session.creatorId !== actor) return denied();
    const [task] = await this.rows(
      "SELECT task_session_id FROM byai.byai_group_chat_task WHERE task_session_id=$1",
      [id],
    );
    if (task) return denied();
    if (session.sessionType !== "hs_as" && session.parentSessionId != null)
      await this.session(actor, requireId(session.parentSessionId), false, visited);
    return session;
  }
  async requireUploadSession(actor: string, uploadSessionId: string) {
    await this.session(actor, uploadSessionId, false);
    return {
      actor: { userId: actor, enterpriseId: this.tenantId },
      backend: "TENANT" as const,
      sessionId: uploadSessionId,
      enterpriseId: this.tenantId,
    };
  }
  async readMessage(
    actor: string,
    sourceSessionId: string,
    selectedMessageId: string,
  ): Promise<SourceMessage> {
    requireId(selectedMessageId);
    const session = await this.session(actor, sourceSessionId, true);
    const [message] = await this.rows(
      "SELECT * FROM byai.byai_message WHERE message_id=$1 AND session_id=$2 AND enterprise_id=$3",
      [selectedMessageId, sourceSessionId, this.tenantId],
    );
    if (
      !message ||
      message.recalledAt != null ||
      message.archivedAt != null ||
      ![1, 2].includes(message.usage)
    )
      return denied();
    const metadata = parse(message.metadata, {}),
      related = parse(message.relatedResources, {});
    const authority: SourceAuthority = {
      actor: { userId: actor, enterpriseId: this.tenantId },
      backend: "TENANT",
      sourceSessionId,
      selectedMessageId,
      // The tenant baseline uses -1 for a group without a bound project.
      projectId:
        session.projectId == null || session.projectId === "-1"
          ? null
          : requireId(session.projectId),
      currentItemId: null,
      scene: typeof metadata.scene === "string" ? metadata.scene : null,
      kind: typeof metadata.kind === "string" ? metadata.kind : null,
      publicationFiles: [],
    };
    if (metadata.scene === "GROUP_CHAT" && metadata.kind === "TASK_RESULT") {
      const [publication] = await this.rows(
        "SELECT * FROM byai.byai_group_chat_task_publication WHERE group_session_id=$1 AND message_id=$2 AND task_session_id=$3",
        [sourceSessionId, selectedMessageId, requireId(metadata.taskId)],
      );
      if (!publication) return unresolved();
      authority.publicationFiles = entries(parse(publication.filesJson, []));
      if (
        publication.pendingPublicationId != null &&
        authority.publicationFiles.some((file) => file.cloudResourceId == null)
      ) {
        const [pending] = await this.rows(
          "SELECT * FROM byai.byai_group_chat_pending_publication WHERE task_session_id=$1 AND pending_publication_id=$2",
          [publication.taskSessionId, publication.pendingPublicationId],
        );
        if (pending?.cloudResourceId != null) {
          const cloud = requireId(pending.cloudResourceId),
            uploaded = parse(pending.uploadedFilesJson, {});
          if (
            !uploaded ||
            typeof uploaded !== "object" ||
            Array.isArray(uploaded) ||
            Object.keys(uploaded).length > 100
          )
            return unresolved();
          const files = Object.values(uploaded).flatMap((value) => entries(value));
          if (files.length > 100) return unresolved();
          authority.publicationFiles = authority.publicationFiles.map((file) => {
            if (file.cloudResourceId != null) return file;
            const matches = files.filter(
              (candidate) =>
                candidate.filePath === file.filePath &&
                (candidate.cloudResourceId == null || candidate.cloudResourceId === cloud),
            );
            return matches.length === 1 ? { ...file, cloudResourceId: cloud } : file;
          });
        }
      }
    }
    const source: SourceMessage = {
      id: selectedMessageId,
      timelineOrdinal: 0,
      content: typeof message.messageContent === "string" ? message.messageContent : "",
      speaker: {
        type: message.usage === 1 ? "USER" : "AGENT",
        id: requireId(message.creatorId),
        name: message.creatorName || "Unknown",
      },
      createdAt: new Date(message.createTime).toISOString(),
      resourceList: entries(
        related.resourceList ?? metadata.resourceList,
        Number.POSITIVE_INFINITY,
      ),
      relatedResources: { files: entries(related.files) },
      metadata: { files: entries(metadata.files) },
      mergedItems: [],
      authority,
    };
    const items = await this.rows(
      `SELECT i.*,t.checkpoint_json,t.message_ids_json,t.target_session_id FROM byai.byai_group_chat_forward_item i
      JOIN byai.byai_group_chat_forward_target t ON t.target_id=i.target_id AND t.enterprise_id=i.enterprise_id
      WHERE i.enterprise_id=$1 AND i.bound_message_id=$2 AND t.target_session_id=$3 AND t.state='SUCCEEDED' ORDER BY i.ordinal`,
      [this.tenantId, selectedMessageId, sourceSessionId],
    );
    if (items.length > 100) return unresolved();
    for (const item of items) {
      if (!parse(item.messageIdsJson, []).includes(selectedMessageId)) return unresolved();
      const attachments = parse(item.attachmentsJson, []);
      if (!Array.isArray(attachments) || attachments.length > 100) return unresolved();
      const common = attachments.filter((f: any) => !f.cloudResourceId);
      const cloud = attachments.filter((f: any) => !!f.cloudResourceId);
      source.mergedItems.push({
        id: requireId(item.sourceMessageId),
        timelineOrdinal: item.ordinal,
        content: item.content,
        speaker: parse(item.speakerJson, null),
        createdAt: new Date(item.sourceCreatedAt).toISOString(),
        resourceList: entries(parse(item.referencesJson, []), Number.POSITIVE_INFINITY),
        relatedResources: { files: entries(common) },
        metadata: { files: entries(cloud) },
        mergedItems: [],
        authority: {
          ...authority,
          currentItemId: requireId(item.itemId),
          scene: "GROUP_CHAT",
          kind: "FORWARD_SINGLE",
          publicationFiles: entries(cloud),
        },
      });
    }
    const forwarded =
      metadata.scene === "GROUP_CHAT" &&
      ["FORWARD_SINGLE", "FORWARD_MERGED"].includes(metadata.kind);
    if (
      (forwarded && source.mergedItems.length === 0) ||
      (!forwarded && source.mergedItems.length > 0)
    )
      return unresolved();
    if (metadata.kind === "FORWARD_SINGLE" && forwarded) {
      if (source.mergedItems.length !== 1) return unresolved();
      const item = source.mergedItems[0]!;
      if (source.content !== item.content) return unresolved();
      // A new selection of an ordinary forward has the current sender/time; only merged cards retain inner provenance.
      source.resourceList = item.resourceList;
      source.relatedResources = item.relatedResources;
      source.metadata = {};
      source.authority = item.authority;
      source.mergedItems = [];
    }
    if (Buffer.byteLength(JSON.stringify(source), "utf8") > 2 * 1024 * 1024) return unresolved();
    return source;
  }
}
