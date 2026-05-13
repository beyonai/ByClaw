import { agentTypeMap, agentMap } from '@/constants/agent';
import { IAgent } from '@/typescript/agent';
import { useIntl, useSelector } from '@umijs/max';
import { useMemo } from 'react';

import { IState } from '@/models/useEmployees';

export default function useDefaultAgentInfo({ agentType, agentId }: { agentType?: string; agentId: string }) {
  const intl = useIntl();
  const { employeesList, defaultAgentList } = useSelector(({ employees }: { employees: IState }) => ({
    defaultAgentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));
  return useMemo(() => {
    let agentInfo = defaultAgentList?.find((item: IAgent) => item.agentType === agentType);
    if (agentInfo) {
      return agentInfo;
    }
    agentInfo = [...(employeesList || [])].find((item) => `${item.id}` === `${agentId}`);
    if (agentInfo) {
      return agentInfo;
    }
    // 在所有的列表数据里都找不到这个agent，这时候用一个特殊的agent名字代替
    return {
      agentType,
      agentId,
      name: intl.formatMessage({ id: 'ai-assistant' }),
      chatAvatar: agentMap[agentTypeMap.common]?.chatAvatar,
    };
  }, [agentId, agentType, employeesList, defaultAgentList]);
}
