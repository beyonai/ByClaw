import { bounded } from "./paging.js";
import { DomainError } from "../../domain/errors.js";
import { requireId } from "../../domain/values.js";
import { HistoryAccess } from "./access.js";
import { arrayJson, objectJson } from "./message-format.js";

/** 群列表、详情、设置及任务读取；私有任务和待发布卡片仅向发起人开放。 */
export class GroupHistory extends HistoryAccess {
  async groups(actor: string, pageNum: number, pageSize: number) {
    requireId(actor);
    pageNum = bounded(pageNum, 1, 100000);
    pageSize = bounded(pageSize, 20, 100);
    const result = await this.repository.groups(actor, pageNum, pageSize);
    const list = await Promise.all(
      result.list.map(async (r) => {
        const { latestMessageRecalledAt, latestMessageMetadata, ...summary } = r;
        const resources = arrayJson(objectJson(latestMessageMetadata).resourceList);
        const names = new Map(
          resources
            .filter(
              (v) => v && ["HUMAN", "DIG_EMPLOYEE"].includes(v.resourceType) && v.resourceName,
            )
            .map((v) => [`${v.resourceType}_${v.resourceId}`, v.resourceName]),
        );
        const preview = String(r.latestMessageContent ?? "").replace(
          /\{\{((?:DIG_EMPLOYEE|HUMAN)_[1-9]\d*)}}|\[@([^]\r\n]+)]\(uid=([^()\s]+)\)/g,
          (match, placeholder, name, uid) =>
            names.get(placeholder ?? uid) || name
              ? `@${names.get(placeholder ?? uid) ?? name}`
              : match,
        );
        return {
          ...summary,
          latestMessageRecalled: latestMessageRecalledAt != null,
          latestMessageContent: latestMessageRecalledAt ? "消息已撤回" : preview,
          members: (await this.repository.members(r.sessionId))
            .slice(0, 9)
            .map((m) => ({ memObjType: m.memObjType, memObjId: m.memObjId, memName: m.memName })),
          hasUnreadMention: Number(r.unreadMentionCount) > 0,
        };
      }),
    );
    return { ...result, list, pageNum, pageSize, totalPages: Math.ceil(result.total / pageSize) };
  }
  async settings(actor: string, sessionId: string) {
    await this.access(actor, sessionId, true);
    const ext = new Map(
      (await this.repository.extensions(sessionId)).map((r) => [r.extParamCode, r.extParamValue]),
    );
    return {
      groupNumber: sessionId,
      allowJoinByLink:
        !ext.has("group_join_link_enabled") || ext.get("group_join_link_enabled") === "true",
      allowMemberAddAgent: ext.get("group_member_add_agent_enabled") === "true",
      allowMemberInviteUser: ext.get("group_member_invite_user_enabled") === "true",
    };
  }
  async detail(actor: string, sessionId: string) {
    const session = await this.access(actor, sessionId, true);
    return {
      session,
      members: await this.repository.members(sessionId),
      settings: await this.settings(actor, sessionId),
    };
  }
  async lifecycle(actor: string, sessionId: string) {
    return {
      dissolved: (await this.access(actor, sessionId, true, true)).state === "GROUP_DISSOLVED",
    };
  }
  async tasks(actor: string, sessionId: string) {
    await this.access(actor, sessionId, true);
    return this.repository.tasks(sessionId);
  }
  async task(actor: string, taskId: string) {
    requireId(taskId);
    const task = await this.repository.task(taskId);
    if (!task) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    await this.access(actor, task.groupSessionId, true);
    if (task.initiatorUserId !== actor) throw new DomainError("RESOURCE_NOT_ACCESSIBLE");
    return task;
  }
  async pending(actor: string, taskId: string) {
    const task = await this.task(actor, taskId);
    if (task.status !== "ACTIVE") return null;
    const row = await this.repository.pending(taskId);
    return row
      ? {
          taskId,
          pendingPublicationId: row.pendingPublicationId,
          text: row.textContent,
          sourcePaths: arrayJson(row.sourceFilesJson),
          createTime: row.createTime,
        }
      : null;
  }
}
