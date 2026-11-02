import { ResourceTypeMap } from '@/constants/resource';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import { queryDigitalEmployeeSkillResources } from '@/components/Resources/workspaceSkill/queryDigitalEmployeeSkillResources';

export const EMPLOYEE_RESOURCE_REPLACEMENT_TABS = {
  [ResourceTypeMap.SKILL]: 'skill',
  [ResourceTypeMap.knowledgeBase]: 'knowledge',
  [ResourceTypeMap.knowledgeBaseQa]: 'knowledge',
  [ResourceTypeMap.Agent]: 'tool',
  [ResourceTypeMap.MCP]: 'tool',
  [ResourceTypeMap.TOOL]: 'tool',
  [ResourceTypeMap.TOOLKIT]: 'tool',
} as const;

export type EmployeeResourceReplacementTab =
  (typeof EMPLOYEE_RESOURCE_REPLACEMENT_TABS)[keyof typeof EMPLOYEE_RESOURCE_REPLACEMENT_TABS];

export const getEmployeeResourceReplacementTab = (resourceType?: string) =>
  resourceType
    ? EMPLOYEE_RESOURCE_REPLACEMENT_TABS[resourceType as keyof typeof EMPLOYEE_RESOURCE_REPLACEMENT_TABS]
    : undefined;

export const hasUnresolvedEmployeeResource = (
  resources: Array<{
    isAgentResourceValidationPending?: boolean;
    requiresAgentResourceReplacement?: boolean;
  }> = []
) =>
  resources.some((resource) => resource.isAgentResourceValidationPending || resource.requiresAgentResourceReplacement);

const getResourceRows = (response: any) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

const isSameResource = (candidate: any, resource: { id?: string; resourceCode?: string }) => {
  const expected = [resource.id, resource.resourceCode].filter(Boolean).map((item) => `${item}`);
  return [candidate?.resourceId, candidate?.resourceSourcePkId, candidate?.resourceCode]
    .filter(Boolean)
    .some((item) => expected.includes(`${item}`));
};

export async function isEmployeeResourceAvailable(
  agentId: string,
  resource: { id?: string; name?: string; resourceCode?: string; resourceType?: string },
  userCode?: string
) {
  if (!getEmployeeResourceReplacementTab(resource.resourceType)) return true;

  if (resource.resourceType === ResourceTypeMap.SKILL) {
    const result = await queryDigitalEmployeeSkillResources({
      resourceId: agentId,
      userCode,
      keyword: resource.name,
      pageNum: 1,
      pageSize: 100,
      includeWorkspace: true,
    });
    return result.rows.some((item) => isSameResource(item, resource));
  }

  const response = await queryDigEmployeeRelResourceAuth({
    resourceId: agentId,
    pageSize: 100,
    pageNum: 1,
    keyword: resource.name,
    resourceBizTypeList: resource.resourceType ? [resource.resourceType] : undefined,
  });
  return getResourceRows(response).some((item) => isSameResource(item, resource));
}
