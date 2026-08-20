import { sessionHandler } from '@/utils/session';
import type { ProjectSession, ProjectShareTarget, ProjectSpace, ProjectType } from './types';

export type ProjectTagMeta = {
  classSuffix: 'Normal' | 'Development' | 'Operation';
  messageId: 'projectSpace.scene.normal' | 'projectSpace.scene.development' | 'projectSpace.scene.operation';
};

/**
 * 项目标签只表达项目类型：普通、研发、运营。
 * default 是系统内置项目、sharedFlag 是共享范围，均不再作为标签类型展示。
 */
export const getProjectTagMeta = (
  project?: Pick<ProjectSpace, 'projectType' | 'sharedFlag'> | ProjectType | string
): ProjectTagMeta => {
  const projectType = typeof project === 'string' ? project : project?.projectType;
  if (projectType === 'develop' || projectType === 'development') {
    return { classSuffix: 'Development', messageId: 'projectSpace.scene.development' };
  }
  if (projectType === 'operation') {
    return { classSuffix: 'Operation', messageId: 'projectSpace.scene.operation' };
  }
  return { classSuffix: 'Normal', messageId: 'projectSpace.scene.normal' };
};

export const getArrayData = (response: any): any[] => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  // 部分项目接口会把分页对象再包在 data 中，统一解包后供大详情各 Tab 复用。
  if (response?.data && response.data !== response) return getArrayData(response.data);
  return [];
};

// 分页接口存在直接返回和 data 包裹两种结构，统一提取总数供详情 Tab 判断是否继续加载。
export const getPageTotal = (response: any, fallback = 0): number => {
  const total = response?.total ?? response?.data?.total;
  const normalizedTotal = Number(total);
  return Number.isFinite(normalizedTotal) ? normalizedTotal : fallback;
};

const getObjectData = (response: any): any => {
  if (!response) return null;
  return response?.data && !Array.isArray(response.data) ? response.data : response;
};

export const normalizeProjectSession = (item: any, projectId?: string): ProjectSession => {
  const normalizedProjectId = `${item?.projectId || projectId || ''}`;
  const normalizedSessionId = `${item?.sessionId || ''}`;

  // 与旧会话列表共用头像兜底逻辑，缺少头像时展示会话默认图而非通用人员头像。
  const session = sessionHandler({
    ...item,
    projectId: normalizedProjectId,
    sessionId: normalizedSessionId,
    sessionName: item?.sessionName || '',
  } as any);

  return {
    ...session,
    // 后端 Long 到前端统一转字符串，避免项目会话高亮、跳转时出现数字/字符串不匹配。
    projectId: normalizedProjectId,
    sessionId: normalizedSessionId,
    sessionName: item?.sessionName || '',
  } as ProjectSession;
};

const normalizeShareTarget = (item: any): ProjectShareTarget => {
  const type = item?.type || item?.targetType || item?.grantToObjType || 'USER';
  const targetId = item?.targetId ?? item?.grantToObjId;
  const name = item?.name || item?.targetName || item?.grantToObjName || '';
  return {
    ...item,
    id: item?.id || `${String(type).toLowerCase()}_${targetId ?? ''}`,
    name,
    type,
    targetType: type,
    targetId,
    targetName: name,
  };
};

export const normalizeProject = (item: any): ProjectSpace => ({
  projectId: `${item?.projectId || ''}`,
  projectName: item?.projectName || '',
  description: item?.description,
  resourceId: item?.resourceId,
  // 后端项目类型统一使用 normal/operation/develop，这里继续兼容旧前端 development 值，保证历史项目仍能进入对应详情页。
  projectType: item?.projectType === 'development' ? 'develop' : item?.projectType || 'normal',
  isShare: item?.isShare === 'Y' || item?.sharedFlag === true ? 'Y' : 'N',
  sharedFlag: item?.isShare === 'Y' || item?.sharedFlag === true,
  // 存量/普通项目无该字段时按 ready 处理,避免误拦截历史项目建需求/启动任务。
  initStatus: item?.initStatus || 'ready',
  initSessionId:
    item?.initSessionId !== undefined && item?.initSessionId !== null ? Number(item.initSessionId) : undefined,
  initFailReason: item?.initFailReason,
  createBy: item?.createBy,
  createTime: item?.createTime,
  sessionCount: item?.sessionCount ?? item?.sessions?.length ?? 0,
  taskCount: item?.taskCount ?? item?.tasks?.length ?? 0,
  fileCount: item?.fileCount ?? item?.resources?.length ?? 0,
  members: item?.members || [],
  sessions: (item?.sessions || []).map((session: any) => normalizeProjectSession(session, `${item?.projectId || ''}`)),
  repos: Array.isArray(item?.repos) ? item.repos : undefined,
  shareTargets: Array.isArray(item?.shareTargets) ? item.shareTargets.map(normalizeShareTarget) : undefined,
  resources: Array.isArray(item?.resources) ? item.resources : [],
  // boundResources 保留别名，兼容早期详情组件对该字段的读取。
  boundResources: Array.isArray(item?.resources) ? item.resources : [],
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
