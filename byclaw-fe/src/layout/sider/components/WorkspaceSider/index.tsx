import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOutlined,
  BulbOutlined,
  DownOutlined,
  LoadingOutlined,
  ReloadOutlined,
  RightOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
// @ts-ignore
import { useDispatch, useIntl, useLocation, useNavigate } from '@umijs/max';
import classNames from 'classnames';
import dayjs from 'dayjs';
import AntdIcon from '@/components/AntdIcon';
import { clearEasyConfirmInputDraft } from '@/components/ChatLayoutComp/components/EasyConfirm';
import { hydrateRunningSessions } from '@/hooks/useChat/chatRuntime';
import useGlobal from '@/hooks/useGlobal';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import useAppStore from '@/models/common/useAppStore';
import { useProjectList } from '@/pages/projectSpace/hooks/useProjectList';
import { useProjectScopeId } from '@/pages/projectSpace/hooks/useProjectScopeId';
import type { ProjectSession, ProjectSpace } from '@/pages/projectSpace/types';
import { getArrayData, getPageTotal, getProjectTagMeta, normalizeProjectSession } from '@/pages/projectSpace/utils';
import { listProjectSessionsByQo } from '@/service/devloop';
import { getChatRunningStatus } from '@/service/message';
import { chatSessionRuntimeManager, type RunningChatInfo } from '@/utils/chatSessionRuntimeManager';
import WorkspaceSiderHeader from './WorkspaceSiderHeader';
import WorkspaceProjectActions from './WorkspaceProjectActions';
import WorkspaceSessionActions from './WorkspaceSessionActions';
import WorkspaceUserBar from './WorkspaceUserBar';
import styles from './index.module.less';

const PROJECT_SESSION_PAGE_SIZE = 5;
const EXPANDED_PROJECTS_STORAGE_KEY = 'byclaw.workspaceSider.expandedProjectIds';

const RESOURCE_PATHS = [
  '/resourceCenter',
  '/knowledgeCenter',
  '/toolCenter',
  '/viewCenter',
  '/objectCenter',
  '/ontologyCenter',
  '/skillCenter',
  '/files',
] as const;

type ProjectSessionState = {
  sessions: ProjectSession[];
  total: number;
  pageNum: number;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: boolean;
};

type SessionLoadOptions = {
  append?: boolean;
  force?: boolean;
};

type ProjectSessionRefreshPayload = {
  projectId?: string | number;
  sessionId?: string | number;
  clientRequestId?: string;
  session?: ProjectSession;
  sessionName?: string;
  sessionContent?: string;
  updateTime?: string;
};

export interface WorkspaceSiderProps {
  className?: string;
  style?: React.CSSProperties;
}

const createEmptySessionState = (): ProjectSessionState => ({
  sessions: [],
  total: 0,
  pageNum: 0,
  loaded: false,
  loading: false,
  loadingMore: false,
  error: false,
});

