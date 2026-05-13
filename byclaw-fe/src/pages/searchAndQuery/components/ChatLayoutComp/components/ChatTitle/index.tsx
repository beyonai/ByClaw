import React, { useContext } from 'react';
import classnames from 'classnames';
import MenuUnfoldOutlined from '@ant-design/icons/MenuUnfoldOutlined';
import MenuFoldOutlined from '@ant-design/icons/MenuFoldOutlined';
import ChatAvatar from '@/components/ChatAvatar';
import { ISession } from '@/typescript/session';
import styles from './ChatTitle.module.less';
import { SearchAndQueryContext } from '@/pages/searchAndQuery';

interface ChatTitleProps {
  sessionId?: string;
  currentSession?: ISession;
}

export default function ChatTitle(props: ChatTitleProps) {
  const { sessionId, currentSession } = props;

  const { setIsWorkSpaceCollapsed, isWorkSpaceCollapsed } = useContext(SearchAndQueryContext);

  return (
    <>
      <nav className={styles.chatTitle}>
        {currentSession?.sessionName && (
          <div className={classnames(styles.chatTitleWrap, 'ub ub-ac gap8')}>
            {currentSession && <ChatAvatar session={currentSession} size={32} />}

            <div className={styles.chatTitle}>{currentSession?.sessionName}</div>
            <div className={styles.actions}>
              {sessionId && (
                <span
                  className={styles.btn}
                  onClick={() => {
                    setIsWorkSpaceCollapsed((prevState: boolean) => !prevState);
                  }}
                >
                  {isWorkSpaceCollapsed && <MenuFoldOutlined />}
                  {!isWorkSpaceCollapsed && <MenuUnfoldOutlined />}
                </span>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
