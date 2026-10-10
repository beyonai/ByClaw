import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { Row } from "./contracts.js";
import { HistoryAccess } from "./access.js";
import { messageAttachments } from "./attachments.js";
import { time } from "./message-format.js";
import { bounded, encodeCursor } from "./paging.js";

/** 从最新群消息向前补足文件页；游标保留同一消息内的附件位置。 */
export class GroupFileHistory extends HistoryAccess {
  async files(actor: string, sessionId: string, requestedSize?: number, cursor?: string) {
    await this.access(actor, sessionId, true);
    const pageSize = bounded(requestedSize, 20, 50);
    const resume = this.decode(sessionId, cursor);
    let before = resume?.messageId;
    let inclusive = resume !== undefined;
    let last: { messageId: string; index: number } | undefined;
    const files: { messageId: string; createdAt: number | null; attachment: Row }[] = [];
    while (true) {
      const rows = await this.repository.messages({
        sessionId,
        filePage: { before, inclusive },
        limit: 100,
      });
      for (const row of rows) {
        const attachments = messageAttachments(row);
        const start = resume && row.messageId === resume.messageId ? resume.index + 1 : 0;
        for (let index = start; index < attachments.length; index++) {
          // 多发现一个有效附件才设置 hasMore，避免普通消息或损坏附件造成空的下一页。
          if (files.length === pageSize)
            return {
              files,
              pageSize,
              hasMore: true,
              nextCursor: encodeCursor(["1", sessionId, last!.messageId, String(last!.index)]),
            };
          files.push({
            messageId: row.messageId,
            createdAt: row.createTime == null ? null : time(row.createTime),
            attachment: attachments[index]!,
          });
          last = { messageId: row.messageId, index };
        }
      }
      if (rows.length < 100) break;
      before = rows.at(-1)!.messageId;
      inclusive = false;
    }
    return { files, pageSize, hasMore: false, nextCursor: null };
  }

  private decode(sessionId: string, cursor?: string) {
    if (!cursor?.trim()) return undefined;
    const parts = Buffer.from(cursor, "base64url").toString("utf8").split(":");
    if (
      cursor.length > 256 ||
      !/^[A-Za-z0-9_-]+={0,2}$/.test(cursor) ||
      parts.length !== 4 ||
      parts[0] !== "1" ||
      parts[1] !== sessionId ||
      !/^[1-9]\d*$/.test(parts[2]!) ||
      !/^\d+$/.test(parts[3]!) ||
      Number(parts[3]) > 2147483647
    )
      throw new DomainError("INVALID_CURSOR");
    try {
      requireId(parts[2]);
    } catch {
      throw new DomainError("INVALID_CURSOR");
    }
    return { messageId: parts[2]!, index: Number(parts[3]) };
  }
}
