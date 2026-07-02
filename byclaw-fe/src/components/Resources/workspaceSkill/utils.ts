import { ResourceTypeMap } from '@/constants/resource';

/**
 * 工作空间（用户开发）技能在前端的虚拟 resourceId 前缀。
 * 这类技能尚未资源化，没有真实 resourceId，用 skillPath/skillName 拼出稳定唯一标识。
 */
export const WORKSPACE_SKILL_ID_PREFIX = 'WORKSPACE_SKILL:';

/**
 * 技能来源类型：用户开发。后端 displaySourceType 取值。
 */
export const SKILL_DISPLAY_SOURCE_USER_DEVELOPED = 'USER_DEVELOPED';

/**
 * 工作空间技能的最小字段集合，左右两侧列表共用。
 */
export interface WorkspaceSkillItem {
  resourceId?: string | number;
  resourceBizType?: string;
  resourceBacked?: boolean;
  displaySourceType?: string;
  skillPath?: string;
  [key: string]: any;
}

/**
 * 判断一条记录是否为工作空间（用户开发、未资源化）技能。
 * 依据：SKILL 类型 且（resourceBacked === false 或 resourceId 带 WORKSPACE_SKILL: 前缀）。
 */
export const isWorkspaceSkill = (item?: WorkspaceSkillItem): boolean =>
  item?.resourceBizType === ResourceTypeMap.SKILL &&
  (item?.resourceBacked === false || String(item?.resourceId || '').startsWith(WORKSPACE_SKILL_ID_PREFIX));

/**
 * 把后端工作空间技能原始行映射为列表项（ResourceItem 形态）。
 * resourceId 用 WORKSPACE_SKILL: 前缀拼接，resourceBacked=false，并打 USER_DEVELOPED 来源。
 */
export const mapWorkspaceSkillRows = (rows: any[] = []): WorkspaceSkillItem[] =>
  rows.map((item) => ({
    resourceId: `${WORKSPACE_SKILL_ID_PREFIX}${item.skillPath || item.skillName}`,
    resourceCode: item.skillName,
    resourceName: item.skillName,
    resourceDesc: item.skillDesc,
    resourceBizType: ResourceTypeMap.SKILL,
    displaySourceType: item.displaySourceType || SKILL_DISPLAY_SOURCE_USER_DEVELOPED,
    resourceBacked: false,
    skillPath: item.skillPath,
    skillDocObjectKey: item.skillDocObjectKey,
    useStartTime: item.useStartTime,
  }));

/**
 * 当前用户展示名兜底。
 */
export const getCurrentUserDisplayName = (userInfo?: any): string =>
  userInfo?.userName || userInfo?.name || userInfo?.nickName || userInfo?.userCode || userInfo?.userId || '';
