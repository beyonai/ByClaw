import type { Key, ReactNode } from 'react';

export interface SkillOption {
  resourceId: string;
  resourceName: string;
  resourceDesc?: string;
  systemBuiltIn: boolean;
  creatorOwned: boolean;
}

export type SkillCandidateTabKey = 'builtIn' | 'personal';

export const SKILL_CANDIDATE_TABS_SIZE = 'small' as const;

export const SKILL_CANDIDATE_LIST_HEIGHT = 256;

export const buildSkillGroupCandidateParams = (groupId?: string) => ({
  keyword: '',
  pageNum: 1,
  pageSize: 100,
  ...(groupId ? { groupId } : {}),
});

export const normalizeSkillOptions = (rows: any[]): SkillOption[] =>
  rows
    .filter((item) => item?.resourceId)
    .map((item) => {
      const legacySystemBuiltIn =
        `${item.skillType || ''}`.trim().toLowerCase() === 'inner' ||
        `${item.sourceType || ''}`.trim().toUpperCase() === 'SYSTEM_BUILTIN';

      return {
        resourceId: `${item.resourceId}`,
        resourceName: item.resourceName || item.resourceCode || `${item.resourceId}`,
        systemBuiltIn:
          item.systemBuiltIn === null || item.systemBuiltIn === undefined
            ? legacySystemBuiltIn
            : Boolean(item.systemBuiltIn),
        creatorOwned:
          item.creatorOwned === null || item.creatorOwned === undefined
            ? !legacySystemBuiltIn
            : Boolean(item.creatorOwned),
        ...(item.resourceDesc || item.description ? { resourceDesc: item.resourceDesc || item.description } : {}),
      };
    });

export const partitionSkillOptions = (skills: SkillOption[]) => ({
  builtInSkills: skills.filter((skill) => skill.systemBuiltIn),
  personalSkills: skills.filter((skill) => skill.creatorOwned),
});

export const getSkillOptionsForTab = (skills: SkillOption[], activeTab: SkillCandidateTabKey) =>
  skills.filter((skill) => (activeTab === 'builtIn' ? skill.systemBuiltIn : skill.creatorOwned));

export const getSkillOptionLabel = (skills: SkillOption[], value: Key, fallbackLabel?: ReactNode) =>
  skills.find((skill) => skill.resourceId === `${value}`)?.resourceName || fallbackLabel;
