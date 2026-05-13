import { ResourceTypeMap } from '@/constants/resource';

export const ELEMENT_MENTION = 'mention';
export const ELEMENT_RESOURCE = 'resource';
export const ELEMENT_EDITABLE = 'editable';

export const ResourceType = {
  text: 'text',
  tool: 'tool', // 需要再根据数据细分，取工具的resourceBizType
  agentTool: 'agentTool', // 数字员工的技能

  ...ResourceTypeMap,
} as const;

export { ResourceType as DragType };
