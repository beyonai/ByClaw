import { POST, type ConfigType } from '@/service/common/request';
import type { IntegrationStage, TestAccount } from '@/layout/sider/components/ProjectSpaceList/Integration/types';

// 默认项目只用于系统内置项目回显和编辑，接口层类型也需要覆盖，避免前端判断 default 时类型不一致。
type DevloopProjectType = 'normal' | 'operation' | 'develop' | 'default';

type DevloopProjectShareFlag = 'N' | 'Y';

export type ProjectResourceType = 'knowledge' | 'digital_employee' | 'ontology';

export type ProjectResourcePayload = {
  resourceType: ProjectResourceType;
  resourceId: string | number;
  resourceName?: string;
  sortNo?: number;
};

export type DevloopProjectSessionSearchMode = 'DIGITAL_EMPLOYEE' | 'CHAT_CONTENT';

type DevloopProjectShareTargetPayload = {
  targetType: string;
  targetId: string | number;
  targetName?: string;
};

type DevloopProjectPayload = {
  projectName: string;
  description?: string;
  projectType?: DevloopProjectType;
  isShare?: DevloopProjectShareFlag;
  shareTargets?: DevloopProjectShareTargetPayload[];
  resources?: ProjectResourcePayload[];
};

type DevloopProjectSessionListPayload = {
  projectId: number;
  pageNum?: number;
  pageSize?: number;
  keyword?: string;

  /** 高级会话搜索方式；不传时后端保持标题、摘要搜索兼容逻辑。 */
  searchMode?: DevloopProjectSessionSearchMode;
};

export type DevloopTaskListQuery = {
  projectId: number;
  createTimeStart?: string;
  createTimeEnd?: string;
  taskName?: string;

  /** 仅看当前登录用户负责（创建）的任务；后端按当前用户的会话过滤，分页总数随之收敛。 */
  onlyMine?: boolean;

  /** 任务状态筛选，整体任务视图按状态列分别查询。 */
  status?: 'pending' | 'in_progress' | 'paused' | 'completed';

  /** 任务类型筛选；为空返回全部类型。与 status 同传时两个条件叠加。 */
  taskType?: DevloopTaskType;
  pageNum?: number;
  pageSize?: number;
};

// 任务类型对照 byai_default_agent 的架构/需求/研发/测试四角色；chat=项目内直接开聊的普通会话，不属于四角色任务。
// 会话表没有类型列，后端按各创建链路的关联行反查(架构=项目初始化会话，研发=有仓库子任务行，测试=被集成执行记录引用，需求=需求项回写了会话)。
export type DevloopTaskType = 'architect' | 'requirement' | 'coder' | 'tester' | 'chat';

export type DevloopTaskCurrentStage = {
  stageId: string;
  stageIndex: number;
  stageName: string;
  skill?: string;
  activity?: string;
  nextAction?: string;
  startedAt?: string;
};

export type DevloopTaskStage = {
  stageId: string;
  sequence: number;
  stageName: string;
  skill?: string;
  status: 'pending' | 'in_progress' | 'paused' | 'completed';
  statusLabel?: string;
  activity?: string;
  resultSummary?: string;
  progressPercent?: number;
  loopCount?: number;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
};

export type DevloopTaskState = {
  schemaVersion: '2.0.0';
  revision: number;
  sessionId: string;
  traceId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'paused' | 'completed';
  statusLabel: string;
  currentStage: DevloopTaskCurrentStage;
  progress: {
    percent: number;
    completedStages: number;
    totalStages: number;
    summary: string;
  };
  loopCount: number;
  stageLoopCount: number;
  stages: DevloopTaskStage[];
  transitions: Array<Record<string, any>>;
  pause?: Record<string, any> | null;
  stateFile: string;
  createdAt: string;
  updatedAt: string;
};

export type DevloopTaskItem = {
  taskId: number;
  sessionId: number;
  projectId: number;
  title?: string;
  createBy?: number;
  canDelete?: boolean;
  createTime?: string;
  updateTime?: string;
  stateAvailable: boolean;
  traceId?: string;
  revision?: number;
  status?: DevloopTaskState['status'];
  statusLabel?: string;
  currentStage?: DevloopTaskCurrentStage;
  progress: number;
  loopCount?: number;
  stageLoopCount?: number;
  assignee?: string;
  assigneeId?: string | number;
  dueTime?: string;
  agentName?: string;
  avatar?: string;
  // 会话绑定的数字员工，进入会话后输入框据此回填默认 @ 员工；只有 agentName 无法回填。
  objectType?: string;
  objectId?: number | string;
  description?: string;
  taskDescription?: string;
  branchName?: string;
  repoFullName?: string;
  requirementTitle?: string;
  requirementOriginId?: string;
  sourceItemId?: number;
  taskType?: DevloopTaskType;
};

