import React, { useCallback, useEffect, useRef, useState, useMemo, ForwardedRef } from 'react';
import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { isEmpty, last, size } from 'lodash';
import { notification } from 'antd';

import MessageList from '@/components/MessageList';

import ReferenceSource from '@/components/ReferenceSource';
import ForwardMessages from './components/ForwardMessages';

import ChatLayoutCompContext from './hooks/useContext';

import { agentTypeMap } from '@/constants/agent';
import { Platform } from '@/layout/components/provider/global';
import useAppStore from '@/models/common/useAppStore';

import useChat, { ISendProps } from '@/hooks/useChat';
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

import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';

import styles from './index.module.less';
import { getResponseAgentInfo, isMultiAgentResponsePayload, type ResponseMetadataPayload } from '../MessageList/utils';
import ChatResourceWorkspace from './ChatResourceWorkspace';
import {
  DEFAULT_SIDER_CONTENT_WIDTH,
  HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH,
  SiderContentContext,
  type DetailPanelOptions,
} from '@/layout/sider/siderContentContext';
import { closeChatResourceTab, upsertChatResourceTab, type ChatResourceTab } from './ChatResourceWorkspace/tabState';

type IProps = {
  sessionId: string;
  getContainer?: () => HTMLElement | null;

  agentType?: IAgentType;
  setAgentType?: React.Dispatch<React.SetStateAction<IAgentType>>;

  isBottom: boolean;
  setIsBottom?: React.Dispatch<React.SetStateAction<boolean>>;

  queryInputProps?: Record<string, unknown>;

  /** 自定义聊天地址 */
  chatUrl?: string;
  cannotAt?: boolean;
  readOnly?: boolean;
  hideAction?: boolean;
  hideChatTitle?: boolean;
  sendExtraParams?: Record<string, unknown>;
  projectId?: number;
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
    projectId,
  } = props;
  const { isBottom, setIsBottom } = props;
  const { sessionId, queryInputProps = {}, readOnly } = props;
  const { cannotAt = !sessionId && !isRootPage() } = props;

  const [notificationMessage, contextHolder] = notification.useNotification({
    placement: 'bottomRight',
  });

  const [myAgentType, setMyAgentType] = useState<IAgentType>(agentType);
  const [sessionSelectOpen, setSessionSelectOpen] = useState<boolean>(false);
  const [resourceListOpen, setResourceListOpen] = useState(false);
  const [resourceTabs, setResourceTabs] = useState<ChatResourceTab[]>([]);
  const [activeResourceTabKey, setActiveResourceTabKey] = useState('');

  // 工作区状态只属于当前聊天实例，路由刷新后不恢复详情页签，避免复用失效的 React 节点。
  const resourceTabSequenceRef = useRef(0);
  const previousResourceSessionIdRef = useRef(sessionId);
  const resourceWorkspaceOwnedRef = useRef(false);
  const { setDetailPanel, clearDetailPanel } = React.useContext(SiderContentContext);

  const { EventEmitter, setAgentId, platform, agentId } = useGlobal();
  const isPC = platform === Platform.pc;
  const { getSandboxesInfoUrl } = useAppStore();

  /** 对话的额外参数 */
  const tempParamsRef = useRef(sendExtraParams);
  tempParamsRef.current = sendExtraParams;
  const shouldSkipSessionListCache = Boolean(sendExtraParams?.troubleshootMessageId);

  const prevAgentId = useRef(agentId);

  // 修改ref类型为MessageListRefType
  const messageListCompRef = useRef<MessageListRefType>(null);

  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const { sessionList } = useSelector((state: any) => state.session);

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

  const sessionProjectId = useMemo(() => {
    // 路由状态在刷新或非项目列表入口时可能丢失，优先从当前会话的后端归属字段恢复。
    const candidateProjectId = projectId ?? currentSession?.projectId;
    const normalizedProjectId = Number(candidateProjectId);
    return Number.isFinite(normalizedProjectId) && normalizedProjectId > 0 ? normalizedProjectId : undefined;
  }, [currentSession?.projectId, projectId]);

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

  const resourceWorkspaceVisible = resourceListOpen || resourceTabs.length > 0;

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
        listOpen={resourceListOpen}
        tabs={resourceTabs}
        activeTabKey={activeResourceTabKey}
        onToggleList={toggleResourceList}
        onOpenDetail={openResourceDetailFromResourceList}
        onActiveTabChange={setActiveResourceTabKey}
        onCloseTab={closeResourceTab}
      />,
      {
        width: resourceTabs.length ? HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH : DEFAULT_SIDER_CONTENT_WIDTH,
      }
    );
  }, [
    activeResourceTabKey,
    clearDetailPanel,
    closeResourceTab,
    openResourceDetailFromResourceList,
    resourceListOpen,
    resourceTabs,
    resourceWorkspaceVisible,
    sessionId,
    sessionProjectId,
    setDetailPanel,
    toggleResourceList,
  ]);

  useEffect(() => {
    // 会话切换时关闭旧详情，但保留资源入口，方便在新会话中继续查看对应范围。
    const previousSessionId = previousResourceSessionIdRef.current;
    previousResourceSessionIdRef.current = sessionId;
    if (`${previousSessionId}` === `${sessionId}`) return;

    const workspaceWasOpen = resourceListOpen || resourceTabs.length > 0;
    setResourceTabs([]);
    setActiveResourceTabKey('');
    if (workspaceWasOpen) setResourceListOpen(true);
  }, [sessionId]);

  useEffect(
    () => () => {
      if (resourceWorkspaceOwnedRef.current) clearDetailPanel?.();
    },
    [clearDetailPanel]
  );

  const onReceivedChatMessages = useCallback(
    (payload?: ResponseMetadataPayload) => {
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
        setAgentId?.(agentInfo.agentId);
        setMyAgentType(agentInfo.agentType);
      }
    },
    [agentList, employeesList, sessionId]
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
    cancelCurrentSession,
  } = useChat({
    chatUrl,
    sessionId,
    agentType: myAgentType,
    addSession,
    onBeforeSend,
  });
  const lastMsg = last(messageList);

  const onCancel = useCallback(() => {
    if (
      isSessionRunning ||
      [IMessageState.Query, IMessageState.Answer].includes(lastMsg?.messageState as IMessageState)
    ) {
      cancelCurrentSession();
    }
  }, [cancelCurrentSession, isSessionRunning, lastMsg?.messageState]);

  const { disabledInput, multiChoicesList, setMultiChoicesList, multiChoicesMsgId, setMultiChoicesMsgId } =
    useEventEmitterHooks({
      messageList,
      updateMessage,
      openDrawerSourceFromInfo,
      sendQuery,
      setMyAgentType,
      deleteMessage,
      cancelSSE: onCancel,
    });
  const isMultiChoices = !isEmpty(multiChoicesList);

  const onSendRef = useRef<(param: ISendProps, isRetry?: boolean) => any>(undefined);

  const onSend = useCallback(
    async (param: ISendProps, isRetry?: boolean) => {
      if (disabledInput) return;
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
    [disabledInput, sendQuery, setIsBottom]
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
    setIsBottom?.((prev) => {
      return prev || !!lastMsg;
    });
  }, [lastMsg]);

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
    if (isSessionRunning) {
      return IMessageState.Answer;
    }
    return lastMsg?.messageState;
  }, [isSessionRunning, lastMsg?.messageState]);

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
                // 按钮底色只反映右侧资源小面板状态，文件预览单独打开时保持无底色。
                resourceWorkspaceOpen={resourceListOpen}
                // 会话标题按钮关闭资源工作区时，需要同时关闭列表和全部多 Tab 预览。
                onToggleResourceWorkspace={toggleResourceWorkspaceFromChatTitle}
              />
            )}
            {isBottom && (
              <div className={classnames(styles.messageList, 'ub-f1 overflow-hidden')}>
                <MessageList
                  ref={messageListCompRef}
                  onNext={onNext}
                  hasMore={hasMore}
                  sessionId={sessionId}
                  hideAction={hideAction}
                  captureRequirementProjectId={sessionProjectId}
                  messageList={messageList}
                  updateMessage={updateMessage}
                  deleteMessage={deleteMessage}
                  multiChoicesList={multiChoicesList}
                  multiChoicesMsgId={multiChoicesMsgId}
                  setMultiChoicesMsgId={setMultiChoicesMsgId}
                />
              </div>
            )}
            {!readOnly && (
              <div
                className={classnames(styles.queryInputWrapper, {
                  [styles.messageListDisappear]: isMultiChoices,
                })}
                id="queryInputWrapper"
              >
                <EasyConfirm
                  messageState={messageState}
                  disabledInput={disabledInput}
                  isBottom={isBottom}
                  cannotAt={cannotAt}
                  queryInputProps={{ ...queryInputProps, projectId: sessionProjectId }}
                  lastMsg={lastMsg}
                  sessionId={sessionId}
                  onSend={onSend}
                  onCancel={onCancel}
                  myAgentType={myAgentType}
                  setMyAgentType={setMyAgentType}
                />
                {/* {isBottom && TopButtons} */}
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
