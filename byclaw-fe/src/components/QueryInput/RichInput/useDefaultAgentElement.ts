import { agentTypeMap, agentMap } from '@/constants/agent';
import { useIntl, useSelector } from '@umijs/max';
import { useCallback, useMemo } from 'react';
import { getAgentCache } from './agentCache';
import { ResourceType } from './utils/constants';
import getElementData from './utils/getElementData';
import { MentionElementType } from './elements/mention';
import { getResponseAgentInfo } from '@/components/MessageList/utils';

export default function useDefaultAgentElement({ agentType, agentId }: { agentType?: string; agentId?: string }) {
  const intl = useIntl();
  const { employeesList, defaultAgentList } = useSelector(({ employees }) => ({
    defaultAgentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const findAgentInfo = useCallback(() => {
    if (!agentId) {
      return undefined;
    }
    const agentInfo = getResponseAgentInfo({ agentList: defaultAgentList, employeesList }, JSON.stringify({ agentId }));
    if (!agentInfo) {
      // 在所有的列表数据里都找不到这个agent，这时候用一个特殊的agent名字代替
      return {
        agentType,
        id: agentId,
        name: intl.formatMessage({ id: 'ai-assistant' }),
        chatAvatar: agentMap[agentTypeMap.common].chatAvatar,
      };
    }
    return {
      ...agentInfo,

      /**
       * 出此下策，因为有些数字员工的agentType老是配置成了慧笔的，但是给到输入框的agentType又是001
       * 这个时候查出来的agentInfo的agentType就和传到输入框的不一样，这会导致前后不一致，因此输入框的前缀突然间变成了慧笔
       * 因此这里用传入的agentType覆盖agentInfo的agentType
       */
      agentType,
    };
  }, [agentId, agentType, employeesList, defaultAgentList]);

  return useMemo(() => {
    if (!agentId) {
      return undefined;
    }
    const cacheInfo = getAgentCache(agentId);
    if (cacheInfo) {
      return {
        ...cacheInfo,
        isDefaultAgent: true,
        children: [{ text: '' }],
      } as MentionElementType;
    }
    const agentInfo = findAgentInfo();
    if (agentInfo) {
      return {
        ...getElementData(ResourceType.digitalEmployee, agentInfo),
        isDefaultAgent: true,
        children: [{ text: '' }],
      } as MentionElementType;
    }
    return undefined;
  }, [agentId, agentType, employeesList, defaultAgentList]);
}