export type DevloopTaskPage = {
  pageNum: number;
  pageSize: number;
  total: number;
  totalPages: number;
  list: DevloopTaskItem[];
};

export type DevloopProjectSpaceFile = {
  fileId: number;
  fileName: string;
  fileUrl: string;
  projectId: number;
  shareLink?: string | null;
};

export type OperationTaskTemplateType = 'collect' | 'knowledge' | 'content' | 'publish' | 'analyze';

export type OperationTaskTemplate = {
  templateId: number;
  templateType: OperationTaskTemplateType;
  templateName: string;
  description?: string;
  icon?: string;
  config?: string | Record<string, unknown>;
  sortNo?: number;
  isBuiltin?: string;
};

// 仓库类型:workspace 工作区(单个,承载项目上下文/产出) / code 代码仓库(可多个)。存量数据默认 code。
export type ProjectRepoType = 'workspace' | 'code';

// 代码平台:决定 clone/push 使用的 host 与令牌注入方式。存量无值按 github 处理。
export type RepoProvider = 'github' | 'gitlab' | 'gitea';

export type DevloopProjectRepo = {
  repoId: number;
  projectId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  // 人工填写的仓库职责,给后来人和需求 AI 预拆看。
  description?: string;
  repoType?: ProjectRepoType;
  provider?: RepoProvider;
  createBy?: string;
  createTime?: string;
};

// 项目管理
// 创建项目由页面自行展示业务错误信息，允许调用方关闭请求层的通用错误弹窗。
export const createProject = (data: DevloopProjectPayload, config?: ConfigType) =>
  POST<any>('/byaiService/project/create', data, config);

export const listProjects = (data?: { keyword?: string; pageNum?: number; pageSize?: number }, config?: ConfigType) =>
  POST<any>('/byaiService/project/list', data || {}, config);

export const getProject = (projectId: number) => POST<any>('/byaiService/project/get', { projectId });

export const listProjectResources = (projectId: number) =>
  POST<any>('/byaiService/project/resource/list', { projectId });

export const saveProjectResources = (data: { projectId: number; resources: ProjectResourcePayload[] }) =>
  POST<void>('/byaiService/project/resource/save', data);

export const updateProject = (data: Partial<DevloopProjectPayload> & { projectId: number }) =>
  POST<any>('/byaiService/project/update', data);

export const deleteProject = (projectId: number) => POST<any>('/byaiService/project/delete', { projectId });

// 研发项目工作区初始化状态:ready 已就绪(默认/普通项目)、pending 待初始化、initializing 初始化中。
// 仅 develop 项目在未 ready 前禁止建需求/启动任务。
export type ProjectInitStatus = 'ready' | 'pending' | 'initializing';

// initializing 态轮询间隔:后端扫描定时任务本身 30s 一轮,再快也拿不到更新的状态,只是白打接口。
export const INIT_POLL_INTERVAL_MS = 5000;

// 轮询次数上限(约 10 分钟)。后端超时线是 2 小时,页面开着不该陪着打两小时接口;
// 更要紧的是后端一旦收不了口(状态文件读失败、状态被卡住),没有封顶就是无限刷同一个 /project/get。
// 停轮询只影响自动消横幅,用户切项目或重进页面即重新开始轮询。
export const INIT_POLL_MAX_ROUNDS = 120;

// 下发工作区初始化:后端建一条架构数字员工会话并返回 sessionId,真正的初始化在沙箱里由架构助理执行。
// 完成与否由后端定时任务读该会话的任务状态文件判定,前端只轮询 initStatus,没有「标记完成」的接口。
// 回架构员工而不只回会话ID:项目维度员工不在前端员工列表里,跳进会话时要靠这两个字段写 agentCache,
// 否则聊天输入框的 @ 查不到人会兜底成「AI 助手」。ID 是字符串——雪花 ID 超过 JS 安全整数。
export const startProjectInit = (data: { projectId: number; buildIndex: boolean; skillPackages: string[] }) =>
  POST<{ sessionId: string; architectAgentId: string; architectAgentName: string }>(
    '/byaiService/project/init/start',
    data
  );

