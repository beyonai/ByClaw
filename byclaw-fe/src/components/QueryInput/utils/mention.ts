import { agentTypeMap } from '@/constants/agent';
import type { IAgentCache, IAgentType } from '@/typescript/agent';
import type { Resource } from '../RichInput/types';
import { ResourceType } from '../RichInput/utils/constants';

interface ChatEmployeeContext {
  resourceList: Resource[];
  agentId?: string | number;
  agentType?: IAgentType;
  agentInfo?: IAgentCache;
  employeesList?: IAgentCache[];
  defaultDigEmployeeId?: string | number;
}

/** 加号弹窗跟随生效的聊天对象：显式 @ 优先，其次是当前会话员工，最后才是默认员工。 */
export const isEmployeeGroupChat = ({
  resourceList,
  agentId,
  agentType,
  agentInfo,
  employeesList = [],
  defaultDigEmployeeId,
}: ChatEmployeeContext): boolean => {
  const getAgentType = (identity?: string | number) => {
    if (!identity) return undefined;
    return [agentInfo, ...employeesList].find((employee) =>
      [employee?.agentId, employee?.id, employee?.resourceId, employee?.resourceCode]
        .filter(Boolean)
        .some((value) => `${value}` === `${identity}`)
    )?.agentType;
  };
  const mentionedEmployees = resourceList.filter(
    (item) => item.resourceType === ResourceType.digitalEmployee && item.resourceId && !item.isInactiveAgentSelection
  );

  // 被员工/员工组互斥规则停用的旧节点不参与判断；节点自带类型不依赖列表异步加载。
  if (mentionedEmployees.length) {
    return mentionedEmployees.some(
      (item) => (item.agentType || getAgentType(item.resourceId)) === agentTypeMap.employeeGroup
    );
  }

  // 详情入口可能先取得会话类型、后加载员工缓存；该类型只用于当前会话，不能覆盖默认员工。
  const selectedAgentType = getAgentType(agentId || defaultDigEmployeeId) || (agentId ? agentType : undefined);
  return selectedAgentType === agentTypeMap.employeeGroup;
};

export const getLastMentionedDigitalEmployeeId = (resourceList: Resource[]) => {
  // resourceList 保持输入顺序，倒序命中的第一个员工就是最后一次 @ 的员工。
  const lastMentionedAgent = [...resourceList]
    .reverse()
    .find((item) => item.resourceType === ResourceType.digitalEmployee && item.resourceId);
  return lastMentionedAgent ? `${lastMentionedAgent.resourceId}` : '';
};
