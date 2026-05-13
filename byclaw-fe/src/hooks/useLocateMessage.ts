import { useCallback } from 'react';
import { useDispatch, useNavigate, useSelector } from '@umijs/max';
import { POST } from '@/service/common/request';
import { getRootPagePath } from '@/utils';
import useGlobal from './useGlobal';

import { getAgentPath } from '@/utils/agent';

import { IState as UseEmployeesIState } from '@/models/useEmployees';

async function qryMsgLocation(sessionId: string, messageId: string) {
  const resp = await POST<{
    position: number;
    totalCount: number;
  }>('/byaiService/showcase/messages/count', {
    sessionId,
    messageId,
  });
  return resp;
}

export default function useLocateMessage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { setSessionId, setAgentId } = useGlobal();

  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);

  const getAgentInfo = useCallback(
    (agentId?: string) => {
      if (!agentId) return undefined;
      return [...(agentList || []), ...(employeesList || [])].find(
        (item) => `${item.id}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`
      );
    },
    [agentList, employeesList]
  );

  return useCallback(
    async ({ sessionId, messageId, agentId = '' }: { sessionId: string; messageId: string; agentId: string }) => {
      try {
        const { position, totalCount } = await qryMsgLocation(sessionId, messageId);
        await dispatch({
          type: 'messageStore/setInitialSessionDataToLocateMsg',
          payload: {
            sessionId,
            index: position,
            total: totalCount,
            targetMessageId: messageId,
          },
        });
        setTimeout(() => {
          setSessionId?.(sessionId);
          setAgentId?.(agentId);
          const agentInfo = getAgentInfo(agentId);

          let path = getRootPagePath();
          if (agentInfo) {
            path = getAgentPath(agentInfo) || path;
          }

          navigate(path);
        });
      } catch (e) {
        console.error(e);
      }
    },
    [dispatch, navigate, setSessionId, getAgentInfo]
  );
}