// 项目仓库维护：扫描源关联仓库时可即席新增/删除
export const createProjectRepo = (data: {
  projectId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  description?: string;
  repoType?: ProjectRepoType;
  provider?: RepoProvider;
}) => POST<any>('/byaiService/project/repo/create', data);

/** 更新项目仓库，沿用原 repoId 保持已有任务和扫描源的关联不变。 */
export const updateProjectRepo = (data: {
  repoId: number;
  projectId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  description?: string;
  repoType?: ProjectRepoType;
  provider?: RepoProvider;
}) => POST<any>('/byaiService/project/repo/update', data);

export const listProjectRepos = (projectId: number) =>
  POST<DevloopProjectRepo[]>('/byaiService/project/repo/list', { projectId });

export type ProjectRepoTreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file' | string;
  size?: number;
  sha?: string;
  url?: string;
  hasChildren?: boolean;
};

export type ProjectRepoBranch = {
  name: string;
  sha?: string;
  protectedBranch?: boolean;
};

export type ProjectRepoFileContent = {
  name: string;
  path: string;
  branch: string;
  sha?: string;
  size?: number;
  content?: string | null;
  base64Content?: string | null;
  binary?: boolean;
  url?: string;
  downloadUrl?: string;
};

export const listProjectRepoTree = (data: { projectId: number; repoId: number; path?: string; ref?: string }) =>
  POST<ProjectRepoTreeNode[]>('/byaiService/project/repo/tree', data);

export const searchProjectRepoTree = (data: { projectId: number; repoId: number; keyword: string; ref?: string }) =>
  POST<ProjectRepoTreeNode[]>('/byaiService/project/repo/tree/search', data);

export const listProjectRepoBranches = (repoId: number) =>
  POST<ProjectRepoBranch[]>('/byaiService/project/repo/branch/list', { repoId });

export const getProjectRepoFileContent = (data: { repoId: number; branch: string; path: string }) =>
  POST<ProjectRepoFileContent>('/byaiService/project/repo/file/content', data);

export const deleteProjectRepo = (repoId: number) => POST<any>('/byaiService/project/repo/delete', { repoId });

// 项目会话列表按项目懒加载，避免项目列表接口一次带出大量会话。
export const listProjectSessionsByQo = (data: DevloopProjectSessionListPayload, config?: ConfigType) =>
  POST<any>('/byaiService/project/session/listByQo', data, config);

// 项目资源 tab 的共享文件空间使用项目维度文件接口，不再读取当前数字员工的 /.shared/ 目录。
export const listProjectSpaceFiles = (projectId: number) =>
  POST<DevloopProjectSpaceFile[]>('/byaiService/project/share/listSpaceFiles', { projectId });

// 会话空间文件保存到当前项目共享文件空间，成功后刷新共享文件列表。
export const saveProjectFileToSpace = (data: {
  projectId: number;
  sessionId: number;
  filePath: string;
  fileName: string;
}) => POST<void>('/byaiService/project/share/saveToSpace', data);

// 共享文件的名称和存储位置由项目维度接口管理，避免误走数字员工文件浏览接口。
export const renameProjectSpaceFile = (data: { projectId: number; fileId: number; fileName: string }) =>
  POST<void>('/byaiService/project/share/rename', data);

// 删除项目共享文件时由后端同步清理对象存储、文件元数据和项目关联记录。
export const deleteProjectSpaceFile = (data: { projectId: number; fileId: number }) =>
  POST<void>('/byaiService/project/share/delete', data);

// 扫描源管理
export const createScanSource = (data: {
  projectId: number;
  sourceName: string;
  sourceType: string;
  config: string;
  cronExpr?: string;
  enabled?: string;
  repoId?: number;
  confirmMode?: string;
  scoreThreshold?: number;
}) => POST<any>('/byaiService/devloop/source/create', data);

export const updateScanSource = (data: {
  sourceId: number;
  sourceName?: string;
  config?: string;
  cronExpr?: string;
  repoId?: number;
  confirmMode?: string;
  scoreThreshold?: number;
}) => POST<any>('/byaiService/devloop/source/update', data);

export const deleteScanSource = (sourceId: number) => POST<any>('/byaiService/devloop/source/delete', { sourceId });

export const listScanSources = (data: { projectId: number; keyword?: string; pageNum?: number; pageSize?: number }) =>
  POST<any>('/byaiService/devloop/source/list', data);

export const toggleScanSource = (sourceId: number, enabled: string) =>
  POST<any>('/byaiService/devloop/source/toggle', { sourceId, enabled });

export const triggerScan = (sourceId: number) => POST<any>('/byaiService/devloop/source/scan', { sourceId });

