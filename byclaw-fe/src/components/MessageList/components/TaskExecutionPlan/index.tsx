import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  DownOutlined,
  LoadingOutlined,
  MinusCircleFilled,
  UpOutlined,
} from '@ant-design/icons';
import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import type { TaskPlanSnapshot, TaskPlanTask, TaskPlanTaskStatus } from '@/typescript/message';
import styles from './index.module.less';

type Props = {
  taskPlan: TaskPlanSnapshot;
};

const getTaskTime = (task: TaskPlanTask) => {
  const time = task.completedAt || task.startedAt;
  if (!time) return '';
  const parsed = dayjs(time);
  return parsed.isValid() ? parsed.format('HH:mm:ss') : '';
};

const getStatusIcon = (status: TaskPlanTaskStatus) => {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircleFilled />;
    case 'IN_PROGRESS':
      return <LoadingOutlined />;
    case 'FAILED':
      return <CloseCircleFilled />;
    case 'SKIPPED':
    case 'CANCELLED':
      return <MinusCircleFilled />;
    default:
      return <ClockCircleOutlined />;
  }
};

const TaskExecutionPlan: React.FC<Props> = ({ taskPlan }) => {
  const intl = useIntl();
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(taskPlan.status);
  const [collapsed, setCollapsed] = useState(terminal);
  const tasks = [...(taskPlan.tasks || [])].sort((left, right) => left.position - right.position);

  useEffect(() => {
    setCollapsed(terminal);
  }, [taskPlan.planId, terminal]);

  if (!tasks.length) return null;

  const completedCount = tasks.filter((task) => task.status === 'COMPLETED').length;

  return (
    <section className={styles.taskPlan} aria-label={intl.formatMessage({ id: 'messageList.taskPlan.title' })}>
      <button
        type="button"
        className={`${styles.header} ${collapsed ? '' : styles.headerExpanded}`}
        aria-label={intl.formatMessage({ id: 'messageList.taskPlan.title' })}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className={styles.headerTitle}>
          <span>{intl.formatMessage({ id: 'messageList.taskPlan.title' })}</span>
          {collapsed ? <DownOutlined /> : <UpOutlined />}
        </span>
        <span className={styles.progress}>
          {intl.formatMessage(
            { id: 'messageList.taskPlan.progress' },
            { completed: completedCount, total: tasks.length }
          )}
        </span>
      </button>
      {!collapsed && (
        <div className={styles.taskList}>
          {tasks.map((task) => {
            const status = task.status || 'PENDING';
            const statusLabel = intl.formatMessage({ id: `messageList.taskPlan.status.${status}` });
            const reason = task.statusReason?.message;
            return (
              <div className={styles.taskItem} key={task.taskId || task.position}>
                <span className={styles.timelineLine} aria-hidden="true" />
                <div className={styles.timeline}>
                  <Tooltip title={reason || statusLabel}>
                    <span className={`${styles.statusIcon} ${styles[`status${status}`]}`}>{getStatusIcon(status)}</span>
                  </Tooltip>
                </div>
                <time className={styles.taskTime}>{getTaskTime(task)}</time>
                <div className={styles.taskContent}>
                  <div className={styles.taskTitle}>{task.title}</div>
                  {task.description && <div className={styles.taskDescription}>{task.description}</div>}
                  {reason && <div className={styles.taskReason}>{reason}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default TaskExecutionPlan;
