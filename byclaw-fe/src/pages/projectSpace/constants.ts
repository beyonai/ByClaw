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
  { key: 'sessions', labelId: 'projectSpace.detail.tabs.sessions' },
  { key: 'tasks', labelId: 'projectSpace.detail.tabs.tasks' },
  { key: 'resources', labelId: 'projectSpace.detail.tabs.resources' },
  { key: 'members', labelId: 'projectSpace.detail.tabs.members' },
  { key: 'requirements', labelId: 'projectSpace.detail.tabs.requirements' },
] as const;

export type ProjectDetailSection = (typeof PROJECT_DETAIL_SECTIONS)[number]['key'];
