import type { ProjectType } from './types';

/** 研发、运营项目都支持在资源页维护和浏览共享代码仓库。 */
export const supportsProjectRepositories = (projectType?: ProjectType | string) =>
  projectType === 'develop' || projectType === 'operation';

/** 资源页卡片数量用于保持同一行等宽布局。 */
export const getProjectResourceCategoryCount = (projectType?: ProjectType | string) => {
  if (projectType === 'operation') return 5;
  if (projectType === 'develop') return 2;
  return 1;
};
