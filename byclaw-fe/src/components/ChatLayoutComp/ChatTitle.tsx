import React, { useRef } from 'react';
import classnames from 'classnames';
import Achievements, { TriggerRef } from '@/pages/workSpace/Achievements';
import AntdIcon from '@/components/AntdIcon';
import useGlobal from '@/hooks/useGlobal';
import ChatAvatar from '@/components/ChatAvatar';
import { ISession } from '@/typescript/session';
// import { SessionType } from '@/constants/session';
import CreateTemplate from '@/components/ChatLayoutComp/components/CreateTemplate';
import styles from './ChatTitle.module.less';
import { IAgentType } from '@/typescript/agent';
import NullableAntdCompWithAnim from '../NullableAntdCompWithAnim';
import { isAdminVip } from '@/utils/auth';
import { useSelector, useIntl } from '@umijs/max';
import VNC from './components/VNC';
import ProjectSessionActions from './ProjectSessionActions';
import ResourcePanelToggleIcon from './ChatResourceWorkspace/ResourcePanelToggleIcon';
import { sessionHandler } from '@/utils/session';
import { Button } from 'antd';

interface ChatTitleProps {
  sessionId?: string;
  currentSession?: ISession;
  suffix?: React.ReactNode;
  lastAnswer?: any;
  agentType: IAgentType;
  projectId?: number;
  resourceWorkspaceOpen?: boolean;
  onToggleResourceWorkspace?: () => void;
}

export default function ChatTitle(props: ChatTitleProps) {
  const { sessionId, currentSession } = props;
  const intl = useIntl();
  const achievementRef = useRef<TriggerRef>(null);
  const { EventEmitter } = useGlobal();
  const userInfo = useSelector((state: any) => state.user.userInfo);

  const [openTemplate, setOpenTemplate] = React.useState<boolean>(false);

  // const onToggleAchievements = () => {
  //   achievementRef.current?.toggle();
  // };

  // const isSimpleSession = currentSession?.sessionType === SessionType.simple;

  const titleSession = React.useMemo(() => {
    if (!sessionId) return undefined;

    // 缓存会话已带有列表计算出的头像和主题色，直接复用，避免再次标准化后图标样式与列表不一致。
    if (currentSession) {
      return {
        ...currentSession,
        sessionId: `${sessionId}`,
        sessionName: currentSession.sessionName || 'New Chat',
      };
    }

    // 项目/任务入口可能先切换 sessionId 再同步列表缓存，缓存缺失时仍保留标题行。
    return sessionHandler({
      sessionId: `${sessionId}`,
      sessionName: 'New Chat',
    } as ISession);
  }, [currentSession, sessionId]);

  return (
    <>
      <nav className={styles.chatTitle}>
        {titleSession && (
          <div className={classnames(styles.chatTitleWrap, 'ub ub-ac gap8')}>
            <ChatAvatar session={titleSession} size={32} />

            <div className={styles.chatTitle}>{titleSession.sessionName}</div>
            <div className={styles.actions}>
              <ProjectSessionActions
                projectId={props.projectId}
                sessionId={sessionId}
                sessionName={titleSession.sessionName}
              />
              <VNC />
              {props.onToggleResourceWorkspace && (
                <Button
                  type="text"
                  className={classnames(styles.projectActionButton, {
                    [styles.projectActionButtonActive]: props.resourceWorkspaceOpen,
                  })}
                  icon={<ResourcePanelToggleIcon className={styles.resourcePanelToggleIcon} />}
                  onClick={props.onToggleResourceWorkspace}
                  aria-label={intl.formatMessage({ id: 'chatResource.toggleList' })}
                />
              )}
              {isAdminVip(userInfo) && (
                <span className={styles.btn} onClick={() => setOpenTemplate(true)} style={{ padding: '0 8px' }}>
                  <AntdIcon type="icon-a-View-grid-listliebiaochakanmoshi" />
                  <span>{intl.formatMessage({ id: 'chatTitle.saveAsTemplate' })}</span>
                </span>
              )}
              {/* {!isSimpleSession && (
                <span className={styles.btn} onClick={onToggleAchievements}>
                  <AntdIcon type="icon-a-Folder-withdrawal-onetuichuwenjianjia1" />
                </span>
              )} */}
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
