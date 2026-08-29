import React from 'react';
import { useDispatch } from '@umijs/max';
import { Dropdown } from 'antd';
import { ArrowLeftOutlined, DownOutlined, TeamOutlined } from '@ant-design/icons';

import useGlobal from '@/hooks/useGlobal';
import { qryConversations } from '@/service/layout';
import type { ISession } from '@/typescript/session';
import { getExternalSessionExt } from '@/utils/scopedSession';

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
  const isChild = Boolean(currentSession?.parentSessionId);
  const rootSessionId = isChild ? `${currentSession?.parentSessionId || ''}` : `${sessionId || ''}`;

  React.useEffect(() => {
    if (!rootSessionId) return undefined;
    let cancelled = false;
    let loadingChildren = false;
    const loadChildren = async () => {
      if (loadingChildren) return;
      loadingChildren = true;
      try {
        const response = await qryConversations({ parentSessionId: rootSessionId, pageNum: 1, pageSize: 100 });
        if (cancelled) return;
        const childSessions = (response?.list || []).map((item: ISession) => ({
          ...item,
          sessionId: `${item.sessionId}`,
        }));
        setChildren(childSessions);
        childSessions.forEach((child: ISession) => dispatch({ type: 'session/addSession', payload: child }));
      } catch {
        // Keep the last hierarchy while the next refresh retries.
      } finally {
        loadingChildren = false;
      }
    };
    void loadChildren();
    const refreshTimer = window.setInterval(loadChildren, 1500);

    if (isChild) {
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
    } else {
      setParent(currentSession);
    }
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [currentSession, dispatch, isChild, rootSessionId]);

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
