import type { Row } from "./contracts.js";
import { DomainError } from "../../domain/errors.js";
import { HistoryAccess } from "./access.js";
import { responseView } from "./group-response-contracts.js";

/** A group member may discover response status; only the initiator may resolve a runtime binding. */
export class GroupResponseHistory extends HistoryAccess {
  async responses(actor: string, groupId: string, cursor = "0", limit = 50) {
    await this.access(actor, groupId, true);
    if (!/^\d+$/.test(cursor) || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new DomainError("INVALID_BODY");
    const rows = await this.repository.responses!(groupId, cursor, limit + 1);
    return {
      items: rows.slice(0, limit).map((row) => this.viewerResponse(row, actor)),
      nextCursor: rows.length > limit ? String(rows[limit - 1].executionId) : undefined,
    };
  }
  async resolveResponses(actor: string, groupId: string, ids: string[]) {
    await this.access(actor, groupId, true);
    if (
      !Array.isArray(ids) ||
      ids.length > 100 ||
      ids.some((id) => !/^(execution|task):\d+$/.test(id))
    )
      throw new DomainError("INVALID_BODY");
    const rows = ids.length ? await this.repository.responses!(groupId, "0", 100, ids) : [];
    const items: Row[] = rows.map((row) => this.viewerResponse(row, actor));
    // Coordinated tasks are formal immediately and retain their existing task permissions.
    if (ids.some((id) => id.startsWith("task:"))) {
      for (const task of await this.repository.tasks(groupId, actor)) {
        const responseId = `task:${task.dispatchId}`;
        if (
          ids.includes(responseId) &&
          task.status !== "PRIVATE" &&
          task.turnStatus !== "PRIVATE"
        ) {
          const [source] = await this.repository.messages({
            sessionId: groupId,
            ids: [String(task.sourceMessageId)],
            visible: true,
          });
          if (!source) continue;
          const view = responseView({
            ...task,
            responseId,
            groupSessionId: groupId,
            disposition: "TASK",
            taskStatus: task.status,
            taskTurnStatus: task.turnStatus,
            sourceContent: source.messageContent,
            sourceMetadata: source.metadata,
            sourceName: source.creatorName,
            sourceCreatorId: source.creatorId,
            sourceCreateTime: source.createTime,
            sourceRecalledAt: source.recalledAt,
            agentName: "群组工作助手",
          });
          items.push({ ...view, canReadContent: false });
        }
      }
    }
    return {
      items,
      unavailableIds: ids.filter((id) => !items.some((item) => item.responseId === id)),
    };
  }
  /** Runtime identity is private to the initiator; public response events omit it. */
  private viewerResponse(row: Row, actor: string): Row {
    const view = responseView(row);
    const canReadContent = String(row.initiatorUserId) === actor;
    return {
      ...view,
      canReadContent,
      ...(canReadContent && view.phase === "RUNNING" && row.traceId
        ? {
            stream: { sessionId: String(row.candidateSessionId), traceId: String(row.traceId) },
          }
        : {}),
    };
  }
}
