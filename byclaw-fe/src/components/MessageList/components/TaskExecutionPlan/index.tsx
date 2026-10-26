import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  LoadingOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  MinusCircleOutlined,
  RightOutlined,
  ArrowRightOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Modal, Tooltip } from 'antd';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import type { TaskPlanSnapshot, TaskPlanTask, TaskPlanTaskStatus } from '@/typescript/message';
import type { IAgentCache } from '@/typescript/agent';
import { getAgentChatAvatar } from '@/utils/agent';
import useLocateMessage from '@/hooks/useLocateMessage';
import useGlobal from '@/hooks/useGlobal';
import { useAgentTeamsSnapshot } from '@/components/MessagesComp/ToolCall/agentTeamsStore';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';
import styles from './index.module.less';

const subscribeRuntime = (listener: () => void) => chatSessionRuntimeManager.subscribe(listener);

type Props = {
  taskPlan: TaskPlanSnapshot;
};

const statusOrder: TaskPlanTaskStatus[] = ['COMPLETED', 'IN_PROGRESS', 'PENDING', 'FAILED', 'CANCELLED', 'SKIPPED'];

const getRunExecutionKey = (
  taskId: string,
  attempt: number,
  attemptId: string | undefined,
  run: { sessionId?: string; messageId?: string; runId?: string },
  index: number
) => [taskId, attemptId || attempt, run.runId || `${run.sessionId}:${run.messageId}` || index].join(':');

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
  const locateMessage = useLocateMessage();
  const { setSessionId } = useGlobal();
  const employeesList = useSelector(
    (state: { employees?: { employeesList?: IAgentCache[] } }) => state.employees?.employeesList || []
  );
  const teamSnapshot = useAgentTeamsSnapshot(taskPlan.sessionId);
  const [collapsed, setCollapsed] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const [locatingExecution, setLocatingExecution] = useState<string>();
  const tasks = useMemo(
    () => [...(taskPlan.tasks || [])].sort((left, right) => left.position - right.position),
    [taskPlan.tasks]
  );
  const navigationTeam = useMemo(() => {
    const team = teamSnapshot?.team;
    if (!team) return undefined;
    if (taskPlan.teamId) return team.teamId === taskPlan.teamId ? team : undefined;
    if (taskPlan.planId.startsWith('todo:')) return undefined;
    // Old team plans only carried numbered steps. Match the entire unique task list before using its members.
    const teamTasks = team.tasks || [];
    const matchesLegacyPlan =
      teamTasks.length === tasks.length &&
      new Set(tasks.map((task) => task.title)).size === tasks.length &&
      tasks.every((task) => teamTasks.filter((candidate) => candidate.subject === task.title).length === 1);
    return matchesLegacyPlan ? team : undefined;
  }, [taskPlan.planId, taskPlan.teamId, tasks, teamSnapshot]);
  const isTeamPlan = Boolean(taskPlan.teamId || navigationTeam);

  useEffect(() => {
    // Snapshot refreshes may replace planId; only changing conversations resets the user's choice.
    setCollapsed(true);
    setMaximized(false);
  }, [taskPlan.sessionId]);

  const runtimeRevision = useSyncExternalStore(
    subscribeRuntime,
    () => {
      const runtime = chatSessionRuntimeManager.getSessionRuntime(taskPlan.sessionId);
      return `${runtime?.traceId || ''}:${runtime?.revision || 0}`;
    },
    () => ''
  );
  const runtime = chatSessionRuntimeManager.getSessionRuntime(taskPlan.sessionId);
  const requests = chatSessionRuntimeManager.getAllBySession(taskPlan.sessionId);
  let sameTurn = runtime?.traceId === taskPlan.traceId;
  if (!taskPlan.traceId) {
    sameTurn = requests.some(
      (request) => request.answerMessageId === taskPlan.messageId && request.traceId === runtime?.traceId
    );
  }
  const captainSummarizing = Boolean(
    runtimeRevision &&
      sameTurn &&
      runtime?.status === 'running' &&
      runtime.rootActive === true &&
      runtime.activeChildCount === 0 &&
      runtime.waitingInteractionCount === 0
  );
  const isSummarizing =
    captainSummarizing &&
    !['CANCELLING', 'CANCELLED', 'FAILED'].includes(taskPlan.status) &&
    tasks.length > 0 &&
    tasks.every((task) => task.status === 'COMPLETED');
  const hasRunningTask = tasks.some((task) => task.status === 'IN_PROGRESS');
  const allTasksTerminal = tasks.every((task) => ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(task.status));
  const hasWorkingMember = Boolean(
    runtime?.activeChildCount || navigationTeam?.members?.some((member) => member.activity === 'working')
  );
  const workingMemberCount =
    runtime?.activeChildCount || navigationTeam?.members?.filter((member) => member.activity === 'working').length || 0;
  const hasBlockedTask = Boolean(navigationTeam?.tasks?.some((task) => task.state === 'blocked'));
  const isWaitingForUser = runtime?.status === 'waiting_user' || Boolean(runtime?.waitingInteractionCount);
  const isRuntimeFailure = runtime?.status === 'failed' || taskPlan.status === 'FAILED';
  const isRuntimeCancelled = runtime?.status === 'cancelled' || ['CANCELLING', 'CANCELLED'].includes(taskPlan.status);
  const isStaleRunningTask = hasRunningTask && runtime?.status === 'idle';
  const teamStillActive = navigationTeam?.lifecycle === 'running' && !allTasksTerminal;
  const isWorking =
    !isRuntimeFailure &&
    !isRuntimeCancelled &&
    !isStaleRunningTask &&
    (hasRunningTask || isSummarizing || hasWorkingMember || runtime?.rootActive === true || teamStillActive);
  let overallStatus: string | undefined;
  if (isRuntimeFailure) {
    overallStatus = intl.formatMessage({ id: 'messageList.taskPlan.executionFailed' });
  } else if (isRuntimeCancelled) {
    overallStatus = intl.formatMessage({ id: 'messageList.taskPlan.executionCancelled' });
  } else if (isWaitingForUser) {
    overallStatus = intl.formatMessage({ id: 'messageList.taskPlan.waitingUser' });
  } else if (hasBlockedTask) {
    overallStatus = intl.formatMessage({ id: 'messageList.taskPlan.waitingDependency' });
  } else if (isStaleRunningTask) {
    overallStatus = intl.formatMessage({ id: 'messageList.taskPlan.statusSyncing' });
  } else if (!isSummarizing && hasWorkingMember && runtime?.rootActive) {
    overallStatus = intl.formatMessage(
      {
        id: isTeamPlan
          ? 'messageList.taskPlan.captainAndMembersWorking'
          : 'messageList.taskPlan.agentAndSubagentsWorking',
      },
      { count: workingMemberCount }
    );
  } else if (!isSummarizing && hasWorkingMember) {
    overallStatus = intl.formatMessage(
      { id: isTeamPlan ? 'messageList.taskPlan.membersWorking' : 'messageList.taskPlan.subagentsWorking' },
      { count: workingMemberCount }
    );
  } else if (!isSummarizing && runtime?.rootActive) {
    overallStatus = intl.formatMessage({
      id: isTeamPlan ? 'messageList.taskPlan.captainWorking' : 'messageList.taskPlan.agentWorking',
    });
  } else if (teamStillActive) {
    overallStatus = intl.formatMessage({ id: 'messageList.taskPlan.dispatching' });
  }
  const progress = statusOrder
    .map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length,
    }))
    .filter(({ count }) => count > 0)
    .map(({ status, count }) => intl.formatMessage({ id: `messageList.taskPlan.summary.${status}` }, { count }))
    .join(' · ');
  const openExecution = useCallback(
    async (execution: NonNullable<TaskPlanTask['executions']>[number], executionKey: string) => {
      const target = execution.runs[execution.runs.length - 1];
      if (!target?.sessionId || !target.messageId) return;
      setLocatingExecution(executionKey);
      try {
        await locateMessage({ sessionId: target.sessionId, messageId: target.messageId, preserveAgentContext: true });
      } finally {
        setLocatingExecution((current) => (current === executionKey ? undefined : current));
      }
    },
    [locateMessage]
  );

  if (!tasks.length) return null;

  const plan = (
    <section
      className={`${styles.taskPlan} ${maximized ? styles.maximized : ''}`}
      aria-label={intl.formatMessage({ id: 'messageList.taskPlan.title' })}
    >
      <div className={styles.headerRow}>
        <button
          type="button"
          className={styles.header}
          aria-label={intl.formatMessage({ id: 'messageList.taskPlan.title' })}
          aria-expanded={!collapsed}
          onClick={() => {
            if (maximized) setMaximized(false);
            setCollapsed((value) => !value);
          }}
        >
          <span className={styles.headerTitle}>
            {isWorking ? (
              <LoadingOutlined spin className={styles.runningHeaderIcon} />
            ) : (
              <UnorderedListOutlined className={styles.headerIcon} />
            )}
            <span>{intl.formatMessage({ id: 'messageList.taskPlan.title' })}</span>
          </span>
          <span className={`${styles.progress} ${isWorking ? styles.runningProgress : ''}`}>{progress}</span>
          {overallStatus && (
            <span className={styles.runningProgress} role="status">
              {overallStatus}
            </span>
          )}
          {isSummarizing && (
            <span className={styles.runningProgress} role="status">
              {intl.formatMessage({
                id: isTeamPlan ? 'messageList.taskPlan.captainSummarizing' : 'messageList.taskPlan.agentSummarizing',
              })}
            </span>
          )}
          <span className={styles.chevron} aria-hidden="true">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </span>
        </button>
        <Tooltip
          title={intl.formatMessage({
            id: maximized ? 'messageList.taskPlan.restore' : 'messageList.taskPlan.maximize',
          })}
        >
          <button
            type="button"
            className={styles.sizeButton}
            aria-label={intl.formatMessage({
              id: maximized ? 'messageList.taskPlan.restore' : 'messageList.taskPlan.maximize',
            })}
            onClick={() => {
              setCollapsed(false);
              setMaximized((value) => !value);
            }}
          >
            {maximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          </button>
        </Tooltip>
      </div>
      {!collapsed && (
        <ul className={styles.taskList}>
          {tasks.map((task) => {
            const status = task.status || 'PENDING';
            const statusLabel = intl.formatMessage({ id: `messageList.taskPlan.status.${status}` });
            const reason = task.statusReason?.message;
            const executions = (task.executions || []).filter((execution) => execution.runs.length > 0);
            const latestExecution = executions[executions.length - 1];
            const latestTarget = latestExecution?.runs[latestExecution.runs.length - 1];
            const latestExecutionKey = latestExecution
              ? `${task.taskId}:${latestExecution.attemptId || latestExecution.attempt}:latest`
              : undefined;
            const teamTask =
              navigationTeam?.tasks?.find((candidate) => candidate.id === task.taskId) ||
              navigationTeam?.tasks?.find((candidate) => candidate.subject === task.title);
            const assignee = task.assignee || teamTask?.assignee;
            const member = navigationTeam?.members?.find((candidate) => candidate.name === assignee);
            const employee = employeesList.find(
              (candidate) =>
                (member?.employeeId && `${candidate.agentId || candidate.id}` === `${member.employeeId}`) ||
                `${candidate.name || ''}` === `${assignee || member?.name || ''}`
            );
            const memberSessionId = member?.byclawSessionId;
            return (
              <li className={styles.taskItem} key={task.taskId || task.position} data-status={status}>
                <Tooltip title={reason || statusLabel}>
                  <span className={`${styles.statusIcon} ${styles[`status${status}`]}`} aria-hidden="true">
                    {getStatusIcon(status)}
                  </span>
                </Tooltip>
                <span className={styles.taskContent}>
                  <span className={styles.taskHeading}>
                    {employee?.chatAvatar ? (
                      <span className={styles.assigneeAvatar} title={assignee || member?.name}>
                        {getAgentChatAvatar(employee.chatAvatar)}
                      </span>
                    ) : null}
                    {status === 'IN_PROGRESS' || status === 'PENDING' ? (
                      <span className={`${styles.statusLabel} ${styles[`statusLabel${status}`]}`}>{statusLabel}</span>
                    ) : null}
                    {latestTarget?.sessionId && latestTarget.messageId ? (
                      <button
                        type="button"
                        className={styles.taskLink}
                        aria-label={`${task.title} ${intl.formatMessage({ id: 'messageList.taskPlan.latestAttempt' })}`}
                        aria-busy={locatingExecution === latestExecutionKey}
                        disabled={locatingExecution === latestExecutionKey}
                        onClick={() => void openExecution(latestExecution!, latestExecutionKey!)}
                      >
                        {locatingExecution === latestExecutionKey ? <LoadingOutlined spin /> : null}
                        {task.title}
                      </button>
                    ) : memberSessionId ? (
                      <Tooltip title={intl.formatMessage({ id: 'messageList.taskPlan.memberConversationHint' })}>
                        <button
                          type="button"
                          className={styles.taskLink}
                          aria-label={`${task.title} ${intl.formatMessage({
                            id: 'messageList.taskPlan.openMemberConversation',
                          })}`}
                          onClick={() => setSessionId?.(`${memberSessionId}`)}
                        >
                          {task.title}
                          <span className={styles.memberConversationLabel}>
                            {intl.formatMessage({ id: 'messageList.taskPlan.memberConversation' })}
                            <ArrowRightOutlined />
                          </span>
                        </button>
                      </Tooltip>
                    ) : (
                      <span className={styles.taskTitle}>{task.title}</span>
                    )}
                  </span>
                  {task.description || assignee || task.teamId || reason ? (
                    <span className={styles.taskMetadata}>
                      {task.description ? <span className={styles.taskDescription}> · {task.description}</span> : null}
                      {assignee || task.teamId ? (
                        <span className={styles.taskDescription}>
                          {' · '}
                          {assignee === 'captain'
                            ? intl.formatMessage({ id: 'messageList.taskPlan.captain' })
                            : assignee || intl.formatMessage({ id: 'messageList.taskPlan.unassigned' })}
                        </span>
                      ) : null}
                      {reason ? <span className={styles.taskReason}> · {reason}</span> : null}
                    </span>
                  ) : null}
                  {executions.length ? (
                    <span className={styles.executionLinks}>
                      {executions.map((execution) => (
                        <span className={styles.executionRound} key={execution.attemptId || execution.attempt}>
                          <span className={styles.roundLabel}>
                            {intl.formatMessage({ id: 'messageList.taskPlan.attempt' }, { attempt: execution.attempt })}
                          </span>
                          {execution.runs.length ? (
                            execution.runs.map((run, index) =>
                              run.sessionId && run.messageId ? (
                                <button
                                  type="button"
                                  key={`${execution.attemptId || execution.attempt}:${
                                    run.runId || `${run.sessionId}:${run.messageId}`
                                  }`}
                                  aria-label={`${task.title} ${intl.formatMessage(
                                    { id: 'messageList.taskPlan.attempt' },
                                    { attempt: execution.attempt }
                                  )} ${intl.formatMessage(
                                    { id: 'messageList.taskPlan.executionTurn' },
                                    { turn: index + 1 }
                                  )}`}
                                  aria-busy={
                                    locatingExecution ===
                                    getRunExecutionKey(task.taskId, execution.attempt, execution.attemptId, run, index)
                                  }
                                  disabled={
                                    locatingExecution ===
                                    getRunExecutionKey(task.taskId, execution.attempt, execution.attemptId, run, index)
                                  }
                                  title={execution.assignee}
                                  onClick={() =>
                                    void openExecution(
                                      { ...execution, runs: [run] },
                                      getRunExecutionKey(
                                        task.taskId,
                                        execution.attempt,
                                        execution.attemptId,
                                        run,
                                        index
                                      )
                                    )
                                  }
                                >
                                  {locatingExecution ===
                                    getRunExecutionKey(
                                      task.taskId,
                                      execution.attempt,
                                      execution.attemptId,
                                      run,
                                      index
                                    ) && <LoadingOutlined spin />}
                                  {intl.formatMessage(
                                    { id: 'messageList.taskPlan.executionTurn' },
                                    { turn: index + 1 }
                                  )}
                                </button>
                              ) : (
                                <span
                                  key={`${execution.attemptId || execution.attempt}:${run.runId || index}`}
                                  className={styles.executionUnavailable}
                                >
                                  {intl.formatMessage(
                                    { id: 'messageList.taskPlan.attempt' },
                                    { attempt: execution.attempt }
                                  )}
                                  {' · '}
                                  {intl.formatMessage(
                                    { id: 'messageList.taskPlan.executionTurn' },
                                    { turn: index + 1 }
                                  )}
                                  {' · '}
                                  {intl.formatMessage({ id: 'messageList.taskPlan.noExecution' })}
                                </span>
                              )
                            )
                          ) : (
                            <span className={styles.executionUnavailable}>
                              {intl.formatMessage({ id: 'messageList.taskPlan.noExecution' })}
                            </span>
                          )}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
  return (
    <>
      {!maximized && plan}
      <Modal
        open={maximized}
        title={null}
        footer={null}
        closable={false}
        width="calc(100vw - 32px)"
        style={{ top: 16, paddingBottom: 0 }}
        styles={{ body: { padding: 0 } }}
        onCancel={() => setMaximized(false)}
        destroyOnHidden
      >
        {maximized && plan}
      </Modal>
    </>
  );
};

export default TaskExecutionPlan;
