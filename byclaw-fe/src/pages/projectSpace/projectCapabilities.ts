/** 所有项目均支持在资源页维护和浏览共享代码仓库。 */
export const supportsProjectRepositories = () => true;

/** 资源页卡片数量用于保持同一行等宽布局。 */
export const getProjectResourceCategoryCount = (_projectType?: ProjectType | string) => {
  return 2;
};
