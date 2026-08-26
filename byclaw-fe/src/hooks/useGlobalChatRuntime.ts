import { useCallback, useEffect, useMemo } from 'react';

import { useDispatch, useSelector } from '@umijs/max';

import { subscribeChatStream } from '@/hooks/useSseSender/chatStream';
import { getChatRunningStatus } from '@/service/message';
import {
  clearChatRuntime,
  handleChatStreamError,
  handleParsedChatStream,
  hydrateRunningSessions,
  handleTaskPlanSnapshot,
} from '@/hooks/useChat/chatRuntime';
import webSocketManager from '@/utils/websocket';

import type { RunningChatInfo } from '@/utils/chatSessionRuntimeManager';
import type { ISession } from '@/typescript/session';
import type { TaskPlanSnapshot } from '@/typescript/message';

type State = {
  user: {
    userInfo?: {
      userId?: string | number;
    };
  };
  session: {
    sessionList: ISession[];
  };
};

export default function useGlobalChatRuntime() {
  const dispatch = useDispatch();
  const { userInfo, sessionList } = useSelector((state: State) => ({
    userInfo: state.user.userInfo,
    sessionList: state.session.sessionList || [],
  }));

  const userId = userInfo?.userId;
  const sessionIds = useMemo(
    () =>
      sessionList
        .map((item) => item.sessionId)
        .filter(Boolean)
        .map((item) => `${item}`)
        .join(','),
    [sessionList]
  );

  const syncRunningStatus = useCallback(async () => {
    if (!userId || !sessionIds.length) {
      return;
    }

    try {
      const list: RunningChatInfo[] = await getChatRunningStatus({ sessionIds: sessionIds.split(',') });
      hydrateRunningSessions(list || []);
    } catch (error) {
      console.error(error);
    }
  }, [sessionIds, userId]);

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

    const handleNotification = (message: { session?: ISession; data?: { session?: ISession } }) => {
      const session = message.session || message.data?.session;
      if (!session || `${userId}` !== `${session.creatorId}`) {
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

    webSocketManager.onMessage('ERROR', handleChatStreamError);
    webSocketManager.onMessage('NOTIFICATION', handleNotification);
    webSocketManager.onMessage('TASK_PLAN_SNAPSHOT', handleTaskPlan);

    return () => {
      unsubscribeChatStream();
      webSocketManager.offMessage('ERROR', handleChatStreamError);
      webSocketManager.offMessage('NOTIFICATION', handleNotification);
      webSocketManager.offMessage('TASK_PLAN_SNAPSHOT', handleTaskPlan);
    };
  }, [dispatch, userId]);

  useEffect(() => {
    syncRunningStatus();
  }, [syncRunningStatus]);

  // useEffect(() => {
  //   if (!userId) {
  //     return;
  //   }

  //   const handleVisibilityChange = () => {
  //     if (document.visibilityState === 'visible') {
  //       syncRunningStatus();
  //     }
  //   };

  //   window.addEventListener('online', syncRunningStatus);
  //   document.addEventListener('visibilitychange', handleVisibilityChange);
  //   const timer = window.setInterval(syncRunningStatus, 30000);

  //   return () => {
  //     window.removeEventListener('online', syncRunningStatus);
  //     document.removeEventListener('visibilitychange', handleVisibilityChange);
  //     window.clearInterval(timer);
  //   };
  // }, [syncRunningStatus, userId]);
}
