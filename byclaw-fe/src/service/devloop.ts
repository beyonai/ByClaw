import { POST, type ConfigType } from '@/service/common/request';

// 默认项目只用于系统内置项目回显和编辑，接口层类型也需要覆盖，避免前端判断 default 时类型不一致。
type DevloopProjectType = 'normal' | 'develop' | 'default';

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
  keyword?: string;
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

// 项目管理
export const createProject = (data: DevloopProjectPayload) => POST<any>('/byaiService/devloop/project/create', data);

export const listProjects = (data?: { keyword?: string }, config?: ConfigType) =>
  POST<any>('/byaiService/devloop/project/list', data || {}, config);

export const getProject = (projectId: number) => POST<any>('/byaiService/devloop/project/get', { projectId });

export const updateProject = (data: Partial<DevloopProjectPayload> & { projectId: number }) =>
  POST<any>('/byaiService/devloop/project/update', data);

export const deleteProject = (projectId: number) => POST<any>('/byaiService/devloop/project/delete', { projectId });

// 项目仓库维护：扫描源关联仓库时可即席新增/删除
export const createProjectRepo = (data: {
  projectId: number;
  repoFullName: string;
  repoUrl?: string;
  defaultBranch?: string;
}) => POST<any>('/byaiService/devloop/project/repo/create', data);

export const deleteProjectRepo = (repoId: number) => POST<any>('/byaiService/devloop/project/repo/delete', { repoId });

// 项目空间按会话分组展示，创建会话后需要显式建立项目-会话关系。
export const bindProjectSession = (data: { projectId: number; sessionId: number }) =>
  POST<any>('/byaiService/devloop/project/session/bind', data);

export const unbindProjectSession = (data: { projectId: number; sessionId: number }) =>
  POST<any>('/byaiService/devloop/project/session/unbind', data);

// 项目会话列表按项目懒加载，避免项目列表接口一次带出大量会话。
export const listProjectSessionsByQo = (data: DevloopProjectSessionListPayload, config?: ConfigType) =>
  POST<any>('/byaiService/devloop/project/session/listByQo', data, config);

// 项目资源 tab 的共享文件空间使用项目维度文件接口，不再读取当前数字员工的 /.shared/ 目录。
export const listProjectSpaceFiles = (projectId: number) =>
  POST<DevloopProjectSpaceFile[]>('/byaiService/devloop/project/share/listSpaceFiles', { projectId });

// 会话空间文件保存到当前项目共享文件空间，成功后刷新共享文件列表。
export const saveProjectFileToSpace = (data: {
  projectId: number;
  sessionId: number;
  filePath: string;
  fileName: string;
}) => POST<void>('/byaiService/devloop/project/share/saveToSpace', data);

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

export const listScanSources = (projectId: number) => POST<any>('/byaiService/devloop/source/list', { projectId });

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

// 按项目一次查需求(后端时间倒序)，可按标题和内容模糊搜索。
export const listRequirementsByProject = (projectId: number, keyword?: string) =>
  POST<any>('/byaiService/devloop/project/requirements', { projectId, keyword: keyword || undefined });

// PAT 管理
export const saveGitHubPat = (pat: string) => POST<any>('/byaiService/devloop/pat/github', { pat });

export const checkGitHubPat = () => POST<any>('/byaiService/devloop/pat/github/check', {});

// 钉钉群搜索
export const searchDingtalkGroups = (query: string) =>
  POST<any>('/byaiService/devloop/dingtalk/groups/search', { query });

// 研发任务
export const createTask = (data: { projectId: number; sourceItemId?: number; title?: string }) =>
  POST<any>('/byaiService/devloop/task/create', data);

export const listTasks = (query: DevloopTaskListQuery) =>
  POST<DevloopTaskPage>('/byaiService/devloop/task/list', query);

// 任务详情即会话详情，后端按 sessionId 查询（taskId 与 sessionId 同值）
export const getTaskDetail = (sessionId: number) => POST<any>('/byaiService/devloop/task/detail', { sessionId });

// 任务代码变更：目标分支相对仓库默认分支的文件变更列表(远程分支口径)。
// status: ok | no_repo | no_token | branch_not_found | http_error；files 每项含 filename/status/additions/deletions/previousFilename。
export type DevloopTaskChanges = {
  status: 'ok' | 'no_repo' | 'no_token' | 'branch_not_found' | 'http_error';
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

// 任务环节进度：直接读取 self-developed-rules v2 会话状态投影
export const getTaskPhases = (sessionId: number) =>
  POST<DevloopTaskState>('/byaiService/devloop/task/phases', { sessionId });

// 项目成员
export const addProjectMember = (data: {
  projectId: number;
  userId: string | number;
  userCode?: string;
  userName?: string;
}) => POST<any>('/byaiService/devloop/member/add', data);

// 项目成员列表支持按姓名、账号和绑定数字员工名称模糊搜索。
export const listProjectMembers = (projectId: number, keyword?: string) =>
  POST<any>('/byaiService/devloop/member/list', { projectId, keyword: keyword || undefined });

export const removeProjectMember = (memberId: number) => POST<any>('/byaiService/devloop/member/remove', { memberId });

export const bindMemberAgent = (data: { memberId: number; agentId: number }) =>
  POST<any>('/byaiService/devloop/member/bindAgent', data);

// DWS 钉钉授权
export const startDwsDeviceAuth = () => POST<any>('/byaiService/devloop/dws/startDeviceAuth', {});

export const checkDwsAuthStatus = () => POST<any>('/byaiService/devloop/dws/authStatus', {});

export const saveDwsToken = (token: string) => POST<any>('/byaiService/devloop/dws/saveToken', { token });
