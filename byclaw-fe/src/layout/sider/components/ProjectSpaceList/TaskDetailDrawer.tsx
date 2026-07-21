import React, { useEffect, useState } from 'react';
import { Button, Drawer, Empty, Spin } from 'antd';
import { MessageOutlined, PauseCircleOutlined } from '@ant-design/icons';
import { useDispatch, useNavigate } from '@umijs/max';
import dayjs from 'dayjs';
import useGlobal from '@/hooks/useGlobal';
import { getTaskPhases, type DevloopTaskState } from '@/service/devloop';
import styles from './index.module.less';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  onRefresh: () => void;
  projectId?: string | number;
  projectName?: string;
}

// v2 状态机阶段状态 → 展示样式
const PHASE_STATE_META: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  completed: { cls: styles.phaseDone, icon: '✓', label: '完成' },
  in_progress: { cls: styles.phaseActive, icon: '●', label: '进行中' },
  paused: { cls: styles.phaseRejected, icon: <PauseCircleOutlined />, label: '暂停' },
  pending: { cls: styles.phaseWaiting, icon: '○', label: '等待' },
};

// 取名字的首字/首字母做头像标识（Code Agent → CA，张三 → 张）
const initials = (name?: string): string => {
  if (!name) return 'AI';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2);
};

const dash = (v: any): string => (v === null || v === undefined || v === '' ? '-' : `${v}`);

