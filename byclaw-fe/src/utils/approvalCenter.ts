import { filterResourceAuditRowsByType, getBaseResourceBizTypeList } from '@/components/Resources/utils';
import type { ResourceUseApplyAuditItem } from '@/pages/manager/service/resources';

export type ApprovalTab = 'employee' | 'skill' | 'knowledge' | 'tool';
export const APPROVAL_TABS: { key: ApprovalTab; label: string; resourceBizTypeList: string[] }[] = [
  { key: 'employee', label: 'approvalCenter.employee', resourceBizTypeList: ['DIG_EMPLOYEE'] },
  { key: 'skill', label: 'approvalCenter.skill', resourceBizTypeList: getBaseResourceBizTypeList('SKILL') },
  { key: 'knowledge', label: 'approvalCenter.knowledge', resourceBizTypeList: getBaseResourceBizTypeList('KG_DOC') },
  { key: 'tool', label: 'approvalCenter.tool', resourceBizTypeList: getBaseResourceBizTypeList('TOOL') },
];

export type ApprovalCounts = Record<ApprovalTab, number>;

export const ALL_APPROVAL_BIZ_TYPES = APPROVAL_TABS.flatMap((tab) => tab.resourceBizTypeList);
export const EMPTY_APPROVAL_COUNTS: ApprovalCounts = { employee: 0, skill: 0, knowledge: 0, tool: 0 };

/** 角标和表格使用同一数据解包、类型隔离和资源有效性规则。 */
export const getResourceAuditItems = (response: any, resourceBizTypeList: string[]): ResourceUseApplyAuditItem[] => {
  const data = response?.data?.data ?? response?.data ?? response;
  const rows = Array.isArray(data) ? data : data?.list || data?.rows || [];
  return filterResourceAuditRowsByType<ResourceUseApplyAuditItem>(rows, resourceBizTypeList).filter(
    (item) => item?.resourceId !== undefined && item?.resourceId !== null && `${item.resourceId}`.trim() !== ''
  );
};
