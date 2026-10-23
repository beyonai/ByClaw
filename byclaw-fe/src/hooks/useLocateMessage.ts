import { useCallback, useRef } from 'react';
import { useDispatch, useIntl, useNavigate, useSelector } from '@umijs/max';
import { message } from 'antd';
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
  const intl = useIntl();
  const requestId = useRef(0);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { setSessionId, setAgentId, EventEmitter } = useGlobal();

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
    async ({
      sessionId,
      messageId,
      agentId,
      preserveAgentContext = false,
    }: {
      sessionId: string;
      messageId: string;
      agentId?: string;
      preserveAgentContext?: boolean;
    }) => {
      const currentRequest = ++requestId.current;
      try {
        const { position, totalCount } = await qryMsgLocation(sessionId, messageId);
        if (currentRequest !== requestId.current) return;
        if (!Number.isInteger(position) || position < 1 || !Number.isInteger(totalCount) || totalCount < position) {
          throw new Error('Target message position unavailable');
        }
        await dispatch({
          type: 'messageStore/setInitialSessionDataToLocateMsg',
          payload: {
            sessionId,
            index: position,
            total: totalCount,
            targetMessageId: messageId,
          },
        });
        if (currentRequest !== requestId.current) return;
        if (preserveAgentContext) {
          await dispatch({
            type: 'messageStore/getSessionMessage',
            payload: { sessionId },
          });
          if (currentRequest !== requestId.current) return;
          setSessionId?.(sessionId);
          EventEmitter.emit('scrollToMsgOnSessionChanged', { sessionId, targetMessageId: messageId });
          return;
        }
        setTimeout(() => {
          if (currentRequest !== requestId.current) return;
          setSessionId?.(sessionId);
          setAgentId?.(agentId ?? '');
          const agentInfo = getAgentInfo(agentId);
          let path = getRootPagePath();
          if (agentInfo) path = getAgentPath(agentInfo) || path;
          navigate(path);
        });
      } catch (e) {
        console.error(e);
        if (preserveAgentContext && currentRequest === requestId.current) {
          message.warning(intl.formatMessage({ id: 'messageList.taskPlan.executionUnavailable' }));
        }
      }
    },
    [dispatch, navigate, setSessionId, setAgentId, EventEmitter, getAgentInfo, intl]
  );
}
