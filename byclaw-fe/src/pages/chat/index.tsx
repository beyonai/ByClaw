import React, { useMemo, lazy, useEffect } from 'react';

// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';

import ChatLayoutComp from '@/components/ChatLayoutComp';
import TitleWriter from '@/components/TitleWriter';
import { agentTypeMap } from '@/constants/agent';
import useGlobal from '@/hooks/useGlobal';
import type { IAgentType } from '@/typescript/agent';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import ChatPageLayout from '@/components/ChatPageLayout';

const BottomContent = lazy(() => import('@/pages/chat/components/BottomContent'));

const Chat = () => {
  const intl = useIntl();

  const globalContext = useGlobal();
  const { sessionId, agentId, setAgentId, EventEmitter } = globalContext;

  const userInfo = useSelector(({ user }) => user.userInfo);
  const employeesList = useSelector(({ employees }: { employees: IEmployeesState }) => employees.employeesList);

  const [isBottom, setIsBottom] = React.useState(!!sessionId);

  const defaultAgent = useMemo(() => {
    const defaultId = userInfo?.defaultDigEmployeeId ? `${userInfo.defaultDigEmployeeId}` : '';
    if (!defaultId) return null;
    const matched = employeesList?.find((item) => `${item.agentId}` === defaultId);
    return matched ? { agentId: defaultId, agentType: matched.agentType } : null;
  }, [userInfo?.defaultDigEmployeeId, employeesList]);

  // 仅当用户在欢迎页发送首条消息、底部输入框首次出现时自动 @ 默认数字员工。
  // 直接进入已有会话不会触发（isBottom 初值即 true），避免覆盖该会话原本的 agent。
  // 用户手动删掉 @ 后不再回填，发送时由 useChat 兜底走默认数字员工。
  const wasBottomRef = React.useRef<boolean>(isBottom);
  const autoMentionedRef = React.useRef<boolean>(false);
  const lastDefaultAgentIdRef = React.useRef<string | undefined>(defaultAgent?.agentId);

  // 用户在左侧切换默认数字员工后，下一次新开对话需要重新自动 @ 新的默认。
  useEffect(() => {
    if (lastDefaultAgentIdRef.current !== defaultAgent?.agentId) {
      autoMentionedRef.current = false;
      lastDefaultAgentIdRef.current = defaultAgent?.agentId;
    }
  }, [defaultAgent?.agentId]);

  useEffect(() => {
    const wasBottom = wasBottomRef.current;
    wasBottomRef.current = isBottom;
    if (autoMentionedRef.current) return;
    if (!isBottom || wasBottom) return;
    if (!defaultAgent) return;
    if (agentId) {
      autoMentionedRef.current = true;
      return;
    }
    EventEmitter.emit('queryInput-set-schema', {
      agentId: defaultAgent.agentId,
      agentType: defaultAgent.agentType,
    });
    setAgentId?.(defaultAgent.agentId);
    autoMentionedRef.current = true;
  }, [defaultAgent, agentId, isBottom]);

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

  return (
    <ChatPageLayout
      id="chat_wrapper"
      isBottom={isBottom}
      scrollId="chat_scroller"
      title={
        <TitleWriter
          showAssistant
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
        />
      }
    />
  );
};

export default Chat;
