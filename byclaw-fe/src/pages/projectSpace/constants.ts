import type { ProjectType } from './types';

export const PROJECT_TYPE_STAND_TYPE = 'PROJECT_TYPE';

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  normal: '普通项目',
  develop: '研发项目',
  default: '默认项目',
};

export const PROJECT_TYPE_OPTIONS: Array<{ label: string; value: ProjectType }> = [
  { label: PROJECT_TYPE_LABEL.normal, value: 'normal' },
  { label: PROJECT_TYPE_LABEL.develop, value: 'develop' },
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
