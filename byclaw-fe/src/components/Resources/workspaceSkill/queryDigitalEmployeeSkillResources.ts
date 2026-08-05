import { ResourceTypeMap } from '@/constants/resource';
import { queryDigEmployeeRelResourceAuth, queryWorkspaceSkillList } from '@/pages/manager/service/resources';
import { mapWorkspaceSkillRows, type WorkspaceSkillItem } from './utils';

export interface DigitalEmployeeSkillResourceItem extends WorkspaceSkillItem {
  resourceId?: string | number;
  resourceCode?: string;
  resourceName?: string;
  resourceDesc?: string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  [key: string]: any;
}

interface QueryDigitalEmployeeSkillResourcesParams {
  resourceId: string | number;
  userCode?: string;
  keyword?: string;
  pageNum: number;
  pageSize: number;
  includeWorkspace?: boolean;
}

interface QueryDigitalEmployeeSkillResourcesResult {
  rows: DigitalEmployeeSkillResourceItem[];
  boundRows: DigitalEmployeeSkillResourceItem[];
  workspaceRows: DigitalEmployeeSkillResourceItem[];
  pageNum: number;
  total: number;
  response: any;
}

export const getResourceArrayData = (response: any) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

const getSkillResourceUniqueKey = (item: DigitalEmployeeSkillResourceItem, index: number) => {
  const id = item?.resourceId ?? item?.resourceSourcePkId ?? item?.resourceCode ?? item?.skillPath;
  if (id === undefined || id === null || String(id) === '') {
    return `__skill_resource_index_${index}`;
  }
  return `${item?.resourceBizType || ResourceTypeMap.SKILL}:${String(id)}`;
};

export const dedupeSkillResources = (items: DigitalEmployeeSkillResourceItem[]) => {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const key = getSkillResourceUniqueKey(item, index);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const mapBoundSkillRows = (rows: DigitalEmployeeSkillResourceItem[]) =>
  rows
    .filter((item) => !item.resourceBizType || item.resourceBizType === ResourceTypeMap.SKILL)
    .map((item) => ({
      ...item,
      resourceBizType: item.resourceBizType || ResourceTypeMap.SKILL,
      resourceBacked: true,
    }));

export const queryDigitalEmployeeSkillResources = async (
  params: QueryDigitalEmployeeSkillResourcesParams
): Promise<QueryDigitalEmployeeSkillResourcesResult> => {
  const { resourceId, userCode, pageNum, pageSize, includeWorkspace = false } = params;
  const keyword = `${params.keyword || ''}`.trim();
  const response = await queryDigEmployeeRelResourceAuth({
    resourceId,
    pageSize,
    pageNum,
    keyword,
    resourceBizTypeList: [ResourceTypeMap.SKILL],
  });
  const boundRows = mapBoundSkillRows(getResourceArrayData(response));
  let workspaceRows: DigitalEmployeeSkillResourceItem[] = [];

  if (includeWorkspace) {
    try {
      const workspaceSkillResponse = await queryWorkspaceSkillList({
        resourceId,
        userCode,
        keyword,
      });
      workspaceRows = mapWorkspaceSkillRows(getResourceArrayData(workspaceSkillResponse));
    } catch (error) {
      console.warn('query workspace skills failed', error);
    }
  }

  return {
    rows: dedupeSkillResources([...boundRows, ...workspaceRows]),
    boundRows,
    workspaceRows,
    pageNum: Number(response?.pageNum) || pageNum,
    total: Number(response?.total) || 0,
    response,
  };
};
