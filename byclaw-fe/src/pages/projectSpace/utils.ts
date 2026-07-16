import type { ProjectSession, ProjectSpace } from './types';

export const getArrayData = (response: any): any[] => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

const getObjectData = (response: any): any => {
  if (!response) return null;
  return response?.data && !Array.isArray(response.data) ? response.data : response;
};

const normalizeProjectSession = (item: any, projectId?: string): ProjectSession => ({
  ...item,
  // 后端 Long 到前端统一转字符串，避免项目会话高亮、跳转时出现数字/字符串不匹配。
  projectId: `${item?.projectId || projectId || ''}`,
  sessionId: `${item?.sessionId || ''}`,
  sessionName: item?.sessionName || '',
});

export const normalizeProject = (item: any): ProjectSpace => ({
  projectId: `${item?.projectId || ''}`,
  projectName: item?.projectName || '',
  description: item?.description,
  // 后端字段逐步补齐中，这里集中做默认值，避免页面各处散落兜底逻辑。
  projectType: item?.projectType || 'normal',
  sharedFlag: item?.sharedFlag ?? false,
  createTime: item?.createTime,
  sessionCount: item?.sessionCount ?? item?.sessions?.length ?? 0,
  taskCount: item?.taskCount ?? item?.tasks?.length ?? 0,
  fileCount: item?.fileCount ?? item?.resources?.length ?? 0,
  members: item?.members || [],
  sessions: (item?.sessions || []).map((session: any) => normalizeProjectSession(session, `${item?.projectId || ''}`)),
});

export const normalizeProjectDetail = (response: any, fallback?: ProjectSpace): ProjectSpace | undefined => {
  const detail = getObjectData(response);
  if (!detail && !fallback) return undefined;
  return normalizeProject({
    ...fallback,
    ...detail,
    // 详情接口暂未稳定返回统计时，优先用详情数组长度刷新计数。
    sessionCount: detail?.sessionCount ?? detail?.sessions?.length ?? fallback?.sessionCount,
    taskCount: detail?.taskCount ?? detail?.tasks?.length ?? fallback?.taskCount,
    fileCount: detail?.fileCount ?? detail?.resources?.length ?? fallback?.fileCount,
  });
};