// 扫描日志
export const listScanLogs = (sourceId: number, limit = 20) =>
  POST<any>('/byaiService/devloop/log/list', { sourceId, limit });

export const listScanLogItems = (logId: number) => POST<any>('/byaiService/devloop/log/items', { logId });

// 按扫描源直查已收集需求(action=created)，避免按最近N条日志遍历漏掉早期需求
export const listRequirementsBySource = (sourceId: number) =>
  POST<any>('/byaiService/devloop/source/requirements', { sourceId });

// 按项目一次查需求(后端时间倒序)，仅按需求名称模糊搜索。
export const listRequirementsByProject = (projectId: number, title?: string) =>
  POST<any>('/byaiService/devloop/project/requirements', { projectId, title: title || undefined });

/** 手工需求的可编辑字段，与后端的创建、修改 DTO 保持一致。 */
type ManualRequirementPayload = {
  projectId: number;
  sourceType: 'manual' | 'customer_feedback' | 'internal_proposal';
  branch?: string;
  // 手工需求单独关联研发仓库，避免项目存在多个仓库时回退到第一个仓库。
  repoId: number;
  title: string;
  originalContent: string;
  productContent?: string;
};

/**
 * 通过手工录入链路新建需求。sourceType 保存业务来源，后端仍通过内部 manual 来源持久化，
 * 因此此联合类型必须与 ManualRequirementDTO 保持一致。
 */
export const createManualRequirement = (data: ManualRequirementPayload) =>
  POST<any>('/byaiService/devloop/requirement/create', data);

/** 修改尚未启动的手工需求，项目归属由后端按需求条目反查。 */
export const updateManualRequirement = (data: Omit<ManualRequirementPayload, 'projectId'> & { itemId: number }) =>
  POST<any>('/byaiService/devloop/requirement/update', data);

/** 删除尚未启动的手工需求，后端会再次校验当前用户是否为项目创建者。 */
export const deleteManualRequirement = (itemId: number) =>
  POST<any>('/byaiService/devloop/requirement/delete', { itemId });

// 运营需求复用扫描源表，四类需求通过 source_type 区分，差异化执行字段统一收敛到 config。
export type OperationRequirementPayload = {
  itemId?: number;
  projectId?: number;
  requirementName: string;

  /** 运营需求描述，对应 byai_scan_source.source_description。 */
  sourceDescription?: string;
  operationType: 'collect' | 'knowledge' | 'publish' | 'analyze';
  assignee?: string | number;
  dueTime?: string;
  config?: Record<string, any>;
};

/** 创建运营需求；需求创建与后续执行运营任务分离，避免误走研发任务创建接口。 */
export const createOperationRequirement = (data: OperationRequirementPayload) =>
  POST<{ itemId: number; sourceId: number }>('/byaiService/devloop/requirement/createOperationRequirement', data);

/** 修改未启动运营需求；项目归属由后端根据 itemId 反查。 */
export const updateOperationRequirement = (data: Omit<OperationRequirementPayload, 'projectId'> & { itemId: number }) =>
  POST<void>('/byaiService/devloop/requirement/updateOperationRequirement', data);

/** 按运营项目分页查询需求，后端负责名称的忽略大小写模糊搜索。 */
export const listOperationRequirements = (data: {
  projectId: number;
  keyword?: string;
  pageNum?: number;
  pageSize?: number;
}) => POST<DevloopTaskPage>('/byaiService/devloop/requirement/operation/list', data);

/** 查询运营需求详情，供后续编辑和执行入口复用。 */
export const getOperationRequirement = (itemId: number) =>
  POST<any>('/byaiService/devloop/requirement/operation/get', { itemId });

/** 删除运营需求；后端仅允许需求创建人操作。 */
export const deleteOperationRequirement = (itemId: number) =>
  POST<void>('/byaiService/devloop/requirement/operation/delete', { itemId });

// 聊天输入框与运营需求启动入口共用同一套任务模板目录和详情接口。
export const listOperationTaskTemplates = (templateType?: OperationTaskTemplateType) =>
  POST<OperationTaskTemplate[]>('/byaiService/devloop/operation/task-template/list', {
    templateType: templateType || undefined,
  });

export const getOperationTaskTemplate = (templateId: number) =>
  POST<OperationTaskTemplate>('/byaiService/devloop/operation/task-template/get', { templateId });

