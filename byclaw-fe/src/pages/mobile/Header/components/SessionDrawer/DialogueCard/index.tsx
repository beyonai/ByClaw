import React from 'react';
import classnames from 'classnames';

import { Badge } from 'antd';

import { useDispatch, useNavigate, useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import ChatAvatar from '@/components/ChatAvatar';
import webSocketManager from '@/utils/websocket';

import { ISession } from '@/typescript/session';
import { IAgentCache } from '@/typescript/agent';

import styles from './index.module.less';

const MyBadge = (props: { item: ISession }) => {
  const { item } = props;
  const { unreadCount = 0, mentionCount } = item;

  if (Number(mentionCount) > 0) {
    return (
      <div className={styles.mentionTips}>
        <ChatAvatar session={item} size={32} />
        <span className={styles.tips}>@我</span>
      </div>
    );
  }

  return (
    <Badge count={unreadCount} dot={unreadCount > 0} size="small" style={{ padding: '0 3px' }}>
      <ChatAvatar session={item} size={24} />
    </Badge>
  );
};

const DialogueCard = ({ item, onClose }: { item: ISession; onClose: () => void }) => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { setAgentId, setSessionId, sessionId } = useGlobal();

  const { employeesList } = useSelector(({ employees }) => ({
    employeesList: employees.employeesList,
  }));

  const renderTitle = (item: ISession) => {
    const { sessionName } = item;

    return (
      <div className={classnames(styles.titleWrap, 'ub-f1')}>
        <div className={classnames(styles.dialogueItemContent, 'full-width')}>
          <div className={styles.dialogueItemContentBox}>
            <div>
              <div className={classnames(styles.dialogueTitle, 'ellipsis')}>{sessionName}</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      key={item.sessionId}
      className={classnames(styles.dialogueItem, 'ub ub-ac pointer', {
        [styles.activeItem]: `${sessionId}` === `${item.sessionId}`,
      })}
      onClick={() => {
        const { sessionId, objectId, objectType, unreadCount = 0 } = item;
        setSessionId?.(`${sessionId}`);

        // 通知会话
        if (objectType === 'Notification') {
          if (unreadCount > 0) {
            // 调用notice/batchReadNotice action，批量设置所有通知为已读
            dispatch({
              type: 'notice/batchReadNotice',
              payload: {
                read: 'ALL',
              },
            });

            dispatch({
              type: 'session/updateSession',
              payload: {
                ...item,
                unreadCount: 0,
              },
            });

            // 清除websocket产生的红点
            webSocketManager.clearNotification();
          }

          navigate('/mobile/notice');
        } else {
          const employees = employeesList?.find((item: IAgentCache) => `${item.agentId}` === `${objectId}`);
          if (employees) {
            setAgentId?.(`${objectId}`);
          }
        }

        onClose?.();
      }}
    >
      <div className={styles.avatarWrapper}>
        <MyBadge item={item} />
      </div>
      {renderTitle(item)}
    </div>
  );
};

export default React.memo(DialogueCard);
