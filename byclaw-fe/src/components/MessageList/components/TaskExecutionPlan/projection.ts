import { SSEMessageType } from '@/constants/message';
import type {
  IMessage,
  IMessageListItem,
  TaskPlanSnapshot,
  TaskPlanStatus,
  TaskPlanTask,
  TaskPlanTaskStatus,
} from '@/typescript/message';

type LegacyPlanTask = {
  id?: string | number;
  step_name?: string;
  step_description?: string;
  tool_metadata?: { status?: string };
};

type LegacyPlanStep = {
  step_topic?: string;
  sub_steps?: LegacyPlanTask[];
};

type LegacyPlanPayload = {
  planId?: string;
  updatedAt?: string;
  task_description?: string;
  status?: string | number;
  steps?: LegacyPlanStep[];
};

const taskStatusMap: Record<string, TaskPlanTaskStatus> = {
  pending: 'PENDING',
  in_progress: 'IN_PROGRESS',
  running: 'IN_PROGRESS',
  completed: 'COMPLETED',
  done: 'COMPLETED',
  failed: 'FAILED',
  skipped: 'SKIPPED',
  cancelled: 'CANCELLED',
  canceled: 'CANCELLED',
};

const normalizeTaskStatus = (status: unknown): TaskPlanTaskStatus =>
  taskStatusMap[`${status ?? 'pending'}`.trim().toLowerCase()] || 'PENDING';

const derivePlanStatus = (status: unknown, tasks: TaskPlanTask[]): TaskPlanStatus => {
  const normalizedStatus = `${status ?? ''}`.trim().toUpperCase();
  if (['ACTIVE', 'CANCELLING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(normalizedStatus)) {
    return normalizedStatus as TaskPlanStatus;
  }
  if (tasks.some((task) => task.status === 'FAILED')) return 'FAILED';
  const terminalStatuses = new Set<TaskPlanTaskStatus>(['COMPLETED', 'FAILED', 'SKIPPED', 'CANCELLED']);
  if (tasks.length > 0 && tasks.every((task) => terminalStatuses.has(task.status))) return 'COMPLETED';
  return 'ACTIVE';
};

const parsePlanPayload = (substance: unknown): LegacyPlanPayload | undefined => {
  if (typeof substance === 'object' && substance !== null && !Array.isArray(substance)) {
    return substance as LegacyPlanPayload;
  }
  if (typeof substance !== 'string' || substance.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(substance);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as LegacyPlanPayload)
      : undefined;
  } catch {
    return undefined;
  }
};

const updatedAtMillis = (plan: TaskPlanSnapshot | undefined): number | undefined => {
  if (!plan?.updatedAt) return undefined;
  const value = Date.parse(plan.updatedAt);
  return Number.isNaN(value) ? undefined : value;
};

const selectMessagePlan = (
  reconnectBaseline: TaskPlanSnapshot | undefined,
  streamedPlan: TaskPlanSnapshot | undefined
): TaskPlanSnapshot | undefined => {
  if (!reconnectBaseline) return streamedPlan;
  if (!streamedPlan) return reconnectBaseline;

  const baselineUpdatedAt = updatedAtMillis(reconnectBaseline);
  const streamedUpdatedAt = updatedAtMillis(streamedPlan);
  if (baselineUpdatedAt !== undefined && streamedUpdatedAt !== undefined && streamedUpdatedAt > baselineUpdatedAt) {
    return streamedPlan;
  }
  return reconnectBaseline;
};

export const normalizeTaskPlanItem = (
  item: IMessageListItem,
  message: IMessage,
  version: number
): TaskPlanSnapshot | undefined => {
  if (`${item.contentType}` !== `${SSEMessageType.taskOutline}`) return undefined;
  const payload = parsePlanPayload(item.content?.substance);
  if (!payload) return undefined;

  const tasks = (payload.steps || [])
    .flatMap((step) => step.sub_steps || [])
    .map((task, index) => ({
      taskId: `${task.id ?? index + 1}`,
      position: index + 1,
      title: task.step_description?.trim() || task.step_name?.trim() || `Task ${index + 1}`,
      description:
        task.step_description?.trim() && task.step_name?.trim() && task.step_name !== task.step_description
          ? task.step_name
          : undefined,
      status: normalizeTaskStatus(task.tool_metadata?.status),
    }));
  if (tasks.length === 0) return undefined;

  return {
    planId: `${payload.planId || item.uuid || message.messageId || message.msgId}`,
    version,
    title: payload.task_description?.trim() || payload.steps?.[0]?.step_topic?.trim() || 'Task plan',
    status: derivePlanStatus(payload.status, tasks),
    sessionId: `${message.sessionId || ''}`,
    messageId: `${message.messageId || message.msgId}`,
    tasks,
    updatedAt: payload.updatedAt,
  };
};

/** Selects one latest plan for the currently visible conversation; later message events replace earlier snapshots. */
export const selectLatestTaskPlan = (
  messages: IMessage[],
  selectedSessionId?: string
): TaskPlanSnapshot | undefined => {
  let latest: TaskPlanSnapshot | undefined;
  let version = 0;

  messages.forEach((message) => {
    const messageSessionId = `${message.sessionId || ''}`;
    if (selectedSessionId && messageSessionId && messageSessionId !== `${selectedSessionId}`) return;

    let streamedPlan: TaskPlanSnapshot | undefined;
    [...(message.thinkList || []), ...(message.messageList || [])]
      .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
      .forEach((item) => {
        version += 1;
        streamedPlan = normalizeTaskPlanItem(item, message, version) || streamedPlan;
      });

    const reconnectBaseline =
      message.taskPlan &&
      (!selectedSessionId || !message.taskPlan.sessionId || `${message.taskPlan.sessionId}` === `${selectedSessionId}`)
        ? message.taskPlan
        : undefined;
    latest = selectMessagePlan(reconnectBaseline, streamedPlan) || latest;
  });

  return latest;
};
