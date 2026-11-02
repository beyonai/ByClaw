import type { ProjectSession } from '@/pages/projectSpace/types';
import getSessionTimestamp from '@/utils/getSessionTimestamp';

export const DESKTOP_UNASSIGNED_SESSION_SCOPE = '__desktop_unassigned_sessions__';

export const hasDesktopTaskSessions = (desktopMode: boolean, sessionState?: { sessions?: unknown[]; total?: number }) =>
  desktopMode && Boolean((sessionState?.sessions?.length || 0) > 0 || (sessionState?.total || 0) > 0);

export const sortWorkspaceSessions = (sessions: ProjectSession[]) =>
  [...sessions].sort(
    (left, right) =>
      getSessionTimestamp(right.updateTime || right.createTime) -
      getSessionTimestamp(left.updateTime || left.createTime)
  );

export const syncWorkspaceSessionActivity = (
  sessions: ProjectSession[],
  liveSessions: Array<{ sessionId: string; updateTime?: string | number; sessionContent?: unknown }>
) => {
  const liveSessionMap = new Map(liveSessions.map((session) => [`${session.sessionId}`, session]));
  // 仅同步已加载会话的更新摘要，保留项目分页、名称和归属；迟到的列表响应不能回退最新活动时间。
  return sortWorkspaceSessions(
    sessions.map((session) => {
      const liveSession = liveSessionMap.get(`${session.sessionId}`);
      if (
        !liveSession ||
        getSessionTimestamp(liveSession.updateTime) <= getSessionTimestamp(session.updateTime || session.createTime)
      ) {
        return session;
      }
      return {
        ...session,
        updateTime: `${liveSession.updateTime}`,
        sessionContent:
          typeof liveSession.sessionContent === 'string' ? liveSession.sessionContent : session.sessionContent,
      };
    })
  );
};
