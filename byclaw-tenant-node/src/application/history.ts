import type { HistoryRepository } from "./history/contracts.js";
import { HistoryAccess } from "./history/access.js";
import { TraditionalHistory } from "./history/traditional.js";
import { GroupHistory } from "./history/groups.js";
import { TimelineHistory } from "./history/timeline.js";
import { TopicHistory } from "./history/topics.js";
export type { HistoryRepository, MessageFilter, Row } from "./history/contracts.js";
export { safeMessage, objectJson } from "./history/message-format.js";
export { bounded } from "./history/paging.js";

/** 历史查询统一入口；权限与各类投影交由小型用例类处理，保持 HTTP 和 Worker 语义一致。 */
export class HistoryService {
  private readonly permission: HistoryAccess;
  private readonly basic: TraditionalHistory;
  private readonly group: GroupHistory;
  private readonly timeline: TimelineHistory;
  private readonly topic: TopicHistory;
  constructor(
    tenantId: string,
    private readonly repository: HistoryRepository,
  ) {
    this.permission = new HistoryAccess(tenantId, repository);
    this.basic = new TraditionalHistory(tenantId, repository);
    this.group = new GroupHistory(tenantId, repository);
    this.timeline = new TimelineHistory(tenantId, repository);
    this.topic = new TopicHistory(tenantId, repository);
  }
  access = (...args: Parameters<HistoryAccess["access"]>) => this.permission.access(...args);
  async sessionExtensions(actor: string, sessionId: string) {
    await this.permission.access(actor, sessionId);
    return (await this.repository.extensions(sessionId)).filter((row) =>
      [
        "external_session_id",
        "external_root_session_id",
        "external_parent_session_id",
        "external_team_id",
        "external_message_id",
        "external_session_status",
        "child_name",
        "child_role",
        "event_source",
      ].includes(row.extParamCode),
    );
  }
  traditional = (...args: Parameters<TraditionalHistory["traditional"]>) =>
    this.basic.traditional(...args);
  byIds = (...args: Parameters<TraditionalHistory["byIds"]>) => this.basic.byIds(...args);
  byCommand = (...args: Parameters<TraditionalHistory["byCommand"]>) =>
    this.basic.byCommand(...args);
  forward = (...args: Parameters<TraditionalHistory["forward"]>) => this.basic.forward(...args);
  outline = (...args: Parameters<TraditionalHistory["outline"]>) => this.basic.outline(...args);
  cancellation = (...args: Parameters<GroupHistory["cancellation"]>) =>
    this.group.cancellation(...args);
  invitation = (...args: Parameters<GroupHistory["invitation"]>) => this.group.invitation(...args);
  publication = (...args: Parameters<GroupHistory["publication"]>) =>
    this.group.publication(...args);
  groups = (...args: Parameters<GroupHistory["groups"]>) => this.group.groups(...args);
  groupNameCheck = (...args: Parameters<GroupHistory["nameCheck"]>) =>
    this.group.nameCheck(...args);
  management = (...args: Parameters<GroupHistory["management"]>) => this.group.management(...args);
  detail = (...args: Parameters<GroupHistory["detail"]>) => this.group.detail(...args);
  settings = (...args: Parameters<GroupHistory["settings"]>) => this.group.settings(...args);
  lifecycle = (...args: Parameters<GroupHistory["lifecycle"]>) => this.group.lifecycle(...args);
  tasks = (...args: Parameters<GroupHistory["tasks"]>) => this.group.tasks(...args);
  task = (...args: Parameters<GroupHistory["task"]>) => this.group.task(...args);
  pending = (...args: Parameters<GroupHistory["pending"]>) => this.group.pending(...args);
  context = (...args: Parameters<TimelineHistory["context"]>) => this.timeline.context(...args);
  search = (...args: Parameters<TimelineHistory["search"]>) => this.timeline.search(...args);
  around = (...args: Parameters<TimelineHistory["around"]>) => this.timeline.around(...args);
  topics = (...args: Parameters<TopicHistory["topics"]>) => this.topic.topics(...args);
  topicMessages = (...args: Parameters<TopicHistory["topicMessages"]>) =>
    this.topic.topicMessages(...args);
}