/** 按当前选择的知识库查询可用本体对象。 */
export const queryObjectsByKnowledge = (data: {
  kbResourceId: string | number;
  kbDirectories?: string[];
  objectName?: string;
  pageIndex?: number;
  pageSize?: number;
}) => POST<any>('/byaiService/devloop/operation/queryObjectsByKnowledge', data);

/** 查询会话或项目关联的本体对象文件；未传 sessionId 时按项目维度查询。 */
export const listProjectObjectFiles = (data: { projectId?: number | string; sessionId?: number | string }) =>
  POST<any>('/byaiService/devloop/operation/listProjectObjectFiles', data);

// 运营需求启动后拆解为会话任务，taskId 与 byai_session.session_id 保持一致。
export type OperationTaskStartItem = {
  title: string;
  description?: string;
  assignee: string | number;
  dueTime?: string;
  templateId?: number;
  config?: Record<string, unknown>;
};

export const startOperationRequirement = (data: { requirementId: number; tasks: OperationTaskStartItem[] }) =>
  POST<any[]>('/byaiService/devloop/requirement/operation/start', data);

export const listOperationTasks = (data: {
  projectId: number;
  keyword?: string;
  onlyMine?: boolean;
  createTimeStart?: string;
  createTimeEnd?: string;
  status?: string;
  pageNum?: number;
  pageSize?: number;
}) => POST<DevloopTaskPage>('/byaiService/devloop/operation/task/list', data);

export const getOperationTask = (taskId: number) => POST<any>('/byaiService/devloop/operation/task/get', { taskId });

/** 修改待开始的运营任务。 */
export const updateOperationTask = (data: {
  taskId: number;
  title: string;
  description?: string;
  assignee: string | number;
  dueTime?: string;
}) => POST<void>('/byaiService/devloop/operation/task/update', data);

/** 删除运营任务；后端仅允许任务创建人操作。 */
export const deleteOperationTask = (taskId: number) =>
  POST<void>('/byaiService/devloop/operation/task/delete', { taskId });

// 新流程传承接成员 ID，由后端读取其最新绑定的数字员工；agentIds 保留给旧调用方兼容使用。
export const executeOperationTask = (data: {
  taskId: number;
  assigneeIds?: Array<string | number>;
  agentIds?: Array<string | number>;

  /** 执行前由任务模板页补充的模板和结构化配置。 */
  templateId?: number;
  config?: Record<string, unknown>;
}) => POST<{ taskId: number; sessionId: number }>('/byaiService/devloop/operation/task/execute', data);

// 运营账号由项目维度独立维护，新增需求表单和账号管理大面板共用此数据源。
export type OperationAccountPayload = {
  accountId?: string | number;
  projectId?: number;
  platformCode: string;
  accountCode: string;
  accountName: string;
};

export const listOperationAccounts = (projectId: number) =>
  POST<any[]>('/byaiService/devloop/operation/account/list', { projectId });

export const createOperationAccount = (data: OperationAccountPayload) =>
  POST<{ accountId: number }>('/byaiService/devloop/operation/account/create', data);

export const updateOperationAccount = (data: OperationAccountPayload & { accountId: string | number }) =>
  POST<void>('/byaiService/devloop/operation/account/update', data);

export const deleteOperationAccount = (accountId: string | number) =>
  POST<void>('/byaiService/devloop/operation/account/delete', { accountId });

// UI Agent 登录完成后携带采集沙箱标识确认账号状态，服务端会校验沙箱归属。
export const loginOperationAccount = (accountId: string | number, sandboxId: string) =>
  POST<{ accountId: number; loginStatus: string }>('/byaiService/devloop/operation/account/login', {
    accountId,
    sandboxId,
  });

// PAT 管理
export const saveGitHubPat = (pat: string) => POST<any>('/byaiService/devloop/pat/github', { pat });

export const checkGitHubPat = () => POST<any>('/byaiService/devloop/pat/github/check', {});

// 钉钉群搜索
export const searchDingtalkGroups = (query: string) =>
  POST<any>('/byaiService/devloop/dingtalk/groups/search', { query });

// 研发任务继续兼容 sourceItemId；运营任务在同一任务框架下补充任务配置和数字员工编排字段。
export type DevloopTaskCreatePayload = {
  // projectId、title、sourceItemId 为原研发任务调用保留字段。
  projectId: number;
  sourceItemId?: number;
  title?: string;
  taskName?: string;
  description?: string;
  // 以下字段只由运营任务提交；后端联调完成前保持可选以兼容旧接口契约。
  taskType?: 'collect' | 'content' | 'analyze';
  assigneeId?: string | number;
  dueTime?: string;
  controllerAgentId?: string | number;
  executorAgentIds?: Array<string | number>;
  collectConfig?: Record<string, any>;
  contentConfig?: Record<string, any>;
  analyzeConfig?: Record<string, any>;
};

