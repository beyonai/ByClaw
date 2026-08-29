import React from 'react';
import { useDispatch, useSelector } from '@umijs/max';
import { Drawer, Progress } from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  RightOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import classnames from 'classnames';

import useGlobal from '@/hooks/useGlobal';
import type { ISession } from '@/typescript/session';

import styles from './AgentTeamsActivity.module.less';

export interface AgentTeamsMember {
  id: string;
  byclawSessionId?: string;
  name: string;
  role?: string;
  status?: string;
  activity?: 'working' | 'idle' | 'unknown';
  progress?: number;
  done?: number;
  total?: number;
  currentTask?: string;
  unread?: number;
}

export interface AgentTeamsTask {
  id: string;
  subject: string;
  status?: string;
  state?: 'blocked' | 'open' | 'running' | 'completed';
  assignee?: string;
  dependencies?: string[];
  depth?: number;
}

export interface AgentTeamsSnapshot {
  source?: string;
  schemaVersion: 2;
  eventKind: 'agent-teams/snapshot';
  archived?: boolean;
  capturedAt?: string;
  team: {
    teamId: string;
    name?: string;
    description?: string;
    captainSessionId: string;
    members?: AgentTeamsMember[];
    tasks?: AgentTeamsTask[];
    messageCount?: number;
    captainInbox?: Array<{ from: string; content: string }>;
  };
}

export const isAgentTeamsSnapshot = (value: unknown): value is AgentTeamsSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 2 &&
    candidate.eventKind === 'agent-teams/snapshot' &&
    Boolean(candidate.team && typeof candidate.team === 'object')
  );
};

const memberInitial = (name: string) => name.trim().slice(0, 1).toUpperCase() || 'A';

const activityLabel = (member: AgentTeamsMember) => {
  if (member.activity === 'working') return '执行中';
  if (member.status === 'completed' || member.activity === 'idle') return '已完成';
  return '待命';
};

const taskStateLabel = (task: AgentTeamsTask) => {
  if (task.state === 'completed' || task.status === 'completed') return '已完成';
  if (task.state === 'running' || task.status === 'in_progress') return '进行中';
  if (task.state === 'blocked') return '阻塞';
  return '待处理';
};

interface AgentTeamsActivityProps {
  snapshot: AgentTeamsSnapshot;
}

