import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';
import useTracker from '@/hooks/useTracker';
import { isNotificationSession } from '@/utils/session';

import { ISession } from '@/typescript/session';
import { IAgentCache } from '@/typescript/agent';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { clearEasyConfirmInputDraft } from '@/components/ChatLayoutComp/components/EasyConfirm';

import styles from './index.module.less';

interface ConnectState {
  session: ISessionState;
  user: UserState;
}

const MyBadge = (props: { item: ISession }) => {
  const { item } = props;
  const { unreadCount = 0, mentionCount } = item;
  const [isRunning, setIsRunning] = useState(() => chatSessionRuntimeManager.isSessionRunning(item.sessionId));

  useEffect(() => {
    const updateRunningState = () => {
      setIsRunning(chatSessionRuntimeManager.isSessionRunning(item.sessionId));
    };

    updateRunningState();
    return chatSessionRuntimeManager.subscribe(updateRunningState);
  }, [item.sessionId]);

  // 如果会话的状态是running，那么展示状态
  if (isRunning) {
    return (
      <Badge dot status="processing" size="small" style={{ padding: '0 3px' }}>
        <ChatAvatar session={item} size={32} />
      </Badge>
    );
  }

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
  onSessionEditOptimistic,
  onSessionEditRollback,
  onSessionDeleteOptimistic,
  onSessionDeleteRollback,
  cannotActionList = [],
  searchKeyword,
}: {
  item: ISession;
  onSelect?: (item: ISession) => void;
  // 项目空间使用独立缓存，编辑和删除时由父级立即更新，并在接口失败后回滚。
  onSessionEditOptimistic?: (payload: { sessionId: string; sessionName: string }) => void;
  onSessionEditRollback?: (payload: { sessionId: string; sessionName: string }) => void;
  onSessionDeleteOptimistic?: (session: ISession) => void;
  onSessionDeleteRollback?: (session: ISession) => void;
  cannotActionList?: string[];

  /** 项目会话高级搜索时用于突出显示结果摘要中的关键字。 */
  searchKeyword?: string;
}) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { setAgentId, setSessionId, sessionId } = useGlobal();
  const { trackerEmployeeClick } = useTracker();
  const { clearDetailPanel } = React.useContext(SiderContentContext);

  const { sessionLoading, editLoading, delLoading } = useSelector((state: ConnectState) => state.session);
  const { employeesList } = useSelector(({ employees }) => ({
    employeesList: employees.employeesList,
  }));

  const [editName, setEditName] = React.useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [isOptimisticallyDeleted, setIsOptimisticallyDeleted] = useState(false);
  const effectiveCannotActionList = useMemo(
    () => (isNotificationSession(item) ? ['delete', 'edit'] : cannotActionList),
    [cannotActionList, item]
  );
  const onRemove = useCallback(
    (payload: { sessionId: string }): any => {
      return dispatch({
        type: 'session/deleteSession',
        payload,
      });
    },
    [dispatch]
  );

  const handleDelete = useCallback(() => {
    const rollbackDelete = () => {
      setIsOptimisticallyDeleted(false);
      onSessionDeleteRollback?.(item);
    };

    // 删除确认后立即隐藏卡片；接口失败时恢复原会话，避免列表长时间停留在旧状态。
    setIsOptimisticallyDeleted(true);
    onSessionDeleteOptimistic?.(item);
    void Promise.resolve(onRemove({ sessionId: item.sessionId }))
      .then((deletedSessionId) => {
        if (!deletedSessionId) {
          rollbackDelete();
          return;
        }
        if (sessionId === item.sessionId) {
          setSessionId?.('');
        }
      })
      .catch(() => {
        rollbackDelete();
      });
  }, [item, onRemove, onSessionDeleteOptimistic, onSessionDeleteRollback, sessionId, setSessionId]);

  const onEdit = (payload: { sessionName: string; sessionId: string }) => {
    const previousSessionName = item.sessionName || '';
    const updateSessionName = (sessionName: string) => {
      dispatch({
        type: 'session/updateSession',
        payload: {
          ...item,
          sessionName,
        },
      });
    };
    const rollbackSessionName = () => {
      const rollbackPayload = { ...payload, sessionName: previousSessionName };
      updateSessionName(previousSessionName);
      onSessionEditRollback?.(rollbackPayload);
    };

    // 先回写可见列表，接口失败时再恢复保存前名称，避免编辑期间持续展示旧值。
    updateSessionName(payload.sessionName);
    onSessionEditOptimistic?.(payload);
    setEditingSessionId(null);
    void Promise.resolve(
      dispatch({
        type: 'session/editSession',
        payload,
      })
    )
      .then((editedSessionId) => {
        if (!editedSessionId) {
          rollbackSessionName();
        }
      })
      .catch(() => {
        rollbackSessionName();
      });
  };

  const renderTitle = (item: ISession) => {
    const {
      sessionName,
      sessionContent,
      matchText,
      matchType,
      matchedEmployeeName,
      matchedEmployeeMatchField,
      matchedEmployeeMatchText,
    } = item;
    let resultContent = matchText || sessionContent;
    if (matchType === 'DIGITAL_EMPLOYEE') {
      resultContent = intl.formatMessage(
        {
          id:
            matchedEmployeeMatchField === 'DESCRIPTION'
              ? 'projectSpace.searchMatch.digitalEmployeeDescription'
              : 'projectSpace.searchMatch.digitalEmployeeName',
        },
        {
          employeeName: matchedEmployeeName || '-',
          matchText: matchedEmployeeMatchText || matchedEmployeeName || '-',
        }
      );
    }
    const processedContent = processSessionContent(resultContent);
    const normalizedKeyword = trim(searchKeyword || '');
    const renderProcessedContent = () => {
      if (!normalizedKeyword || typeof processedContent !== 'string') return processedContent;

      const lowerContent = processedContent.toLocaleLowerCase();
      const lowerKeyword = normalizedKeyword.toLocaleLowerCase();
      const parts: React.ReactNode[] = [];
      let startIndex = 0;
      let matchIndex = lowerContent.indexOf(lowerKeyword, startIndex);

      while (matchIndex !== -1) {
        if (matchIndex > startIndex) {
          parts.push(processedContent.slice(startIndex, matchIndex));
        }
        parts.push(
          <mark key={`${matchIndex}_${startIndex}`} className={styles.searchMatchHighlight}>
            {processedContent.slice(matchIndex, matchIndex + normalizedKeyword.length)}
          </mark>
        );
        startIndex = matchIndex + normalizedKeyword.length;
        matchIndex = lowerContent.indexOf(lowerKeyword, startIndex);
      }
      if (startIndex < processedContent.length) {
        parts.push(processedContent.slice(startIndex));
      }
      return parts.length ? parts : processedContent;
    };

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
                <div
                  className={classnames(styles.dialogueDesc, 'ellipsis')}
                  title={typeof processedContent === 'string' ? processedContent : undefined}
                >
                  {renderProcessedContent()}
                </div>
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
    if (!effectiveCannotActionList?.includes('edit')) {
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

    if (!effectiveCannotActionList.includes('delete')) {
      items.push({
        key: 'del',
        label: (
          <Popconfirm
            title={intl.formatMessage({ id: 'common.deleteTips' })}
            onConfirm={(e: any) => {
              e.preventDefault();
              e.stopPropagation();
              if (delLoading || isOptimisticallyDeleted) return;
              handleDelete();
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
  }, [delLoading, editLoading, effectiveCannotActionList, sessionLoading, item, isOptimisticallyDeleted, handleDelete]);

  if (isOptimisticallyDeleted) {
    return null;
  }

  return (
    <div
      key={item.sessionId}
      className={classnames(styles.dialogueItem, 'ub ub-ac pointer', {
        [styles.activeItem]: `${sessionId}` === `${item.sessionId}`,
      })}
      onClick={() => {
        const { sessionId, objectId, unreadCount = 0 } = item;

        if (isFunction(onSelect) && !isNotificationSession(item)) {
          onSelect(item);
          return;
        }

        if (editingSessionId === sessionId) return;
        clearDetailPanel?.();
        // 普通会话列表切换时也清除目标会话旧草稿，输入框只保留当前会话详情对应的默认员工。
        clearEasyConfirmInputDraft(sessionId);

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
        if (isNotificationSession(item)) {
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

            dispatch({
              type: 'session/updateUnreadInfo',
              payload: {
                totalUnread: 0,
              },
            });
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
