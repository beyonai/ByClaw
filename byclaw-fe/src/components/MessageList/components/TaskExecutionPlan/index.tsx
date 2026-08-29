import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  RightOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Tooltip } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import type { TaskPlanSnapshot, TaskPlanTaskStatus } from '@/typescript/message';
import styles from './index.module.less';

type Props = {
  taskPlan: TaskPlanSnapshot;
};

const statusOrder: TaskPlanTaskStatus[] = ['COMPLETED', 'IN_PROGRESS', 'PENDING', 'FAILED', 'CANCELLED', 'SKIPPED'];

const getStatusIcon = (status: TaskPlanTaskStatus) => {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircleOutlined />;
    case 'IN_PROGRESS':
      return <LoadingOutlined spin />;
    case 'FAILED':
      return <CloseCircleOutlined />;
    case 'SKIPPED':
    case 'CANCELLED':
      return <MinusCircleOutlined />;
    default:
      return <span className={styles.pendingGlyph} />;
  }
};

const TaskExecutionPlan: React.FC<Props> = ({ taskPlan }) => {
  const intl = useIntl();
  const [collapsed, setCollapsed] = useState(true);
  const tasks = useMemo(
    () => [...(taskPlan.tasks || [])].sort((left, right) => left.position - right.position),
    [taskPlan.tasks]
  );

  useEffect(() => {
    setCollapsed(true);
  }, [taskPlan.planId]);

  if (!tasks.length) return null;

  const progress = statusOrder
    .map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length,
    }))
    .filter(({ count }) => count > 0)
    .map(({ status, count }) => intl.formatMessage({ id: `messageList.taskPlan.summary.${status}` }, { count }))
    .join(' · ');

  return (
    <section className={styles.taskPlan} aria-label={intl.formatMessage({ id: 'messageList.taskPlan.title' })}>
      <button
        type="button"
        className={styles.header}
        aria-label={intl.formatMessage({ id: 'messageList.taskPlan.title' })}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className={styles.headerTitle}>
          <UnorderedListOutlined className={styles.headerIcon} />
          <span>{intl.formatMessage({ id: 'messageList.taskPlan.title' })}</span>
        </span>
        <span className={styles.progress}>{progress}</span>
        <span className={styles.chevron} aria-hidden="true">
          {collapsed ? <RightOutlined /> : <DownOutlined />}
        </span>
      </button>
      {!collapsed && (
        <ul className={styles.taskList}>
          {tasks.map((task) => {
            const status = task.status || 'PENDING';
            const statusLabel = intl.formatMessage({ id: `messageList.taskPlan.status.${status}` });
            const reason = task.statusReason?.message;
            return (
              <li className={styles.taskItem} key={task.taskId || task.position} data-status={status}>
                <Tooltip title={reason || statusLabel}>
                  <span className={`${styles.statusIcon} ${styles[`status${status}`]}`} aria-hidden="true">
                    {getStatusIcon(status)}
                  </span>
                </Tooltip>
                <span className={styles.taskContent}>
                  <span className={styles.taskTitle}>{task.title}</span>
                  {task.description ? <span className={styles.taskDescription}> · {task.description}</span> : null}
                  {reason ? <span className={styles.taskReason}> · {reason}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default TaskExecutionPlan;
