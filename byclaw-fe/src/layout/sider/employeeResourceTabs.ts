import { ResourceTypeMap } from '@/constants/resource';

export const EMPLOYEE_RESOURCE_TAB_KEYS = new Set(['model', 'knowledge', 'tool', 'skill', 'file']);

export const employeeResourceBizTypeListByTabKey: Record<string, string[]> = {
  knowledge: [ResourceTypeMap.knowledgeBase, ResourceTypeMap.knowledgeBaseQa, ResourceTypeMap.knowledgeBaseTerm],
  tool: [ResourceTypeMap.Agent, ResourceTypeMap.MCP, ResourceTypeMap.TOOLKIT],
  skill: [ResourceTypeMap.SKILL],
};

export const employeeResourceTabLabelIdByTabKey: Record<string, string> = {
  knowledge: 'sider.knowledge',
  tool: 'common.tool',
  skill: 'common.skill',
};
