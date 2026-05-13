/**
 * useMessage.ts
 *
 * 自定义Hook，用于管理聊天会话的消息列表
 * 提供消息的增删改查功能，支持会话切换和消息状态同步
 * 与useMessageStore集成，实现消息的持久化存储
 */
import { delMessage } from '@/service/message';
import { useDispatch, useSelector } from '@umijs/max';
import { assign, merge, pullAllBy, size } from 'lodash';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { IMessageInfo } from '@/models/useMessageStore';
import type { IMessage } from '@/typescript/message';
import { getMsgId } from '@/utils/messgae';
import useGlobal from '../useGlobal';
import { getSessionObjectTypeMap } from '@/utils/session';

// 记录当前会话ID的引用，用于跟踪会话变化
const curSessionId = {
  current: '',
};

/**
 * 消息管理Hook
 * @param {object} params - 参数对象
 * @param {string} [params.sessionId] - 会话ID，用于标识当前会话
 * @returns {object} 消息管理相关方法和状态
 */
export default function useMessage({ sessionId }: { sessionId?: string }) {
  // 消息列表状态
  const [messageList, setMessageList] = useState<IMessage[]>([]);
  // 是否有更多消息（分页加载相关）
  const [hasMore, setHasMore] = useState(true);

  const dispatch = useDispatch();
  const { sessionListMap } = useSelector((state: any) => state.messageStore);
  const { EventEmitter } = useGlobal();

  const messageListRef = useRef(messageList);

  /**
   * 更新消息方法
   * 如果消息已存在（通过msgId匹配），则合并更新；否则添加为新消息
   * @param {IMessage} msg - 要更新或添加的消息对象
   */
  const updateMessage = useCallback(
    (msg: IMessage, opt: { isAssign?: boolean } = {}) => {
      const { isAssign = false } = opt;

      let newMessage = msg;

      if (msg.sessionId && `${msg.sessionId}` !== `${curSessionId.current}`) {
        const cacheList = sessionListMap.get(msg.sessionId);

        if (!cacheList) {
          return newMessage;
        }

        const { list } = cacheList || { list: [] };

        const targetMsg = list.find(({ msgId } : { msgId: string }) => msgId === msg.msgId);

        if (targetMsg) {
          if (isAssign) {
            newMessage = assign(targetMsg, msg);
          } else {
            newMessage = merge(targetMsg, msg);
          }
        } else {
          list.push(newMessage);
        }

        dispatch({
          type: 'messageStore/updateSessionMessageList',
          payload: {
            sessionId: msg.sessionId,
            messageList: [...list],
          },
        });

        return newMessage;
      }

      setMessageList((prevList) => {
        const targetMsg = prevList.find(({ msgId }) => msgId === msg.msgId);
        if (targetMsg) {
          if (isAssign) {
            newMessage = assign(targetMsg, msg);
          } else {
            newMessage = merge(targetMsg, msg);
          }
          targetMsg.updateKey = getMsgId();
          return [...prevList];
        }

        return [...prevList, msg];
      });

      return newMessage;
    },
    [sessionListMap, dispatch]
  );

  /**
   * 删除消息方法
   * 根据消息ID从列表中移除指定消息
   * @param {IMessage} msg - 要删除的消息对象
   */
  const deleteMessage = useCallback((msg: IMessage) => {
    setMessageList((prevList) => {
      return [...pullAllBy(prevList, [msg], 'msgId')];
    });
    if (msg.messageId) {
      delMessage({ messageId: msg.messageId });
    }
  }, []);

  /**
   * 设置会话ID方法
   * 切换到新的会话前，保存当前会话的消息列表
   * @param {string} newSessionId - 新的会话ID
   */
  const setSessionId = useCallback((newSessionId: string) => {
    if (!curSessionId.current) {
      // 保存当前消息列表到存储
      dispatch({
        type: 'messageStore/updateSessionMessageList',
        payload: {
          sessionId: newSessionId,
          messageList: [...messageListRef.current],
        },
      });

      // todo： 临时代码，待优化
      dispatch({
        type: 'chatBI/clearTempFileList',
        payload: {
          sessionId: newSessionId,
        },
      });
    }

    // 更新当前会话ID
    curSessionId.current = newSessionId;
  }, []);

  // isPrev ==== 是否翻上一页（pageNum减少）
  const getMoreSessionMessage = useCallback(
    (sessionId: string, isPrev?: boolean) => {
      return dispatch({
        type: 'messageStore/getMoreSessionMessage',
        payload: {
          isPrev,
          sessionId,
        },
      }).then((listInfo?: IMessageInfo & { hasMore: boolean }) => {
        if (!listInfo) {
          return;
        }
        const { list } = listInfo;

        setMessageList(list || []);
        if (!isPrev) {
          // 其实只有向上翻页（pageNum增加）的时候，hasMore才有意义。
          // 如果是向下翻页（pageNum减少）的话，hasMore相当于判断当前pageNum是否大于1，因此这种方向的滚动不需要更新hasMore
          // 总结：hasMore只针对pageNum增加的滚动才有意义
          setHasMore(listInfo.hasMore);
        }
      });
    },
    [dispatch]
  );

  const reloadLatestMessageList = useCallback(() => {
    return new Promise<void>((resolve) => {
      setMessageList([]);
      dispatch({
        type: 'messageStore/getLatestSessionMessage',
        payload: {
          sessionId: curSessionId.current,
        },
      }).then((listInfo?: IMessageInfo) => {
        if (!listInfo) return;
        const { list, pageSize } = listInfo || {};
        setMessageList(list || []);
        setHasMore(size(list) >= pageSize);
        // 再套一个requestIdleCallback，等待视图更新后，再resolve
        requestIdleCallback(() => resolve());
      });
    });
  }, []);

  /**
   * 会话ID变化时的副作用
   * 当会话ID变化时，加载对应会话的消息列表
   */
  useEffect(() => {
    curSessionId.current = sessionId || '';
    setHasMore(false);
    setMessageList([]);

    if (!sessionId) {
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
      const { list, pageSize, targetMessageId } = listInfo || {};

      setMessageList(list || []);
      // 不要用total和list的长度来判断hasMore，因为如果请求的是中间页数，list的长度就会比total小
      setHasMore(size(list) >= pageSize);

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
  }, [sessionId]);

  /**
   * 消息列表变化时的副作用
   * 当消息列表变化时，将其同步到存储中
   */
  useEffect(() => {
    messageListRef.current = messageList;
    if (curSessionId.current) {
      dispatch({
        type: 'messageStore/updateSessionMessageList',
        payload: {
          sessionId: curSessionId.current,
          messageList: [...messageList],
        },
      });
      dispatch({
        type: 'session/updateSessionContent',
        payload: {
          sessionId: curSessionId.current,
          messageList: [...messageList],
        },
      });
    }
  }, [messageList, dispatch]);

  useEffect(() => {
    const onCleanSessionMessage = (mySessionId: string) => {
      if (`${mySessionId}` === `${curSessionId.current}`) {
        setMessageList([]);

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
  }, []);

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
