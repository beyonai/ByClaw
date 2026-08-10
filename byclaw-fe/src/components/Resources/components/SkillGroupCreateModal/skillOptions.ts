export interface SkillOption {
  resourceId: string;
  resourceName: string;
  resourceDesc?: string;
}

export const buildSkillGroupCandidateParams = (groupId?: string) => ({
  keyword: '',
  pageNum: 1,
  pageSize: 100,
  ...(groupId ? { groupId } : {}),
});

export const normalizeSkillOptions = (rows: any[]): SkillOption[] =>
  rows
    .filter((item) => item?.resourceId)
    .map((item) => ({
      resourceId: `${item.resourceId}`,
      resourceName: item.resourceName || item.resourceCode || `${item.resourceId}`,
      ...(item.resourceDesc || item.description ? { resourceDesc: item.resourceDesc || item.description } : {}),
    }));
