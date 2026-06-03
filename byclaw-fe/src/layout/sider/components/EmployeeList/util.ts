import { IAgentCache } from '@/typescript/agent';
import { agentTypeMap } from '@/constants/agent';

// 定义排序优先级：置顶 > 当前默认助理 > 助手型/问答型 > 其他。
// 默认身份现在来自后端 isDefault，不再依赖 ownerType=personal_default 或落库 tagName。
const getPriority = (item: IAgentCache) => {
  if (`${item?.isTop}` === '1') return 10;

  if (item?.isDefault) return 8;

  if ([agentTypeMap.agent, agentTypeMap.qAndaAgent].includes(item.agentType || '')) return 6;

  return 1;
};

export function sortBySuperHelperFirst(items: IAgentCache[]) {
  return [...items].sort((a, b) => {
    const aPriority = getPriority(a);
    const bPriority = getPriority(b);
    return bPriority - aPriority;
  });
}

export function updateDefaultEmployee(items: IAgentCache[], defaultResourceId: string | number) {
  return sortBySuperHelperFirst(
    items.map((item) => {
      const isDefault = [`${item.resourceId}`, `${item.id}`, `${item.agentId}`].includes(`${defaultResourceId}`);

      return {
        ...item,
        isDefault,
        canSetDefault: !isDefault, // todo: 以后拓展需要
      };
    })
  );
}