export const createTask = (data: DevloopTaskCreatePayload) => POST<any>('/byaiService/devloop/task/create', data);

// 需求拆分为多仓库子任务:每个子任务独立仓库/分支/承接员工,dependsOn 记录需求内 DAG 依赖(rowId 引用同批其他子任务)。
export type DevloopSplitTaskPayload = {
  rowId: string;
  title: string;
  repoId: number;
  branch?: string;
  assigneeId?: string | number;
  dependsOn: string[];
};

export type DevloopSplitPayload = {
  projectId: number;
  sourceItemId: number;
  tasks: DevloopSplitTaskPayload[];
};

export const splitTask = (data: DevloopSplitPayload) => POST<any>('/byaiService/devloop/task/split', data);

// 需求的第二个启动入口:交给需求数字员工在聊天里聊完成,不拆子任务。
// 与 splitTask 二选一 —— 两条入口写同一个需求 sessionId,启动其一另一条即被后端闸门挡掉。
export const startRequirementClarify = (data: { projectId: number; sourceItemId: number }) =>
  POST<{ sessionId: number }>('/byaiService/devloop/requirement/clarify', data);

// AI 预拆:后端按系统配置的提示词把需求+仓库清单交给大模型,返回草稿任务,不落库。
// aiSuggested=false 表示模型不可用或输出不可解析,后端已降级为每仓库一行且不猜依赖。
export type DevloopPresplitResult = {
  aiSuggested: boolean;
  degradeReason?: string;
  tasks: {
    rowId: string;
    title: string;
    repoId?: number;
    branch: string;
    dependsOn: string[];
    reason?: string;
  }[];
};

export const presplitRequirement = (data: { projectId: number; sourceItemId: number }) =>
  POST<DevloopPresplitResult>('/byaiService/devloop/task/presplit', data);

export const listTasks = (query: DevloopTaskListQuery) =>
  POST<DevloopTaskPage>('/byaiService/devloop/task/list', query);

// 任务详情即会话详情，后端按 sessionId 查询（taskId 与 sessionId 同值）
export const getTaskDetail = (sessionId: number) => POST<any>('/byaiService/devloop/task/detail', { sessionId });

// 任务代码变更：目标分支相对仓库默认分支的文件变更列表(远程分支口径)。
// status: ok | no_repo | no_token | branch_not_found | http_error；files 每项含 filename/status/additions/deletions/previousFilename。
export type DevloopTaskChanges = {
  status: 'ok' | 'no_repo' | 'no_token' | 'branch_not_found' | 'http_error';
  // 变更来源:local=读宿主机工作区 git(含未推送/未提交),remote=GitHub 远程 compare(仅已推送)。
  source?: 'local' | 'remote';
  repoId?: number;
  repoFullName?: string | null;
  baseBranch?: string | null;
  headBranch?: string | null;
  aheadBy?: number;
  compareUrl?: string | null;
  message?: string | null;
  fileCount?: number;
  files: {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    previousFilename?: string | null;
    blobUrl?: string | null;
    repoId?: number;
  }[];
};

export const getTaskChanges = (sessionId: number) =>
  POST<DevloopTaskChanges>('/byaiService/devloop/task/changes', { sessionId });

// 单个文件的本地 diff（unified 文本），供右侧预览抽屉逐行渲染。status: ok | no_workspace | not_git_repo | git_error。
export type DevloopTaskFileDiff = {
  status: 'ok' | 'no_workspace' | 'not_git_repo' | 'git_error';
  filename?: string | null;
  diff?: string | null;
  message?: string | null;
};

export const getTaskFileDiff = (sessionId: number, filePath: string, repoId?: number) =>
  POST<DevloopTaskFileDiff>('/byaiService/devloop/task/file-diff', { sessionId, filePath, repoId });

// 任务环节进度：直接读取 self-developed-rules v2 会话状态投影
export const getTaskPhases = (sessionId: number) =>
  POST<DevloopTaskState>('/byaiService/devloop/task/phases', { sessionId });

// 项目成员
export const addProjectMember = (data: {
  projectId: number;
  // userIds 用于成员列表多选新增；userId 保留以兼容已有的单成员调用。
  userIds?: Array<string | number>;
  userId?: string | number;
  userCode?: string;
  userName?: string;
}) => POST<any>('/byaiService/project/member/add', data);

