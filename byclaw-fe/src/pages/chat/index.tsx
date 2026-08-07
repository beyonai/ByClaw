import React, { useMemo, lazy } from 'react';

// @ts-ignore
import { useIntl, useLocation, useSelector } from '@umijs/max';

import ChatLayoutComp from '@/components/ChatLayoutComp';
import TitleWriter from '@/components/TitleWriter';
import { agentTypeMap } from '@/constants/agent';
import useGlobal from '@/hooks/useGlobal';
import type { IAgentType } from '@/typescript/agent';
import type { IMessage } from '@/typescript/message';
import ChatPageLayout from '@/components/ChatPageLayout';
import CaptureRequirementModal from '@/pages/chat/components/CaptureRequirementModal';

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

  const locationProjectContext = React.useMemo(() => getProjectChatContext(location.state), [location.state]);
  const autoSendContent = (location.state as { autoSendContent?: string } | null)?.autoSendContent;
  const targetSessionId = (location.state as { sessionId?: string | number } | null)?.sessionId;
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

  // 沉淀为需求:入口挂在数字员工回答下方(MoreActions),点击后带该条消息发事件到此处打开弹窗。
  // 弹窗需要项目上下文与仓库列表,由聊天页持有,避免逐层透传到深层消息组件。
  const [captureOpen, setCaptureOpen] = React.useState(false);
  const [captureMessages, setCaptureMessages] = React.useState<IMessage[]>([]);
  // 事件里带来的项目归属优先，回退到当前会话上下文，避免刷新丢失路由态时取不到项目。
  const [captureProjectId, setCaptureProjectId] = React.useState<number>(0);

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
    const handleCaptureRequirement = (payload: { message?: IMessage; projectId?: number }) => {
      if (!payload?.message) return;
      const resolvedProjectId = Number(payload.projectId ?? sessionProjectContext.projectId);
      if (!Number.isFinite(resolvedProjectId) || resolvedProjectId <= 0) return;
      setCaptureProjectId(resolvedProjectId);
      setCaptureMessages([payload.message]);
      setCaptureOpen(true);
    };

    EventEmitter.on('chat-capture-requirement', handleCaptureRequirement);
    return () => {
      EventEmitter.off('chat-capture-requirement', handleCaptureRequirement);
    };
  }, [EventEmitter, sessionProjectContext.projectId]);

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
        />
      }
    >
      <CaptureRequirementModal
        open={captureOpen}
        projectId={captureProjectId}
        projectName={sessionProjectContext.projectName}
        messages={captureMessages}
        onClose={() => setCaptureOpen(false)}
      />
    </ChatPageLayout>
  );
};

export default Chat;
