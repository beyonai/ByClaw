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
  constructor(tenantId: string, repository: HistoryRepository) {
    this.permission = new HistoryAccess(tenantId, repository);
    this.basic = new TraditionalHistory(tenantId, repository);
    this.group = new GroupHistory(tenantId, repository);
    this.timeline = new TimelineHistory(tenantId, repository);
    this.topic = new TopicHistory(tenantId, repository);
  }
  access = (...args: Parameters<HistoryAccess["access"]>) => this.permission.access(...args);
  traditional = (...args: Parameters<TraditionalHistory["traditional"]>) =>
    this.basic.traditional(...args);
  byIds = (...args: Parameters<TraditionalHistory["byIds"]>) => this.basic.byIds(...args);
  forward = (...args: Parameters<TraditionalHistory["forward"]>) => this.basic.forward(...args);
  outline = (...args: Parameters<TraditionalHistory["outline"]>) => this.basic.outline(...args);
  groups = (...args: Parameters<GroupHistory["groups"]>) => this.group.groups(...args);
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
