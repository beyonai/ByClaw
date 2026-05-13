import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { last, size, noop, isEmpty } from 'lodash';
import { Button, notification } from 'antd';
import classnames from 'classnames';
import { FundOutlined } from '@ant-design/icons';

import useGlobal from '@/hooks/useGlobal';
import useChat, { ISendProps } from '@/hooks/useChat';
import useEventEmitterHooks from '@/components/ChatLayoutComp/hooks/useEventEmitterHooks';

import { getResponseAgentInfo } from '@/components/MessageList/utils';

import EmployeeDrawer from './EmployeeDrawer';
import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';
import QueryInput from '@/components/QueryInput';
import Header from './Header';
import MessageList from './MessageList';
import MultiChoices from '@/components/ChatLayoutComp/components/MultiChoices';

import { agentTypeMap } from '@/constants/agent';
import { IMessageState } from '@/constants/message';

import webSocketManager from '@/utils/websocket';

import type { ISession } from '@/typescript/session';
import type { IAgentType } from '@/typescript/agent';
import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';

import styles from './index.module.less';

interface MessageListRefType {
  toBottom: () => void;
}

export default function Mobile(props: { hideHeader?: boolean }) {
  const { hideHeader } = props;
  const intl = useIntl();

  const [notificationMessage, contextHolder] = notification.useNotification({
    placement: 'topRight',
  });

  const [myAgentType, setMyAgentType] = useState<IAgentType>(agentTypeMap.common);
  const [employeeDrawerOpen, setEmployeeDrawerOpen] = useState<boolean>(false);

  const { EventEmitter, setAgentId, agentId, sessionId } = useGlobal();

  const prevAgentId = useRef(agentId);

  // 修改ref类型为MessageListRefType
  const messageListCompRef = useRef<MessageListRefType>(null);

  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const { sessionList } = useSelector((state: any) => state.session);
  const { userInfo } = useSelector(({ user }: any) => user);

  const dispatch = useDispatch();

  const addSession = useCallback(
    (newSession: ISession) => {
      dispatch({
        type: 'session/addSession',
        payload: newSession,
      });
    },
    [dispatch]
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

  const onBeforeSend = useCallback((param = {}) => {
    return EventEmitter.invoke('beyond-chat-beforesend-hook', param);
  }, []);

  const currentSession = useMemo(() => {
    const target = [...sessionList].find((item: any) => `${item.sessionId}` === `${sessionId}`);

    return target;
  }, [sessionId, sessionList]);

  const onReceivedChatMessages = useCallback(
    (metadata?: string) => {
      const agentInfo = getResponseAgentInfo({ agentList, employeesList }, metadata);
      if (agentInfo) {
        setAgentId?.(agentInfo.agentId);
        setMyAgentType(agentInfo.agentType);
      }
    },
    [agentList, employeesList]
  );

  const { sendQuery, messageList, hasMore, getMessageList, onNext, updateMessage, deleteMessage } = useChat({
    sessionId,
    agentType: myAgentType,
    addSession,
    onBeforeSend,
  });
  const lastMsg = last(messageList);

  const onCancel = useCallback(() => {
    if ([IMessageState.Query, IMessageState.Answer].includes(lastMsg?.messageState as IMessageState)) {
      lastMsg?.cancelSSE?.();
    }
  }, [lastMsg?.cancelSSE, lastMsg?.messageState]);

  const { disabledInput, multiChoicesList, setMultiChoicesList, multiChoicesMsgId, setMultiChoicesMsgId } =
    useEventEmitterHooks({
      messageList,
      updateMessage,
      openDrawerSourceFromInfo: noop,
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
        Object.assign(param, { payload: { ...param.payload } });
      }
      try {
        const res = await sendQuery(param);
        if (res) {
          requestIdleCallback(() => {
            messageListCompRef.current?.toBottom();
          });
        }
      } catch (e) {
        if (e instanceof Promise) {
          e.finally(() => {
            onSendRef.current?.(param, true);
          });
        }
      }
    },
    [disabledInput, sendQuery]
  );

  onSendRef.current = onSend;

  useEffect(() => {
    const onNotificationChange = (hasNotification: boolean) => {
      dispatch({
        type: 'session/updateUnreadInfo',
        payload: {
          totalUnread: Number(!!hasNotification),
        },
      });
    };

    const handleNewSession = (session: any) => {
      if (`${userInfo.userId}` !== `${session.creatorId}`) {
        return;
      }
      // 调用addSession action，该action会自动处理会话的添加或更新
      dispatch({
        type: 'session/addNotificationSession',
        payload: session,
      });
    };

    if (userInfo) {
      // 设置红点状态变化回调
      webSocketManager.setOnNotificationChange(onNotificationChange);
      webSocketManager.setOnAddNotificationSessionCb(handleNewSession);

      // 初始化 WebSocket 连接
      webSocketManager.init();
    }

    return () => {
      // 清理 WebSocket 连接
      webSocketManager.setOnNotificationChange(noop);
      webSocketManager.setOnAddNotificationSessionCb(noop);
      webSocketManager.disconnect();
    };
  }, [userInfo]);

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
            {!hideHeader && <Header />}
            <div className={classnames(styles.messageList, 'ub-f1 overflow-hidden')}>
              <MessageList
                ref={messageListCompRef}
                onNext={onNext}
                hasMore={hasMore}
                sessionId={sessionId}
                messageList={messageList}
                updateMessage={updateMessage}
                deleteMessage={deleteMessage}
                isMultiChoices={isMultiChoices}
                multiChoicesMsgId={multiChoicesMsgId}
                setMultiChoicesMsgId={setMultiChoicesMsgId}
              />
            </div>
            <div
              className={classnames(styles.queryInputWrapper, {
                [styles.messageListDisappear]: isMultiChoices,
              })}
              id="queryInputWrapper"
            >
              <div className="ub ub-ac gap12" style={{ marginBottom: '10px' }}>
                <Button icon={<FundOutlined />} className={styles.btn} onClick={() => setEmployeeDrawerOpen(true)}>
                  市场
                </Button>
              </div>
              <div
                className={classnames(styles.queryInput, {
                  [styles.queryInputDisabled]: disabledInput,
                })}
              >
                <QueryInput
                  messageState={lastMsg?.messageState}
                  onSend={onSend}
                  onCancel={onCancel}
                  myAgentType={myAgentType}
                  setMyAgentType={setMyAgentType}
                  isBottom
                  cannotAt={false}
                  sessionId={sessionId}
                />
              </div>
            </div>
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
            {!isMultiChoices && (
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
      </div>
      <EmployeeDrawer open={employeeDrawerOpen} onClose={() => setEmployeeDrawerOpen(false)} />
      {contextHolder}
    </ChatLayoutCompContext.Provider>
  );
}
