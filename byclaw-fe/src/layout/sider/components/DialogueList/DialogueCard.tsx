import React, { useState, useMemo } from 'react';
// @ts-ignore
import { useDispatch, useIntl, useNavigate, useSelector } from '@umijs/max';
import { Badge, Dropdown, Input, Popconfirm } from 'antd';
import classnames from 'classnames';
import { trim, isFunction, isEmpty } from 'lodash';

import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import { UserState } from '@/models/common/user';
import { ISessionState } from '@/models/session';
import ChatAvatar from '@/components/ChatAvatar';

import { processSessionContent, formatTime } from './util';
import { getAgentPath } from '@/utils/agent';
import webSocketManager from '@/utils/websocket';
import useTracker from '@/hooks/useTracker';

import { ISession } from '@/typescript/session';
import { IAgentCache } from '@/typescript/agent';

import styles from './index.module.less';

interface ConnectState {
  session: ISessionState;
  user: UserState;
}

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
      <ChatAvatar session={item} size={32} />
    </Badge>
  );
};

const DialogueCard = ({
  item,
  onSelect,
  cannotActionList = [],
}: {
  item: ISession;
  onSelect?: (item: ISession) => void;
  cannotActionList?: string[];
}) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { setAgentId, setSessionId, sessionId } = useGlobal();
  const { trackerEmployeeClick } = useTracker();

  const { sessionLoading, editLoading, delLoading } = useSelector((state: ConnectState) => state.session);
  const { employeesList } = useSelector(({ employees }) => ({
    employeesList: employees.employeesList,
  }));

  const [editName, setEditName] = React.useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const onRemove = (payload: { sessionId: string }): any => {
    return dispatch({
      type: 'session/deleteSession',
      payload,
    });
  };

  const onEdit = (payload: { sessionName: string; sessionId: string }) => {
    dispatch({
      type: 'session/editSession',
      payload,
    });
    setEditingSessionId(null);
  };

  const renderTitle = (item: ISession) => {
    const { sessionName, sessionContent } = item;
    const processedContent = processSessionContent(sessionContent);

    return (
      <div
        className={classnames(styles.titleWrap, 'ub-f1')}
        onClick={(e) => {
          if (editingSessionId === item.sessionId) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {editingSessionId === item.sessionId && (
          <>
            <Input
              maxLength={20}
              onChange={(e) => {
                setEditName(trim(e.target.value));
              }}
              onPressEnter={() => {
                if (editLoading || sessionLoading) return;
                onEdit({ sessionName: editName, sessionId: item.sessionId });
              }}
              autoFocus
              value={editName}
              style={{ marginRight: '5px', color: '#000' }}
              onBlur={() => {
                if (editLoading || sessionLoading) return;
                onEdit({ sessionName: editName, sessionId: item.sessionId });
              }}
            />
          </>
        )}
        {editingSessionId !== item.sessionId && (
          <div className={classnames(styles.dialogueItemContent, 'full-width')}>
            <div className={styles.dialogueItemContentBox}>
              <div>
                <div className={classnames(styles.dialogueTitle, 'ellipsis')}>{sessionName}</div>
                <div className={classnames(styles.dialogueDesc, 'ellipsis')}>{processedContent}</div>
              </div>
              <div className={styles.createTime}>{formatTime(item.updateTime, item.createTime)}</div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const menuItems = useMemo(() => {
    const items = [];

    // 只有当 sessionType 不是 单聊h_h 时才显示编辑项
    if (!cannotActionList?.includes('edit')) {
      items.push({
        key: 'edit',
        label: (
          <span className={styles.menuItem}>
            <AntdIcon type="icon-a-Editbianji" style={{ marginRight: '10px' }} />
            {intl.formatMessage({ id: 'common.edit' })}
          </span>
        ),
      });
    }

    if (!cannotActionList.includes('delete')) {
      items.push({
        key: 'del',
        label: (
          <Popconfirm
            title={intl.formatMessage({ id: 'common.deleteTips' })}
            onConfirm={(e: any) => {
              e.preventDefault();
              e.stopPropagation();
              if (delLoading) return;
              onRemove({ sessionId: item.sessionId }).then(() => {
                if (sessionId === item.sessionId) {
                  setSessionId?.('');
                }
              });
            }}
          >
            <span className={styles.menuItem}>
              <AntdIcon type="icon-a-Deleteshanchu" style={{ marginRight: '10px' }} />
              {intl.formatMessage({ id: 'common.delete' })}
            </span>
          </Popconfirm>
        ),
        danger: true,
      });
    }

    return items;
  }, [cannotActionList, delLoading, editLoading, sessionLoading, sessionId, item]);

  return (
    <div
      key={item.sessionId}
      className={classnames(styles.dialogueItem, 'ub ub-ac pointer', {
        [styles.activeItem]: `${sessionId}` === `${item.sessionId}`,
      })}
      onClick={() => {
        const { sessionId, objectId, objectType, unreadCount = 0 } = item;

        if (isFunction(onSelect)) {
          onSelect(item);
          return;
        }

        if (editingSessionId === sessionId) return;

        if (Array.isArray(item.sessionExts) && item.sessionExts.length > 0) {
          dispatch({
            type: 'session/saveExtParamsBySessionId',
            payload: {
              sessionId,
              extParams: item.sessionExts.reduce((acc: Record<string, any>, item) => {
                acc[item.extParamCode] = item.extParamValue;
                return acc;
              }, {}),
            },
          });
        }

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

          navigate('/notice');
          return;
        }

        const employees = employeesList?.find((item: IAgentCache) => `${item.agentId}` === `${objectId}`);
        if (employees) {
          trackerEmployeeClick(employees, 'sessionAgentRedirect');

          setAgentId?.(`${objectId}`);
          navigate(getAgentPath(employees));
        } else {
          setAgentId?.('');
          navigate('/chat');
        }
      }}
    >
      <div className={styles.avatarWrapper}>
        <MyBadge item={item} />
      </div>
      {renderTitle(item)}
      {!isEmpty(menuItems) && editingSessionId !== item.sessionId && (
        <Dropdown
          menu={{
            items: menuItems,
            className: styles.dropdownMenu,
            onClick: ({ key, domEvent }) => {
              domEvent.preventDefault();
              domEvent.stopPropagation();
              if (key === 'edit') {
                setEditName(item?.sessionName ?? '');
                setEditingSessionId(item.sessionId);
              }
            },
          }}
        >
          {/* 一定要有父节点包着AntdIcon，否则会死循环更新页面全屏报错 */}
          <span
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
          >
            <AntdIcon type="icon-a-Moregengduo" />
          </span>
        </Dropdown>
      )}
    </div>
  );
};

export default React.memo(DialogueCard);