function AgentTeamsActivity({ snapshot }: AgentTeamsActivityProps) {
  const dispatch = useDispatch();
  const { sessionId, setSessionId } = useGlobal();
  const sessionList = useSelector((state: any) => state.session?.sessionList || []) as ISession[];
  const [panelOpen, setPanelOpen] = React.useState(false);

  const members = snapshot.team.members || [];
  const tasks = snapshot.team.tasks || [];
  const completedTasks = tasks.filter((task) => task.state === 'completed' || task.status === 'completed').length;
  const parentSession = sessionList.find((session) => `${session.sessionId}` === `${sessionId}`);
  const teamName = snapshot.team.name || snapshot.team.teamId;

  const openChildSession = (member: AgentTeamsMember) => {
    if (!member.byclawSessionId) return;
    const childSessionId = `${member.byclawSessionId}`;
    const parentSessionId = Number(parentSession?.sessionId || sessionId);
    dispatch({
      type: 'session/addSession',
      payload: {
        ...parentSession,
        sessionId: childSessionId,
        parentSessionId: Number.isFinite(parentSessionId) ? parentSessionId : undefined,
        sessionName: member.name || '子 Agent',
        sessionContent: member.currentTask,
        createTime: parentSession?.createTime || '',
        updateTime: parentSession?.updateTime || '',
        sessionExts: [
          { extParamName: '外部会话标识', extParamCode: 'external_session_id', extParamValue: member.id },
          {
            extParamName: '外部会话状态',
            extParamCode: 'external_session_status',
            extParamValue: member.status || '',
          },
        ],
      },
    });
    setPanelOpen(false);
    setSessionId?.(childSessionId);
  };

  return (
    <>
      <section className={styles.teamCard} aria-label={`Agent Team ${teamName}`}>
        <div className={styles.cardAccent} aria-hidden="true" />
        <div className={styles.cardHeader}>
          <div className={styles.teamMark} aria-hidden="true">
            <TeamOutlined />
          </div>
          <div className={styles.teamCopy}>
            <div className={styles.teamName}>{teamName}</div>
            <div className={styles.teamMeta}>
              {members.length} 位成员 · {completedTasks}/{tasks.length} 项任务完成
            </div>
          </div>
          <span className={classnames(styles.liveBadge, { [styles.archivedBadge]: snapshot.archived })}>
            {snapshot.archived ? '已归档' : '协作中'}
          </span>
          <button
            type="button"
            className={styles.panelTrigger}
            aria-label="打开 AgentTeams 活动面板"
            onClick={() => setPanelOpen(true)}
          >
            活动面板
            <RightOutlined />
          </button>
        </div>
        <div className={styles.memberStrip}>
          {members.slice(0, 5).map((member) => (
            <button
              type="button"
              key={member.id}
              className={styles.memberChip}
              disabled={!member.byclawSessionId}
              aria-label={member.byclawSessionId ? `打开${member.name}子会话` : `${member.name}子会话尚未就绪`}
              onClick={() => openChildSession(member)}
            >
              <span className={styles.miniAvatar}>{memberInitial(member.name)}</span>
              <span className={styles.memberChipName}>{member.name}</span>
            </button>
          ))}
        </div>
      </section>

      <Drawer
        open={panelOpen}
        width={440}
        placement="right"
        title="AgentTeams 活动面板"
        rootClassName={styles.activityDrawer}
        onClose={() => setPanelOpen(false)}
      >
        <div className={styles.panelHero}>
          <div className={styles.heroEyebrow}>{snapshot.source || 'EXTERNAL'} · LIVE ORCHESTRATION</div>
          <h2>{teamName}</h2>
          <p>{snapshot.team.description || '多 Agent 并行协作状态与任务进展'}</p>
          <div className={styles.heroStats}>
            <span>
              <strong>{members.length}</strong> 成员
            </span>
            <span>
              <strong>{tasks.length}</strong> 任务
            </span>
            <span>
              <strong>{snapshot.team.messageCount || 0}</strong> 消息
            </span>
          </div>
        </div>

        <section className={styles.panelSection}>
          <div className={styles.sectionHeading}>
            <span>成员动态</span>
            <span className={styles.sectionCount}>{members.length}</span>
          </div>
          <div className={styles.memberList}>
            {members.map((member) => (
              <button
                type="button"
                key={member.id}
                className={styles.memberRow}
                disabled={!member.byclawSessionId}
                aria-label={member.byclawSessionId ? `打开${member.name}子会话` : `${member.name}子会话尚未就绪`}
                onClick={() => openChildSession(member)}
              >
                <span className={styles.avatar}>{memberInitial(member.name)}</span>
                <span className={styles.memberMain}>
                  <span className={styles.memberHeading}>
                    <strong>{member.name}</strong>
                    <span
                      className={classnames(styles.activityState, {
                        [styles.activityWorking]: member.activity === 'working',
                      })}
                    >
                      {activityLabel(member)}
                    </span>
                  </span>
                  <span className={styles.memberRole}>{member.role || 'AgentTeams 成员'}</span>
                  {member.currentTask && <span className={styles.currentTask}>{member.currentTask}</span>}
                  <span className={styles.progressLine}>
                    <Progress percent={member.progress || 0} showInfo={false} size="small" />
                    <span>{member.progress || 0}%</span>
                  </span>
                </span>
                <ArrowRightOutlined className={styles.openArrow} />
              </button>
            ))}
          </div>
        </section>

        <section className={styles.panelSection}>
          <div className={styles.sectionHeading}>
            <span>任务队列</span>
            <span className={styles.sectionCount}>{tasks.length}</span>
          </div>
          <div className={styles.taskList}>
            {tasks.map((task) => {
              const completed = task.state === 'completed' || task.status === 'completed';
              return (
                <article key={task.id} className={styles.taskRow}>
                  <span className={classnames(styles.taskIcon, { [styles.taskIconDone]: completed })}>
                    {completed ? <CheckCircleFilled /> : <ClockCircleOutlined />}
                  </span>
                  <span className={styles.taskCopy}>
                    <strong>{task.subject}</strong>
                    <span>{task.assignee || '待分配'}</span>
                  </span>
                  <span className={classnames(styles.taskState, { [styles.taskStateDone]: completed })}>
                    {taskStateLabel(task)}
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      </Drawer>
    </>
  );
}

export default AgentTeamsActivity;
