import React, { useCallback, useEffect, useRef, useState, useMemo, ForwardedRef } from 'react';
import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { last, noop, size } from 'lodash';
import classnames from 'classnames';

import QueryInput from '@/components/QueryInput';

import ReferenceSource from '@/components/ReferenceSource';
import ChatTitle from './components/ChatTitle';
import MessageList from './components/MessageList';
import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';

import useGlobal from '@/hooks/useGlobal';
import useChat, { ISendProps } from '@/hooks/useChat';
import useEventEmitterHooks from '@/components/ChatLayoutComp/hooks/useEventEmitterHooks';

import type { IAgentType } from '@/typescript/agent';
import type { IMessage, IResourceFromItem } from '@/typescript/message';
import type { ISession } from '@/typescript/session';

import { IMessageState } from '@/constants/message';

import styles from './index.module.less';

type IProps = {
  sessionId: string;
  agentType: IAgentType;

  isBottom: boolean;
  setIsBottom?: React.Dispatch<React.SetStateAction<boolean>>;
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
  const dispatch = useDispatch();

  const { setIsBottom, isBottom } = props;
  const { sessionId } = props;

  const [myAgentType] = useState<IAgentType>(props.agentType);

  const { EventEmitter } = useGlobal();

  /** 对话的额外参数 */
  const tempParamsRef = useRef({});

  // 修改ref类型为MessageListRefType
  const messageListCompRef = useRef<MessageListRefType>(null);

  const { sessionList } = useSelector((state: any) => state.session);

  const currentSession = useMemo(() => {
    const target = [...sessionList].find((item: any) => `${item.sessionId}` === `${sessionId}`);

    return target;
  }, [sessionId, sessionList]);

  const addSession = useCallback(
    (newSession: ISession) => {
      dispatch({
        type: 'session/addSession',
        payload: newSession,
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

  const { sendQuery, messageList, hasMore, getMessageList, setMessageList, onNext, updateMessage, deleteMessage } =
    useChat({
      sessionId,
      agentType: myAgentType,
      addSession,
      onBeforeSend,
    });
  const lastMsg = last(messageList);

  const onSend = useCallback(
    async (param: ISendProps, isRetry?: boolean) => {
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
        console.error(e);
      }
    },
    [sendQuery, setIsBottom]
  );

  const onCancel = useCallback(() => {
    if ([IMessageState.Query, IMessageState.Answer].includes(lastMsg?.messageState as IMessageState)) {
      lastMsg?.cancelSSE?.();
    }
  }, [lastMsg?.cancelSSE, lastMsg?.messageState]);

  useEventEmitterHooks({
    sendQuery,
    updateMessage,
    deleteMessage,
    messageList,
    openDrawerSourceFromInfo,
    setMyAgentType: noop,
    cancelSSE: onCancel,
  });

  useEffect(() => {
    setIsBottom?.((prev) => {
      return prev || !!lastMsg || !!sessionId;
    });
  }, [lastMsg, sessionId]);

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
            {isBottom && <ChatTitle sessionId={sessionId} currentSession={currentSession} />}
            {isBottom && (
              <div className={classnames(styles.messageList, 'ub-f1 overflow-hidden')}>
                <MessageList
                  ref={messageListCompRef}
                  onNext={onNext}
                  hasMore={hasMore}
                  sessionId={sessionId}
                  messageList={messageList}
                  updateMessage={updateMessage}
                  deleteMessage={deleteMessage}
                />
              </div>
            )}
            <div className={classnames(styles.queryInputWrapper)} id="queryInputWrapper">
              <div className={classnames(styles.queryInput)} data-isbottom={isBottom}>
                <QueryInput
                  messageState={lastMsg?.messageState}
                  onSend={onSend}
                  onCancel={onCancel}
                  myAgentType={myAgentType}
                  isBottom={isBottom}
                  cannotAt
                  sessionId={sessionId}
                />
              </div>
            </div>
            {isBottom && (
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
    </ChatLayoutCompContext.Provider>
  );
}

export default React.forwardRef<IChatLayoutCompRef, IProps>(ChatLayoutComp);
