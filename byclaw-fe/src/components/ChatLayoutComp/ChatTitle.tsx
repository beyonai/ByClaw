import React, { useRef } from 'react';
import classnames from 'classnames';
import Achievements, { TriggerRef } from '@/pages/workSpace/Achievements';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import ChatAvatar from '@/components/ChatAvatar';
import { ISession } from '@/typescript/session';
import { SessionType } from '@/constants/session';
import CreateTemplate from '@/components/ChatLayoutComp/components/CreateTemplate';
import styles from './ChatTitle.module.less';
import { IAgentType } from '@/typescript/agent';
import NullableAntdCompWithAnim from '../NullableAntdCompWithAnim';
import { isAdminVip } from '@/utils/auth';
import { useSelector, useIntl } from '@umijs/max';

interface ChatTitleProps {
  sessionId?: string;
  currentSession?: ISession;
  suffix?: React.ReactNode;
  lastAnswer?: any;
  agentType: IAgentType;
}

export default function ChatTitle(props: ChatTitleProps) {
  const { sessionId, currentSession } = props;
  const intl = useIntl();
  const achievementRef = useRef<TriggerRef>(null);
  const { EventEmitter } = useGlobal();
  const userInfo = useSelector((state: any) => state.user.userInfo);

  const [openTemplate, setOpenTemplate] = React.useState<boolean>(false);

  const onToggleAchievements = () => {
    achievementRef.current?.toggle();
  };

  const isSimpleSession = currentSession?.sessionType === SessionType.simple;

  return (
    <>
      <nav className={styles.chatTitle}>
        {currentSession?.sessionName && (
          <div className={classnames(styles.chatTitleWrap, 'ub ub-ac gap8')}>
            {currentSession && <ChatAvatar session={currentSession} size={32} />}

            <div className={styles.chatTitle}>{currentSession?.sessionName}</div>
            <div className={styles.actions}>
              {isAdminVip(userInfo) && (
                <span className={styles.btn} onClick={() => setOpenTemplate(true)} style={{ padding: '0 8px' }}>
                  <AntdIcon type="icon-a-View-grid-listliebiaochakanmoshi" />
                  <span>{intl.formatMessage({ id: 'chatTitle.saveAsTemplate' })}</span>
                </span>
              )}
              {!isSimpleSession && (
                <span className={styles.btn} onClick={onToggleAchievements}>
                  <AntdIcon type="icon-a-Folder-withdrawal-onetuichuwenjianjia1" />
                </span>
              )}
            </div>
          </div>
        )}
      </nav>
      {!!sessionId && (
        <Achievements.Trigger
          // container="#chat_wrapper,#employees_wrapper"
          ref={achievementRef}
          key={`${sessionId}_Achievements`}
          sessionId={sessionId}
          EventEmitter={EventEmitter}
        />
      )}
      <NullableAntdCompWithAnim open={openTemplate} key={`${sessionId}_NullableAntdCompWithAnim`}>
        <CreateTemplate
          open={openTemplate}
          originalSessionId={sessionId}
          onClose={() => setOpenTemplate(false)}
          agentType={props.agentType}
          sessionName={currentSession?.sessionName}
        />
      </NullableAntdCompWithAnim>
    </>
  );
}
