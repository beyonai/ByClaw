import { POST } from '@/service/common/request';

// 项目管理
export const createProject = (data: {
  projectName: string;
  description?: string;
  resourceId?: number;
  repos?: { repoFullName: string; repoUrl?: string; defaultBranch?: string }[];
}) => POST<any>('/byaiService/devloop/project/create', data);

export const listProjects = () => POST<any>('/byaiService/devloop/project/list', {});

export const getProject = (projectId: number) => POST<any>('/byaiService/devloop/project/get', { projectId });

export const updateProject = (data: { projectId: number; projectName?: string; description?: string }) =>
  POST<any>('/byaiService/devloop/project/update', data);

export const deleteProject = (projectId: number) => POST<any>('/byaiService/devloop/project/delete', { projectId });

// 扫描源管理
export const createScanSource = (data: {
  projectId: number;
  sourceName: string;
  sourceType: string;
  config: string;
  cronExpr?: string;
  enabled?: string;
}) => POST<any>('/byaiService/devloop/source/create', data);

export const updateScanSource = (data: { sourceId: number; sourceName?: string; config?: string; cronExpr?: string }) =>
  POST<any>('/byaiService/devloop/source/update', data);

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
