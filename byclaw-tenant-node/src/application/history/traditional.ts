import { bounded } from "./paging.js";
import { DomainError } from "../../domain/errors.js";
import { opaqueId, requireId } from "../../domain/values.js";
import { HistoryAccess } from "./access.js";
import { objectJson, recalled, safeMessage } from "./message-format.js";

/** 保留传统 assiman 消息、关联与大纲查询的分页和位置语义。 */
export class TraditionalHistory extends HistoryAccess {
  async byCommand(actor: string, commandId: string) {
    requireId(actor);
    const [message] = await this.repository.messages({ commandId: opaqueId(commandId), limit: 1 });
    if (!message || message.enterpriseId !== this.tenantId)
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    await this.access(actor, message.sessionId);
    return safeMessage(message);
  }
  async traditional(actor: string, sessionId: string, pageNum: number, pageSize: number) {
    pageNum = bounded(pageNum, 1, 100000);
    pageSize = bounded(pageSize, 20, 100);
    await this.access(actor, sessionId);
    const filter = { sessionId, offset: (pageNum - 1) * pageSize, limit: pageSize };
    const [rows, total] = await Promise.all([
      this.repository.messages(filter),
      this.repository.countMessages(filter),
    ]);
    return {
      pageNum,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      list: rows.map(safeMessage),
    };
  }
  async byIds(actor: string, ids: string[]) {
    ids.forEach(requireId);
    if (!ids.length || ids.length > 100) throw new DomainError("INVALID_MESSAGE_IDS");
    const rows = await this.repository.messages({ ids });
    for (const id of new Set(rows.map((r) => r.sessionId))) await this.access(actor, id);
    return rows.map(safeMessage);
  }
  async forward(actor: string, messageId: string) {
    const [message] = await this.byIds(actor, [requireId(messageId)]);
    if (!message) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    const ids = objectJson(message.metadata).forwardMsgIds;
    return [
      {
        ...message,
        forwardMsgList:
          typeof ids === "string" && ids.length ? await this.byIds(actor, ids.split(",")) : [],
      },
    ];
  }
  async outline(actor: string, sessionId: string) {
    await this.access(actor, sessionId);
    const rows = await this.repository.messages({ sessionId, outline: true, ascending: true });
    return rows.map((r) => {
      const content = recalled(r)
        ? "消息已撤回"
        : String(r.finalContent || r.messageContent || "").slice(0, 800);
      return {
        messageId: r.messageId,
        role: r.role,
        usage: r.usage,
        content,
        displayContent: content,
        relatedResources: recalled(r) ? undefined : r.relatedResources,
        creatorName: r.creatorName,
        recalled: recalled(r),
        recalledAt: r.recalledAt,
        recalledBy: r.recalledBy,
        createTime: r.createTime,
        position: Number(r.position),
        totalCount: Number(r.totalCount),
      };
    });
  }
}
