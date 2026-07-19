import React, { useEffect, useState } from 'react';
import { Drawer, Tag, Descriptions, Button, Spin, Empty } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { useNavigate } from '@umijs/max';
import { useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { getTaskPhases } from '@/service/devloop';
import styles from './index.module.less';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  onRefresh: () => void;
}

// 任务状态色（与看板、卡片保持一致）
const STATUS_COLORS: Record<string, string> = {
  待开始: 'default',
  进行中: 'blue',
  暂停: 'orange',
  完成: 'green',
};

// 环节状态 → 展示样式：通过/进行中/被打回/未开始
const PHASE_STATE_META: Record<string, { cls: string; icon: string; label: string }> = {
  done: { cls: styles.phaseDone, icon: '✓', label: '完成' },
  running: { cls: styles.phaseActive, icon: '●', label: '进行中' },
  rejected: { cls: styles.phaseRejected, icon: '↩', label: '被打回' },
  pending: { cls: styles.phaseWaiting, icon: '○', label: '等待' },
};

// 会话即任务后，状态存于 byai_session_ext 且看板只读，这里仅展示不提供修改入口。
const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({ task, onClose }) => {
  const navigate = useNavigate();
  const { setSessionId } = useGlobal();
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
    setSessionId?.(String(task.sessionId));
    navigate('/chat');
    onClose();
  };

  const phases: any[] = snapshot?.phases || [];
  const kickbacks: any[] = snapshot?.kickbacks || [];
  const currentPhase = snapshot?.currentPhase;

  return (
    <Drawer title={task?.title || '任务详情'} open={!!task} onClose={onClose} width={640}>
      {task && (
        <>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="状态">
              {task.status ? <Tag color={STATUS_COLORS[task.status] || 'default'}>{task.status}</Tag> : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="当前环节">
              {snapshot?.round ? `第 ${snapshot.round} 轮` : ''}
              {phases.find((p) => p.key === currentPhase)?.label || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">{task.createTime || '-'}</Descriptions.Item>
            <Descriptions.Item label="负责人">{task.assignee || '我'}</Descriptions.Item>
          </Descriptions>

          <div className={styles.phaseSection}>
            <h3 className={styles.phaseSectionTitle}>研发环节进度</h3>
            <Spin spinning={phaseLoading}>
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
            </Spin>
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
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <Button type="primary" icon={<MessageOutlined />} onClick={handleGoToChat}>
                进入会话
              </Button>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
};

export default TaskDetailDrawer;
