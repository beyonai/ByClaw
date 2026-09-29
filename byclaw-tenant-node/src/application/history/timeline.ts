import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { Row } from "./contracts.js";
import { HistoryAccess } from "./access.js";
import { safeMessage } from "./message-format.js";
import { bounded } from "./paging.js";
import { displayMessages } from "./timeline-format.js";

/** 群时间线、搜索和上下文快照；在用例层限制数量与字符量，覆盖 HTTP 和 Worker 两种入口。 */
export class TimelineHistory extends HistoryAccess {
  private display(rows: Row[]) {
    return displayMessages(this.repository, rows);
  }
  async context(
    actor: string,
    sessionId: string,
    before: string | undefined,
    maxMessages: number,
    maxCharacters: number,
  ) {
    maxMessages = bounded(maxMessages, 60, 60);
    maxCharacters = bounded(maxCharacters, 30000, 30000);
    await this.access(actor, sessionId, true);
    if (before) requireId(before);
    const [latest] = before
      ? []
      : await this.repository.messages({ sessionId, orderById: true, limit: 1 });
    const boundary = before ?? (latest ? (BigInt(latest.messageId) + 1n).toString() : "1");
    const filter = { sessionId, before: boundary, timeline: true, limit: maxMessages + 1 };
    const [rows, total] = await Promise.all([
      this.repository.messages(filter),
      this.repository.countMessages(filter),
    ]);
    const page = rows.slice(0, maxMessages);
    let used = 0;
    let characterTruncated = false;
    const selected: Row[] = [];
    for (const row of page) {
      const length = (safeMessage(row).messageContent ?? "").length;
      if (used + length > maxCharacters) {
        characterTruncated = true;
        break;
      }
      used += length;
      selected.push(row);
    }
    selected.reverse();
    return {
      schemaVersion: "byclaw.group-chat-context/v1",
      conversationKey: sessionId,
      messages: await this.display(selected),
      snapshot: {
        beforeMessageId: boundary,
        lastIncludedMessageId: selected.at(-1)?.messageId,
        generatedAt: Date.now(),
      },
      truncation: {
        truncated: total > selected.length || characterTruncated,
        omittedMessageCount: total - selected.length,
        reason: characterTruncated
          ? "character_limit"
          : total > selected.length
            ? "message_limit"
            : null,
      },
    };
  }
  async search(actor: string, sessionId: string, input: Row) {
    await this.access(actor, sessionId, true);
    const scope = String(input.scope ?? "ALL").toUpperCase(),
      senderType = String(input.senderType ?? "ALL").toUpperCase();
    if (
      !["ALL", "MINE", "MENTIONED_ME"].includes(scope) ||
      !["ALL", "USER", "AGENT"].includes(senderType)
    )
      throw new DomainError("INVALID_SEARCH_FILTER");
    if (
      input.keyword !== undefined &&
      (typeof input.keyword !== "string" || input.keyword.length > 100)
    )
      throw new DomainError("INVALID_KEYWORD");
    for (const key of ["startTime", "endTime"])
      if (
        input[key] !== undefined &&
        (!Number.isSafeInteger(input[key]) || input[key] < 0 || input[key] > 253402300799999)
      )
        throw new DomainError("INVALID_TIME");
    if (input.startTime != null && input.endTime != null && input.startTime > input.endTime)
      throw new DomainError("INVALID_TIME");
    const limit = bounded(input.limit, 20, 50);
    if (input.beforeMessageId) requireId(input.beforeMessageId);
    const rows = await this.repository.messages({
      sessionId,
      actor,
      visible: true,
      search: true,
      keyword: input.keyword?.trim(),
      scope,
      senderType,
      startTime: input.startTime,
      endTime: input.endTime,
      before: input.beforeMessageId,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      messages: await this.display(page),
      hasMore: rows.length > limit,
      nextBeforeMessageId: rows.length > limit ? page.at(-1)?.messageId : undefined,
    };
  }
  async around(actor: string, sessionId: string, messageId: string) {
    await this.access(actor, sessionId, true);
    requireId(messageId);
    if (!(await this.repository.messages({ sessionId, ids: [messageId], visible: true })).length)
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    const before = await this.repository.messages({
      sessionId,
      before: (BigInt(messageId) + 1n).toString(),
      visible: true,
      limit: 27,
    });
    const after = await this.repository.messages({
      sessionId,
      after: messageId,
      visible: true,
      ascending: true,
      limit: 25,
    });
    return {
      schemaVersion: "byclaw.group-chat-context/v1",
      conversationKey: sessionId,
      messages: await this.display([...before.slice(0, 26).reverse(), ...after]),
      truncation: {
        truncated: before.length > 26,
        omittedMessageCount: before.length > 26 ? 1 : 0,
        reason: before.length > 26 ? "message_limit" : null,
      },
    };
  }
}
