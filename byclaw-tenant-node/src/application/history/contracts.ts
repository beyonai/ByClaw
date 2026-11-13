export type Row = Record<string, any>;
export interface MessageFilter {
  filePage?: { before?: string; inclusive?: boolean };
  sessionId?: string;
  commandId?: string;
  ids?: string[];
  before?: string;
  after?: string;
  topicId?: string;
  rootId?: string;
  offset?: number;
  limit?: number;
  visible?: boolean;
  timeline?: boolean;
  outline?: boolean;
  search?: boolean;
  orderById?: boolean;
  ascending?: boolean;
  keyword?: string;
  scope?: string;
  senderType?: string;
  actor?: string;
  startTime?: number;
  endTime?: number;
}
export interface HistoryRepository {
  responses?(groupId: string, after: string, limit: number, ids?: string[]): Promise<Row[]>;
  groupProjectAccess(
    actor: string,
    projectId: string,
  ): Promise<{ bound: boolean; canRead: boolean }>;
  groupNameExists(actor: string, name: string): Promise<boolean>;
  invitation(actor: string, token: string): Promise<Row>;
  publication(taskId: string, privatePendingId?: string): Promise<Row | null>;
  acknowledgements(sessionId: string, messageIds: string[]): Promise<Row[]>;
  session(id: string): Promise<Row | null>;
  member(sessionId: string, userId: string): Promise<Row | null>;
  activeDirectTaskId(groupId: string, actor: string, agentId: string): Promise<string | null>;
  groupMemberApiKey(sessionId: string, userId: string): Promise<string | null>;
  groupMemberId(sessionId: string, userId: string): Promise<string | null>;
  members(sessionId: string): Promise<Row[]>;
  extensions(sessionId: string): Promise<Row[]>;
  messages(filter: MessageFilter): Promise<Row[]>;
  countMessages(filter: MessageFilter): Promise<number>;
  groups(
    actor: string,
    page: number,
    size: number,
  ): Promise<{ list: Row[]; total: number; totalUnreadMessageCount?: number }>;
  tasks(sessionId: string, actor?: string): Promise<Row[]>;
  task(taskId: string): Promise<Row | null>;
  candidate?(sessionId: string): Promise<Row | null>;
  pending(taskId: string): Promise<Row | null>;
  topics(sessionId: string, limit: number, boundary?: string[]): Promise<Row[]>;
  topic(sessionId: string, topicId: string): Promise<Row | null>;
  participants(sessionId: string, topicIds: string[]): Promise<Row[]>;
}
