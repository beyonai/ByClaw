import React, { useEffect, useState } from 'react';
import { Button, Drawer, Empty, Spin } from 'antd';
import { MessageOutlined, PauseCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { getTaskPhases, type DevloopTaskState } from '@/service/devloop';
import { getAgentChatAvatar } from '@/utils/agent';
import styles from './index.module.less';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  canEnterSession?: boolean;
  onEnterSession?: (task: any) => void;
  // 只读查看会话:非处理人可看别人任务的会话消息(无输入框,不能对话)。
  onViewSession?: (task: any) => void;
}

// 同时兼容 v2 阶段状态和旧状态值，任务详情始终按同一视觉语义展示。
const PHASE_STATE_META: Record<string, { cls: string; icon: React.ReactNode; labelId: string }> = {
  completed: { cls: styles.phaseDone, icon: '✓', labelId: 'projectTaskDetail.status.done' },
  done: { cls: styles.phaseDone, icon: '✓', labelId: 'projectTaskDetail.status.done' },
  in_progress: { cls: styles.phaseActive, icon: '●', labelId: 'projectTaskDetail.status.running' },
  running: { cls: styles.phaseActive, icon: '●', labelId: 'projectTaskDetail.status.running' },
  paused: { cls: styles.phasePaused, icon: <PauseCircleOutlined />, labelId: 'projectTaskDetail.status.paused' },
  rejected: { cls: styles.phaseRejected, icon: <RollbackOutlined />, labelId: 'projectTaskDetail.status.rejected' },
  pending: { cls: styles.phaseWaiting, icon: '○', labelId: 'projectTaskDetail.status.pending' },
};

const PHASE_LABEL_IDS: Record<string, string> = {
  issue: 'projectTaskDetail.phase.issue',
  req: 'projectTaskDetail.phase.req',
  design: 'projectTaskDetail.phase.design',
  coder: 'projectTaskDetail.phase.coder',
  reviewer: 'projectTaskDetail.phase.reviewer',
  tester: 'projectTaskDetail.phase.tester',
  pr: 'projectTaskDetail.phase.pr',
};

const dash = (value: any): string => (value === null || value === undefined || value === '' ? '-' : `${value}`);

