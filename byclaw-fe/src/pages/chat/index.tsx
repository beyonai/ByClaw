import React, { useMemo, lazy } from 'react';

// @ts-ignore
import { useIntl, useLocation, useSelector } from '@umijs/max';

import ChatLayoutComp from '@/components/ChatLayoutComp';
import TitleWriter from '@/components/TitleWriter';
import { agentTypeMap } from '@/constants/agent';
import useGlobal from '@/hooks/useGlobal';
import type { IAgentType } from '@/typescript/agent';
import ChatPageLayout from '@/components/ChatPageLayout';

const BottomContent = lazy(() => import('@/pages/chat/components/BottomContent'));

const Chat = () => {
  const intl = useIntl();
  const location = useLocation();

  const globalContext = useGlobal();
  const { sessionId } = globalContext;

  const userInfo = useSelector(({ user }) => user.userInfo);

  const [isBottom, setIsBottom] = React.useState(!!sessionId);

  const title = useMemo(() => {
    if (userInfo) {
      return `Hi, ${userInfo.userName}! ${intl.formatMessage({ id: 'assistant.greeting1' })}`;
    }
    return `Hi, ${intl.formatMessage({ id: 'assistant.greeting1' })}`;
  }, [userInfo]);

  const fullText = useMemo(() => {
    return intl.formatMessage({ id: 'assistant.greeting2' });
  }, []);
  const highlightStart = useMemo(() => {
    return Number(intl.formatMessage({ id: 'assistant.greeting3.hightlightStart' }));
  }, []);

  const [agentType, setAgentType] = React.useState<IAgentType>(agentTypeMap.common);
  const [modeSelect, setModeSelect] = React.useState<'uploadExcel' | 'knowledgeBase'>('knowledgeBase');
  const [writerModeSelect, setwriterModeSelect] = React.useState<'writer' | 'ppt' | 'longWriter'>('writer');

  React.useEffect(() => {
    setIsBottom(!!sessionId);
  }, [sessionId]);

  const chatBottom = useMemo(() => {
    return <BottomContent />;
  }, [agentType, modeSelect, writerModeSelect]);

  const queryInputProps = React.useMemo(() => {
    return {
      onModeSelectChange: (mode: string) => {
        if (['uploadExcel', 'knowledgeBase'].includes(mode)) {
          setModeSelect(mode as 'uploadExcel' | 'knowledgeBase');
        }
        if (['writer', 'ppt', 'longWriter'].includes(mode)) {
          setwriterModeSelect(mode as 'writer' | 'ppt' | 'longWriter');
        }
      },
    };
  }, []);

  const projectChatExtraParams = React.useMemo(() => {
    const locationState = (location.state || {}) as {
      from?: string;
      projectId?: string | number;
      projectName?: string;
    };
    if (locationState.from !== 'projectSpace' || !locationState.projectId) {
      return {};
    }

    return {
      // 项目空间复用普通聊天页，发送时用 projectId 让后端消息和项目会话关系能对齐。
      projectId: Number(locationState.projectId),
      projectName: locationState.projectName,
    };
  }, [location.state]);

  return (
    <ChatPageLayout
      id="chat_wrapper"
      isBottom={isBottom}
      scrollId="chat_scroller"
      title={
        <TitleWriter
          showAssistant
          showAssistantTips
          title={title}
          colorTitleBg="linear-gradient(90deg, #3150ff 0%, #c067ff 100%) text"
          fullText={fullText}
          highlightStart={highlightStart}
        />
      }
      bottom={chatBottom}
      main={
        <ChatLayoutComp
          sessionId={sessionId}
          getContainer={() => document.getElementById('chat_wrapper')}
          agentType={agentType}
          setAgentType={setAgentType}
          isBottom={isBottom}
          setIsBottom={setIsBottom}
          queryInputProps={queryInputProps}
          sendExtraParams={projectChatExtraParams}
        />
      }
    />
  );
};

export default Chat;
