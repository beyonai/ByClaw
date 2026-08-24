import type { ProjectType } from './types';

export const PROJECT_TYPE_STAND_TYPE = 'PROJECT_TYPE';

// 项目类型只保存国际化键，任何展示入口均通过当前语言环境解析，禁止直接依赖中文常量。
export const PROJECT_TYPE_MESSAGE_ID: Record<ProjectType, string> = {
  normal: 'projectSpace.projectForm.type.normal',
  operation: 'projectSpace.projectForm.type.operation',
  develop: 'projectSpace.projectForm.type.develop',
  default: 'projectSpace.projectForm.type.default',
};

export const PROJECT_TYPE_OPTIONS: Array<{ label: string; value: ProjectType }> = [
  // 表单消费方会把这里的国际化键转换为当前语言文案，静态参数不可用时保守回退普通项目。
  { label: PROJECT_TYPE_MESSAGE_ID.normal, value: 'normal' },
];

export const DEFAULT_PROJECT_TYPE_OPTION: { label: string; value: ProjectType } = {
  label: PROJECT_TYPE_MESSAGE_ID.default,
  value: 'default',
};

// 独立项目详情页使用与侧栏详情一致的 Tab 标识，标签文本统一由消费组件国际化。
export const PROJECT_DETAIL_SECTIONS = [
  { key: 'tasks', labelId: 'projectSpace.detail.tabs.tasks' },
  { key: 'resources', labelId: 'projectSpace.detail.tabs.resources' },
  { key: 'requirements', labelId: 'projectSpace.detail.tabs.requirements' },
  { key: 'members', labelId: 'projectSpace.detail.tabs.members' },
  { key: 'integration', labelId: 'projectSpace.detail.tabs.integration' },
  { key: 'accounts', labelId: 'projectSpace.detail.tabs.accounts' },
  // 非运营项目仍保留会话页，但按产品顺序放在业务管理页签之后。
  { key: 'sessions', labelId: 'projectSpace.detail.tabs.sessions' },
] as const;

export type ProjectDetailSection = (typeof PROJECT_DETAIL_SECTIONS)[number]['key'];

// 当前项目仅持久化 ID，项目列表加载后会根据用户权限再次校验该值。
export const PROJECT_SCOPE_STORAGE_KEY = 'byclaw.projectSpace.selectedProjectId';
export const PROJECT_SCOPE_CHANGE_EVENT = 'byclaw-project-scope-change';
let memoryProjectScopeId: string | undefined;

export const getStoredProjectScopeId = () => {
  if (typeof window === 'undefined') return undefined;

  try {
    memoryProjectScopeId = window.localStorage.getItem(PROJECT_SCOPE_STORAGE_KEY)?.trim() || undefined;
    return memoryProjectScopeId;
  } catch {
    // 浏览器禁用本地存储时回退到内存值，当前标签页内的项目切换仍可同步。
    return memoryProjectScopeId;
  }
};

export const saveProjectScopeIdToStorage = (projectId?: string | number) => {
  if (typeof window === 'undefined') return;

  const normalizedProjectId = `${projectId ?? ''}`.trim();
  const nextProjectId = normalizedProjectId || undefined;
  const previousProjectId = getStoredProjectScopeId();
  memoryProjectScopeId = nextProjectId;
  try {
    if (nextProjectId) {
      window.localStorage.setItem(PROJECT_SCOPE_STORAGE_KEY, nextProjectId);
    } else {
      window.localStorage.removeItem(PROJECT_SCOPE_STORAGE_KEY);
    }
  } catch {
    // 浏览器禁用本地存储时不影响当前会话中的项目切换。
  }

  if (previousProjectId === nextProjectId) return;
  // storage 事件不会在当前标签页触发，补充自定义事件让会话和项目模块即时同步。
  window.dispatchEvent(new Event(PROJECT_SCOPE_CHANGE_EVENT));
};

export const subscribeProjectScopeId = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === PROJECT_SCOPE_STORAGE_KEY) listener();
  };
  window.addEventListener(PROJECT_SCOPE_CHANGE_EVENT, listener);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(PROJECT_SCOPE_CHANGE_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
};
