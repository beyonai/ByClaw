import React from 'react';
import { useDispatch } from '@umijs/max';
import { Dropdown } from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  DownOutlined,
  LoadingOutlined,
  StopOutlined,
  TeamOutlined,
} from '@ant-design/icons';

import useGlobal from '@/hooks/useGlobal';
import { qryConversations } from '@/service/layout';
import type { ISession } from '@/typescript/session';
import {
  getExternalSessionExt,
  getScopedChildRunState,
  isScopedChildProjection,
  shouldApplyScopedChildRun,
  type ScopedChildRunState,
} from '@/utils/scopedSession';
import webSocketManager from '@/utils/websocket';
import { useAgentTeamsSnapshot } from '@/components/MessagesComp/ToolCall/agentTeamsStore';

import styles from './ChatTitle.module.less';

interface ChildSessionNavigatorProps {
  sessionId?: string;
  currentSession?: ISession;
}

function ChildSessionNavigator({ sessionId, currentSession }: ChildSessionNavigatorProps) {
  const dispatch = useDispatch();
  const { setSessionId } = useGlobal();
  const [children, setChildren] = React.useState<ISession[]>([]);
  const [parent, setParent] = React.useState<ISession>();
  const childSessionsRef = React.useRef(new Map<string, ISession>());
  const childRunsRef = React.useRef(new Map<string, ScopedChildRunState>());
  const reloadChildrenRef = React.useRef<(() => Promise<void>) | undefined>();
  const currentSessionRef = React.useRef(currentSession);
  const isChild = Boolean(currentSession?.parentSessionId);
  const rootSessionId = isChild ? `${currentSession?.parentSessionId || ''}` : `${sessionId || ''}`;
  const teamSnapshot = useAgentTeamsSnapshot(rootSessionId);

  React.useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  React.useEffect(() => {
    childSessionsRef.current.clear();
    childRunsRef.current.clear();
    setChildren([]);
  }, [rootSessionId]);

  React.useEffect(() => {
    if (!rootSessionId) return undefined;
    let cancelled = false;
    let loadingChildren: Promise<void> | undefined;
    const loadChildren = () => {
      if (loadingChildren) return loadingChildren;
      const runsAtRequest = new Map(childRunsRef.current);
      loadingChildren = (async () => {
        try {
          const response = await qryConversations({ parentSessionId: rootSessionId, pageNum: 1, pageSize: 100 });
          if (cancelled) return;
          const fetchedChildren = (response?.list || []).map((item: ISession) => ({
            ...item,
            sessionId: `${item.sessionId}`,
          }));
          const merged = new Map<string, ISession>(
            fetchedChildren.map((child: ISession) => [`${child.sessionId}`, child])
          );
          childRunsRef.current.forEach((run, id) => {
            const liveChild = childSessionsRef.current.get(id);
            if (liveChild && run !== runsAtRequest.get(id)) merged.set(id, liveChild);
          });
          childSessionsRef.current = merged;
          const childSessions = Array.from(merged.values());
          setChildren(childSessions);
          childSessions.forEach((child: ISession) => dispatch({ type: 'session/addSession', payload: child }));
        } catch {
          // Keep the last hierarchy while the next event or reconnect retries.
        }
      })().finally(() => {
        loadingChildren = undefined;
      });
      return loadingChildren;
    };
    reloadChildrenRef.current = loadChildren;
    void loadChildren();
    return () => {
      cancelled = true;
      if (reloadChildrenRef.current === loadChildren) reloadChildrenRef.current = undefined;
    };
  }, [dispatch, rootSessionId]);

  React.useEffect(() => {
    if (!isChild || !rootSessionId) {
      setParent(undefined);
      return undefined;
    }
    let cancelled = false;
    void qryConversations({ sessionId: rootSessionId, pageNum: 1, pageSize: 1 })
      .then((response) => {
        if (cancelled) return;
        const parentSession = response?.list?.[0];
        if (!parentSession) return;
        const normalizedParent = { ...parentSession, sessionId: `${parentSession.sessionId}` };
        setParent(normalizedParent);
        dispatch({ type: 'session/addSession', payload: normalizedParent });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [dispatch, isChild, rootSessionId]);

  React.useEffect(
    () =>
      webSocketManager.onReconnect(() => {
        void reloadChildrenRef.current?.();
      }),
    [rootSessionId]
  );

  React.useEffect(() => {
    if (!rootSessionId) return undefined;
    const handleNewMessage = (message: any) => {
      const projection = message?.data || message;
      if (!isScopedChildProjection(projection)) return;

      let metadata: Record<string, unknown>;
      try {
        metadata =
          typeof projection.metadata === 'string' ? JSON.parse(projection.metadata || '{}') : projection.metadata || {};
      } catch {
        return;
      }
      if (`${metadata.external_parent_session_id || ''}` !== rootSessionId) return;

      const childSessionId = `${message?.sessionId || projection?.sessionId || ''}`;
      if (!childSessionId) return;
      const childRun = getScopedChildRunState(projection, message?.streamId);
      if (!shouldApplyScopedChildRun(childRunsRef.current.get(childSessionId), childRun)) return;

      const previousChild = childSessionsRef.current.get(childSessionId);
      const baseSession = previousChild || currentSessionRef.current;
      const extValues: Record<string, unknown> = {
        external_session_id: metadata.external_session_id,
        external_root_session_id: metadata.external_root_session_id,
        child_name: metadata.child_name,
        child_role: metadata.child_role,
        external_session_status: metadata.session_status,
        event_source: metadata.event_source,
      };
      const updates = Object.entries(extValues)
        .filter(([, value]) => value !== undefined && value !== null && `${value}` !== '')
        .map(([code, value]) => ({ extParamCode: code, extParamName: code, extParamValue: `${value}` }));
      const sessionExts = [
        ...(previousChild?.sessionExts || []).filter(
          (ext) => !updates.some((item) => item.extParamCode === ext.extParamCode)
        ),
        ...updates,
      ];
      const now = new Date().toISOString();
      const child: ISession = {
        ...baseSession,
        sessionId: childSessionId,
        parentSessionId: rootSessionId,
        sessionName: `${metadata.child_name || previousChild?.sessionName || '子 Agent'}`,
        sessionContent: `${metadata.child_task || previousChild?.sessionContent || ''}`,
        createTime: baseSession?.createTime || now,
        updateTime: now,
        sessionExts,
      };

      childRunsRef.current.set(childSessionId, childRun);
      childSessionsRef.current.set(childSessionId, child);
      setChildren(Array.from(childSessionsRef.current.values()));
      dispatch({ type: 'session/addSession', payload: child });
    };

    webSocketManager.onMessage('NEW_MESSAGE', handleNewMessage);
    return () => webSocketManager.offMessage('NEW_MESSAGE', handleNewMessage);
  }, [dispatch, rootSessionId]);

  const navigateTo = (target: ISession) => {
    dispatch({ type: 'session/addSession', payload: target });
    setSessionId?.(`${target.sessionId}`);
  };

  const teamChildIds = new Set(
    (teamSnapshot?.team.members || []).flatMap((member) =>
      member.byclawSessionId ? [`${member.byclawSessionId}`] : []
    )
  );
  const visibleChildren = teamSnapshot ? children.filter((child) => teamChildIds.has(`${child.sessionId}`)) : children;

  if (!isChild && visibleChildren.length === 0) return null;

  const menuItems = visibleChildren.map((child) => {
    const member = teamSnapshot?.team.members?.find(
      (item) =>
        `${item.byclawSessionId || ''}` === `${child.sessionId}` ||
        item.id === getExternalSessionExt(child, 'external_session_id')
    );
    let rawStatus = member?.status || getExternalSessionExt(child, 'external_session_status') || 'ready';
    if (member?.activity === 'working') rawStatus = 'running';
    else if (member?.activity === 'idle' && rawStatus === 'running') rawStatus = 'idle';
    const lastTask = teamSnapshot?.team.tasks?.filter((task) => task.assignee === member?.name).slice(-1)[0];
    if (member?.activity !== 'working' && lastTask?.status === 'cancelled') rawStatus = 'cancelled';
    let status: 'idle' | 'running' | 'completed' | 'failed' | 'waiting' | 'cancelled' = 'idle';
    if (rawStatus === 'running' || rawStatus === 'completed' || rawStatus === 'cancelled') status = rawStatus;
    else if (['failed', 'error'].includes(rawStatus)) status = 'failed';
    else if (['waiting', 'waiting_user', 'blocked'].includes(rawStatus)) status = 'waiting';
    const label = {
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      waiting: '等待中',
      idle: '待命',
      cancelled: '已停止',
    }[status];
    const detail = lastTask?.subject || member?.role || getExternalSessionExt(child, 'child_role');
    return {
      key: `${child.sessionId}`,
      label: (
        <span className={styles.childSessionMenuItem} data-status={status}>
          <span className={styles.childSessionMenuAvatar}>{child.sessionName?.slice(0, 1) || 'A'}</span>
          <span className={styles.childSessionMenuCopy}>
            <strong title={child.sessionName}>{child.sessionName || '子 Agent'}</strong>
            {detail && <span title={detail}>{detail}</span>}
          </span>
          <span className={styles.childSessionStatus}>
            {status === 'running' ? (
              <LoadingOutlined />
            ) : status === 'cancelled' ? (
              <StopOutlined />
            ) : status === 'completed' ? (
              <CheckCircleFilled />
            ) : (
              <ClockCircleOutlined />
            )}
            {label}
          </span>
        </span>
      ),
    };
  });

  return (
    <div className={styles.childSessionNavigator}>
      <span className={styles.childSessionSeparator}>/</span>
      {isChild && parent && (
        <button type="button" className={styles.parentSessionButton} onClick={() => navigateTo(parent)}>
          <ArrowLeftOutlined />
          {parent.sessionName || '主会话'}
        </button>
      )}
      <Dropdown
        trigger={['click']}
        overlayClassName={styles.childSessionDropdown}
        menu={{
          items: menuItems,
          selectedKeys: isChild ? [`${sessionId}`] : [],
          onClick: ({ key }) => {
            const target = visibleChildren.find((child) => `${child.sessionId}` === `${key}`);
            if (target) navigateTo(target);
          },
        }}
      >
        <button type="button" className={styles.childSessionsButton} aria-label="打开子会话列表">
          <TeamOutlined />
          {visibleChildren.length} 个子代理
          <DownOutlined />
        </button>
      </Dropdown>
    </div>
  );
}

export default ChildSessionNavigator;