// 保存项目最终成员列表，新增和删除成员由后端在同一事务中统一处理。
export const saveProjectMembers = (data: { projectId: number; userIds: Array<string | number> }) =>
  POST<any>('/byaiService/project/member/save', data);

// 项目成员列表仅按成员姓名模糊搜索，和成员 Tab 的输入提示保持一致。
export const listProjectMembers = (projectId: number, userName?: string) =>
  POST<any>('/byaiService/project/member/list', { projectId, userName: userName || undefined });

export const removeProjectMember = (memberId: number) => POST<any>('/byaiService/project/member/remove', { memberId });

export const bindMemberAgent = (data: { memberId: number; agentId: number }) =>
  POST<any>('/byaiService/project/member/bindAgent', data);

export const unbindMemberAgent = (memberId: number) =>
  POST<any>('/byaiService/project/member/unbindAgent', { memberId });

// DWS 钉钉授权
export const startDwsDeviceAuth = () => POST<any>('/byaiService/devloop/dws/startDeviceAuth', {});

export const checkDwsAuthStatus = () => POST<any>('/byaiService/devloop/dws/authStatus', {});

// 按扫描源查授权状态：查该源创建者的授权，返回 canAuthorize/creatorName，供列表逐源展示与入口控制。
export const checkDwsAuthStatusBySource = (sourceId: number) =>
  POST<any>('/byaiService/devloop/dws/authStatus/bySource', { sourceId });

// 集成测试环境
// stages / testAccounts 前端为结构化数组，落库为JSON字符串，故服务层统一序列化后再发。
// 定时(cron)与执行员工不在环境里，归属独立测试数字员工配置，避免重复。
export type IntegrationEnvPayload = {
  projectId: number;
  envName: string;
  address?: string;
  connProtocol?: 'ssh' | 'local';
  connHost?: string;
  connPort?: string;
  connUser?: string;
  connAuth?: 'key' | 'password';
  // 用例来源:workspace=跟随项目工作区仓库(约定入口 tests/run.sh)/on_env=用例已预置在环境机上。
  // 后端 IntegrationRunExecutor 只看这个字段判定用例从哪来，用例集里的仓库/分支仅 on_env 时还生效。
  caseSource?: 'workspace' | 'on_env';
  // 连接凭据key，指向 ~/.openclaw/credentials/，不传明文密码。
  connCredentialRef?: string;
  connWorkdir?: string;
  stages?: IntegrationStage[];
  testAccounts?: TestAccount[];
};

// stages/testAccounts 序列化为JSON字符串以匹配后端 IntegrationEnvDTO 的 String 字段。
const encodeEnvPayload = (data: Partial<IntegrationEnvPayload>) => ({
  ...data,
  stages: data.stages !== undefined ? JSON.stringify(data.stages) : undefined,
  testAccounts: data.testAccounts !== undefined ? JSON.stringify(data.testAccounts) : undefined,
});

export const createIntegrationEnv = (data: IntegrationEnvPayload) =>
  POST<any>('/byaiService/devloop/integration/env/create', encodeEnvPayload(data));

export const updateIntegrationEnv = (data: Partial<IntegrationEnvPayload> & { envId: number }) =>
  POST<any>('/byaiService/devloop/integration/env/update', encodeEnvPayload(data));

export const deleteIntegrationEnv = (envId: number) =>
  POST<any>('/byaiService/devloop/integration/env/delete', { envId });

export const listIntegrationEnvs = (projectId: number) =>
  POST<any>('/byaiService/devloop/integration/env/list', { projectId });

// 端到端测试用例集:caseCount 为数字,enabled 落库为 '0'/'1'。
// 用例来源已上移到环境 caseSource,用例集只登记环境机上的执行入口,所以 source/branch 恒为空;
// runner 也不再收发——运行命令本身写明了用什么跑。
export type IntegrationSuitePayload = {
  projectId: number;
  suiteName: string;
  source?: string;
  branch?: string;
  runCommand?: string;
  workdir?: string;
  reportPath?: string;
  caseCount?: number;
  enabled?: string;
};

export const createIntegrationSuite = (data: IntegrationSuitePayload) =>
  POST<any>('/byaiService/devloop/integration/suite/create', data);

export const updateIntegrationSuite = (data: Partial<IntegrationSuitePayload> & { suiteId: number }) =>
  POST<any>('/byaiService/devloop/integration/suite/update', data);

export const deleteIntegrationSuite = (suiteId: number) =>
  POST<any>('/byaiService/devloop/integration/suite/delete', { suiteId });

