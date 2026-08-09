export interface SkillOption {
  resourceId: string;
  resourceName: string;
  resourceDesc?: string;
}

export const normalizeSkillOptions = (rows: any[]): SkillOption[] =>
  rows
    .filter((item) => item?.resourceId && `${item.skillType || ''}`.toLowerCase() === 'inner')
    .map((item) => ({
      resourceId: `${item.resourceId}`,
      resourceName: item.resourceName || item.resourceCode || `${item.resourceId}`,
      ...(item.resourceDesc || item.description ? { resourceDesc: item.resourceDesc || item.description } : {}),
    }));
