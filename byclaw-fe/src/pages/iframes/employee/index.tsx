import { useEffect, useRef, useState } from 'react';
import { useDispatch } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import ChatLayoutComp, { IChatLayoutCompRef } from '@/components/ChatLayoutComp';
import { createMessage } from '@/utils/messgae';
import { IMessageState } from '@/constants/message';
import { ResourceTypeMap } from '@/constants/resource';
import { getDebugSession } from '@/service/auth';
import { queryResourceDetail } from '@/service/knowledgeCenter';
import { agentHandler } from '@/utils/agent';
import { IAgentType } from '@/typescript/agent.d';
import { agentTypeMap } from '@/constants/agent';

export default function Employee() {
  const dispatch = useDispatch();
  const { agentId, sessionId, setSessionId } = useGlobal();
  const chat = useRef<IChatLayoutCompRef>(null);

  const [agentType, setAgentType] = useState<IAgentType | null>(null);

  const refresh = async (resourceId: string) => {
    const data = await getDebugSession({ agentId: resourceId });

    if (data && data?.sessionInfo) {
      setSessionId?.(data.sessionInfo.sessionId || '');
    }
  };

  const refreshAgent = async (resourceId: string) => {
    const res = await queryResourceDetail({ resourceId });

    if (res?.resourceId) {
      if (res.param?.agentType) {
        setAgentType(res.param.agentType);
      } else {
        setAgentType(agentTypeMap.agent);
      }
      dispatch({
        type: 'employees/save',
        payload: {
          employeesList: [
            agentHandler({
              ...(res.param || {}),
              id: res.resourceId,
              name: res.resourceName,
              resourceCode: res.resourceCode,
              avatar: res.avatar,
            }),
          ],
        },
      });

      if (res.param?.prologue) {
        let descText = '';
        let metadata = '';
        let relatedQuestions = [];
        try {
          const obj = JSON.parse(res.param.prologue);
          const { descText: parsedDescText, openingQuestion } = obj;
          descText = parsedDescText;

          metadata = JSON.stringify({
            resourceId,
            resourceType: ResourceTypeMap.digitalEmployee,
            agentId,
          });

          relatedQuestions = JSON.parse(openingQuestion);
        } catch (error) {
          console.warn(error);
        }

        chat.current?.setMessageList((prev) => {
          const first = prev[0];
          if (first?.msgId !== '-1') {
            return [
              createMessage({
                msgId: '-1',
                fromBeyond: true,
                messageState: IMessageState.Done,
                text: descText,
                relatedQuestions,
                metadata,
              }),
              ...prev,
            ];
          }

          return prev;
        });
      }
    }
  };

  useEffect(() => {
    if (agentId) {
      refresh(agentId).then(() => {
        refreshAgent(agentId);
      });
    }

    Object.assign(window, { refreshAgent });
    return () => {
      delete (window as any).refreshAgent;
    };
  }, [agentId]);

  if (!agentType) return null;

  return (
    <section className="full-width full-height ub" id="employees_wrapper2">
      <ChatLayoutComp
        ref={chat}
        isBottom
        cannotAt
        hideAction
        hideChatTitle
        agentType={agentType}
        sessionId={sessionId}
        chatUrl="/byaiService/digitalEmployeeController/debugChat"
      />
    </section>
  );
}
