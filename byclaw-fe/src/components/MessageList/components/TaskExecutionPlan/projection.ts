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
  task_id?: string;
  attempt?: number;
  attempt_id?: string;
  assignee?: string;
  child_session_id?: string;
  child_message_id?: string;
  team_id?: string;
  executions?: Array<{
    attempt?: number;
    attempt_id?: string;
    assignee?: string;
    runs?: Array<{
      child_session_id?: string;
      child_message_id?: string;
      child_run_id?: string;
      child_turn?: number;
    }>;
  }>;
};

type LegacyPlanStep = {
  step_topic?: string;
  sub_steps?: LegacyPlanTask[];
};

type LegacyPlanPayload = {
  planId?: string;
  team_id?: string;
  createdAt?: string;
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

const parseTime = (value?: string | number): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = `${value}`;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;
  const normalized = Date.parse(text.replace(/-/g, '/'));
  return Number.isFinite(normalized) ? normalized : undefined;
};

const updatedAtMillis = (plan: TaskPlanSnapshot | undefined): number | undefined => {
  if (!plan) return undefined;
  return parseTime(plan.updatedAt || plan.createdAt);
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

const normalizeExecutions = (task: LegacyPlanTask): TaskPlanTask['executions'] => {
  if (task.executions?.length) {
    return task.executions.map((execution) => ({
      attempt: Number(execution.attempt) || 1,
      ...(execution.attempt_id ? { attemptId: execution.attempt_id } : {}),
      ...(execution.assignee ? { assignee: execution.assignee } : {}),
      runs: (execution.runs || []).map((run) => ({
        ...(run.child_session_id ? { sessionId: run.child_session_id } : {}),
        ...(run.child_message_id ? { messageId: run.child_message_id } : {}),
        ...(run.child_run_id ? { runId: run.child_run_id } : {}),
        ...(run.child_turn ? { childTurn: run.child_turn } : {}),
      })),
    }));
  }
  if (!task.child_session_id || !task.child_message_id) return undefined;
  return [
    {
      attempt: Number(task.attempt) || 1,
      ...(task.attempt_id ? { attemptId: task.attempt_id } : {}),
      ...(task.assignee ? { assignee: task.assignee } : {}),
      runs: [{ sessionId: task.child_session_id, messageId: task.child_message_id }],
    },
  ];
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
      taskId: `${task.task_id ?? task.id ?? index + 1}`,
      ...(task.team_id || payload.team_id ? { teamId: task.team_id || payload.team_id } : {}),
      position: index + 1,
      title: task.step_description?.trim() || task.step_name?.trim() || `Task ${index + 1}`,
      description:
        task.step_description?.trim() && task.step_name?.trim() && task.step_name !== task.step_description
          ? task.step_name
          : undefined,
      ...(task.assignee ? { assignee: task.assignee } : {}),
      status: normalizeTaskStatus(task.tool_metadata?.status),
      executions: normalizeExecutions(task),
    }));
  if (tasks.length === 0) return undefined;

  return {
    planId: `${payload.planId || item.uuid || message.messageId || message.msgId}`,
    ...(payload.team_id ? { teamId: payload.team_id } : {}),
    version,
    title: payload.task_description?.trim() || payload.steps?.[0]?.step_topic?.trim() || 'Task plan',
    status: derivePlanStatus(payload.status, tasks),
    sessionId: `${message.sessionId || ''}`,
    messageId: `${message.messageId || message.msgId}`,
    tasks,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  };
};

/** Selects one latest plan for the currently visible conversation; later message events replace earlier snapshots. */
export const selectLatestTaskPlan = (
  messages: IMessage[],
  selectedSessionId?: string
): TaskPlanSnapshot | undefined => {
  let latest: TaskPlanSnapshot | undefined;
  let latestMessageTime: number | undefined;
  let latestMessageOrder = -1;
  let messageOrder = 0;
  let version = 0;
  const executionHistory = new Map<string, NonNullable<TaskPlanTask['executions']>>();

  messages.forEach((message) => {
    const currentMessageOrder = messageOrder;
    messageOrder += 1;
    const messageSessionId = `${message.sessionId || ''}`;
    if (selectedSessionId && messageSessionId && messageSessionId !== `${selectedSessionId}`) return;

    let streamedPlan: TaskPlanSnapshot | undefined;
    const streamedPlans: TaskPlanSnapshot[] = [];
    [...(message.thinkList || []), ...(message.messageList || [])]
      .sort((left, right) => Number(left.seq || 0) - Number(right.seq || 0))
      .forEach((item) => {
        version += 1;
        const normalized = normalizeTaskPlanItem(item, message, version);
        if (normalized) {
          streamedPlan = normalized;
          streamedPlans.push(normalized);
        }
      });

    const reconnectBaseline =
      message.taskPlan &&
      (!selectedSessionId || !message.taskPlan.sessionId || `${message.taskPlan.sessionId}` === `${selectedSessionId}`)
        ? message.taskPlan
        : undefined;
    const latestPlan = selectMessagePlan(reconnectBaseline, streamedPlan);
    if (!latestPlan) return;
    const historyPlans =
      latestPlan === reconnectBaseline
        ? [...streamedPlans, reconnectBaseline!]
        : [...(reconnectBaseline ? [reconnectBaseline] : []), ...streamedPlans];
    historyPlans.forEach((plan) => {
      plan.tasks.forEach((task) => {
        if (!task.executions?.length) return;
        const teamId = task.teamId || plan.teamId;
        if (!teamId) return;
        const taskKey = `${teamId}:${task.taskId}`;
        const executions = executionHistory.get(taskKey) || [];
        task.executions.forEach((execution) => {
          const executionKey = execution.attemptId || `${execution.attempt}`;
          const index = executions.findIndex((entry) => (entry.attemptId || `${entry.attempt}`) === executionKey);
          if (index < 0) executions.push(execution);
          else {
            const current = executions[index]!;
            const runs = [...current.runs];
            execution.runs.forEach((run) => {
              const runIndex = runs.findIndex((entry) =>
                run.runId && entry.runId
                  ? entry.runId === run.runId
                  : !!run.messageId && entry.messageId === run.messageId && entry.sessionId === run.sessionId
              );
              if (runIndex < 0) runs.push(run);
              else runs[runIndex] = { ...runs[runIndex], ...run };
            });
            executions[index] = { ...current, ...execution, runs };
          }
        });
        executionHistory.set(taskKey, executions);
      });
    });

    // The answer message time identifies the conversation turn. Plan version
    // is only meaningful inside one plan and must not decide between turns.
    const messageTime = parseTime(message.createTime);
    const isNewerMessage =
      !latest ||
      (messageTime !== undefined && (latestMessageTime === undefined || messageTime >= latestMessageTime)) ||
      (messageTime === undefined && latestMessageTime === undefined && currentMessageOrder >= latestMessageOrder);
    if (isNewerMessage) {
      latest = latestPlan;
      latestMessageTime = messageTime;
      latestMessageOrder = currentMessageOrder;
    }
  });

  if (!latest?.teamId) return latest;
  const teamId = latest.teamId;
  return {
    ...latest,
    tasks: latest.tasks.map((task) => {
      const executions = executionHistory.get(`${teamId}:${task.taskId}`);
      return executions?.length ? { ...task, executions: [...executions].sort((a, b) => a.attempt - b.attempt) } : task;
    }),
  };
};
