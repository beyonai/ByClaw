import type { CommandContext } from "./command-context.js";
import { DomainError } from "../../domain/errors.js";
import { requireId, text } from "../../domain/values.js";
import { first } from "./sql-utils.js";
import { objectJson, arrayJson } from "../../application/history/message-format.js";

/** Message edits share the command transaction and session lock with mirror writes. */
async function message(context: CommandContext) {
  const { command, db } = context;
  const row = await first(
    db,
    "SELECT * FROM byai.byai_message WHERE message_id=$1 AND session_id=$2 AND enterprise_id=$3",
    [requireId(command.payload.messageId), command.sessionId, command.enterpriseId],
  );
  if (!row || row.recalledAt) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
  return row;
}

export async function updateFeedback(context: CommandContext) {
  const { command, db } = context,
    p = command.payload;
  if (!["praise", "tread", "none"].includes(p.type) || !["reaction", "feedback"].includes(p.mode))
    throw new DomainError("INVALID_FEEDBACK");
  const row = await message(context),
    metadata = objectJson(row.metadata);
  const details = p.feedback == null ? {} : objectJson(text(p.feedback, 64000));
  if (
    p.mode === "feedback" &&
    p.type === "tread" &&
    !["ANS_INACCURATE", "WRONG_PERSON", "FEED_OTHER"].includes(details.feedbackLabel)
  )
    throw new DomainError("INVALID_FEEDBACK");
  for (const key of [
    "praise",
    "tread",
    "feedback_type",
    "feedback_content",
    "feedback_label",
    "feedback_score",
    "feedback_con_mark",
  ])
    delete metadata[key];
  if (p.type !== "none") {
    metadata.feedback_type = p.type;
    if (p.mode === "reaction" || p.type === "tread") metadata[p.type] = command.userId;
    if (p.type === "tread") {
      metadata.feedback_content = details.feedbackContent ?? null;
      metadata.feedback_label = details.feedbackLabel ?? null;
      if (p.mode === "reaction") {
        metadata.feedback_score = details.feedbackScore ?? null;
        metadata.feedback_con_mark = details.feedbackConMark ?? null;
      }
    }
  }
  const encoded = JSON.stringify(metadata);
  await db.query(
    "UPDATE byai.byai_message SET metadata=$1,storage_version=storage_version+1,update_time=CURRENT_TIMESTAMP WHERE message_id=$2 AND session_id=$3 AND enterprise_id=$4",
    [encoded, p.messageId, command.sessionId, command.enterpriseId],
  );
  await db.query(
    "UPDATE byai.byai_message_relobj SET feedback_type=$1,feedback_content=$2,feedback_label=$3,feedback_score=$4,feedback_time=$5 WHERE res_msg_id=$6 AND session_id=$7",
    [
      p.type === "none" ? null : p.type,
      metadata.feedback_content ?? null,
      metadata.feedback_label == null
        ? null
        : JSON.stringify(
            Array.isArray(metadata.feedback_label)
              ? metadata.feedback_label
              : [metadata.feedback_label],
          ),
      metadata.feedback_score ?? null,
      p.type === "tread" ? new Date() : null,
      p.messageId,
      command.sessionId,
    ],
  );
  return { metadata: encoded };
}

export async function updateMessageStructure(context: CommandContext) {
  const { command, db } = context,
    p = command.payload;
  if (!["messageStruct", "inferLog"].includes(p.updateField))
    throw new DomainError("INVALID_MESSAGE_UPDATE");
  const id = text(p.id, 255, true),
    content = text(p.content, 2 * 1024 * 1024);
  const row = await message(context),
    structure = arrayJson(row[p.updateField]);
  for (const item of structure) {
    if (item?.id !== id || !Array.isArray(item.choices)) continue;
    for (const choice of item.choices) if (choice?.delta) choice.delta.content = content;
  }
  const column = p.updateField === "inferLog" ? "infer_log" : "message_struct";
  await db.query(
    `UPDATE byai.byai_message SET ${column}=$1,storage_version=storage_version+1,update_time=CURRENT_TIMESTAMP WHERE message_id=$2 AND session_id=$3 AND enterprise_id=$4`,
    [JSON.stringify(structure), p.messageId, command.sessionId, command.enterpriseId],
  );
}
