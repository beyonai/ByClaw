import React, { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo, ForwardedRef } from 'react';
import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { isEmpty, last, size } from 'lodash';
import { notification, Spin } from 'antd';
import { ArrowLeftOutlined, LockOutlined } from '@ant-design/icons';

import MessageList from '@/components/MessageList';

import ReferenceSource from '@/components/ReferenceSource';
import ForwardMessages from './components/ForwardMessages';

import ChatLayoutCompContext from './hooks/useContext';

import { agentTypeMap } from '@/constants/agent';
import { Platform } from '@/layout/components/provider/global';
import useAppStore from '@/models/common/useAppStore';

import useChat, { ISendProps, ISendConf } from '@/hooks/useChat';
import type { IAgentType } from '@/typescript/agent';
import type { IMessage, IResourceFromItem } from '@/typescript/message';
import type { ISession } from '@/typescript/session';
import { IMessageState } from '@/constants/message';
import { isRootPage } from '@/utils';
import useGlobal from '@/hooks/useGlobal';
import classnames from 'classnames';
import useEventEmitterHooks from './hooks/useEventEmitterHooks';
import ChatTitle from './ChatTitle';
import MultiChoices from './components/MultiChoices';
import EasyConfirm from './components/EasyConfirm';
import { selectLatestTaskPlan } from '@/components/MessageList/components/TaskExecutionPlan/projection';
import ChatTaskPlanDock from './ChatTaskPlanDock';

import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';

import styles from './index.module.less';
import { getResponseAgentInfo, isMultiAgentResponsePayload, type ResponseMetadataPayload } from '../MessageList/utils';
import ChatResourceWorkspace from './ChatResourceWorkspace';
import TaskTemplateEntry from '@/components/TaskTemplateModal/TaskTemplateEntry';
import {
  DEFAULT_DETAIL_PANEL_WIDTH,
  HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH,
  SiderContentContext,
  type DetailPanelOptions,
} from '@/layout/sider/siderContentContext';
import { closeChatResourceTab, upsertChatResourceTab, type ChatResourceTab } from './ChatResourceWorkspace/tabState';
import { isNotificationSession } from '@/utils/session';
import { qryConversations } from '@/service/layout';
import { isExternalChildSession } from '@/utils/scopedSession';
import { useChatResourceProject } from './ChatResourceWorkspace/useChatResourceProject';

type IProps = {
  sessionId: string;
  getContainer?: () => HTMLElement | null;

  agentType?: IAgentType;
  setAgentType?: React.Dispatch<React.SetStateAction<IAgentType>>;

  isBottom: boolean;
  setIsBottom?: React.Dispatch<React.SetStateAction<boolean>>;

  /** 是否在恢复到消息列表时自动进入聊天态，员工详情页切换员工时需要关闭。 */
  autoEnterBottomOnMessage?: boolean;

  queryInputProps?: Record<string, unknown>;

  /** 输入区外层样式，由特殊聊天页面按需覆盖视觉，不改变输入逻辑。 */
  queryInputWrapperClassName?: string;

  /** 新建任务上传文件生成会话后，保持新建任务视图直到用户发送消息。 */
  preserveNewSessionView?: boolean;

  /** 禁用输入框草稿缓存与恢复，员工详情等固定聊天对象场景使用。 */
  disableInputDraft?: boolean;

  /** 自定义聊天地址 */
  chatUrl?: string;
  cannotAt?: boolean;
  readOnly?: boolean;
  hideAction?: boolean;
  hideChatTitle?: boolean;
  sendExtraParams?: Record<string, unknown>;

  /**
   * 调试 iframe 中锁定当前资源，避免普通会话同步逻辑将其误清空。
   * 正常聊天页不传该参数，继续使用全局 agentId。
   */
  fixedAgentId?: string;
  projectId?: number;
  projectName?: string;
};

// 定义MessageList组件的ref类型接口
interface MessageListRefType {
  toBottom: (params?: { behavior?: ScrollBehavior }) => void;
}

