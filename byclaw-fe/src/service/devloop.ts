import { POST, type ConfigType } from '@/service/common/request';

type DevloopProjectType = 'normal' | 'develop';

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

// 扫描源管理
export const createScanSource = (data: {
  projectId: number;
  sourceName: string;
  sourceType: string;
  config: string;
  cronExpr?: string;
  enabled?: string;
  repoId?: number;
}) => POST<any>('/byaiService/devloop/source/create', data);

export const updateScanSource = (data: {
  sourceId: number;
  sourceName?: string;
  config?: string;
  cronExpr?: string;
  repoId?: number;
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

// PAT 管理
export const saveGitHubPat = (pat: string) => POST<any>('/byaiService/devloop/pat/github', { pat });

export const checkGitHubPat = () => POST<any>('/byaiService/devloop/pat/github/check', {});

// 钉钉群搜索
export const searchDingtalkGroups = (query: string) =>
  POST<any>('/byaiService/devloop/dingtalk/groups/search', { query });

// 研发任务
export const createTask = (data: { projectId: number; sourceItemId?: number; title?: string }) =>
  POST<any>('/byaiService/devloop/task/create', data);

export const listTasks = (projectId: number) => POST<any>('/byaiService/devloop/task/list', { projectId });

export const updateTask = (data: {
  taskId: number;
  status?: string;
  phase?: string;
  currentRound?: number;
  score?: number;
  warningTag?: string;
  sessionId?: number;
}) => POST<any>('/byaiService/devloop/task/update', data);

export const getTaskDetail = (taskId: number) => POST<any>('/byaiService/devloop/task/detail', { taskId });

// 项目成员
export const addProjectMember = (data: {
  projectId: number;
  userId: string | number;
  userCode?: string;
  userName?: string;
}) => POST<any>('/byaiService/devloop/member/add', data);

export const listProjectMembers = (projectId: number) => POST<any>('/byaiService/devloop/member/list', { projectId });

export const removeProjectMember = (memberId: number) => POST<any>('/byaiService/devloop/member/remove', { memberId });

export const bindMemberAgent = (data: { memberId: number; agentId: number }) =>
  POST<any>('/byaiService/devloop/member/bindAgent', data);

// DWS 钉钉授权
export const startDwsDeviceAuth = () => POST<any>('/byaiService/devloop/dws/startDeviceAuth', {});

export const checkDwsAuthStatus = () => POST<any>('/byaiService/devloop/dws/authStatus', {});

export const saveDwsToken = (token: string) => POST<any>('/byaiService/devloop/dws/saveToken', { token });
