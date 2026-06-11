/**
 * useMessage.ts
 *
 * 自定义Hook，用于管理聊天会话的消息列表
 * 提供消息的增删改查功能，支持会话切换和消息状态同步
 * 与useMessageStore集成，实现消息的持久化存储
 */
import { delMessage } from '@/service/message';
import { useDispatch, useSelector } from '@umijs/max';
import { assign, merge, size } from 'lodash';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SetStateAction } from 'react';

import type { IMessageInfo } from '@/models/useMessageStore';
import type { IMessage } from '@/typescript/message';
import { getMsgId } from '@/utils/messgae';
import { getSessionObjectTypeMap } from '@/utils/session';
import useGlobal from '../useGlobal';

// 记录当前会话ID的引用，用于跟踪会话变化
const curSessionId = {
  current: '',
};

export const DRAFT_SESSION_ID = '__message_store_draft_session__';
export const EMPTY_ARRAY = [];

/**
 * 消息管理Hook
 * @param {object} params - 参数对象
 * @param {string} [params.sessionId] - 会话ID，用于标识当前会话
 * @returns {object} 消息管理相关方法和状态
 */
export default function useMessage({ sessionId }: { sessionId?: string }) {
  const dispatch = useDispatch();
  const { sessionListMap } = useSelector((state: any) => state.messageStore);
  const { EventEmitter } = useGlobal();

  const [optimisticSessionId, setOptimisticSessionId] = useState('');
  const pendingDraftCleanupRef = useRef(false);

  const activeSessionId = String(sessionId || optimisticSessionId || DRAFT_SESSION_ID);
  const messageInfo = sessionListMap.get(activeSessionId) as (IMessageInfo & { hasMore?: boolean }) | undefined;
  const messageList = useMemo(() => messageInfo?.list || EMPTY_ARRAY, [messageInfo]);
  const hasMore = useMemo(() => {
    if (!messageInfo?.list) return false;
    if (typeof messageInfo.hasMore === 'boolean') return messageInfo.hasMore;
    return size(messageInfo.list) >= messageInfo.pageSize;
  }, [messageInfo]);

  const messageListRef = useRef<IMessage[]>(messageList);

  const getTargetSessionId = useCallback(
    (msg?: Partial<IMessage>) => `${msg?.sessionId || curSessionId.current || activeSessionId}`,
    [activeSessionId]
  );

  /**
   * 更新消息方法
   * 如果消息已存在（通过messageId或msgId匹配），则合并更新；否则添加为新消息
   * @param {IMessage} msg - 要更新或添加的消息对象
   */
  const updateMessage = useCallback(
    (msg: IMessage, opt: { isAssign?: boolean; allowCreateSession?: boolean } = {}) => {
      const { isAssign = false } = opt;
      const targetSessionId = getTargetSessionId(msg);
      if (!targetSessionId) return msg;

      let newMessage = msg;

      dispatch({
        type: 'messageStore/updateSessionMessageList',
        payload: {
          sessionId: targetSessionId,
          allowCreateSession: opt.allowCreateSession ?? targetSessionId === DRAFT_SESSION_ID,
          // callback的形式，拿到reducer里面最新的messageList，以防连续调用updateMessage时，后者覆盖前者
          messageList: (messageList: IMessage[]) => {
            let list = [...(messageList || [])];

            const targetIndex = list.findIndex(({ msgId, messageId }: IMessage) => {
              if (messageId && msg.messageId) {
                return `${messageId}` === `${msg.messageId}`;
              }
              return `${msgId}` === `${msg.msgId}`;
            });

            if (targetIndex > -1) {
              const targetMsg = list[targetIndex];
              if (isAssign) {
                newMessage = assign({}, targetMsg, msg);
              } else {
                newMessage = merge({}, targetMsg, msg);
              }
              newMessage.updateKey = getMsgId();
              list[targetIndex] = newMessage;
            } else {
              list = [...list, newMessage];
            }

            if (`${targetSessionId}` === `${curSessionId.current}` || `${targetSessionId}` === `${activeSessionId}`) {
              messageListRef.current = list;
            }

            return list;
          },
        },
      });

      return newMessage;
    },
    [activeSessionId, dispatch, getTargetSessionId]
  );

  const setMessageList = useCallback(
    (value: SetStateAction<IMessage[]>) => {
      const nextList = typeof value === 'function' ? value(messageListRef.current) : value;
      messageListRef.current = nextList;
      dispatch({
        type: 'messageStore/updateSessionMessageList',
        payload: {
          sessionId: curSessionId.current || activeSessionId,
          messageList: [...nextList],
        },
      });
    },
    [activeSessionId, dispatch]
  );

  /**
   * 删除消息方法
   * 根据消息ID从列表中移除指定消息
   * @param {IMessage} msg - 要删除的消息对象
   */
  const deleteMessage = useCallback(
    (msg: IMessage) => {
      const targetSessionId = getTargetSessionId(msg);
      const cache = sessionListMap.get(targetSessionId);
      const list: IMessage[] = cache?.list || messageListRef.current;
      const nextList = list.filter((item) => `${item.msgId}` !== `${msg.msgId}`);
      if (targetSessionId === curSessionId.current || targetSessionId === activeSessionId) {
        messageListRef.current = nextList;
      }

      dispatch({
        type: 'messageStore/updateSessionMessageList',
        payload: {
          sessionId: targetSessionId,
          messageList: nextList,
        },
      });

      if (msg.messageId) {
        delMessage({ messageId: msg.messageId });
      }
    },
    [dispatch, getTargetSessionId, sessionListMap]
  );

  /**
   * 设置会话ID方法
   * 切换到新的会话前，保存当前草稿会话消息列表
   * @param {string} newSessionId - 新的会话ID
   */
  const setSessionId = useCallback(
    (newSessionId: string) => {
      if (!curSessionId.current || curSessionId.current === DRAFT_SESSION_ID) {
        dispatch({
          type: 'messageStore/copyFromSession',
          payload: {
            fromSessionId: curSessionId.current || DRAFT_SESSION_ID,
            targetSessionId: newSessionId,
          },
        });

        if (curSessionId.current === DRAFT_SESSION_ID) {
          pendingDraftCleanupRef.current = true;
          setOptimisticSessionId(newSessionId);
        }

        // todo： 临时代码，待优化
        dispatch({
          type: 'chatBI/clearTempFileList',
          payload: {
            sessionId: newSessionId,
          },
        });
      }

      curSessionId.current = newSessionId;
    },
    [dispatch]
  );

  // isPrev ==== 是否翻上一页（pageNum减少）
  const getMoreSessionMessage = useCallback(
    (targetSessionId: string, isPrev?: boolean) => {
      return dispatch({
        type: 'messageStore/getMoreSessionMessage',
        payload: {
          isPrev,
          sessionId: targetSessionId,
        },
      });
    },
    [dispatch]
  );

  const reloadLatestMessageList = useCallback(() => {
    return new Promise<void>((resolve) => {
      dispatch({
        type: 'messageStore/getLatestSessionMessage',
        payload: {
          sessionId: curSessionId.current,
        },
      }).then((listInfo?: IMessageInfo) => {
        if (!listInfo) return;
        // 再套一个requestIdleCallback，等待视图更新后，再resolve
        requestIdleCallback(() => resolve());
      });
    });
  }, [dispatch]);

  useEffect(() => {
    curSessionId.current = activeSessionId;
  }, [activeSessionId]);

  /**
   * 会话ID变化时的副作用
   * 当会话ID变化时，加载对应会话的消息列表
   */
  useEffect(() => {
    if (!sessionId) {
      if (!optimisticSessionId) {
        dispatch({
          type: 'messageStore/updateSessionMessageList',
          payload: {
            sessionId: DRAFT_SESSION_ID,
            messageList: [],
          },
        });
      }
      return;
    }

    const { objectType = '' } = getSessionObjectTypeMap(sessionId) || {};
    if (objectType?.toLowerCase() === 'openclaw') {
      // openclaw 的会话消息，不需要查询接口，直接从websocket中获取
      return;
    }

    // 从存储中获取会话消息并更新状态
    dispatch({
      type: 'messageStore/getSessionMessage',
      payload: {
        sessionId,
      },
    }).then((listInfo: IMessageInfo) => {
      // 只接受最新的session的数据
      if (`${sessionId}` !== `${curSessionId.current}`) return;
      const { list, targetMessageId } = listInfo || {};

      dispatch({
        type: 'session/myBatchReadMessages',
        payload: {
          sessionId,
          messageIds: (list || []).map((item) => item.messageId),
        },
      });

      if (list?.length) {
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const msg = list[i];
          if (msg.fromBeyond) {
            // 在这里写是因为，只需要每次切换会话查询聊天记录后，找到最后一条fromBeyond的记录
            EventEmitter.emit('RECEIVE_SESSION_RECORDS_LAST_METADATA', msg.metadata);
            break;
          }
        }
      }

      EventEmitter.emit('scrollToMsgOnSessionChanged', {
        sessionId,
        targetMessageId,
      });
    });
  }, [optimisticSessionId, sessionId, dispatch, EventEmitter]);

  useEffect(() => {
    if (!sessionId) return;
    setOptimisticSessionId('');
  }, [sessionId]);

  useEffect(() => {
    if (!pendingDraftCleanupRef.current || activeSessionId === DRAFT_SESSION_ID) return;

    pendingDraftCleanupRef.current = false;
    dispatch({
      type: 'messageStore/cleanSessionMessage',
      payload: {
        sessionId: DRAFT_SESSION_ID,
      },
    });
  }, [activeSessionId, dispatch]);

  /**
   * 消息列表变化时的副作用
   * 当前 hook 只订阅 store 中的会话消息，同时把当前会话概要同步给 session model
   */
  useEffect(() => {
    messageListRef.current = messageList;
    if (sessionId) {
      dispatch({
        type: 'session/updateSessionContent',
        payload: {
          sessionId,
          messageList: [...messageList],
        },
      });
    }
  }, [messageList, dispatch, sessionId]);

  useEffect(() => {
    const onCleanSessionMessage = (mySessionId: string) => {
      if (`${mySessionId}` === `${curSessionId.current}`) {
        dispatch({
          type: 'messageStore/cleanSessionMessage',
          payload: {
            sessionId: mySessionId,
          },
        });
      }
    };

    EventEmitter.on('on-clean-session-message', onCleanSessionMessage);
    return () => {
      EventEmitter.off('on-clean-session-message', onCleanSessionMessage);
    };
  }, [dispatch, EventEmitter]);

  // 返回消息管理相关的状态和方法
  return {
    messageList, // 当前会话的消息列表
    setMessageList, // 直接设置消息列表的方法
    hasMore, // 是否有更多消息（用于分页）

    setSessionId, // 设置/切换会话ID的方法

    deleteMessage, // 删除单条消息的方法
    getMoreSessionMessage,
    reloadLatestMessageList,
    updateMessage, // 更新单条消息的方法
  };
}