export interface IChatLayoutCompRef {
  setMessageList: React.Dispatch<React.SetStateAction<IMessage[]>>;
  getMessageList: () => IMessage[];
  scrollToBottom?: MessageListRefType['toBottom'];
}

function ChatLayoutComp(props: IProps, ref: ForwardedRef<IChatLayoutCompRef>) {
  const intl = useIntl();
  const {
    setAgentType,
    agentType = agentTypeMap.common,
    sendExtraParams = {},
    hideChatTitle = false,
    chatUrl,
    hideAction = false,
    fixedAgentId,
    projectId,
    projectName,
    queryInputWrapperClassName,
    preserveNewSessionView = false,
  } = props;
  const { isBottom, setIsBottom, autoEnterBottomOnMessage = true } = props;
  const { sessionId, queryInputProps = {}, readOnly, disableInputDraft = false } = props;
  const { cannotAt = !sessionId && !isRootPage() } = props;

  const [notificationMessage, contextHolder] = notification.useNotification({
    placement: 'bottomRight',
  });

  const [myAgentType, setMyAgentType] = useState<IAgentType>(agentType);
  const [sessionSelectOpen, setSessionSelectOpen] = useState<boolean>(false);
  // 进入已有会话详情时默认展开右侧资源列表；用户关闭后保持关闭，直到进入另一个会话详情。
  const [resourceListOpen, setResourceListOpen] = useState(() => Boolean(sessionId));
  const [resourceTabs, setResourceTabs] = useState<ChatResourceTab[]>([]);
  const [activeResourceTabKey, setActiveResourceTabKey] = useState('');
  const [resourceWorkspaceRefreshKey, setResourceWorkspaceRefreshKey] = useState(0);
  const [selectedProject, setSelectedProject] = useState<{
    projectId: string;
    projectName: string;
    cloudResourceId?: string | number;
  }>();

  // 工作区状态只属于当前聊天实例，路由刷新后不恢复详情页签，避免复用失效的 React 节点。
  const resourceTabSequenceRef = useRef(0);
  const previousResourceSessionIdRef = useRef(sessionId);
  const resourceWorkspaceOwnedRef = useRef(false);
  const { setDetailPanel, clearDetailPanel } = React.useContext(SiderContentContext);

  const { EventEmitter, setAgentId, setSessionId: setGlobalSessionId, platform, agentId } = useGlobal();
  const isPC = platform === Platform.pc;
  const { getSandboxesInfoUrl } = useAppStore();

  /** 对话的额外参数 */
  const tempParamsRef = useRef(sendExtraParams);
  tempParamsRef.current = sendExtraParams;
  const shouldSkipSessionListCache = Boolean(sendExtraParams?.troubleshootMessageId);

  const prevAgentId = useRef(agentId);
  // 只在会话员工身份变化时同步一次；不能把 agentId 放进 effect 依赖，否则手动 @ 员工会被会话员工反复覆盖。
  const sessionAgentSyncKeyRef = useRef('');

  // 修改ref类型为MessageListRefType
  const messageListCompRef = useRef<MessageListRefType>(null);

  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const { sessionList } = useSelector((state: any) => state.session);
  const userInfo = useSelector((state: any) => state.user?.userInfo);

  const dispatch = useDispatch();

  const addSession = useCallback(
    (newSession: ISession) => {
      if (shouldSkipSessionListCache) {
        return;
      }

      dispatch({
        type: 'session/addSession',
        payload: newSession,
      });
    },
    [dispatch, shouldSkipSessionListCache]
  );

  const updateSession = useCallback(
    (session: Partial<Omit<ISession, 'sessionId'>> & Pick<ISession, 'sessionId'>) => {
      dispatch({
        type: 'session/updateSession',
        payload: session,
      });
    },
    [dispatch]
  );

  const openDrawerSourceFromInfo = useCallback((infoList: IResourceFromItem[]) => {
    EventEmitter.emit('beyond-main-driver-open-type', {
      width: '25vw',
      title: intl.formatMessage({ id: 'sourceDrawer.title' }),
      canClose: true,
      drawerType: <ReferenceSource drawerSourceFromInfo={infoList} />,
    });
  }, []);

  const onBeforeSend = useCallback(async (param = {}) => {
    void getSandboxesInfoUrl();

    return EventEmitter.invoke('beyond-chat-beforesend-hook', param);
  }, []);

  const currentSession = useMemo(() => {
    const target = [...sessionList].find((item: any) => `${item.sessionId}` === `${sessionId}`);

    return target;
  }, [sessionId, sessionList]);

  useEffect(() => {
    if (!sessionId || currentSession) return undefined;
    let cancelled = false;
    qryConversations({ sessionId, pageNum: 1, pageSize: 1 })
      .then((response) => {
        const exactSession = response?.list?.[0];
        if (cancelled || !exactSession) return;
        addSession({ ...exactSession, sessionId: `${exactSession.sessionId}` });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [addSession, currentSession, sessionId]);

  const sessionProjectId = useMemo(() => {
    // 路由状态在刷新或非项目列表入口时可能丢失，优先从当前会话的后端归属字段恢复。
    const candidateProjectId = projectId ?? currentSession?.projectId;
    const normalizedProjectId = Number(candidateProjectId);
    return Number.isFinite(normalizedProjectId) && (normalizedProjectId === -1 || normalizedProjectId > 0)
      ? normalizedProjectId
      : undefined;
  }, [currentSession?.projectId, projectId]);
  const { project: sessionProject } = useChatResourceProject(sessionProjectId);
  const sessionCloudResourceId =
    currentSession?.cloudResourceId || selectedProject?.cloudResourceId || sessionProject?.cloudResourceId;

  const notificationSession = isNotificationSession(currentSession);
  const externalChildSession = isExternalChildSession(currentSession);
  const effectiveReadOnly = Boolean(readOnly || notificationSession || externalChildSession);

  useEffect(() => {
    if (fixedAgentId) {
      // 数字员工编辑页调试没有 session 列表上下文，必须始终保留当前调试资源身份。
      setAgentId?.(`${fixedAgentId}`);
      setMyAgentType(agentType);
      return;
    }

    // 新建会话尚无 sessionId 时，agentId 可能来自员工详情或任务模板选择，不能按“普通会话”误清空；
    // 只有已有会话切换时，才根据会话返回的 objectId 同步默认数字员工。
    if (!sessionId) return;

    const sessionObjectType = `${currentSession?.objectType || ''}`.toLowerCase();
    const sessionAgentId = currentSession?.objectId;
    // 会话切换时列表缓存可能比 sessionId 晚一拍更新，等待目标会话信息到齐，避免先清空旧 @ 标签再立即重建。
    if (sessionId && !currentSession) return;
    const syncKey = `${sessionId || ''}:${sessionObjectType}:${sessionAgentId ?? ''}`;
    if (sessionAgentSyncKeyRef.current === syncKey) return;
    sessionAgentSyncKeyRef.current = syncKey;

    if (sessionObjectType !== 'digemployee' || sessionAgentId === undefined || sessionAgentId === null) {
      // 切换到没有会话员工的普通会话时清理上一会话的默认 @ 员工，避免旧标签残留。
      setAgentId?.('');
      setMyAgentType(agentType);
      return;
    }

    const sessionAgentInfo = getResponseAgentInfo(
      { agentList, employeesList },
      JSON.stringify({ agentId: sessionAgentId })
    );
    const nextAgentId = `${sessionAgentInfo?.agentId || sessionAgentId}`;
    // 运营任务进入会话后立即恢复模板所选员工，使输入框默认 @ 该员工并在发送后继续保留。
    setAgentId?.(nextAgentId);
    setMyAgentType(sessionAgentInfo?.agentType || agentTypeMap.agent);
  }, [
    agentList,
    agentType,
    currentSession?.objectId,
    currentSession?.objectType,
    employeesList,
    fixedAgentId,
    sessionId,
    setAgentId,
  ]);

  // 旧资源面板仍以单详情节点回调；这里统一补齐稳定身份，才能在多次点击同一资源时复用页签。
  const openResourceDetail = useCallback(
    (panel: React.ReactNode, options: DetailPanelOptions = {}) => {
      const elementProps = React.isValidElement(panel) ? (panel.props as Record<string, any>) : {};
      const identity =
        elementProps.resourceId ||
        elementProps.item?.resourceId ||
        elementProps.dataset?.resourceId ||
        elementProps.node?.resourceId ||
        elementProps.node?.viewCode ||
        elementProps.node?.objectCode ||
        elementProps.fileName ||
        elementProps.title;
      const elementType = React.isValidElement(panel)
        ? typeof panel.type === 'string'
          ? panel.type
          : panel.type.displayName || panel.type.name || 'detail'
        : 'detail';
      const key =
        options.tabKey || (identity ? `${elementType}:${identity}` : `detail:${++resourceTabSequenceRef.current}`);
      const title =
        options.title ||
        elementProps.title ||
        elementProps.resourceName ||
        elementProps.item?.resourceName ||
        elementProps.dataset?.resourceName ||
        elementProps.node?.name ||
        elementProps.fileName ||
        intl.formatMessage({ id: 'common.detail' });

      setResourceTabs((current) => upsertChatResourceTab(current, { key, title, content: panel }));
      setActiveResourceTabKey(key);
    },
    [intl]
  );

  /** 从资源列表打开任意详情页签后自动收起列表，避免浮层遮挡新打开的内容。 */
  const openResourceDetailFromResourceList = useCallback(
    (panel: React.ReactNode, options: DetailPanelOptions = {}) => {
      openResourceDetail(panel, options);
      setResourceListOpen(false);
    },
    [openResourceDetail]
  );

  const closeResourceTab = useCallback(
    (key: string) => {
      const next = closeChatResourceTab(resourceTabs, activeResourceTabKey, key);
      setResourceTabs(next.tabs);
      setActiveResourceTabKey(next.activeKey);
      if (!next.tabs.length) setResourceListOpen(true);
    },
    [activeResourceTabKey, resourceTabs]
  );

  const closeResourceTabs = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setResourceTabs((currentTabs) => {
      const nextTabs = currentTabs.filter((tab) => !keys.includes(tab.key));
      setActiveResourceTabKey((currentActiveKey) => {
        if (nextTabs.some((tab) => tab.key === currentActiveKey)) return currentActiveKey;
        return nextTabs[nextTabs.length - 1]?.key || '';
      });
      if (!nextTabs.length) setResourceListOpen(true);
      return nextTabs;
    });
  }, []);

  const resourceWorkspaceVisible = isBottom && (resourceListOpen || resourceTabs.length > 0);

  // 预览页签栏的列表按钮只负责显示/隐藏资源列表，不能误关已经打开的文件预览。
  const toggleResourceList = useCallback(() => {
    setResourceListOpen((open) => !open);
  }, []);

  // 会话标题入口是资源工作区总开关：关闭时同时清理列表和全部预览页签。
  const toggleResourceWorkspaceFromChatTitle = useCallback(() => {
    if (resourceListOpen || resourceTabs.length > 0) {
      setResourceListOpen(false);
      setResourceTabs([]);
      setActiveResourceTabKey('');
      return;
    }
    setResourceListOpen(true);
  }, [resourceListOpen, resourceTabs.length]);

  useEffect(() => {
    if (!resourceWorkspaceVisible) {
      if (resourceWorkspaceOwnedRef.current) {
        clearDetailPanel?.();
        resourceWorkspaceOwnedRef.current = false;
      }
      return;
    }

    resourceWorkspaceOwnedRef.current = true;
    setDetailPanel?.(
      <ChatResourceWorkspace
        sessionId={sessionId}
        projectId={sessionProjectId}
        cloudResourceId={sessionCloudResourceId}
        listOpen={resourceListOpen}
        tabs={resourceTabs}
        activeTabKey={activeResourceTabKey}
        onToggleList={toggleResourceList}
        onOpenDetail={openResourceDetailFromResourceList}
        onActiveTabChange={setActiveResourceTabKey}
        onCloseTab={closeResourceTab}
        onCloseTabs={closeResourceTabs}
      />,
      {
        width: resourceTabs.length ? HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH : DEFAULT_DETAIL_PANEL_WIDTH,
      }
    );
  }, [
    activeResourceTabKey,
    clearDetailPanel,
    closeResourceTab,
    closeResourceTabs,
    openResourceDetailFromResourceList,
    resourceListOpen,
    resourceTabs,
    resourceWorkspaceVisible,
    resourceWorkspaceRefreshKey,
    sessionId,
    sessionCloudResourceId,
    sessionProjectId,
    setDetailPanel,
    toggleResourceList,
  ]);

  useLayoutEffect(() => {
    // 每次进入另一个已有会话详情时关闭旧预览并默认打开资源列表；新建会话尚无 sessionId 时不展示。
    const previousSessionId = previousResourceSessionIdRef.current;
    previousResourceSessionIdRef.current = sessionId;
    if (`${previousSessionId}` === `${sessionId}`) {
      // 上传文件提前创建的会话在新建任务页暂不打开资源面板；用户发送消息后再进入详情时补开。
      if (sessionId && isBottom) setResourceListOpen(true);
      return;
    }

    setResourceTabs([]);
    setActiveResourceTabKey('');
    setResourceListOpen(Boolean(sessionId && isBottom));
  }, [isBottom, sessionId]);

  useEffect(() => {
    // 会话详情切换时兜底打开一次资源列表，避免路由切换和详情面板清理的异步时序导致右侧面板偶发保持关闭。
    if (sessionId && isBottom) {
      setResourceListOpen(true);
    }
  }, [isBottom, sessionId]);

  useEffect(() => {
    const handleChatSessionChanged = (payload?: { sessionId?: string | number }) => {
      if (!payload?.sessionId || `${payload.sessionId}` !== `${sessionId}`) return;

      setResourceTabs([]);
      setActiveResourceTabKey('');
      setResourceListOpen(true);
      // PC 布局切换路由时可能已经清空了详情面板，此处递增 key 强制重新注册资源工作区。
      setResourceWorkspaceRefreshKey((current) => current + 1);
    };

    EventEmitter.on('chat-session-changed', handleChatSessionChanged);
    return () => {
      EventEmitter.off('chat-session-changed', handleChatSessionChanged);
    };
  }, [EventEmitter, sessionId]);

  // 路由切换时由 PCLayout 统一决定是否清理详情面板；资源中心入口带 preserveDetailPanel 标记时，
  // 即使聊天组件卸载，也要保留右侧资源工作区显示在资源中心页面旁边。

  const onReceivedChatMessages = useCallback(
    (payload?: ResponseMetadataPayload) => {
      if (fixedAgentId) {
        return;
      }
      const { sessionId: sourceSessionId, metadata } = payload || {};
      if (`${sourceSessionId}` !== `${sessionId}`) {
        return;
      }
      if (isMultiAgentResponsePayload(payload)) {
        // 多员工会话由输入框 mention 决定参与员工，不能用最后完成的单个回答覆盖全局 agentId。
        return;
      }
      const agentInfo = getResponseAgentInfo({ agentList, employeesList }, metadata);
      if (agentInfo) {
        // 目标会话缓存尚未到齐时不处理异步历史消息，避免旧会话员工抢先写入全局状态。
        if (sessionId && !currentSession) return;
        // 已有会话的 objectId 是详情接口返回的唯一默认员工；历史消息异步回放时不能再用旧响应员工覆盖它。
        const sessionObjectType = `${currentSession?.objectType || ''}`.toLowerCase();
        const sessionAgentId = currentSession?.objectId;
        if (
          sessionObjectType === 'digemployee' &&
          sessionAgentId !== undefined &&
          sessionAgentId !== null &&
          `${agentInfo.agentId}` !== `${sessionAgentId}`
        ) {
          return;
        }
        // 会话员工 ID 在不同接口中可能以 number/string 返回，统一成字符串避免输入框默认 @ 节点反复切换。
        setAgentId?.(`${agentInfo.agentId}`);
        setMyAgentType(agentInfo.agentType);
      }
    },
    [agentList, currentSession?.objectId, currentSession?.objectType, employeesList, fixedAgentId, sessionId]
  );

  const {
    sendQuery,
    messageList,
    hasMore,
    getMessageList,
    setMessageList,
    onNext,
    updateMessage,
    deleteMessage,
    isSessionRunning,
    canAcceptInput,
    cancelCurrentSession,
    sessionMessageLoadState,
    retrySessionMessageLoad,
  } = useChat({
    chatUrl,
    sessionId,
    agentType: myAgentType,
    fixedAgentId,
    addSession,
    onBeforeSend,
  });
  const lastMsg = last(messageList);
  const latestTaskPlan = useMemo(() => selectLatestTaskPlan(messageList, sessionId), [messageList, sessionId]);

  const guardedSendQuery = useCallback(
    (sendProps: ISendProps, sendConf?: ISendConf) => {
      if (effectiveReadOnly) return;
      return sendQuery(sendProps, sendConf);
    },
    [effectiveReadOnly, sendQuery]
  );
  const guardedDeleteMessage = useCallback(
    (message: IMessage) => {
      if (effectiveReadOnly) return;
      deleteMessage(message);
    },
    [deleteMessage, effectiveReadOnly]
  );

  const onCancel = useCallback(() => {
    if (effectiveReadOnly) return;
    if (
      isSessionRunning ||
      [IMessageState.Query, IMessageState.Answer].includes(lastMsg?.messageState as IMessageState)
    ) {
      cancelCurrentSession();
    }
  }, [cancelCurrentSession, effectiveReadOnly, isSessionRunning, lastMsg?.messageState]);

  const { disabledInput, multiChoicesList, setMultiChoicesList, multiChoicesMsgId, setMultiChoicesMsgId } =
    useEventEmitterHooks({
      messageList,
      updateMessage,
      openDrawerSourceFromInfo,
      sendQuery: guardedSendQuery,
      setMyAgentType,
      deleteMessage: guardedDeleteMessage,
      cancelSSE: onCancel,
    });
  const isMultiChoices = !isEmpty(multiChoicesList);

  const onSendRef = useRef<(param: ISendProps, isRetry?: boolean) => any>(undefined);

  const onSend = useCallback(
    async (param: ISendProps, isRetry?: boolean) => {
      if (disabledInput || effectiveReadOnly) return;
      if (!isRetry) {
        Object.assign(param, { payload: { ...param.payload, ...tempParamsRef.current } });
      }
      try {
        const res = await sendQuery(param);
        if (res) {
          setIsBottom?.(true);
          requestIdleCallback(() => {
            messageListCompRef.current?.toBottom();
          });
        }
      } catch (e) {
        // 等待promise执行完成，再重试发送
        if (e instanceof Promise) {
          e.finally(() => {
            onSendRef.current?.(param, true);
          });
        }
      }
    },
    [disabledInput, effectiveReadOnly, sendQuery, setIsBottom]
  );

  onSendRef.current = onSend;

  const lastAnswer = useMemo(() => {
    const lastM = last(messageList);
    const lastT = last(lastM?.thinkList ?? []);
    return lastT;
  }, [messageList]);

  useEffect(() => {
    setAgentType?.(myAgentType);
  }, [myAgentType]);

  useEffect(() => {
    const onSetSchema = (schema: any) => {
      // 因为目前没有外层agentType控制内部myAgentType的逻辑（反过来就有），所以这里需要再写一遍修改myAgentType的逻辑
      const { agentType, agentId } = schema;
      setAgentId?.(agentId || '');
      setMyAgentType(agentType || agentTypeMap.common);
    };

    EventEmitter.on('queryInput-set-schema', onSetSchema);

    return () => {
      EventEmitter.off('queryInput-set-schema', onSetSchema);
    };
  }, []);

  useEffect(() => {
    // agentId从有到无
    if (!agentId && prevAgentId.current) {
      setMyAgentType(agentTypeMap.common);
    }
    prevAgentId.current = agentId;
  }, [agentId]);

  useEffect(() => {
    // 员工详情页可能短暂恢复上一员工的消息，不能因此隐藏当前员工的介绍区域。
    if (!autoEnterBottomOnMessage) return;
    setIsBottom?.((prev) => {
      return prev || !!lastMsg;
    });
  }, [autoEnterBottomOnMessage, lastMsg, setIsBottom]);

  useEffect(() => {
    return () => {
      if (sessionId) {
        updateSession({
          sessionId,
          citeMsgIdList: undefined,
        });
      }

      setMultiChoicesList([]);
    };
  }, [sessionId, updateSession]);

  useEffect(() => {
    // 每次切换会话之后，查询到上一次聊天最后的一个metadata，然后根据metadata还原上一次最后的agent信息
    EventEmitter.on('RECEIVE_SESSION_RECORDS_LAST_METADATA', onReceivedChatMessages);
    return () => {
      EventEmitter.off('RECEIVE_SESSION_RECORDS_LAST_METADATA', onReceivedChatMessages);
    };
  }, [onReceivedChatMessages]);

  useEffect(() => {
    const onCancelSSE = (mySessionId: string) => {
      if (mySessionId === sessionId) {
        onCancel();
      }
    };

    EventEmitter.on('on-cancel-sse', onCancelSSE);

    return () => {
      EventEmitter.off('on-cancel-sse', onCancelSSE);
    };
  }, [onCancel, sessionId]);

  React.useImperativeHandle(ref, () => ({
    getMessageList,
    setMessageList,
    scrollToBottom: messageListCompRef.current?.toBottom,
  }));

  const messageState = React.useMemo(() => {
    if (isSessionRunning && !canAcceptInput) {
      return IMessageState.Answer;
    }
    return lastMsg?.messageState;
  }, [canAcceptInput, isSessionRunning, lastMsg?.messageState]);

  const showNewSessionProjectSelector = Boolean(
    userInfo && queryInputProps.enableTaskTemplate !== false && (!sessionId || (preserveNewSessionView && !isBottom))
  );
  const projectSelectorSessionId = preserveNewSessionView && !isBottom ? '' : sessionId;

  return (
    <ChatLayoutCompContext.Provider
      value={{
        getMessageList,
        totalMesageListSize: size(messageList),
        currentSession,
      }}
    >
      <div className={classnames(styles.chatLayoutCompBox, 'full-height full-width')}>
        <div className={classnames(styles.chatLayoutComp, 'full-width ub')}>
          <div className="ub ub-f1 ub-ver">
            {!hideChatTitle && isBottom && isPC && (
              <ChatTitle
                sessionId={sessionId}
                lastAnswer={lastAnswer}
                currentSession={currentSession}
                agentType={myAgentType}
                projectId={sessionProjectId}
                projectName={projectName}
                // 按钮底色只反映右侧资源小面板状态，文件预览单独打开时保持无底色。
                resourceWorkspaceOpen={resourceListOpen}
                // 会话标题按钮关闭资源工作区时，需要同时关闭列表和全部多 Tab 预览。
                onToggleResourceWorkspace={toggleResourceWorkspaceFromChatTitle}
              />
            )}
            {isBottom && (
              <div className={classnames(styles.messageList, 'ub-f1 overflow-hidden')}>
                {sessionMessageLoadState === 'loading' && (
                  <div className={styles.sessionMessageLoadNotice} role="status">
                    <Spin size="small" /> 正在同步会话消息…
                  </div>
                )}
                {sessionMessageLoadState === 'error' && (
                  <button
                    type="button"
                    className={styles.sessionMessageLoadError}
                    onClick={() => void retrySessionMessageLoad()}
                  >
                    会话消息加载失败，点击重试
                  </button>
                )}
                <MessageList
                  ref={messageListCompRef}
                  onNext={onNext}
                  hasMore={hasMore}
                  sessionId={sessionId}
                  hideAction={hideAction || notificationSession}
                  messageList={messageList}
                  updateMessage={updateMessage}
                  deleteMessage={guardedDeleteMessage}
                  multiChoicesList={multiChoicesList}
                  multiChoicesMsgId={multiChoicesMsgId}
                  setMultiChoicesMsgId={setMultiChoicesMsgId}
                  previewInDetailPanel
                  enableConversationNavigator={isPC && !notificationSession && !isMultiChoices}
                />
              </div>
            )}
            {latestTaskPlan ? <ChatTaskPlanDock taskPlan={latestTaskPlan} /> : null}
            {!effectiveReadOnly && (
              <div
                className={classnames(styles.queryInputWrapper, queryInputWrapperClassName, {
                  [styles.messageListDisappear]: isMultiChoices,
                  [styles.withProjectSelector]: showNewSessionProjectSelector,
                })}
                id="queryInputWrapper"
              >
                <EasyConfirm
                  messageState={messageState}
                  disabledInput={disabledInput}
                  isBottom={isBottom}
                  cannotAt={cannotAt}
                  disableInputDraft={disableInputDraft}
                  queryInputProps={{
                    ...queryInputProps,
                    projectId: sessionProjectId,
                    projectCloudResourceId: sessionCloudResourceId,
                    selectedProject,
                  }}
                  lastMsg={lastMsg}
                  sessionId={sessionId}
                  preserveInputOnSessionChange={preserveNewSessionView && !isBottom}
                  onSend={onSend}
                  onCancel={onCancel}
                  myAgentType={myAgentType}
                  setMyAgentType={setMyAgentType}
                  updateMessage={updateMessage}
                />
                {showNewSessionProjectSelector && (
                  <div className={styles.externalProjectSelector}>
                    <TaskTemplateEntry
                      projectId={sessionProjectId}
                      sessionId={projectSelectorSessionId}
                      onProjectChange={setSelectedProject}
                      onApply={() => undefined}
                    />
                  </div>
                )}
                {/* {isBottom && TopButtons} */}
              </div>
            )}
            {externalChildSession && (
              <div className={styles.childSessionReadOnlyNotice}>
                <span className={styles.childSessionReadOnlyCopy}>
                  <LockOutlined />子 Agent 会话为只读，消息由外部执行器持续同步
                </span>
                <button type="button" onClick={() => setGlobalSessionId?.(`${currentSession?.parentSessionId || ''}`)}>
                  <ArrowLeftOutlined />
                  返回主会话继续任务
                </button>
              </div>
            )}
            {isMultiChoices && (
              <MultiChoices
                sessionId={sessionId}
                multiChoicesList={multiChoicesList}
                currentSession={currentSession}
                multiChoicesMsgId={multiChoicesMsgId}
                messageList={messageList}
                setMultiChoicesMsgId={setMultiChoicesMsgId}
                setMultiChoicesList={setMultiChoicesList}
                updateSession={updateSession}
                setMyAgentType={setMyAgentType}
                notificationMessage={notificationMessage}
              />
            )}
            {!isMultiChoices && isBottom && (
              <div
                className="ub ub-ac ub-pc"
                style={{
                  margin: '3px 0 6px',
                  fontSize: `var(--${PREFIX_NAME}-font-size-sm)`,
                  color: 'rgba(0, 0, 0, 0.3)',
                }}
              >
                {intl.formatMessage({ id: 'chatLayout.aiDisclaimer' })}
              </div>
            )}
          </div>
        </div>
        <ForwardMessages
          open={sessionSelectOpen}
          setOpen={setSessionSelectOpen}
          multiChoicesMsgId={multiChoicesMsgId}
          updateMessage={updateMessage}
        />
      </div>
      {contextHolder}
    </ChatLayoutCompContext.Provider>
  );
}

export default React.forwardRef<IChatLayoutCompRef, IProps>(ChatLayoutComp);
