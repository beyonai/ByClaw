export const DESKTOP_UNASSIGNED_SESSION_SCOPE = '__desktop_unassigned_sessions__';

export const hasDesktopTaskSessions = (desktopMode: boolean, sessionState?: { sessions?: unknown[]; total?: number }) =>
  desktopMode && Boolean((sessionState?.sessions?.length || 0) > 0 || (sessionState?.total || 0) > 0);
