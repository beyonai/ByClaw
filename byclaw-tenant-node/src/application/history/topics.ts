import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import type { Row } from "./contracts.js";
import { HistoryAccess } from "./access.js";
import { time } from "./message-format.js";
import { decodeCursor, encodeCursor } from "./paging.js";
import { displayMessages } from "./timeline-format.js";

export class TopicHistory extends HistoryAccess {
  private display(rows: Row[]) {
    return displayMessages(this.repository, rows);
  }
  async topics(actor: string, sessionId: string, limit: number, cursor?: string) {
    await this.access(actor, sessionId, true);
    const boundary = decodeCursor(cursor, sessionId, 5);
    const rows = await this.repository.topics(sessionId, limit + 1, boundary);
    const page = rows.slice(0, limit);
    const participants = await this.repository.participants(
      sessionId,
      page.map((r) => r.topicId),
    );
    const items = await Promise.all(
      page.map(async (r) => {
        const messages = await this.repository.messages({
          sessionId,
          ids: [r.rootMessageId, r.lastMessageId],
          visible: true,
        });
        const display = new Map((await this.display(messages)).map((m) => [m.messageId, m]));
        return {
          topicId: r.topicId,
          rootMessageId: r.rootMessageId,
          lastMessageId: r.lastMessageId,
          lastActivityAt: time(r.lastActivityAt),
          rootMessage: display.get(r.rootMessageId) ?? null,
          lastMessage: display.get(r.lastMessageId) ?? null,
          participants: participants
            .filter((p) => p.topicId === r.topicId)
            .map(({ topicId: _id, ...p }) => p),
        };
      }),
    );
    const last = page.at(-1);
    return {
      items,
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor([
              "1",
              sessionId,
              String(time(last.lastActivityAt)),
              last.lastMessageId,
              last.topicId,
            ])
          : null,
    };
  }
  async topicMessages(
    actor: string,
    sessionId: string,
    topicId: string,
    limit: number,
    cursor?: string,
  ) {
    await this.access(actor, sessionId, true);
    requireId(topicId);
    const topic = await this.repository.topic(sessionId, topicId);
    if (!topic) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    const boundary = decodeCursor(cursor, sessionId, 5, topicId);
    if (boundary) {
      const [anchor] = await this.repository.messages({
        sessionId,
        ids: [boundary[4]!],
        visible: true,
      });
      if (!anchor || anchor.topicId !== topicId || time(anchor.createTime) !== Number(boundary[3]))
        throw new DomainError("INVALID_CURSOR");
    }
    const rows = await this.repository.messages({
      sessionId,
      topicId,
      rootId: topic.rootMessageId,
      visible: true,
      ascending: true,
      after: boundary?.[4],
      limit: limit + 1,
    });
    const page = rows.slice(0, limit),
      roots = await this.repository.messages({
        sessionId,
        ids: [topic.rootMessageId],
        visible: true,
      });
    const display = new Map((await this.display([...page, ...roots])).map((m) => [m.messageId, m]));
    const last = page.at(-1);
    return {
      topicId,
      rootMessageId: topic.rootMessageId,
      rootMessage: display.get(topic.rootMessageId) ?? null,
      messages: page.map((r) => display.get(r.messageId)),
      hasMore: rows.length > limit,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(["1", sessionId, topicId, String(time(last.createTime)), last.messageId])
          : null,
    };
  }
}
