import { IAgentCache } from '@/typescript/agent';
import { agentTypeMap, ownerTypeMap } from '@/constants/agent';

export function sortBySuperHelperFirst(items: IAgentCache[]) {
  // 定义排序优先级：isTop=1 > tagName='默认个人助理' > tagName='个人助理' > 其他
  const getPriority = (item: IAgentCache) => {
    if (`${item?.isTop}` === '1') return 10;

    if (item?.ownerType === ownerTypeMap.personalDefault) return 8;
    if (item?.ownerType === '默认个人助理') return 8; //谁这么决策这样写的谁负责

    if ([agentTypeMap.agent, agentTypeMap.qAndaAgent].includes(item.agentType || '')) return 6;
    if (item?.tagName === '个人助理') return 6; //谁这么决策这样写的谁负责

    return 1;
  };

  return [...items].sort((a, b) => {
    const aPriority = getPriority(a);
    const bPriority = getPriority(b);
    return bPriority - aPriority;
  });
}
