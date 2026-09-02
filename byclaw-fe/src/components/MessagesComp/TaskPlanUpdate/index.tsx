import { CheckSquareOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

type Props = {
  messageListItemContent: {
    substance?: unknown;
  };
};

const readPlanTasks = (substance: unknown): Array<{ tool_metadata?: { status?: string } }> => {
  let payload = substance;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return [];
    }
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return [];
  const steps = (payload as { steps?: Array<{ sub_steps?: unknown[] }> }).steps;
  if (!Array.isArray(steps)) return [];
  return steps.flatMap((step) => (Array.isArray(step.sub_steps) ? step.sub_steps : []));
};

export default function TaskPlanUpdate({ messageListItemContent }: Props) {
  const intl = useIntl();
  const tasks = readPlanTasks(messageListItemContent?.substance);
  const completed = tasks.filter(
    (task) => `${task?.tool_metadata?.status || ''}`.trim().toLowerCase() === 'completed'
  ).length;

  return (
    <div className={styles.planUpdate}>
      <CheckSquareOutlined aria-hidden="true" />
      <span className={styles.title}>{intl.formatMessage({ id: 'messageList.taskPlan.updated' })}</span>
      {tasks.length > 0 ? (
        <span className={styles.progress}>
          {intl.formatMessage({ id: 'messageList.taskPlan.progress' }, { completed, total: tasks.length })}
        </span>
      ) : null}
    </div>
  );
}
