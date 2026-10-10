import type { CommandContext } from "./command-context.js";
import { CommandContext as ChildContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { camel, first, insert, nextId } from "./sql-utils.js";
import { createHash } from "node:crypto";

/** A root-locked binding is durable across backend/Node restarts and never crosses tenants. */
export async function ensureExternalChild(context: CommandContext) {
  const { command, db } = context;
  const parent = await context.session();
  if (!parent || parent.sessionType === "hs_as") throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const external = text(command.payload.externalSessionId, 255);
  const root = text(command.payload.externalRootSessionId, 255);
  if (!external.trim() || !root.trim() || external === root)
    throw new DomainError("INVALID_EXTERNAL_CHILD");
  const key = `external_child:${createHash("sha256").update(external).digest("hex")}`;
  const binding = await first(
    db,
    "SELECT ext_param_value FROM byai.byai_session_ext WHERE session_id=$1 AND ext_param_code=$2",
    [command.sessionId, key],
  );
  if (binding) {
    const ids = JSON.parse(binding.extParamValue);
    if (ids.externalRootSessionId !== root) throw new DomainError("MIRROR_CONTEXT_MISMATCH");
    const session = await first(
      db,
      "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
      [ids.childSessionId, command.enterpriseId],
    );
    const message = await first(
      db,
      "SELECT * FROM byai.byai_message WHERE message_id=$1 AND enterprise_id=$2",
      [ids.messageId, command.enterpriseId],
    );
    if (
      !session ||
      session.parentSessionId !== command.sessionId ||
      !message ||
      message.sessionId !== session.sessionId
    )
      throw new DomainError("MIRROR_CONTEXT_MISMATCH");
    return { data: { session, message } };
  }
  const childSessionId = await nextId(db, command.enterpriseId);
  const messageId = await nextId(db, command.enterpriseId);
  const task = await first(
    db,
    "SELECT target_agent_id FROM byai.byai_group_chat_task WHERE task_session_id=$1",
    [command.sessionId],
  );
  const session = {
    session_id: childSessionId,
    parent_session_id: command.sessionId,
    enterprise_id: command.enterpriseId,
    creator_id: parent.creatorId,
    session_type: parent.sessionType,
    project_id: parent.projectId,
    object_id: task?.targetAgentId ?? parent.objectId ?? null,
    object_type: "AGENT",
    session_name: text(command.payload.childName ?? "子 Agent", 255, true) || "子 Agent",
    session_content: text(command.payload.childTask ?? "", 4000, true),
    state: "ACTIVE",
    last_seq: "1",
    create_time: new Date(),
    update_time: new Date(),
  };
  const message = {
    id: messageId,
    message_id: messageId,
    session_id: childSessionId,
    enterprise_id: command.enterpriseId,
    usage: 2,
    role: "assistant",
    message_content: "",
    message_struct: "[]",
    infer_log: "[]",
    metadata: "{}",
    msg_status: 1,
    is_complete: false,
    storage_version: "0",
    created_seq: "1",
    create_time: new Date(),
    update_time: new Date(),
  };
  await insert(db, "byai_session", session);
  await insert(db, "byai_message", message);
  const child = new ChildContext(db, { ...command, sessionId: childSessionId });
  for (const [code, value] of Object.entries({
    external_session_id: external,
    external_root_session_id: root,
    external_message_id: messageId,
    event_source: "EXTERNAL_CHILD",
    external_parent_session_id: command.payload.externalParentSessionId ?? root,
    child_name: session.session_name,
    child_role: command.payload.childRole ?? "",
  }))
    await child.setExtension(code, text(value, 4000, true));
  await context.setExtension(
    key,
    JSON.stringify({ childSessionId, messageId, externalRootSessionId: root }),
  );
  return { data: { session: camel(session), message: camel(message) } };
}

/** Store a complete rendered projection; optimistic watermark prevents lost concurrent updates. */
export async function saveExternalChild(context: CommandContext) {
  const { command, db } = context,
    p = command.payload;
  const childId = requireId(p.childSessionId),
    messageId = requireId(p.messageId);
  const child = await first(
    db,
    "SELECT * FROM byai.byai_session WHERE session_id=$1 AND enterprise_id=$2",
    [childId, command.enterpriseId],
  );
  const message = await first(
    db,
    "SELECT * FROM byai.byai_message WHERE message_id=$1 AND enterprise_id=$2 FOR UPDATE",
    [messageId, command.enterpriseId],
  );
  if (
    !child ||
    child.parentSessionId !== command.sessionId ||
    !message ||
    message.sessionId !== childId
  )
    throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  const stored = JSON.parse(message.metadata || "{}");
  if ((stored.event_stream_id ?? null) !== (p.expectedStreamId ?? null))
    throw new DomainError("VERSION_CONFLICT");
  if (
    !Array.isArray(p.messageStruct) ||
    !Array.isArray(p.inferLog) ||
    typeof p.complete !== "boolean" ||
    !p.metadata ||
    typeof p.metadata !== "object" ||
    Array.isArray(p.metadata) ||
    typeof p.streamId !== "string" ||
    !/^\d+-\d+$/.test(p.streamId)
  )
    throw new DomainError("INVALID_EXTERNAL_CHILD");
  const metadata = { ...p.metadata, event_stream_id: p.streamId };
  const committed = await first(
    db,
    `UPDATE byai.byai_message SET message_content=$1,message_struct=$2,infer_log=$3,
    metadata=$4,is_complete=$5,msg_status=$6,storage_version=storage_version+1,update_time=CURRENT_TIMESTAMP,
    final_content=$10 WHERE message_id=$7 AND session_id=$8 AND enterprise_id=$9 RETURNING *`,
    [
      text(p.messageContent, 2 * 1024 * 1024, true),
      JSON.stringify(p.messageStruct),
      JSON.stringify(p.inferLog),
      JSON.stringify(metadata),
      p.complete,
      p.complete ? 0 : 1,
      messageId,
      childId,
      command.enterpriseId,
      p.finalContent == null ? null : text(p.finalContent, 2 * 1024 * 1024, true),
    ],
  );
  await new ChildContext(db, { ...command, sessionId: childId }).setExtension(
    "external_session_status",
    String(metadata.session_status ?? (p.complete ? "completed" : "running")),
  );
  return { data: { session: child, message: { ...committed, complete: p.complete } } };
}
