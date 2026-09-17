// 用户可见提示在使用时读取当前语言，接口值与用户内容保持原样。
import React from 'react';
import { getIntl, useDispatch, useIntl } from '@umijs/max';
import { Drawer, Pagination, Progress } from 'antd';
import { ArrowRightOutlined, CheckCircleFilled, ClockCircleOutlined, TeamOutlined } from '@ant-design/icons';
import classnames from 'classnames';

import type { AgentTeamsMember, AgentTeamsTask } from '@/components/MessagesComp/ToolCall/AgentTeamsActivity';
import {
  applyAgentTeamsChildProjection,
  useAgentTeamsSnapshot,
} from '@/components/MessagesComp/ToolCall/agentTeamsStore';
import activityStyles from '@/components/MessagesComp/ToolCall/AgentTeamsActivity.module.less';
import useGlobal from '@/hooks/useGlobal';
import type { ISession } from '@/typescript/session';
import webSocketManager from '@/utils/websocket';

import styles from './ChatTitle.module.less';

const TASK_PAGE_SIZE = 5;

const activityLabel = (member: AgentTeamsMember) => {
  if (member.activity === 'working') return getIntl().formatMessage({ id: 'ui.team.running' });
  if (member.status === 'cancelled') return getIntl().formatMessage({ id: 'ui.team.stopped' });
  if (member.status === 'completed') return getIntl().formatMessage({ id: 'ui.team.completed' });
  return getIntl().formatMessage({ id: 'ui.team.idle' });
};

const taskStateLabel = (task: AgentTeamsTask) => {
  if (task.status === 'cancelled') return getIntl().formatMessage({ id: 'ui.team.cancelled' });
  if (task.status === 'failed') return getIntl().formatMessage({ id: 'ui.team.failed' });
  if (task.state === 'completed' || task.status === 'completed')
    return getIntl().formatMessage({ id: 'ui.team.completed' });
  if (task.state === 'running' || task.status === 'in_progress' || task.status === 'claimed')
    return getIntl().formatMessage({ id: 'ui.team.inProgress' });
  if (task.state === 'blocked') return getIntl().formatMessage({ id: 'ui.team.blocked' });
  return getIntl().formatMessage({ id: 'ui.team.pending' });
};

interface Props {
  rootSessionId: string;
  currentSession?: ISession;
}

