import type { ProjectType } from './types';

export const PROJECT_TYPE_STAND_TYPE = 'PROJECT_TYPE';

// 当前项目仅持久化 ID，项目列表加载后会根据用户权限再次校验该值。
export const PROJECT_SCOPE_STORAGE_KEY = 'byclaw.projectSpace.selectedProjectId';

export const getStoredProjectScopeId = () => {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY)?.trim() || undefined;
  } catch {
    // 浏览器禁用本地存储时不影响当前会话中的项目切换。
    return undefined;
  }
};

export const saveProjectScopeIdToStorage = (projectId?: string | number) => {
  if (typeof window === 'undefined') return;

  try {
    const normalizedProjectId = `${projectId ?? ''}`.trim();
    if (normalizedProjectId) {
      window.localStorage.setItem(PROJECT_SCOPE_STORAGE_KEY, normalizedProjectId);
      return;
    }
    window.localStorage.removeItem(PROJECT_SCOPE_STORAGE_KEY);
  } catch {
    // 浏览器禁用本地存储时不影响当前会话中的项目切换。
  }
};

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  normal: '普通项目',
  develop: '研发项目',
  default: '默认项目',
};

export const PROJECT_TYPE_OPTIONS: Array<{ label: string; value: ProjectType }> = [
  // 静态参数不可用时保守回退普通项目，避免未部署研发闭环的环境误展示研发能力。
  { label: PROJECT_TYPE_LABEL.normal, value: 'normal' },
];

export const DEFAULT_PROJECT_TYPE_OPTION: { label: string; value: ProjectType } = {
  label: PROJECT_TYPE_LABEL.default,
  value: 'default',
};

export const PROJECT_DETAIL_SECTIONS = [
  { key: 'sessions', label: '会话' },
  { key: 'tasks', label: '任务' },
  { key: 'resources', label: '资源' },
  { key: 'members', label: '成员' },
  { key: 'requirements', label: '需求' },
] as const;

export type ProjectDetailSection = (typeof PROJECT_DETAIL_SECTIONS)[number]['key'];
