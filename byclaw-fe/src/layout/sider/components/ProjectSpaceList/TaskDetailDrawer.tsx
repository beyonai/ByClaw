import React, { useEffect, useState } from 'react';
import { Drawer, Tag, Button, Spin, Empty } from 'antd';
import { MessageOutlined, RollbackOutlined } from '@ant-design/icons';
import { useDispatch, useNavigate, useSelector } from '@umijs/max';
import dayjs from 'dayjs';
import useGlobal from '@/hooks/useGlobal';
import { getTaskPhases } from '@/service/devloop';
import styles from './index.module.less';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  onRefresh: () => void;
  projectId?: string | number;
  projectName?: string;
}

// 环节状态 → 展示样式：通过/进行中/被打回/未开始
const PHASE_STATE_META: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  done: { cls: styles.phaseDone, icon: '✓', label: '完成' },
  running: { cls: styles.phaseActive, icon: '●', label: '进行中' },
  // 使用标准图标，避免 Unicode 回退箭头被浏览器渲染为彩色 emoji。
  rejected: { cls: styles.phaseRejected, icon: <RollbackOutlined />, label: '被打回' },
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

// 会话即任务后，状态存于 byai_session_ext 且看板只读，这里仅展示不提供修改入口。
const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({ task, onClose, projectId, projectName }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { EventEmitter, setSessionId } = useGlobal();
  const userInfo = useSelector(({ user }: any) => user.userInfo);

  const [phaseLoading, setPhaseLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<any>(null);

  const isMyTask = task?.createBy && userInfo?.userId && String(task.createBy) === String(userInfo.userId);

  // 打开抽屉时按 sessionId 拉环节进度；后端按需刷新（缓存缺失或有新消息才重算）。
  useEffect(() => {
    if (!task?.sessionId) {
      setSnapshot(null);
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
  }, [task?.sessionId]);

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

  const phases: any[] = snapshot?.phases || [];
  const kickbacks: any[] = snapshot?.kickbacks || [];
  const currentPhase = snapshot?.currentPhase;
  const currentPhaseLabel = phases.find((p) => p.key === currentPhase)?.label;
  const round = snapshot?.round;

  // 总进度按环节完成占比派生：done 记 1，running 记 0.5，除以环节总数。
  const progress = phases.length
    ? Math.round(
        (phases.reduce((acc, p) => acc + (p.status === 'done' ? 1 : p.status === 'running' ? 0.5 : 0), 0) /
          phases.length) *
          100
      )
    : 0;

  const agentName = task?.agentName || 'Code Agent';
  // 展示需求标题（originId 对钉钉是消息ID乱码，仅作兜底）。
  const requirement = task?.requirementTitle || task?.requirementOriginId;

  return (
    <Drawer title="任务详情" className={styles.taskDetailDrawer} open={!!task} onClose={onClose} width={640}>
      {task && (
        <Spin spinning={phaseLoading}>
          <div className={styles.taskDetailDrawerContent}>
            {/* 任务标题与需求详情保持同一内容层级，避免占用抽屉头部展示空间。 */}
            <div className={styles.taskDetailTitle}>{task.title || task.taskName || '未命名任务'}</div>

            {/* Agent 执行概览：头像 + 当前 Agent + 阶段·轮次·总进度 */}
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
                  {round ? ` · 第 ${round} 轮` : ''} · 总进度 {progress}%
                </p>
              </div>
            </div>

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
                <Empty description="暂无环节信息" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <div className={styles.phaseFlow}>
                  {phases.map((p, idx) => {
                    const meta = PHASE_STATE_META[p.status] || PHASE_STATE_META.pending;
                    const isCurrent = p.key === currentPhase;
                    return (
                      <div key={p.key} className={`${styles.phaseNode} ${meta.cls}`}>
                        <span className={styles.phaseNodeMark}>
                          {p.status === 'done' || p.status === 'rejected' ? meta.icon : idx + 1}
                        </span>
                        <div className={styles.phaseNodeBody}>
                          <strong>
                            {p.label}
                            {isCurrent && <span className={styles.phaseCurrentDot}> · 当前</span>}
                          </strong>
                          <small>{meta.label}</small>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {kickbacks.length > 0 && (
              <div className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>打回记录</h3>
                <div className={styles.kickbackList}>
                  {kickbacks.map((kb, i) => {
                    const fromLabel = phases.find((p) => p.key === kb.from)?.label || kb.from;
                    const toLabel = phases.find((p) => p.key === kb.to)?.label || kb.to;
                    return (
                      <div key={i} className={styles.kickbackItem}>
                        <Tag color="error" bordered={false}>
                          {fromLabel} → {toLabel}
                        </Tag>
                        <span className={styles.kickbackRound}>第 {kb.round} 轮</span>
                        {kb.reason && <span className={styles.kickbackReason}>{kb.reason}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isMyTask && task.sessionId && (
              <div className={styles.taskDetailAction}>
                <Button type="primary" icon={<MessageOutlined />} onClick={handleGoToChat}>
                  进入我的任务会话
                </Button>
              </div>
            )}
          </div>
        </Spin>
      )}
    </Drawer>
  );
};

export default TaskDetailDrawer;
