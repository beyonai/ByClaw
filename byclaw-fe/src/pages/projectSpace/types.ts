// operation 为运营项目；default 仅用于系统内置项目的回显和编辑，不出现在普通新建选项中。
export type ProjectType = 'normal' | 'operation' | 'develop' | 'default';

export type ProjectShareFlag = 'N' | 'Y';

// 研发项目工作区初始化状态:ready 已就绪(默认/普通项目)、pending 待初始化、initializing 初始化中。
// pending 待初始化 →(维护项目仓库里点初始化,后端同步建工作区)initialized →(点「去跟架构聊天」下发员工)initializing
// →(后端定时任务读会话状态文件报 completed)ready。只有 ready 才放开建需求与启动任务。
export type ProjectInitStatus = 'ready' | 'pending' | 'initialized' | 'initializing';

export type ProjectMemberRole = 'owner' | 'admin' | 'member';

export type ProjectResourceScope = 'shared' | 'task' | 'session';

export type ProjectBoundResourceType = 'knowledge' | 'digital_employee' | 'ontology';

export interface ProjectBoundResource {
  id?: string | number;
  projectId?: string | number;
  resourceType: ProjectBoundResourceType;
  resourceId: string | number;
  resourceName?: string;

  /** 资源详情描述；绑定表历史数据可能没有这些字段，由资源接口补齐。 */
  description?: string;
  resourceDesc?: string;
  desc?: string;
  sortNo?: number;
}

export interface ProjectMember {
  memberId?: string | number;
  projectId?: string | number;
  userId: string | number;
  userCode?: string;
  userName: string;
  role: ProjectMemberRole;
  agentId?: string | number;
  agentName?: string;
  avatar?: string;
  createTime?: string | number;
}

export interface ProjectSession {
  sessionId: string;
  sessionName: string;
  sessionContent?: string;
  updateTime?: string;
  createTime?: string;
  projectId?: string;
  objectId?: string | number;
  objectType?: string;
  avatar?: string;
  // 会话绑定员工的显示名。项目维度的执行员工不在 redux 员工列表里，只给 objectId 会让输入框
  // 的 useDefaultAgentElement 查不到人而兜底成「AI 助手」，得连名字一起带过去写 agentCache。
  agentName?: string;
  sessionExts?: Array<{ extParamCode: string; extParamValue: any }>;
  taskId?: string;
  fileCount?: number;
  matchType?: 'DIGITAL_EMPLOYEE' | 'CHAT_CONTENT';
  matchText?: string;
  matchedEmployeeId?: string | number;
  matchedEmployeeName?: string;
  matchedEmployeeMatchField?: 'NAME' | 'DESCRIPTION';
  matchedEmployeeMatchText?: string;
  // 从项目任务模板执行入口进入聊天时，携带模板生成的首条消息并自动发送。
  initialChatContent?: string;
}

export interface ProjectSpace {
  projectId: string;
  projectName: string;
  description?: string;
  resourceId?: string | number | null;
  projectType: ProjectType;
  isShare: ProjectShareFlag;
  sharedFlag: boolean;
  // 研发项目工作区初始化状态:ready 已就绪(默认/普通项目)、pending 待初始化、initializing 初始化中。
  // 存量与普通项目视为 ready;仅 develop 未 ready 前禁止建需求/启动任务。
  initStatus?: ProjectInitStatus;
  // 初始化会话ID:后端下发初始化时建的那条架构助理会话,用于直达该会话看进展。
  initSessionId?: number;
  // 上次初始化失败/超时原因:pending 态回显,避免只显示「未初始化」而看不出为何回退。
  initFailReason?: string;
  createBy?: string | number;
  createTime?: string;
  sessionCount?: number;
  taskCount?: number;
  fileCount?: number;
  members?: ProjectMember[];
  sessions?: ProjectSession[];
  repos?: ProjectRepo[];
  shareTargets?: ProjectShareTarget[];
  resources?: ProjectBoundResource[];
  boundResources?: ProjectBoundResource[];
}

export interface ProjectRepo {
  repoId?: string | number;
  projectId?: string | number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  createBy?: string | number;
  createTime?: string | number;
}

export interface ProjectShareTarget {
  id: string;
  name: string;
  type: 'USER' | 'ORG' | string;
  shareId?: string | number;
  projectId?: string | number;
  targetType?: string;
  targetId?: string | number;
  targetName?: string;
  createBy?: string | number;
  createTime?: string | number;
}

export interface ProjectTask {
  taskId: string;
  projectId: string;
  taskName: string;
  description?: string;
  assigneeId?: string;
  assigneeName?: string;
  status?: 'todo' | 'doing' | 'done';
  progress?: number;
  dueTime?: string;
}

export interface ProjectResource {
  fileId: string;
  fileName: string;
  scope: ProjectResourceScope;
  sessionId?: string;
  taskId?: string;
  size?: number | string;
  updateTime?: string;
}

export interface ProjectRequirement {
  requirementId: string;
  projectId: string;
  title: string;
  sourceType?: string;
  priority?: string;
  score?: number;
  status?: string;
  createTime?: string;
}
