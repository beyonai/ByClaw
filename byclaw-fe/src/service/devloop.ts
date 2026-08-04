import { POST, type ConfigType } from '@/service/common/request';
import type { IntegrationStage, TestAccount } from '@/layout/sider/components/ProjectSpaceList/Integration/types';

// 默认项目只用于系统内置项目回显和编辑，接口层类型也需要覆盖，避免前端判断 default 时类型不一致。
type DevloopProjectType = 'normal' | 'operation' | 'develop' | 'default';

type DevloopProjectShareFlag = 'N' | 'Y';

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
};

type DevloopProjectSessionListPayload = {
  projectId: number;
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
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
  pageNum?: number;
  pageSize?: number;
};

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
  agentName?: string;
  avatar?: string;
  branchName?: string;
  repoFullName?: string;
  requirementTitle?: string;
  requirementOriginId?: string;
  sourceItemId?: number;
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

export type DevloopProjectRepo = {
  repoId: number;
  projectId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
  createBy?: string;
  createTime?: string;
};

// 项目管理
export const createProject = (data: DevloopProjectPayload) => POST<any>('/byaiService/project/create', data);

export const listProjects = (data?: { keyword?: string; pageNum?: number; pageSize?: number }, config?: ConfigType) =>
  POST<any>('/byaiService/project/list', data || {}, config);

export const getProject = (projectId: number) => POST<any>('/byaiService/project/get', { projectId });

export const updateProject = (data: Partial<DevloopProjectPayload> & { projectId: number }) =>
  POST<any>('/byaiService/project/update', data);

export const deleteProject = (projectId: number) => POST<any>('/byaiService/project/delete', { projectId });

// 项目仓库维护：扫描源关联仓库时可即席新增/删除
export const createProjectRepo = (data: {
  projectId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
}) => POST<any>('/byaiService/project/repo/create', data);

export const listProjectRepos = (projectId: number) =>
  POST<DevloopProjectRepo[]>('/byaiService/project/repo/list', { projectId });

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

// 运营需求独立于研发扫描需求，三类需求的差异化字段统一收敛到 config，避免前端依赖数据库字段命名。
export type OperationRequirementPayload = {
  itemId?: number;
  projectId?: number;
  requirementName: string;
  description?: string;
  operationType: 'collect' | 'publish' | 'analyze';
  assignee?: string | number;
  dueTime?: string;
  status?: 'todo' | 'launched' | 'doing' | 'pendingReview' | 'done' | 'cancelled';
  progress?: number;
  config?: Record<string, any>;
};

/** 创建运营需求；需求创建与后续执行运营任务分离，避免误走研发任务创建接口。 */
export const createOperationRequirement = (data: OperationRequirementPayload) =>
  POST<{ itemId: number }>('/byaiService/devloop/requirement/createOperationRequirement', data);

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

/** 删除未启动的运营需求。 */
export const deleteOperationRequirement = (itemId: number) =>
  POST<void>('/byaiService/devloop/requirement/operation/delete', { itemId });

// 运营需求启动后会拆解为多个独立运营任务，任务与需求分别维护状态和执行会话。
export type OperationTaskStartItem = {
  title: string;
  description?: string;
  assignee: string | number;
  dueTime?: string;
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

// 新流程传承接成员 ID，由后端读取其最新绑定的数字员工；agentIds 保留给旧调用方兼容使用。
export const executeOperationTask = (data: {
  taskId: number;
  assigneeIds?: Array<string | number>;
  agentIds?: Array<string | number>;
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

export const getTaskFileDiff = (sessionId: number, filePath: string) =>
  POST<DevloopTaskFileDiff>('/byaiService/devloop/task/file-diff', { sessionId, filePath });

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

// DWS 钉钉授权
export const startDwsDeviceAuth = () => POST<any>('/byaiService/devloop/dws/startDeviceAuth', {});

export const checkDwsAuthStatus = () => POST<any>('/byaiService/devloop/dws/authStatus', {});

// 按扫描源查授权状态：查该源创建者的授权，返回 canAuthorize/creatorName，供列表逐源展示与入口控制。
export const checkDwsAuthStatusBySource = (sourceId: number) =>
  POST<any>('/byaiService/devloop/dws/authStatus/bySource', { sourceId });

export const saveDwsToken = (token: string) => POST<any>('/byaiService/devloop/dws/saveToken', { token });

// 集成测试环境
// stages / testAccounts 前端为结构化数组，落库为JSON字符串，故服务层统一序列化后再发。
// 定时(cron)与执行员工不在环境里，归属独立测试数字员工配置，避免重复。
export type IntegrationEnvPayload = {
  projectId: number;
  envName: string;
  address?: string;
  orchestrator?: 'script' | 'jenkins' | 'k8s' | 'webhook';
  connProtocol?: 'ssh' | 'local';
  connHost?: string;
  connPort?: string;
  connUser?: string;
  connAuth?: 'key' | 'password';
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

// 端到端测试用例集
// manual 套件的清单(manualCases)不入库,仅登记 manualFile 路径;caseCount 为数字,enabled 落库为 '0'/'1'。
export type IntegrationSuitePayload = {
  projectId: number;
  suiteName: string;
  runner?: string;
  sourceType?: string;
  repoId?: number;
  source?: string;
  branch?: string;
  runCommand?: string;
  workdir?: string;
  reportPath?: string;
  caseCount?: number;
  enabled?: string;
  manualFile?: string;
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
export const startIntegrationRun = (suiteId: number, envId: number) =>
  POST<{ runId: string }>('/byaiService/devloop/integration/run/start', { suiteId, envId });

export const getIntegrationRun = (runId: string | number) =>
  POST<any>('/byaiService/devloop/integration/run/get', { runId });

export const listIntegrationRuns = (suiteId: number) =>
  POST<any[]>('/byaiService/devloop/integration/run/list', { suiteId });