const readExpandedProjectIds = (): Set<string> => {
  if (typeof window === 'undefined') return new Set();
  try {
    const storedProjectIds = window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY);
    if (!storedProjectIds) return new Set();
    const parsedProjectIds = JSON.parse(storedProjectIds);
    if (!Array.isArray(parsedProjectIds)) return new Set();
    return new Set(parsedProjectIds.map((projectId) => `${projectId}`.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
};

const hasStoredExpandedProjectIds = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(EXPANDED_PROJECTS_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
};

const normalizeProjectId = (projectId?: string | number) => `${projectId ?? ''}`.trim();

const sortSessions = (sessions: ProjectSession[]) =>
  [...sessions].sort((left, right) => {
    const leftTime = dayjs(left.updateTime || left.createTime || 0).valueOf();
    const rightTime = dayjs(right.updateTime || right.createTime || 0).valueOf();
    return rightTime - leftTime;
  });

const mergeSessions = (currentSessions: ProjectSession[], nextSessions: ProjectSession[]) => {
  const sessionMap = new Map(currentSessions.map((session) => [`${session.sessionId}`, session]));
  nextSessions.forEach((session) => {
    sessionMap.set(`${session.sessionId}`, session);
  });
  return sortSessions(Array.from(sessionMap.values()));
};

const getSessionsCreatedDuringRequest = (
  sessionsAtRequestStart: ProjectSession[],
  currentSessions: ProjectSession[],
  responseSessions: ProjectSession[]
) => {
  const initialSessionIds = new Set(sessionsAtRequestStart.map((session) => `${session.sessionId}`));
  const responseSessionIds = new Set(responseSessions.map((session) => `${session.sessionId}`));

  return currentSessions.filter((session) => {
    const sessionId = `${session.sessionId}`;
    return !initialSessionIds.has(sessionId) && !responseSessionIds.has(sessionId);
  });
};

const formatSessionTime = (value: string | number | undefined, intl: ReturnType<typeof useIntl>): string => {
  if (!value) return '';

  const dateValue = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  const time = dayjs(dateValue);
  if (!time.isValid()) return '';

  const minuteDiff = dayjs().diff(time, 'minute');
  if (minuteDiff < 60) {
    return intl.formatMessage({ id: 'workspaceSider.time.minutesAgo' }, { count: Math.max(1, minuteDiff) });
  }
  if (minuteDiff < 60 * 24) {
    return intl.formatMessage({ id: 'workspaceSider.time.hoursAgo' }, { count: Math.floor(minuteDiff / 60) });
  }
  const dayDiff = dayjs().diff(time, 'day');
  if (dayDiff < 30) {
    return intl.formatMessage({ id: 'workspaceSider.time.daysAgo' }, { count: dayDiff });
  }
  const monthDiff = dayjs().diff(time, 'month');
  if (monthDiff < 12) {
    return intl.formatMessage({ id: 'workspaceSider.time.monthsAgo' }, { count: Math.max(1, monthDiff) });
  }
  return intl.formatMessage({ id: 'workspaceSider.time.yearsAgo' }, { count: Math.max(1, dayjs().diff(time, 'year')) });
};

const isSameOrChildPath = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`);

const WorkspaceSider: React.FC<WorkspaceSiderProps> = ({ className, style }) => {
  const intl = useIntl();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { EventEmitter, sessionId, setAgentId, setSessionId } = useGlobal();
  const { clearDetailPanel } = useContext(SiderContentContext);
  const { projects, loading, fetchProjects } = useProjectList();
  const { setSiderCollapsed } = useAppStore();
  const [projectScopeId, updateProjectScopeId] = useProjectScopeId();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(readExpandedProjectIds);
  const [sessionStateMap, setSessionStateMap] = useState<Record<string, ProjectSessionState>>({});
  const [, setRuntimeVersion] = useState(0);
  const initializedProjectRef = useRef(false);
  const expandedProjectIdsRef = useRef(expandedProjectIds);
  const sessionStateMapRef = useRef(sessionStateMap);
  const sessionLoadingProjectIdsRef = useRef<Set<string>>(new Set());
  const hasStoredExpandedProjectIdsRef = useRef(hasStoredExpandedProjectIds());
  const runningSessionIdsKeyRef = useRef('');

  useEffect(() => {
    expandedProjectIdsRef.current = expandedProjectIds;
  }, [expandedProjectIds]);

  useEffect(() => {
    sessionStateMapRef.current = sessionStateMap;
  }, [sessionStateMap]);

  const loadedSessionIds = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(sessionStateMap)
            .flatMap((sessionState) => sessionState.sessions)
            .map((session) => `${session.sessionId || ''}`.trim())
            // 临时会话的运行态由本地 manager 维护，后端仅能查询已经落库的真实会话。
            .filter((loadedSessionId) => loadedSessionId && !loadedSessionId.startsWith('pending_'))
        )
      ).sort(),
    [sessionStateMap]
  );
  const loadedSessionIdsKey = loadedSessionIds.join(',');

  const syncRunningStatus = useCallback(async () => {
    if (!loadedSessionIdsKey) return;

    try {
      const runningInfoList: RunningChatInfo[] = await getChatRunningStatus({
        sessionIds: loadedSessionIdsKey.split(','),
      });
      hydrateRunningSessions(runningInfoList || []);
    } catch (error) {
      console.error('Failed to synchronize workspace session running status:', error);
    }
  }, [loadedSessionIdsKey]);

  const updateDisplayedRunningSessions = useCallback(() => {
    const nextRunningSessionIdsKey = Object.values(sessionStateMapRef.current)
      .flatMap((sessionState) => sessionState.sessions)
      .map((session) => `${session.sessionId || ''}`.trim())
      .filter((loadedSessionId) => loadedSessionId && chatSessionRuntimeManager.isSessionRunning(loadedSessionId))
      .sort()
      .join(',');
    if (nextRunningSessionIdsKey === runningSessionIdsKeyRef.current) return;

    runningSessionIdsKeyRef.current = nextRunningSessionIdsKey;
    setRuntimeVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    // 流式游标也会触发 manager 通知，仅在可见会话的 running 集合变化时刷新侧边栏。
    return chatSessionRuntimeManager.subscribe(updateDisplayedRunningSessions);
  }, [updateDisplayedRunningSessions]);

  useEffect(() => {
    updateDisplayedRunningSessions();
  }, [sessionStateMap, updateDisplayedRunningSessions]);

  useEffect(() => {
    void syncRunningStatus();
  }, [syncRunningStatus]);

  useEffect(() => {
    if (!loadedSessionIdsKey) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncRunningStatus();
      }
    };
    const handleOnline = () => {
      void syncRunningStatus();
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const timer = window.setInterval(() => void syncRunningStatus(), 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(timer);
    };
  }, [loadedSessionIdsKey, syncRunningStatus]);

  const updateProjectSessionState = useCallback((projectId: string, patch: Partial<ProjectSessionState>) => {
    const currentState = sessionStateMapRef.current[projectId] || createEmptySessionState();
    const nextStateMap = {
      ...sessionStateMapRef.current,
      [projectId]: {
        ...currentState,
        ...patch,
      },
    };
    sessionStateMapRef.current = nextStateMap;
    setSessionStateMap(nextStateMap);
  }, []);

  const updateExpandedProjectIds = useCallback((updater: (currentIds: Set<string>) => Set<string>) => {
    setExpandedProjectIds((currentIds) => {
      const nextIds = updater(currentIds);
      expandedProjectIdsRef.current = nextIds;
      try {
        window.localStorage.setItem(EXPANDED_PROJECTS_STORAGE_KEY, JSON.stringify(Array.from(nextIds)));
      } catch {
        // 浏览器禁用本地存储时仍保留当前页面内的展开状态。
      }
      return nextIds;
    });
  }, []);

  const fetchProjectSessions = useCallback(
    async (projectId: string, options: SessionLoadOptions = {}) => {
      const { append = false, force = false } = options;
      const normalizedProjectId = normalizeProjectId(projectId);
      const numericProjectId = Number(normalizedProjectId);
      if (!normalizedProjectId || !Number.isFinite(numericProjectId)) return;
      if (sessionLoadingProjectIdsRef.current.has(normalizedProjectId)) return;

      const currentState = sessionStateMapRef.current[normalizedProjectId] || createEmptySessionState();
      if (!append && currentState.loaded && !force) return;
      if (append && (!currentState.loaded || currentState.sessions.length >= currentState.total)) return;
      const sessionsAtRequestStart = currentState.sessions;

      const pageNum = append ? currentState.pageNum + 1 : 1;
      sessionLoadingProjectIdsRef.current.add(normalizedProjectId);
      updateProjectSessionState(normalizedProjectId, {
        loading: !append,
        loadingMore: append,
        error: false,
      });

      try {
        const response = await listProjectSessionsByQo({
          projectId: numericProjectId,
          pageNum,
          pageSize: PROJECT_SESSION_PAGE_SIZE,
        });
        const nextSessions = getArrayData(response).map((item) => normalizeProjectSession(item, normalizedProjectId));
        const previousSessions = sessionStateMapRef.current[normalizedProjectId]?.sessions || [];
        const sessionsCreatedDuringRequest = getSessionsCreatedDuringRequest(
          sessionsAtRequestStart,
          previousSessions,
          nextSessions
        );
        const sessions = append
          ? mergeSessions(previousSessions, nextSessions)
          : mergeSessions(nextSessions, sessionsCreatedDuringRequest);
        const total = Math.max(getPageTotal(response, sessions.length), sessions.length);

        updateProjectSessionState(normalizedProjectId, {
          sessions,
          total,
          pageNum: Number(response?.pageNum || response?.data?.pageNum || pageNum),
          loaded: true,
          loading: false,
          loadingMore: false,
          error: false,
        });
      } catch (error) {
        console.error('Failed to load workspace project sessions:', error);
        updateProjectSessionState(normalizedProjectId, {
          loading: false,
          loadingMore: false,
          error: true,
        });
      } finally {
        sessionLoadingProjectIdsRef.current.delete(normalizedProjectId);
      }
    },
    [updateProjectSessionState]
  );

  const selectProject = useCallback(
    (project: ProjectSpace, shouldExpand = true) => {
      const projectId = normalizeProjectId(project.projectId);
      if (!projectId) return;

      updateProjectScopeId(projectId);
      EventEmitter.emit('projectSpace-active-project-change', {
        projectId,
        projectName: project.projectName,
      });

      if (shouldExpand) {
        updateExpandedProjectIds((currentIds) => {
          if (currentIds.has(projectId)) return currentIds;
          return new Set([...currentIds, projectId]);
        });
      }
    },
    [EventEmitter, updateExpandedProjectIds, updateProjectScopeId]
  );

  useEffect(() => {
    if (initializedProjectRef.current || !projects.length) return;

    const activeProject = projects.find((project) => normalizeProjectId(project.projectId) === projectScopeId);
    const defaultProject = projects.find((project) => project.projectType === 'default') || projects[0];
    const project = activeProject || defaultProject;
    if (!project) return;

    initializedProjectRef.current = true;
    const projectId = normalizeProjectId(project.projectId);
    const shouldExpandProject =
      expandedProjectIdsRef.current.size > 0
        ? expandedProjectIdsRef.current.has(projectId)
        : !hasStoredExpandedProjectIdsRef.current;
    selectProject(project, shouldExpandProject);

    // 恢复浏览器缓存的展开状态时，同时加载每个已展开项目的第一页会话数据。
    const expandedProjectIdsToLoad = new Set(expandedProjectIdsRef.current);
    if (shouldExpandProject) expandedProjectIdsToLoad.add(projectId);
    projects.forEach((item) => {
      const itemProjectId = normalizeProjectId(item.projectId);
      if (expandedProjectIdsToLoad.has(itemProjectId)) {
        void fetchProjectSessions(itemProjectId);
      }
    });
  }, [fetchProjectSessions, projectScopeId, projects, selectProject]);

  useEffect(() => {
    const handleProjectListRefresh = (payload?: { projectId?: string | number }) => {
      const projectId = normalizeProjectId(payload?.projectId);
      void fetchProjects().then((refreshedProjects) => {
        if (!projectId || !refreshedProjects.some((project) => normalizeProjectId(project.projectId) === projectId)) {
          return;
        }

        updateExpandedProjectIds((currentIds) => {
          if (currentIds.has(projectId)) return currentIds;
          return new Set([...currentIds, projectId]);
        });
        void fetchProjectSessions(projectId);
      });
    };
    const handleProjectSessionPending = (payload: ProjectSessionRefreshPayload) => {
      const projectId = normalizeProjectId(payload?.projectId);
      const clientRequestId = `${payload?.clientRequestId || ''}`.trim();
      if (!projectId || !clientRequestId) return;

      const currentState = sessionStateMapRef.current[projectId] || createEmptySessionState();
      const pendingSessionId = `pending_${clientRequestId}`;
      if (currentState.sessions.some((session) => `${session.sessionId}` === pendingSessionId)) return;

      const pendingSession = normalizeProjectSession(
        {
          sessionId: pendingSessionId,
          projectId,
          sessionName: payload.sessionName || intl.formatMessage({ id: 'workspaceSider.newSession' }),
          sessionContent: payload.sessionContent || '',
          updateTime: payload.updateTime || new Date().toISOString(),
        },
        projectId
      );
      const sessions = mergeSessions(currentState.sessions, [pendingSession]);
      updateProjectSessionState(projectId, {
        sessions,
        total: Math.max(currentState.total + 1, sessions.length),
      });
    };
    const handleProjectSessionRefresh = (payload: ProjectSessionRefreshPayload) => {
      const projectId = normalizeProjectId(payload?.projectId);
      if (!projectId) return;

      const currentState = sessionStateMapRef.current[projectId] || createEmptySessionState();
      if (payload?.session) {
        const normalizedSession = normalizeProjectSession(payload.session, projectId);
        if (!normalizedSession.sessionId) {
          updateProjectSessionState(projectId, { loaded: false });
          if (expandedProjectIdsRef.current.has(projectId)) {
            void fetchProjectSessions(projectId, { force: true });
          }
          return;
        }

        const pendingSessionId = payload.clientRequestId ? `pending_${payload.clientRequestId}` : '';
        const pendingSessionExists = currentState.sessions.some(
          (session) => `${session.sessionId}` === pendingSessionId
        );
        const sessionsWithoutPending = pendingSessionId
          ? currentState.sessions.filter((session) => `${session.sessionId}` !== pendingSessionId)
          : currentState.sessions;
        const sessionExists = sessionsWithoutPending.some(
          (session) => `${session.sessionId}` === `${normalizedSession.sessionId}`
        );
        const sessions = mergeSessions(sessionsWithoutPending, [normalizedSession]);
        updateProjectSessionState(projectId, {
          sessions,
          total: Math.max(currentState.total + (sessionExists || pendingSessionExists ? 0 : 1), sessions.length),
        });

        if (currentState.loaded) return;
      }

      updateProjectSessionState(projectId, { loaded: false });
      if (expandedProjectIdsRef.current.has(projectId)) {
        void fetchProjectSessions(projectId, { force: true });
      }
    };

    EventEmitter.on('projectSpace-list-refresh', handleProjectListRefresh);
    EventEmitter.on('projectSpace-session-pending', handleProjectSessionPending);
    EventEmitter.on('projectSpace-session-bound', handleProjectSessionRefresh);
    return () => {
      EventEmitter.off('projectSpace-list-refresh', handleProjectListRefresh);
      EventEmitter.off('projectSpace-session-pending', handleProjectSessionPending);
      EventEmitter.off('projectSpace-session-bound', handleProjectSessionRefresh);
    };
  }, [EventEmitter, fetchProjectSessions, fetchProjects, intl, updateExpandedProjectIds, updateProjectSessionState]);

  const activeProject = useMemo(
    () => projects.find((project) => normalizeProjectId(project.projectId) === projectScopeId),
    [projectScopeId, projects]
  );
  const resourceCenterActive = RESOURCE_PATHS.some((path) => isSameOrChildPath(location.pathname, path));
  const newSessionActive = location.pathname === '/chat' && !sessionId;
  const projectActive = isSameOrChildPath(location.pathname, '/projectSpace');
  const employeeActive =
    isSameOrChildPath(location.pathname, '/digitalEmployees') || isSameOrChildPath(location.pathname, '/employees');
  const automationActive = isSameOrChildPath(location.pathname, '/automation');
  const inspirationActive = isSameOrChildPath(location.pathname, '/inspiration');

  const handleNewSession = useCallback(() => {
    clearDetailPanel?.();
    clearEasyConfirmInputDraft();
    setAgentId?.('');
    setSessionId?.('');

    if (activeProject) {
      navigate('/chat', {
        state: {
          keepSiderActiveKey: 'sessions',
          from: 'projectSpace',
          projectId: activeProject.projectId,
          projectName: activeProject.projectName,
        },
      });
      return;
    }

    navigate('/chat');
  }, [activeProject, clearDetailPanel, navigate, setAgentId, setSessionId]);

  const handleOpenSession = useCallback(
    (project: ProjectSpace, session: ProjectSession) => {
      const projectId = normalizeProjectId(project.projectId);
      if (!projectId || !session.sessionId) return;

      clearDetailPanel?.();
      clearEasyConfirmInputDraft(session.sessionId);
      selectProject(project, false);

      if (Array.isArray(session.sessionExts) && session.sessionExts.length > 0) {
        dispatch({
          type: 'session/saveExtParamsBySessionId',
          payload: {
            sessionId: session.sessionId,
            extParams: session.sessionExts.reduce((params: Record<string, any>, item) => {
              params[item.extParamCode] = item.extParamValue;
              return params;
            }, {}),
          },
        });
      }

      const sessionPayload = {
        ...session,
        sessionId: `${session.sessionId}`,
        sessionName: session.sessionName || intl.formatMessage({ id: 'workspaceSider.newSession' }),
        projectId,
        objectId: session.objectId,
        objectType: session.objectType,
      };
      dispatch({ type: 'session/addSession', payload: sessionPayload });
      dispatch({ type: 'session/updateSession', payload: sessionPayload });

      setAgentId?.(session.objectId ? `${session.objectId}` : '');
      setSessionId?.(`${session.sessionId}`);
      navigate('/chat', {
        state: {
          keepSiderActiveKey: 'sessions',
          from: 'projectSpace',
          projectId,
          projectName: project.projectName,
          selectedAgentId: session.objectId,
          selectedAgentObjectType: session.objectType,
        },
      });
    },
    [clearDetailPanel, dispatch, intl, navigate, selectProject, setAgentId, setSessionId]
  );

  const handleProjectExpandToggle = useCallback(
    (project: ProjectSpace) => {
      const projectId = normalizeProjectId(project.projectId);
      if (!projectId) return;

      const isExpanded = expandedProjectIdsRef.current.has(projectId);
      updateExpandedProjectIds((currentIds) => {
        const nextIds = new Set(currentIds);
        if (nextIds.has(projectId)) {
          nextIds.delete(projectId);
        } else {
          nextIds.add(projectId);
        }
        return nextIds;
      });

      if (!isExpanded) {
        void fetchProjectSessions(projectId);
      }
    },
    [fetchProjectSessions, updateExpandedProjectIds]
  );

  const handleProjectClick = useCallback(
    (project: ProjectSpace) => {
      handleProjectExpandToggle(project);
    },
    [handleProjectExpandToggle]
  );

  const handleNewProjectSession = useCallback(
    (project: ProjectSpace) => {
      clearDetailPanel?.();
      clearEasyConfirmInputDraft();
      setAgentId?.('');
      setSessionId?.('');
      selectProject(project, false);
      navigate('/chat', {
        state: {
          keepSiderActiveKey: 'sessions',
          from: 'projectSpace',
          projectId: project.projectId,
          projectName: project.projectName,
        },
      });
    },
    [clearDetailPanel, navigate, selectProject, setAgentId, setSessionId]
  );

  const handleProjectChanged = useCallback(
    async (project: ProjectSpace, action: 'rename' | 'delete') => {
      const projectId = normalizeProjectId(project.projectId);
      if (action === 'delete') {
        updateExpandedProjectIds((currentIds) => {
          const nextIds = new Set(currentIds);
          nextIds.delete(projectId);
          return nextIds;
        });
        if (projectScopeId === projectId) updateProjectScopeId();
      }
      await fetchProjects();
      EventEmitter.emit('projectSpace-list-refresh');
    },
    [EventEmitter, fetchProjects, projectScopeId, updateExpandedProjectIds, updateProjectScopeId]
  );

  const handleSessionEdited = useCallback(
    (projectId: string, editedSession: ProjectSession, sessionName: string) => {
      const currentState = sessionStateMapRef.current[projectId] || createEmptySessionState();
      updateProjectSessionState(projectId, {
        sessions: currentState.sessions.map((session) =>
          `${session.sessionId}` === `${editedSession.sessionId}` ? { ...session, sessionName } : session
        ),
      });
      dispatch({ type: 'session/updateSession', payload: { ...editedSession, sessionName } });
    },
    [dispatch, updateProjectSessionState]
  );

  const handleSessionDeleted = useCallback(
    (projectId: string, deletedSession: ProjectSession) => {
      const currentState = sessionStateMapRef.current[projectId] || createEmptySessionState();
      const sessions = currentState.sessions.filter(
        (session) => `${session.sessionId}` !== `${deletedSession.sessionId}`
      );
      updateProjectSessionState(projectId, {
        sessions,
        total: Math.max(0, currentState.total - (sessions.length < currentState.sessions.length ? 1 : 0)),
      });
      if (`${deletedSession.sessionId}` === `${sessionId}`) {
        setAgentId?.('');
        setSessionId?.('');
      }
    },
    [sessionId, setAgentId, setSessionId, updateProjectSessionState]
  );

  const renderProjectSessions = (project: ProjectSpace) => {
    const projectId = normalizeProjectId(project.projectId);
    const sessionState = sessionStateMap[projectId] || createEmptySessionState();
    const hasMoreSessions = sessionState.loaded && sessionState.total > sessionState.sessions.length;
    const canCollapseSessions =
      sessionState.loaded && !hasMoreSessions && sessionState.sessions.length > PROJECT_SESSION_PAGE_SIZE;

    const handleCollapseSessions = () => {
      updateProjectSessionState(projectId, {
        sessions: sessionState.sessions.slice(0, PROJECT_SESSION_PAGE_SIZE),
        pageNum: 1,
      });
    };

    return (
      <div className={styles.sessionList} role="group">
        {sessionState.loading && !sessionState.sessions.length && (
          <div className={styles.sessionLoading} role="status">
            <LoadingOutlined spin />
            <span>{intl.formatMessage({ id: 'workspaceSider.loading' })}</span>
          </div>
        )}

        {sessionState.error && !sessionState.sessions.length && (
          <div className={styles.sessionFeedback}>
            <span>{intl.formatMessage({ id: 'workspaceSider.sessionLoadFailed' })}</span>
            <button type="button" onClick={() => void fetchProjectSessions(projectId, { force: true })}>
              <ReloadOutlined />
              {intl.formatMessage({ id: 'workspaceSider.retry' })}
            </button>
          </div>
        )}

        {sessionState.loaded && !sessionState.sessions.length && !sessionState.error && (
          <div className={styles.sessionEmpty}>{intl.formatMessage({ id: 'workspaceSider.emptySessions' })}</div>
        )}

        {sessionState.sessions.map((session) => (
          <div
            key={session.sessionId}
            className={classNames(
              styles.sessionRow,
              `${session.sessionId}` === `${sessionId}` && styles.sessionItemActive
            )}
          >
            <button type="button" className={styles.sessionItem} onClick={() => handleOpenSession(project, session)}>
              <span className={styles.sessionName}>
                {session.sessionName || intl.formatMessage({ id: 'workspaceSider.newSession' })}
              </span>
              <span className={styles.sessionTime}>
                {chatSessionRuntimeManager.isSessionRunning(`${session.sessionId}`) ? (
                  <LoadingOutlined />
                ) : (
                  formatSessionTime(session.updateTime || session.createTime, intl)
                )}
              </span>
            </button>
            <WorkspaceSessionActions
              session={session}
              onEdited={(sessionName) => handleSessionEdited(projectId, session, sessionName)}
              onDeleted={() => handleSessionDeleted(projectId, session)}
            />
          </div>
        ))}

        {hasMoreSessions && (
          <button
            type="button"
            className={styles.loadMoreSessions}
            disabled={sessionState.loadingMore}
            onClick={() => void fetchProjectSessions(projectId, { append: true })}
          >
            {sessionState.loadingMore ? <LoadingOutlined spin /> : null}
            {intl.formatMessage({ id: 'workspaceSider.loadMore' })}
          </button>
        )}

        {canCollapseSessions && (
          <button type="button" className={styles.loadMoreSessions} onClick={handleCollapseSessions}>
            {intl.formatMessage({ id: 'workspaceSider.collapseSessions' })}
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className={classNames(styles.workspaceSider, className)} style={style} aria-label="workspace navigation">
      <WorkspaceSiderHeader onCollapse={() => setSiderCollapsed(true)} />
      <nav
        className={styles.primaryNavigation}
        aria-label={intl.formatMessage({ id: 'workspaceSider.primaryNavigation' })}
      >
        <button
          type="button"
          className={classNames(styles.primaryItem, newSessionActive && styles.primaryItemActive)}
          onClick={handleNewSession}
        >
          <AntdIcon type="icon-xinjianduihua" className={styles.primaryIcon} />
          <span>{intl.formatMessage({ id: 'workspaceSider.newTask' })}</span>
        </button>
        <button
          type="button"
          className={classNames(styles.primaryItem, automationActive && styles.primaryItemActive)}
          onClick={() => navigate('/automation')}
        >
          <AntdIcon type="icon-a-Alarm-clocknaozhong" className={styles.primaryIcon} />
          <span>{intl.formatMessage({ id: 'workspaceSider.scheduledTasks' })}</span>
        </button>
        <button
          type="button"
          className={classNames(styles.primaryItem, projectActive && styles.primaryItemActive)}
          onClick={() => navigate('/projectSpace', { state: { openProjectList: true } })}
        >
          <ShareAltOutlined className={styles.primaryIcon} />
          <span>{intl.formatMessage({ id: 'sider.projectSpace' })}</span>
        </button>
        <button
          type="button"
          className={classNames(styles.primaryItem, employeeActive && styles.primaryItemActive)}
          onClick={() => navigate('/digitalEmployees')}
        >
          <AntdIcon type="icon-cebianlan-shuziyuangong" className={styles.primaryIcon} />
          <span>{intl.formatMessage({ id: 'workspaceSider.digitalEmployee' })}</span>
        </button>
        <button
          type="button"
          className={classNames(styles.primaryItem, resourceCenterActive && styles.primaryItemActive)}
          onClick={() => navigate('/resourceCenter')}
        >
          <BookOutlined className={styles.primaryIcon} />
          <span>{intl.formatMessage({ id: 'workspaceSider.resourceCenter' })}</span>
        </button>
        <button
          type="button"
          className={classNames(styles.primaryItem, inspirationActive && styles.primaryItemActive)}
          onClick={() => navigate('/inspiration')}
        >
          <BulbOutlined className={styles.primaryIcon} />
          <span>{intl.formatMessage({ id: 'workspaceSider.inspiration' })}</span>
        </button>
      </nav>

      <section
        className={styles.projectSection}
        aria-label={intl.formatMessage({ id: 'workspaceSider.projectSection' })}
      >
        <div className={styles.projectSectionHeader}>
          <span>{intl.formatMessage({ id: 'workspaceSider.projectCount' }, { count: projects.length })}</span>
          {loading && projects.length > 0 && <LoadingOutlined spin />}
        </div>

        <div className={styles.projectList} role="tree">
          {loading && !projects.length && (
            <div className={styles.projectLoading} role="status">
              <LoadingOutlined spin />
              <span>{intl.formatMessage({ id: 'workspaceSider.loading' })}</span>
            </div>
          )}
          {!loading && !projects.length && (
            <div className={styles.projectEmpty}>{intl.formatMessage({ id: 'workspaceSider.emptyProjects' })}</div>
          )}
          {projects.map((project) => {
            const projectId = normalizeProjectId(project.projectId);
            const isExpanded = expandedProjectIds.has(projectId);
            const projectTag = getProjectTagMeta(project);
            return (
              <div key={projectId} className={styles.projectItem} role="treeitem" aria-expanded={isExpanded}>
                <div className={styles.projectRow}>
                  <button type="button" className={styles.projectButton} onClick={() => handleProjectClick(project)}>
                    <span
                      className={classNames(styles.projectTypeTag, styles[`projectTypeTag${projectTag.classSuffix}`])}
                    >
                      {intl.formatMessage({ id: projectTag.messageId })}
                    </span>
                    <span className={styles.projectName} title={project.projectName}>
                      {project.projectName || intl.formatMessage({ id: 'projectSpace.unnamedProject' })}
                    </span>
                  </button>
                  <WorkspaceProjectActions
                    project={project}
                    onNewSession={handleNewProjectSession}
                    onRefreshSessions={(currentProject) =>
                      void fetchProjectSessions(normalizeProjectId(currentProject.projectId), { force: true })
                    }
                    onProjectChanged={handleProjectChanged}
                    refreshing={Boolean(sessionStateMap[projectId]?.loading)}
                  />
                  <button
                    type="button"
                    className={styles.projectExpandButton}
                    aria-label={intl.formatMessage({
                      id: isExpanded ? 'workspaceSider.collapseProject' : 'workspaceSider.expandProject',
                    })}
                    onClick={() => handleProjectExpandToggle(project)}
                  >
                    {isExpanded ? <DownOutlined /> : <RightOutlined />}
                  </button>
                </div>
                {isExpanded && renderProjectSessions(project)}
              </div>
            );
          })}
        </div>
      </section>
      <WorkspaceUserBar />
    </aside>
  );
};

export default WorkspaceSider;
