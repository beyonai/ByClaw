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
// 后端使用 -1 标识默认项目；它与正数项目 ID 都是聊天项目上下文的合法值。
const DEFAULT_PROJECT_ID = -1;

const isValidProjectContextId = (projectId: number) =>
  Number.isFinite(projectId) && (projectId === DEFAULT_PROJECT_ID || projectId > 0);

type ProjectChatContext = {
  projectId?: number;
  projectName?: string;
};

const getProjectChatContext = (locationState: unknown): ProjectChatContext => {
  const state = (locationState || {}) as {
    from?: string;
    projectId?: string | number;
    projectName?: string;
  };
  const projectId = Number(state.projectId);
  if (state.from !== 'projectSpace' || !isValidProjectContextId(projectId)) {
    return {};
  }

  return {
    projectId,
    projectName: state.projectName,
  };
};

const Chat = () => {
  const intl = useIntl();
  const location = useLocation();

  const globalContext = useGlobal();
  const { sessionId, EventEmitter } = globalContext;

  const userInfo = useSelector(({ user }) => user.userInfo);

  const [isBottom, setIsBottom] = React.useState(!!sessionId);
  const fileUploadSessionIdRef = React.useRef('');

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
    if (fileUploadSessionIdRef.current) {
      if (`${sessionId || ''}` === fileUploadSessionIdRef.current) return;
      fileUploadSessionIdRef.current = '';
    }
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
      onFileUploadSessionCreated: (newSessionId: string) => {
        // 文件上传接口会提前创建会话，但新建任务仍应保持当前空白任务页，发送消息后再进入详情。
        if (sessionId) return;
        fileUploadSessionIdRef.current = `${newSessionId}`;
        setIsBottom(false);
      },
    };
  }, [sessionId]);

  const locationProjectContext = React.useMemo(() => getProjectChatContext(location.state), [location.state]);
  const autoSendContent = (location.state as { autoSendContent?: string } | null)?.autoSendContent;
  const targetSessionId = (location.state as { sessionId?: string | number } | null)?.sessionId;
  const selectedAgentId = (location.state as { selectedAgentId?: string | number } | null)?.selectedAgentId;
  const selectedAgentObjectType = (location.state as { selectedAgentObjectType?: string } | null)
    ?.selectedAgentObjectType;
  const autoSendKeyRef = React.useRef<string | undefined>(undefined);
  const [projectChatContext, setProjectChatContext] = React.useState<ProjectChatContext>(locationProjectContext);
  const pendingSessionProjectContextRef = React.useRef<ProjectChatContext | undefined>(undefined);
  const sessionProjectContextMapRef = React.useRef<Record<string, ProjectChatContext>>({});
  const [sessionProjectContext, setSessionProjectContext] = React.useState<ProjectChatContext>(() =>
    sessionId ? locationProjectContext : {}
  );

  React.useEffect(() => {
    if (!sessionId || !targetSessionId || `${sessionId}` !== `${targetSessionId}` || !autoSendContent?.trim()) {
      return undefined;
    }
    const sendKey = `${sessionId}:${autoSendContent}`;
    if (autoSendKeyRef.current === sendKey) return undefined;
    autoSendKeyRef.current = sendKey;
    // 等聊天输入组件完成挂载后再触发，确保事件不会早于输入框监听器注册。
    const timer = window.setTimeout(() => {
      EventEmitter.emit('queryInput-set-value-and-send', autoSendContent);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [EventEmitter, autoSendContent, sessionId, targetSessionId]);

  // 带员工进入已有会话要等会话对齐；带员工开新会话没有 sessionId 可对齐，两者都要能恢复 @ 员工。
  const selectedAgentSessionReady = targetSessionId
    ? !!sessionId && `${sessionId}` === `${targetSessionId}`
    : !sessionId;

  React.useEffect(() => {
    if (
      !selectedAgentSessionReady ||
      `${selectedAgentObjectType || ''}`.toLowerCase() !== 'digemployee' ||
      selectedAgentId === undefined ||
      selectedAgentId === null
    ) {
      return undefined;
    }
    // 等聊天输入组件注册事件后恢复任务模板选择的数字员工，使输入框前缀持续显示 @员工。
    const timer = window.setTimeout(() => {
      EventEmitter.emit('queryInput-set-schema', {
        agentId: `${selectedAgentId}`,
        agentType: agentTypeMap.agent,
        resourceList: [],
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [EventEmitter, selectedAgentId, selectedAgentObjectType, selectedAgentSessionReady]);

  React.useEffect(() => {
    setProjectChatContext(locationProjectContext);
  }, [locationProjectContext.projectId, locationProjectContext.projectName]);

  React.useEffect(() => {
    const handleActiveProjectChange = (payload: { projectId?: string | number; projectName?: string }) => {
      const projectId = Number(payload?.projectId);
      setProjectChatContext(
        isValidProjectContextId(projectId)
          ? {
            projectId,
            projectName: payload?.projectName,
          }
          : {}
      );
    };

    EventEmitter.on('projectSpace-active-project-change', handleActiveProjectChange);
    return () => {
      EventEmitter.off('projectSpace-active-project-change', handleActiveProjectChange);
    };
  }, [EventEmitter]);

  React.useEffect(() => {
    const handleProjectSessionPending = (payload: { projectId?: string | number; projectName?: string }) => {
      const projectId = Number(payload?.projectId);
      if (isValidProjectContextId(projectId)) {
        // 新会话尚未取得 sessionId 时先缓存项目归属，创建成功后顶部工具仍使用实际发送时选择的项目。
        pendingSessionProjectContextRef.current = {
          projectId,
          projectName: payload?.projectName,
        };
      }
    };

    EventEmitter.on('projectSpace-session-pending', handleProjectSessionPending);
    return () => {
      EventEmitter.off('projectSpace-session-pending', handleProjectSessionPending);
    };
  }, [EventEmitter]);

  React.useEffect(() => {
    const handleProjectSessionContext = (payload: {
      sessionId?: string | number;
      projectId?: string | number;
      projectName?: string;
    }) => {
      const projectId = Number(payload?.projectId);
      const targetSessionId = `${payload?.sessionId || ''}`;
      if (!targetSessionId || !isValidProjectContextId(projectId)) return;

      const context = { projectId, projectName: payload?.projectName };
      // 同路由切换任务会话时，先按会话 ID 缓存，避免 sessionId 先更新导致路由 state 尚未生效。
      sessionProjectContextMapRef.current[targetSessionId] = context;
      if (targetSessionId === `${sessionId || ''}`) {
        setSessionProjectContext(context);
      }
    };

    EventEmitter.on('projectSpace-session-context', handleProjectSessionContext);
    return () => {
      EventEmitter.off('projectSpace-session-context', handleProjectSessionContext);
    };
  }, [EventEmitter, sessionId]);

  React.useEffect(() => {
    if (!sessionId) {
      setSessionProjectContext({});
      return;
    }

    const cachedProjectContext = sessionProjectContextMapRef.current[`${sessionId}`];
    if (cachedProjectContext?.projectId) {
      setSessionProjectContext(cachedProjectContext);
      return;
    }

    const pendingProjectContext = pendingSessionProjectContextRef.current;
    if (pendingProjectContext?.projectId) {
      setSessionProjectContext(pendingProjectContext);
      pendingSessionProjectContextRef.current = undefined;
      return;
    }

    // 打开已有项目会话时以跳转路由携带的项目为准，左侧下拉切换不改变当前会话的工具上下文。
    setSessionProjectContext(locationProjectContext);
  }, [locationProjectContext.projectId, locationProjectContext.projectName, sessionId]);

  const projectChatExtraParams = React.useMemo(() => {
    // 仅在新会话的首条消息中绑定项目，已有会话不能因切换左侧项目下拉框而被重新归属。
    if (sessionId || !projectChatContext.projectId) {
      return {};
    }

    return projectChatContext;
  }, [projectChatContext, sessionId]);

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
          projectId={sessionProjectContext.projectId}
          projectName={sessionProjectContext.projectName}
          preserveNewSessionView
        />
      }
    />
  );
};

export default Chat;
