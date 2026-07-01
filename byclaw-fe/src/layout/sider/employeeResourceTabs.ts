import { ResourceTypeMap } from '@/constants/resource';

export const EMPLOYEE_RESOURCE_TAB_KEYS = new Set(['model', 'knowledge', 'tool', 'view', 'object', 'skill', 'file']);

export const employeeResourceBizTypeListByTabKey: Record<string, string[]> = {
  knowledge: [ResourceTypeMap.knowledgeBase, ResourceTypeMap.knowledgeBaseQa, ResourceTypeMap.knowledgeBaseTerm],
  tool: [ResourceTypeMap.Agent, ResourceTypeMap.MCP, ResourceTypeMap.TOOLKIT],
  view: [ResourceTypeMap.VIEW],
  object: [ResourceTypeMap.OBJECT],
  skill: [ResourceTypeMap.SKILL],
};

export const employeeResourceTabLabelIdByTabKey: Record<string, string> = {
  knowledge: 'sider.knowledge',
  tool: 'common.tool',
  view: 'common.resourceType.view',
  object: 'common.resourceType.object',
  skill: 'common.skill',
};
