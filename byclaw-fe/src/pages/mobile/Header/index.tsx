import React, { useState } from 'react';
import classNames from 'classnames';
import { useIntl, useSelector } from '@umijs/max';
import { message, Badge } from 'antd';

import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import { getSystemConfigByStorage } from '@/utils/system';

import ChatAvatar from '@/components/ChatAvatar';

import SessionDrawer from './components/SessionDrawer';
import { ISession } from '@/typescript/session';

import styles from './index.module.less';

const HeaderPage = () => {
  const { sessionId, agentId, setAgentId, setSessionId } = useGlobal();

  const intl = useIntl();

  const [open, setOpen] = useState(false);

  const { sessionList } = useSelector(({ session }: any) => ({
    sessionList: session.sessionList,
  }));

  const { unreadInfo } = useSelector(({ session }: any) => ({
    unreadInfo: session.unreadInfo,
  }));
  const { totalUnread } = unreadInfo;

  const onClose = React.useCallback(() => {
    setOpen(false);
  }, []);

  const curSession: ISession | undefined = React.useMemo(() => {
    return sessionList?.find((item: ISession) => item.sessionId === sessionId);
  }, [sessionList, sessionId]);

  return (
    <>
      <div className={styles.header}>
        <div className={classNames(styles.headerBox, 'ub ub-ac gap12')}>
          <div>
            <Badge dot={Number(totalUnread) > 0} count={totalUnread > 0 ? 1 : undefined} size="small">
              <AntdIcon type="icon-caidan2" style={{ fontSize: '24px' }} onClick={() => setOpen(true)} />
            </Badge>
          </div>
          <div className="ub-f1">
            {curSession ? (
              <div className="ub ub-ac ub-pc gap8">
                <div style={{ minWidth: '24px' }}>
                  <ChatAvatar session={curSession} size={24} />
                </div>
                <span className="ellipsis" style={{ flex: '0 1 auto' }}>
                  {curSession?.sessionName}
                </span>
              </div>
            ) : (
              <div className="ub ub-ac ub-pc">
                {getSystemConfigByStorage().title || intl.formatMessage({ id: 'messageList.defaultAIName' })}
              </div>
            )}
          </div>
          <div>
            <AntdIcon
              type="icon-xinjianduihua"
              style={{ fontSize: '24px' }}
              onClick={() => {
                if (agentId || sessionId) {
                  setAgentId?.('');
                  setSessionId?.('');
                } else {
                  message.success('已经是最新会话');
                }
              }}
            />
          </div>
        </div>
      </div>
      <SessionDrawer open={open} onClose={onClose} />
    </>
  );
};

export default HeaderPage;