const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  onClose,
  canEnterSession,
  onEnterSession,
  onViewSession,
}) => {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [phaseLoading, setPhaseLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<DevloopTaskState | null>(null);

  // 打开抽屉时按 sessionId 定点读取 v2 会话状态投影。
  useEffect(() => {
    if (!task?.sessionId || task?.stateAvailable === false) {
      setSnapshot(null);
      setPhaseLoading(false);
      return;
    }

    let cancelled = false;
    setPhaseLoading(true);
    getTaskPhases(Number(task.sessionId))
      .then((res: any) => {
        if (!cancelled) {
          setSnapshot(res?.data ?? res ?? null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPhaseLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [task?.sessionId, task?.stateAvailable]);

  const phases = snapshot?.stages || [];
  const currentPhase = snapshot?.currentStage?.stageId;
  const getPhaseLabel = (phaseKey?: string, fallback?: string) => {
    const messageId = PHASE_LABEL_IDS[`${phaseKey || ''}`];
    return messageId ? t(messageId) : fallback || phaseKey || '';
  };
  const currentPhaseLabel = getPhaseLabel(currentPhase, snapshot?.currentStage?.stageName);
  const progress = snapshot?.progress?.percent ?? task?.progress ?? 0;
  const phaseProgressText = currentPhaseLabel
    ? t('projectTaskDetail.progress.phase', { phase: currentPhaseLabel })
    : t('projectTaskDetail.status.notStarted');
  const progressSummary = t('projectTaskDetail.progress.summary', {
    phase: phaseProgressText,
    round: snapshot?.revision ? t('projectTaskDetail.progress.round', { round: snapshot.revision }) : '',
    progress,
  });
  const agentName = task?.agentName || t('projectTaskDetail.defaultAgentName');
  const agentAvatar = task?.avatar || task?.agentAvatar;
  const requirement = task?.requirementTitle || task?.requirementOriginId;

  return (
    <Drawer
      title={t('projectTaskDetail.title')}
      className={styles.taskDetailDrawer}
      open={!!task}
      onClose={onClose}
      width={640}
      extra={
        task?.sessionId ? (
          canEnterSession ? (
            // 处理人:进入可对话会话。
            <Button type="primary" icon={<MessageOutlined />} onClick={() => onEnterSession?.(task)}>
              {t('projectTaskDetail.enterSession')}
            </Button>
          ) : onViewSession ? (
            // 非处理人:只读查看会话(有消息、无输入框)。
            <Button icon={<MessageOutlined />} onClick={() => onViewSession(task)}>
              {t('projectTaskDetail.viewSession')}
            </Button>
          ) : null
        ) : null
      }
    >
      {task && (
        <Spin spinning={phaseLoading}>
          <div className={styles.taskDetailDrawerContent}>
            <div className={styles.taskDetailTitle}>
              {task.title || task.taskName || t('projectTaskDetail.defaultTaskName')}
            </div>

            <div className={styles.taskHero}>
              <div className={styles.taskHeroAgent}>
                <span className={styles.taskHeroAvatar}>{getAgentChatAvatar(agentAvatar)}</span>
                <div>
                  <small>{t('projectTaskDetail.currentAgent')}</small>
                  <strong>{agentName}</strong>
                </div>
              </div>
              <div className={styles.taskHeroProgress}>
                {/* progress 元素承载动态百分比，避免使用内联宽度样式。 */}
                <progress className={styles.taskHeroProgressBar} value={progress} max={100} />
                <p>{progressSummary}</p>
              </div>
            </div>

            {snapshot?.status === 'paused' && snapshot.pause && (
              <div className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.pause.title')}</h3>
                <div className={styles.taskContextGrid}>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.pause.reason')}</label>
                    <strong>{dash(snapshot.pause.reason)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.pause.impact')}</label>
                    <strong>{dash(snapshot.pause.impact)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.pause.resumeCondition')}</label>
                    <strong>{dash(snapshot.pause.resume_condition)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.pause.decisionOwner')}</label>
                    <strong>{dash(snapshot.pause.decision_owner)}</strong>
                  </div>
                </div>
              </div>
            )}

            <div className={styles.phaseSection}>
              <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.context.title')}</h3>
              <div className={styles.taskContextGrid}>
                <div className={`${styles.taskContextItem} ${styles.taskContextItemFull}`}>
                  <label>{t('projectTaskDetail.context.requirement')}</label>
                  <strong>{dash(requirement)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>{t('projectTaskDetail.context.repository')}</label>
                  <strong>{dash(task.repoFullName)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>{t('projectTaskDetail.context.branch')}</label>
                  <strong>{dash(task.branchName)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>{t('projectTaskDetail.context.owner')}</label>
                  <strong>{dash(task.assignee)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>{t('projectTaskDetail.context.createdAt')}</label>
                  <strong>{task.createTime ? dayjs(task.createTime).format('YYYY-MM-DD HH:mm') : '-'}</strong>
                </div>
              </div>
            </div>

            <div className={styles.phaseSection}>
              <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.progress.title')}</h3>
              {phases.length === 0 ? (
                <Empty
                  description={
                    task?.stateAvailable === false
                      ? t('projectTaskDetail.emptyState')
                      : t('projectTaskDetail.emptyPhases')
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <div className={styles.phaseFlow}>
                  {phases.map((phase, index) => {
                    const meta = PHASE_STATE_META[phase.status] || PHASE_STATE_META.pending;
                    const isCurrent = phase.stageId === currentPhase;
                    return (
                      <div key={phase.stageId} className={`${styles.phaseNode} ${meta.cls}`}>
                        <span className={styles.phaseNodeMark}>
                          {['completed', 'done', 'paused', 'rejected'].includes(phase.status) ? meta.icon : index + 1}
                        </span>
                        <div className={styles.phaseNodeBody}>
                          <strong>
                            {getPhaseLabel(phase.stageId, phase.stageName)}
                            {isCurrent && (
                              <span className={styles.phaseCurrentDot}> · {t('projectTaskDetail.current')}</span>
                            )}
                          </strong>
                          <small>
                            {phase.statusLabel || t(meta.labelId)}
                            {phase.activity ? ` · ${phase.activity}` : ''}
                            {phase.loopCount
                              ? ` · ${t('projectTaskDetail.phase.loopCount', { count: phase.loopCount })}`
                              : ''}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Spin>
      )}
    </Drawer>
  );
};

export default TaskDetailDrawer;