function AgentTeamsHeaderActivity({ rootSessionId, currentSession }: Props) {
  const dispatch = useDispatch();
  const intl = useIntl();
  const { setSessionId } = useGlobal();
  const snapshot = useAgentTeamsSnapshot(rootSessionId);
  const [open, setOpen] = React.useState(false);
  const [taskPage, setTaskPage] = React.useState(1);

  React.useEffect(() => setTaskPage(1), [snapshot?.capturedAt, snapshot?.team.teamId]);
  React.useEffect(() => {
    if (!rootSessionId) return undefined;
    const handleNewMessage = (message: any) => {
      const projection = message?.data || message;
      applyAgentTeamsChildProjection(rootSessionId, projection, message?.streamId);
    };
    webSocketManager.onMessage('NEW_MESSAGE', handleNewMessage);
    webSocketManager.onMessage('SCOPED_SESSION_STATUS', handleNewMessage);
    return () => {
      webSocketManager.offMessage('NEW_MESSAGE', handleNewMessage);
      webSocketManager.offMessage('SCOPED_SESSION_STATUS', handleNewMessage);
    };
  }, [rootSessionId]);
  if (!snapshot) return null;

  const members = snapshot.team.members || [];
  const tasks = snapshot.team.tasks || [];
  const pageStart = (taskPage - 1) * TASK_PAGE_SIZE;
  const visibleTasks = tasks.slice(pageStart, pageStart + TASK_PAGE_SIZE);
  const teamName = snapshot.team.name || snapshot.team.teamId;

  const openChildSession = (member: AgentTeamsMember) => {
    if (!member.byclawSessionId) return;
    const child: ISession = {
      ...currentSession,
      sessionId: `${member.byclawSessionId}`,
      parentSessionId: rootSessionId,
      sessionName: member.name || intl.formatMessage({ id: 'ui.team.childAgent' }),
      sessionContent: member.currentTask,
      sessionExts: [
        { extParamName: '外部会话标识', extParamCode: 'external_session_id', extParamValue: member.id },
        {
          extParamName: '外部会话状态',
          extParamCode: 'external_session_status',
          extParamValue: member.status || '',
        },
      ],
    } as ISession;
    dispatch({ type: 'session/addSession', payload: child });
    setOpen(false);
    setSessionId?.(`${member.byclawSessionId}`);
  };

  return (
    <>
      <button
        type="button"
        className={styles.teamActivityButton}
        aria-label={intl.formatMessage({ id: 'agentTeamsActivity.openPanel' })}
        onClick={() => setOpen(true)}
      >
        <TeamOutlined />
        {intl.formatMessage({ id: 'ui.team.activity' })}
        <span>{members.length}</span>
      </button>
      <Drawer
        open={open}
        width={440}
        placement="right"
        title={intl.formatMessage({ id: 'agentTeamsActivity.panelTitle' })}
        rootClassName={activityStyles.activityDrawer}
        onClose={() => setOpen(false)}
      >
        <div className={activityStyles.panelHero}>
          <h2>{teamName}</h2>
          <p>{snapshot.team.description || intl.formatMessage({ id: 'ui.team.description' })}</p>
          <div className={activityStyles.heroStats}>
            <span>
              <strong>{members.length}</strong> {intl.formatMessage({ id: 'ui.team.members' })}
            </span>
            <span>
              <strong>{tasks.length}</strong> {intl.formatMessage({ id: 'ui.team.tasks' })}
            </span>
            <span>
              <strong>{snapshot.team.messageCount || 0}</strong> {intl.formatMessage({ id: 'ui.team.messages' })}
            </span>
          </div>
        </div>

        <section className={activityStyles.panelSection}>
          <div className={activityStyles.sectionHeading}>
            <span>{intl.formatMessage({ id: 'ui.team.memberActivity' })}</span>
            <span className={activityStyles.sectionCount}>{members.length}</span>
          </div>
          <div className={activityStyles.memberList}>
            {members.map((member) => (
              <button
                type="button"
                key={member.id}
                className={activityStyles.memberRow}
                disabled={!member.byclawSessionId}
                aria-label={
                  member.byclawSessionId
                    ? intl.formatMessage({ id: 'ui.team.openChild' }, { name: member.name })
                    : intl.formatMessage({ id: 'ui.team.childNotReady' }, { name: member.name })
                }
                onClick={() => openChildSession(member)}
              >
                <span className={activityStyles.avatar}>{member.name.trim().slice(0, 1) || 'A'}</span>
                <span className={activityStyles.memberMain}>
                  <span className={activityStyles.memberHeading}>
                    <strong>{member.name}</strong>
                    <span
                      className={classnames(activityStyles.activityState, {
                        [activityStyles.activityWorking]: member.activity === 'working',
                      })}
                    >
                      {activityLabel(member)}
                    </span>
                  </span>
                  <span className={activityStyles.memberRole}>
                    {member.role || intl.formatMessage({ id: 'ui.team.member' })}
                  </span>
                  {member.currentTask && <span className={activityStyles.currentTask}>{member.currentTask}</span>}
                  <span className={activityStyles.progressLine}>
                    <Progress percent={member.progress || 0} showInfo={false} size="small" />
                    <span>{member.progress || 0}%</span>
                  </span>
                </span>
                <ArrowRightOutlined className={activityStyles.openArrow} />
              </button>
            ))}
          </div>
        </section>

        <section className={activityStyles.panelSection}>
          <div className={activityStyles.sectionHeading}>
            <span>{intl.formatMessage({ id: 'ui.team.taskList' })}</span>
            <span className={activityStyles.sectionCount}>{tasks.length}</span>
          </div>
          <div className={activityStyles.taskList}>
            {visibleTasks.map((task) => {
              const completed = task.state === 'completed' || task.status === 'completed';
              return (
                <article key={task.id} className={activityStyles.taskRow}>
                  <span className={classnames(activityStyles.taskIcon, { [activityStyles.taskIconDone]: completed })}>
                    {completed ? <CheckCircleFilled /> : <ClockCircleOutlined />}
                  </span>
                  <span className={activityStyles.taskCopy}>
                    <strong>{task.subject}</strong>
                    <span>{task.assignee || intl.formatMessage({ id: 'ui.team.unassigned' })}</span>
                  </span>
                  <span className={classnames(activityStyles.taskState, { [activityStyles.taskStateDone]: completed })}>
                    {taskStateLabel(task)}
                  </span>
                </article>
              );
            })}
          </div>
          {tasks.length > TASK_PAGE_SIZE && (
            <Pagination
              current={taskPage}
              pageSize={TASK_PAGE_SIZE}
              total={tasks.length}
              showSizeChanger={false}
              hideOnSinglePage
              onChange={setTaskPage}
            />
          )}
        </section>
      </Drawer>
    </>
  );
}

export default AgentTeamsHeaderActivity;
