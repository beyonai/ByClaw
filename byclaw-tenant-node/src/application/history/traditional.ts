import { bounded } from "./paging.js";
import { DomainError } from "../../domain/errors.js";
import { opaqueId, requireId } from "../../domain/values.js";
import { HistoryAccess } from "./access.js";
import type { Row } from "./contracts.js";
import { arrayJson, objectJson, recalled, safeMessage } from "./message-format.js";

/** 保留传统 assiman 消息、关联与大纲查询的分页和位置语义。 */
export class TraditionalHistory extends HistoryAccess {
  async byCommand(actor: string, commandId: string) {
    requireId(actor);
    const [message] = await this.repository.messages({ commandId: opaqueId(commandId), limit: 1 });
    if (!message || message.enterpriseId !== this.tenantId)
      throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    await this.access(actor, message.sessionId);
    return (await this.projectTaskMentions([message]))[0];
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
      list: await this.projectTaskMentions(rows),
    };
  }
  async byIds(actor: string, ids: string[]) {
    ids.forEach(requireId);
    if (!ids.length || ids.length > 100) throw new DomainError("INVALID_MESSAGE_IDS");
    const rows = await this.repository.messages({ ids });
    for (const id of new Set(rows.map((r) => r.sessionId))) await this.access(actor, id);
    return this.projectTaskMentions(rows);
  }
  /** 为旧任务的首条私聊输入补齐原群消息提及；仅修改返回投影。 */
  private async projectTaskMentions(rows: Row[]): Promise<Row[]> {
    const sources = new Map<string, Row | null>();
    const result: Row[] = [];
    for (const row of rows) {
      const projected = safeMessage(row);
      if (recalled(row) || row.usage !== 1 || !String(row.messageContent).includes("{{")) {
        result.push(projected);
        continue;
      }
      if (!sources.has(row.sessionId)) {
        const task = await this.repository.task(row.sessionId);
        let source: Row | null = null;
        if (
          task?.sourceMessageId &&
          task.groupSessionId &&
          task.initiatorUserId === row.creatorId
        ) {
          const [candidate] = await this.repository.messages({ ids: [task.sourceMessageId] });
          if (
            candidate &&
            candidate.messageId === task.sourceMessageId &&
            candidate.sessionId === task.groupSessionId &&
            candidate.enterpriseId === this.tenantId &&
            candidate.creatorId === task.initiatorUserId &&
            !recalled(candidate)
          )
            source = candidate;
        }
        sources.set(row.sessionId, source);
      }
      const source = sources.get(row.sessionId);
      if (
        source &&
        source.creatorId === row.creatorId &&
        source.messageContent === row.messageContent
      ) {
        const metadata = objectJson(row.metadata);
        const related = objectJson(row.relatedResources);
        const existing = arrayJson(metadata.resourceList).length
          ? arrayJson(metadata.resourceList)
          : arrayJson(related.resourceList);
        const original = arrayJson(objectJson(source.metadata).resourceList).length
          ? arrayJson(objectJson(source.metadata).resourceList)
          : arrayJson(objectJson(source.relatedResources).resourceList);
        const resources = existing.length ? existing : original;
        if (resources.length) {
          if (!arrayJson(metadata.resourceList).length)
            projected.metadata = JSON.stringify({ ...metadata, resourceList: resources });
          if (!arrayJson(related.resourceList).length)
            projected.relatedResources = JSON.stringify({ ...related, resourceList: resources });
        }
      }
      result.push(projected);
    }
    return result;
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