export const toggleIntegrationSuite = (suiteId: number, enabled: string) =>
  POST<any>('/byaiService/devloop/integration/suite/toggle', { suiteId, enabled });

export const listIntegrationSuites = (projectId: number) =>
  POST<any>('/byaiService/devloop/integration/suite/list', { projectId });

// ===== 集成测试执行 =====
// 点「执行测试」秒回 runId,后台异步跑;前端轮询 getIntegrationRun 直到 status 进入终态。
// executorMode:backend=后端直连环境跑用例并当场解析报告(便于排查);tester=下发独立测试数字员工，
// run 保持 running 等员工回流。省略则由后端全局配置决定（正式形态 tester）。
export const startIntegrationRun = (suiteId: number, envId: number, executorMode?: 'backend' | 'tester') =>
  POST<{ runId: string }>('/byaiService/devloop/integration/run/start', { suiteId, envId, executorMode });

export const getIntegrationRun = (runId: string | number) =>
  POST<any>('/byaiService/devloop/integration/run/get', { runId });

// 报告原文不落库，点「查看报告」时后端才 SSH 去环境机读；文件已被清掉会直接返回错误。
export const getIntegrationRunReport = (runId: string | number) =>
  POST<{ path: string; content: string }>('/byaiService/devloop/integration/run/report', { runId });

export const listIntegrationRuns = (suiteId: number) =>
  POST<any[]>('/byaiService/devloop/integration/run/list', { suiteId });

export const listIntegrationRunsByEnv = (envId: number) =>
  POST<any[]>('/byaiService/devloop/integration/run/listByEnv', { envId });

// 需求级集成聚合看板:项目下已拆解需求按「需求→多仓库任务」组装,含就绪状态、最近执行结果与打回记录。
export const listRequirementIntegrations = (projectId: number) =>
  POST<any[]>('/byaiService/devloop/integration/requirements', { projectId });

// ===== 默认助理 =====
// 四角色(架构/需求/研发/测试)兜底员工:projectId 缺省=全局默认,>0=项目覆盖。
export type DefaultAgentConfig = {
  projectId?: number;
  architectAgentId?: string;
  architectAgentName?: string;
  requirementAgentId?: string;
  requirementAgentName?: string;
  coderAgentId?: string;
  coderAgentName?: string;
  testerAgentId?: string;
  testerAgentName?: string;
};

// 查某作用域原始配置(全局或某项目覆盖)。projectId 缺省查全局默认。
export const getDefaultAgent = (projectId?: number) =>
  POST<DefaultAgentConfig>('/byaiService/devloop/default-agent/get', { projectId });

// 解析项目各角色生效员工(项目覆盖合并到全局默认之上)。
export const resolveDefaultAgent = (projectId?: number) =>
  POST<DefaultAgentConfig>('/byaiService/devloop/default-agent/resolve', { projectId });

// 保存某作用域配置(每作用域唯一,后端 upsert)。
export const saveDefaultAgent = (data: DefaultAgentConfig) =>
  POST<void>('/byaiService/devloop/default-agent/save', data);

// ===== 独立测试数字员工配置 =====
// 需求级集成的定时节流+就绪准入+失败打回策略,每项目一行;执行员工统一取全局测试默认(resolveDefaultAgent)。
// 结构对齐前端 TesterConfig(enabled/schedule/admission/kickback),后端与扁平列互转。
export type TesterConfigPayload = {
  projectId: number;
  enabled: boolean;
  schedule: { cron: string; cronLabel: string; timezone: string };
  admission: { requireAllCoded: boolean; maxConcurrentReqs: number };
  kickback: { autoAttribute: boolean; createDefectWhenUnclear: boolean; maxRounds: number };
};

// 查项目配置;后端无记录时回填出厂默认,前端始终拿到完整可编辑配置。
export const getTesterConfig = (projectId: number) =>
  POST<TesterConfigPayload>('/byaiService/devloop/tester-config/get', { projectId });

// 保存项目配置(每项目唯一,后端 upsert)。
export const saveTesterConfig = (data: TesterConfigPayload) =>
  POST<void>('/byaiService/devloop/tester-config/save', data);

// 手动触发一次项目批量集成:对项目下所有启用用例集 × 指定环境各起一次真实 run,返回 runId 列表。
export const runTesterBatch = (projectId: number, envId: number) =>
  POST<{ runIds: Array<string | number>; suiteCount: number }>('/byaiService/devloop/tester-config/run', {
    projectId,
    envId,
  });
