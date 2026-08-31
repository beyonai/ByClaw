import React from 'react';
import { useDispatch } from '@umijs/max';
import { Dropdown } from 'antd';
import { ArrowLeftOutlined, DownOutlined, TeamOutlined } from '@ant-design/icons';

import useGlobal from '@/hooks/useGlobal';
import { qryConversations } from '@/service/layout';
import type { ISession } from '@/typescript/session';
import { getExternalSessionExt, isScopedChildProjection } from '@/utils/scopedSession';
import webSocketManager from '@/utils/websocket';

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
  const knownChildSessionIdsRef = React.useRef(new Set<string>());
  const reloadChildrenRef = React.useRef<(() => Promise<void>) | undefined>();
  const currentSessionRef = React.useRef(currentSession);
  const isChild = Boolean(currentSession?.parentSessionId);
  const rootSessionId = isChild ? `${currentSession?.parentSessionId || ''}` : `${sessionId || ''}`;

  React.useEffect(() => {
    currentSessionRef.current = currentSession;
  }, [currentSession]);

  React.useEffect(() => {
    knownChildSessionIdsRef.current.clear();
    setChildren([]);
  }, [rootSessionId]);

  React.useEffect(() => {
    if (!rootSessionId) return undefined;
    let cancelled = false;
    let loadingChildren: Promise<void> | undefined;
    const loadChildren = () => {
      if (loadingChildren) return loadingChildren;
      loadingChildren = (async () => {
        try {
          const response = await qryConversations({ parentSessionId: rootSessionId, pageNum: 1, pageSize: 100 });
          if (cancelled) return;
          const childSessions = (response?.list || []).map((item: ISession) => ({
            ...item,
            sessionId: `${item.sessionId}`,
          }));
          knownChildSessionIdsRef.current = new Set(childSessions.map((child) => `${child.sessionId}`));
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
      if (!childSessionId || knownChildSessionIdsRef.current.has(childSessionId)) return;

      const baseSession = currentSessionRef.current;
      const extValues: Record<string, unknown> = {
        external_session_id: metadata.external_session_id,
        external_root_session_id: metadata.external_root_session_id,
        child_name: metadata.child_name,
        child_role: metadata.child_role,
        external_session_status: metadata.session_status,
        event_source: metadata.event_source,
      };
      const sessionExts = Object.entries(extValues)
        .filter(([, value]) => value !== undefined && value !== null && `${value}` !== '')
        .map(([code, value]) => ({ extParamCode: code, extParamName: code, extParamValue: `${value}` }));
      const now = new Date().toISOString();
      const child: ISession = {
        ...baseSession,
        sessionId: childSessionId,
        parentSessionId: rootSessionId,
        sessionName: `${metadata.child_name || '子 Agent'}`,
        sessionContent: `${metadata.child_task || ''}`,
        createTime: baseSession?.createTime || now,
        updateTime: now,
        sessionExts,
      };

      knownChildSessionIdsRef.current.add(childSessionId);
      setChildren((current) => [child, ...current.filter((item) => `${item.sessionId}` !== childSessionId)]);
      dispatch({ type: 'session/addSession', payload: child });
    };

    webSocketManager.onMessage('NEW_MESSAGE', handleNewMessage);
    return () => webSocketManager.offMessage('NEW_MESSAGE', handleNewMessage);
  }, [dispatch, rootSessionId]);

  const navigateTo = (target: ISession) => {
    dispatch({ type: 'session/addSession', payload: target });
    setSessionId?.(`${target.sessionId}`);
  };

  if (!isChild && children.length === 0) return null;

  const menuItems = children.map((child) => ({
    key: `${child.sessionId}`,
    label: (
      <span className={styles.childSessionMenuItem}>
        <span className={styles.childSessionMenuAvatar}>{child.sessionName?.slice(0, 1) || 'A'}</span>
        <span className={styles.childSessionMenuCopy}>
          <strong>{child.sessionName || '子 Agent'}</strong>
          <span>{getExternalSessionExt(child, 'external_session_status') || '已同步'}</span>
        </span>
      </span>
    ),
  }));

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
        menu={{
          items: menuItems,
          selectedKeys: isChild ? [`${sessionId}`] : [],
          onClick: ({ key }) => {
            const target = children.find((child) => `${child.sessionId}` === `${key}`);
            if (target) navigateTo(target);
          },
        }}
      >
        <button type="button" className={styles.childSessionsButton} aria-label="打开子会话列表">
          <TeamOutlined />
          {children.length} 个子代理
          <DownOutlined />
        </button>
      </Dropdown>
    </div>
  );
}

export default ChildSessionNavigator;