// 会话即任务后，状态来自 self-developed-rules v2 会话投影；页面只读展示。
const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({ task, onClose, projectId, projectName }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { EventEmitter, setSessionId } = useGlobal();

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
        if (!cancelled) setSnapshot(res?.data ?? res ?? null);
      })
      .finally(() => {
        if (!cancelled) setPhaseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task?.sessionId, task?.stateAvailable]);

  const handleGoToChat = () => {
    if (!task?.sessionId) return;
    // 任务详情跳转绕过普通会话列表时，新增或覆盖同 ID 缓存，避免标题区域拿不到 currentSession。
    const taskSessionPayload = {
      ...task,
      sessionId: `${task.sessionId}`,
      sessionName: task.sessionName || task.title || task.taskName || '任务会话',
    };
    const targetProjectId = [projectId, task.projectId]
      .map((candidateProjectId) => Number(candidateProjectId))
      .find((candidateProjectId) => Number.isFinite(candidateProjectId) && candidateProjectId > 0);
    if (targetProjectId) {
      // 任务会话也保留项目上下文，聊天页标题才能显示任务进度与成果入口。
      EventEmitter.emit('projectSpace-session-context', {
        sessionId: `${task.sessionId}`,
        projectId: targetProjectId,
        projectName: projectName || task.projectName,
      });
      dispatch({
        type: 'session/addSession',
        payload: { ...taskSessionPayload, projectId: targetProjectId },
      });
      dispatch({
        type: 'session/updateSession',
        payload: { ...taskSessionPayload, projectId: targetProjectId },
      });
      setSessionId?.(String(task.sessionId));
      navigate('/chat', {
        state: {
          keepSiderActiveKey: 'sessions',
          from: 'projectSpace',
          projectId: targetProjectId,
          projectName: projectName || task.projectName,
        },
      });
    } else {
      dispatch({
        type: 'session/addSession',
        payload: taskSessionPayload,
      });
      dispatch({
        type: 'session/updateSession',
        payload: taskSessionPayload,
      });
      setSessionId?.(String(task.sessionId));
      navigate('/chat');
    }
    onClose();
  };

  const phases = snapshot?.stages || [];
  const currentPhase = snapshot?.currentStage?.stageId;
  const currentPhaseLabel = snapshot?.currentStage?.stageName;
  const taskLoopCount = snapshot?.loopCount || 0;
  const stageLoopCount = snapshot?.stageLoopCount || 0;
  const progress = snapshot?.progress?.percent || 0;

  const agentName = task?.agentName || 'Code Agent';
  // 展示需求标题（originId 对钉钉是消息ID乱码，仅作兜底）。
  const requirement = task?.requirementTitle || task?.requirementOriginId;

  return (
    <Drawer
      title="任务详情"
      className={styles.taskDetailDrawer}
      open={!!task}
      onClose={onClose}
      width={640}
      extra={
        task?.sessionId ? (
          <Button type="primary" icon={<MessageOutlined />} onClick={handleGoToChat}>
            进入会话
          </Button>
        ) : null
      }
    >
      {task && (
        <Spin spinning={phaseLoading}>
          <div className={styles.taskDetailDrawerContent}>
            {/* 任务标题与需求详情保持同一内容层级，避免占用抽屉头部展示空间。 */}
            <div className={styles.taskDetailTitle}>{task.title || task.taskName || '未命名任务'}</div>

            {/* Agent 执行概览：头像 + 当前 Agent + 阶段·任务总循环·当前环节循环·总进度 */}
            <div className={styles.taskHero}>
              <div className={styles.taskHeroAgent}>
                <span className={styles.taskHeroAvatar}>{initials(agentName)}</span>
                <div>
                  <small>当前执行 Agent</small>
                  <strong>{agentName}</strong>
                </div>
              </div>
              <div className={styles.taskHeroProgress}>
                <div className={styles.taskHeroTrack}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <p>
                  {currentPhaseLabel ? `${currentPhaseLabel}阶段` : '未开始'}
                  {taskLoopCount ? ` · 任务总循环 ${taskLoopCount} 次` : ''}
                  {stageLoopCount ? ` · 当前环节循环 ${stageLoopCount} 次` : ''} · 总进度 {progress}%
                </p>
              </div>
            </div>

            {snapshot?.status === 'paused' && snapshot.pause && (
              <div className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>暂停与恢复条件</h3>
                <div className={styles.taskContextGrid}>
                  <div className={styles.taskContextItem}>
                    <label>暂停原因</label>
                    <strong>{dash(snapshot.pause.reason)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>影响</label>
                    <strong>{dash(snapshot.pause.impact)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>恢复条件</label>
                    <strong>{dash(snapshot.pause.resume_condition)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>决策人</label>
                    <strong>{dash(snapshot.pause.decision_owner)}</strong>
                  </div>
                </div>
              </div>
            )}

            {/* 执行上下文 */}
            <div className={styles.phaseSection}>
              <h3 className={styles.phaseSectionTitle}>执行上下文</h3>
              <div className={styles.taskContextGrid}>
                <div className={styles.taskContextItem}>
                  <label>关联需求</label>
                  <strong>{dash(requirement)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>代码仓库</label>
                  <strong>{dash(task.repoFullName)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>工作分支</label>
                  <strong>{dash(task.branchName)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>任务负责人</label>
                  <strong>{dash(task.assignee)}</strong>
                </div>
                <div className={styles.taskContextItem}>
                  <label>创建时间</label>
                  <strong>{task.createTime ? dayjs(task.createTime).format('YYYY-MM-DD HH:mm') : '-'}</strong>
                </div>
              </div>
            </div>

            {/* 研发环节进度 */}
            <div className={styles.phaseSection}>
              <h3 className={styles.phaseSectionTitle}>研发环节进度</h3>
              {phases.length === 0 ? (
                <Empty
                  description={task?.stateAvailable === false ? '任务状态为空' : '暂无环节信息'}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <div className={styles.phaseFlow}>
                  {phases.map((p, idx) => {
                    const meta = PHASE_STATE_META[p.status] || PHASE_STATE_META.pending;
                    const isCurrent = p.stageId === currentPhase;
                    return (
                      <div key={p.stageId} className={`${styles.phaseNode} ${meta.cls}`}>
                        <span className={styles.phaseNodeMark}>
                          {p.status === 'completed' || p.status === 'paused' ? meta.icon : idx + 1}
                        </span>
                        <div className={styles.phaseNodeBody}>
                          <strong>
                            {p.stageName}
                            {isCurrent && <span className={styles.phaseCurrentDot}> · 当前</span>}
                          </strong>
                          <small>
                            {p.statusLabel || meta.label}
                            {p.activity ? ` · ${p.activity}` : ''}
                            {p.loopCount ? ` · 环节循环 ${p.loopCount} 次` : ''}
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
