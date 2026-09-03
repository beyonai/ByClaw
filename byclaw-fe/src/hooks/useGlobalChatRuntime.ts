import { useEffect } from 'react';
import { isEqual } from 'lodash';
import { useDispatch, useSelector } from '@umijs/max';

import { subscribeChatStream } from '@/hooks/useSseSender/chatStream';
import {
  clearChatRuntime,
  handleChatStreamError,
  handleParsedChatStream,
  handleSessionRuntimeState,
  handleTaskPlanSnapshot,
} from '@/hooks/useChat/chatRuntime';
import webSocketManager from '@/utils/websocket';
import type { SessionRuntimeState } from '@/utils/chatSessionRuntimeManager';

import type { ISession } from '@/typescript/session';
import type { TaskPlanSnapshot } from '@/typescript/message';

type State = {
  user: {
    userInfo?: {
      userId?: string | number;
    };
  };
};

type INotificationMessage = { session?: ISession; data?: { session?: ISession } };

let lastNotificationInfo: INotificationMessage | null = null;
export default function useGlobalChatRuntime() {
  const dispatch = useDispatch();
  const userInfo = useSelector((state: State) => state.user.userInfo);

  const userId = userInfo?.userId;

  useEffect(() => {
    if (!userId) {
      webSocketManager.disconnect();
      clearChatRuntime();
      return;
    }

    webSocketManager.init();

    return () => {
      webSocketManager.disconnect();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const unsubscribeChatStream = subscribeChatStream({
      match: () => true,
      onPayload: handleParsedChatStream,
    });

    const handleNotification = (message: INotificationMessage) => {
      const isSame = isEqual(lastNotificationInfo, message); // 幂等校验
      if (isSame) {
        return;
      }
      lastNotificationInfo = message;

      const session = message.session || message.data?.session;
      if (!session || `${userId}` !== `${session.creatorId}` || isSame) {
        return;
      }

      dispatch({
        type: 'session/updateUnreadInfo',
        payload: {
          totalUnread: 1,
        },
      });
      dispatch({
        type: 'session/addNotificationSession',
        payload: session,
      });
    };

    const handleTaskPlan = (message: { data?: TaskPlanSnapshot; sessionId?: string; messageId?: string }) => {
      const taskPlan = message.data;
      if (!taskPlan?.planId || !taskPlan?.sessionId) return;

      // 实时上下文优先更新当前回答消息；store reducer 同时覆盖已缓存会话并处理页面切换场景。
      handleTaskPlanSnapshot(message);
      dispatch({
        type: 'messageStore/applyTaskPlanSnapshot',
        payload: {
          sessionId: `${taskPlan.sessionId || message.sessionId || ''}`,
          messageId: `${taskPlan.messageId || message.messageId || ''}`,
          taskPlan,
        },
      });
    };

    const handleSessionRuntime = (message: {
      data?: SessionRuntimeState | string;
      sessionId?: string;
      traceId?: string;
    }) => {
      try {
        const payload = typeof message.data === 'string' ? JSON.parse(message.data) : message.data;
        if (!payload) return;
        handleSessionRuntimeState({
          ...payload,
          sessionId: `${payload.sessionId || message.sessionId || ''}`,
          traceId: `${payload.traceId || message.traceId || ''}`,
        });
      } catch (error) {
        console.warn('Ignored invalid session runtime message', error);
      }
    };

    webSocketManager.onMessage('ERROR', handleChatStreamError);
    webSocketManager.onMessage('NOTIFICATION', handleNotification);
    webSocketManager.onMessage('TASK_PLAN_SNAPSHOT', handleTaskPlan);
    webSocketManager.onMessage('SESSION_RUNTIME_STATUS', handleSessionRuntime);

    return () => {
      unsubscribeChatStream();
      webSocketManager.offMessage('ERROR', handleChatStreamError);
      webSocketManager.offMessage('NOTIFICATION', handleNotification);
      webSocketManager.offMessage('TASK_PLAN_SNAPSHOT', handleTaskPlan);
      webSocketManager.offMessage('SESSION_RUNTIME_STATUS', handleSessionRuntime);
    };
  }, [dispatch, userId]);
}
