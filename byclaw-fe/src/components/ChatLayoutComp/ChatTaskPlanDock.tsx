import TaskExecutionPlan from '@/components/MessageList/components/TaskExecutionPlan';
import type { TaskPlanSnapshot } from '@/typescript/message';

import styles from './index.module.less';

type Props = {
  taskPlan: TaskPlanSnapshot;
};

export default function ChatTaskPlanDock({ taskPlan }: Props) {
  return (
    <div className={styles.taskPlanDockWrapper}>
      <div className={styles.taskPlanDock}>
        <TaskExecutionPlan taskPlan={taskPlan} />
      </div>
    </div>
  );
}
