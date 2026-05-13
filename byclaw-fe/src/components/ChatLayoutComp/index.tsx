import React, { useCallback, useEffect, useRef, useState, useMemo, ForwardedRef } from 'react';
import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { isEmpty, last, size } from 'lodash';
import { notification } from 'antd';

import MessageList from '@/components/MessageList';
import QueryInput from '@/components/QueryInput';
import ReferenceSource from '@/components/ReferenceSource';
import ForwardMessages from './components/ForwardMessages';

import ChatLayoutCompContext from './hooks/useContext';

import { agentTypeMap } from '@/constants/agent';
import { Platform } from '@/layout/components/provider/global';

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

import type { IState as UseEmployeesIState } from '@/models/useEmployees.ts';

import styles from './index.module.less';
import { getResponseAgentInfo } from '../MessageList/utils';

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
  } = props;
  const { isBottom, setIsBottom } = props;
  const { sessionId, queryInputProps = {}, readOnly } = props;
  const { cannotAt = !sessionId && !isRootPage() } = props;

  const [notificationMessage, contextHolder] = notification.useNotification({
    placement: 'bottomRight',
  });

  const [myAgentType, setMyAgentType] = useState<IAgentType>(agentType);
  const [sessionSelectOpen, setSessionSelectOpen] = useState<boolean>(false);

  const { EventEmitter, setAgentId, platform, agentId, uploadFileConfig } = useGlobal();
  const isPC = platform === Platform.pc;

  /** 对话的额外参数 */
  const tempParamsRef = useRef(sendExtraParams);
  tempParamsRef.current = sendExtraParams;

  const prevAgentId = useRef(agentId);

  // 修改ref类型为MessageListRefType
  const messageListCompRef = useRef<MessageListRefType>(null);

  const { agentList, employeesList } = useSelector(({ employees }: { employees: UseEmployeesIState }) => employees);
  const { sessionList } = useSelector((state: any) => state.session);

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

  const openDrawerSourceFromInfo = useCallback((infoList: IResourceFromItem[]) => {
    EventEmitter.emit('beyond-main-driver-open-type', {
      width: '25vw',
      title: intl.formatMessage({ id: 'sourceDrawer.title' }),
      canClose: true,
      drawerType: <ReferenceSource drawerSourceFromInfo={infoList} />,
    });
  }, []);

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

  const { sendQuery, messageList, hasMore, getMessageList, setMessageList, onNext, updateMessage, deleteMessage } =
    useChat({
      chatUrl,
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
                {/* {isBottom && TopButtons} */}
                <div
                  className={classnames(styles.queryInput, {
                    [styles.queryInputDisabled]: disabledInput,
                  })}
                  data-isbottom={isBottom}
                >
                  <QueryInput
                    messageState={lastMsg?.messageState}
                    onSend={onSend}
                    onCancel={onCancel}
                    myAgentType={myAgentType}
                    setMyAgentType={setMyAgentType}
                    isBottom={isBottom}
                    cannotAt={cannotAt}
                    sessionId={sessionId}
                    uploadFileConfig={uploadFileConfig}
                    {...queryInputProps}
                  />
                </div>
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
