import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaskPlanSnapshot } from '@/typescript/message';
import type { AgentTeamsSnapshot } from '@/components/MessagesComp/ToolCall/AgentTeamsActivity';
import TaskExecutionPlan from './index';

const mockLocateMessage = jest.fn();
const mockSetSessionId = jest.fn();
let mockTeamSnapshot: AgentTeamsSnapshot | undefined;
let mockEmployeesList: Array<{ agentId: string; id: string; name: string; chatAvatar: string }> = [];

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ setSessionId: mockSetSessionId }),
}));

jest.mock('@/components/MessagesComp/ToolCall/agentTeamsStore', () => ({
  useAgentTeamsSnapshot: () => mockTeamSnapshot,
}));

jest.mock('@/hooks/useLocateMessage', () => ({
  __esModule: true,
  default: () => mockLocateMessage,
}));

jest.mock('@umijs/max', () => ({
  useSelector: (selector: (state: unknown) => unknown) => selector({ employees: { employeesList: mockEmployeesList } }),
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, number>) => {
      if (id === 'messageList.taskPlan.progress') return `${values?.completed}/${values?.total} completed`;
      if (id === 'messageList.taskPlan.attempt') return `Run ${values?.attempt}`;
      if (id === 'messageList.taskPlan.latestAttempt') return 'Open latest execution';
      if (id === 'messageList.taskPlan.openMemberConversation') return 'Open member conversation';
      if (id === 'messageList.taskPlan.executionTurn') return `Conversation ${values?.turn}`;
      if (id === 'messageList.taskPlan.summary.COMPLETED') return `${values?.count} completed`;
      if (id === 'messageList.taskPlan.summary.IN_PROGRESS') return `${values?.count} in progress`;
      if (id === 'messageList.taskPlan.summary.PENDING') return `${values?.count} pending`;
      if (id === 'messageList.taskPlan.captainWorking') return 'Captain is working';
      if (id === 'messageList.taskPlan.membersWorking') return `${values?.count} members working`;
      if (id === 'messageList.taskPlan.waitingUser') return 'Waiting for your input';
      if (id === 'messageList.taskPlan.captainAndMembersWorking') return `Captain and ${values?.count} members working`;
      if (id === 'messageList.taskPlan.waitingDependency') return 'Waiting for a dependency or member report';
      if (id === 'messageList.taskPlan.statusSyncing') return 'Syncing execution status';
      if (id === 'messageList.taskPlan.executionFailed') return 'Execution failed';
      if (id === 'messageList.taskPlan.executionCancelled') return 'Cancelled';
      if (id === 'messageList.taskPlan.dispatching') return 'Dispatching tasks';
      return id;
    },
  }),
}));

describe('TaskExecutionPlan', () => {
  beforeEach(() => {
    chatSessionRuntimeManager.clear();
    mockLocateMessage.mockClear();
    mockSetSessionId.mockClear();
    mockTeamSnapshot = undefined;
    mockEmployeesList = [];
  });

  it('tracks captain summarization live without confusing child work, waiting, or another turn', () => {
    const plan: TaskPlanSnapshot = {
      planId: 'plan',
      version: 1,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 'root',
      messageId: '100',
      traceId: 'trace',
      tasks: [{ taskId: '1', position: 1, title: 'Task', status: 'COMPLETED' }],
    };
    const view = render(<TaskExecutionPlan taskPlan={plan} />);
    const label = 'messageList.taskPlan.captainSummarizing';
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    let revision = 0;
    const update = (overrides = {}) =>
      act(() => {
        revision += 1;
        chatSessionRuntimeManager.applySessionRuntime({
          sessionId: 'root',
          traceId: 'trace',
          status: 'running',
          rootActive: true,
          activeAgentCount: 1,
          activeChildCount: 0,
          waitingInteractionCount: 0,
          revision,
          changedAt: revision,
          ...overrides,
        });
      });
    update();
    expect(screen.getByRole('status')).toHaveTextContent(label);
    for (const overrides of [
      { rootActive: false },
      { activeChildCount: 1 },
      { waitingInteractionCount: 1 },
      { status: 'waiting_user' },
      { status: 'idle' },
      { status: 'failed' },
      { traceId: 'next-turn' },
    ]) {
      update(overrides);
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    update();
    for (const status of ['IN_PROGRESS', 'PENDING', 'FAILED'] as const) {
      view.rerender(<TaskExecutionPlan taskPlan={{ ...plan, tasks: [{ ...plan.tasks[0], status }] }} />);
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('shows the assigned digital employee avatar when the team snapshot identifies the employee', () => {
    mockEmployeesList = [{ agentId: 'employee-1', id: 'employee-1', name: 'Engineer', chatAvatar: 'avatar.png' }];
    mockTeamSnapshot = {
      schemaVersion: 2,
      eventKind: 'agent-teams/snapshot',
      team: {
        teamId: 'team-avatar',
        captainSessionId: 'root',
        members: [{ id: 'member-1', employeeId: 'employee-1', name: 'Engineer', byclawSessionId: '200' }],
        tasks: [{ id: 'task-1', subject: 'Implement feature', assignee: 'Engineer' }],
      },
    };
    render(
      <TaskExecutionPlan
        taskPlan={{
          planId: 'plan-avatar',
          version: 1,
          title: 'Plan',
          status: 'ACTIVE',
          sessionId: 'root',
          messageId: '100',
          tasks: [{ taskId: 'task-1', position: 1, title: 'Implement feature', status: 'PENDING' }],
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.title' }));
    expect(screen.getByTitle('Engineer').querySelector('img')).toHaveAttribute('src', '/byaiService/avatar.png');
  });

  it('shows the overall state when task snapshots lag behind runtime activity', () => {
    const plan: TaskPlanSnapshot = {
      planId: 'plan-state',
      version: 1,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 'root',
      messageId: '100',
      tasks: [{ taskId: '1', position: 1, title: 'Task', status: 'IN_PROGRESS' }],
    };
    const view = render(<TaskExecutionPlan taskPlan={plan} />);
    let revision = 0;
    const applyRuntime = (status: 'running' | 'waiting_user' | 'idle' | 'failed', activeChildCount = 0) =>
      act(() =>
        chatSessionRuntimeManager.applySessionRuntime({
          sessionId: 'root',
          traceId: 'trace',
          status,
          rootActive: status === 'running' && activeChildCount === 0,
          activeAgentCount: activeChildCount,
          activeChildCount,
          waitingInteractionCount: status === 'waiting_user' ? 1 : 0,
          revision: ++revision,
          changedAt: revision,
        })
      );
    applyRuntime('idle');
    expect(screen.getByRole('status')).toHaveTextContent('Syncing execution status');
    applyRuntime('running', 2);
    expect(screen.getByRole('status')).toHaveTextContent('2 members working');
    applyRuntime('waiting_user');
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for your input');
    applyRuntime('failed');
    expect(screen.getByRole('status')).toHaveTextContent('Execution failed');
    view.unmount();
  });

  it('maximizes a collapsed plan, restores it expanded, and resets on conversation change', () => {
    const taskPlan: TaskPlanSnapshot = {
      planId: 'plan',
      version: 1,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 'root',
      messageId: '100',
      tasks: [{ taskId: '1', position: 1, title: 'Visible task', status: 'PENDING' }],
    };
    const { rerender } = render(<TaskExecutionPlan taskPlan={taskPlan} />);
    expect(screen.queryByText('Visible task')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.maximize' }));
    expect(screen.getByRole('dialog')).toContainElement(screen.getByText('Visible task'));
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.restore' }));
    expect(screen.getByText('Visible task')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'messageList.taskPlan.title' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.maximize' }));
    rerender(<TaskExecutionPlan taskPlan={{ ...taskPlan, sessionId: 'other' }} />);
    expect(screen.getByRole('button', { name: 'messageList.taskPlan.title' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: 'messageList.taskPlan.maximize' })).toBeInTheDocument();
  });

  it('opens the same member conversation as team activity for existing plans without execution history', () => {
    mockTeamSnapshot = {
      schemaVersion: 2,
      eventKind: 'agent-teams/snapshot',
      team: {
        teamId: 'team-legacy',
        captainSessionId: 'root',
        members: [{ id: 'external-engineer', name: 'Engineer', byclawSessionId: '200' }],
        tasks: [{ id: 't1', subject: 'Implement feature', assignee: 'Engineer' }],
      },
    };
    render(
      <TaskExecutionPlan
        taskPlan={{
          planId: 'legacy-hash',
          version: 1,
          title: 'Plan',
          status: 'ACTIVE',
          sessionId: 'root',
          messageId: '100',
          tasks: [{ taskId: '1', position: 1, title: 'Implement feature', status: 'IN_PROGRESS' }],
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.title' }));
    fireEvent.click(screen.getByRole('button', { name: 'Implement feature Open member conversation' }));
    expect(mockSetSessionId).toHaveBeenCalledWith('200');
    expect(mockLocateMessage).not.toHaveBeenCalled();
    expect(screen.getByText('· Engineer')).toBeInTheDocument();
  });

  it('does not use another team’s member even when task titles match', () => {
    mockTeamSnapshot = {
      schemaVersion: 2,
      eventKind: 'agent-teams/snapshot',
      team: {
        teamId: 'different-team',
        captainSessionId: 'root',
        members: [{ id: 'external-engineer', name: 'Engineer', byclawSessionId: 'wrong-session' }],
        tasks: [{ id: 't1', subject: 'Review', assignee: 'Engineer' }],
      },
    };
    render(
      <TaskExecutionPlan
        taskPlan={{
          planId: 'team:wanted',
          teamId: 'wanted',
          version: 1,
          title: 'Plan',
          status: 'ACTIVE',
          sessionId: 'root',
          messageId: '100',
          tasks: [{ taskId: 't1', position: 1, title: 'Review', status: 'IN_PROGRESS' }],
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.title' }));
    expect(screen.queryByRole('button', { name: 'Review Open member conversation' })).not.toBeInTheDocument();
    expect(mockSetSessionId).not.toHaveBeenCalled();
  });
  it('renders compact status counts and expands tasks in position order', () => {
    const taskPlan: TaskPlanSnapshot = {
      planId: 'plan-1',
      version: 1,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 's1',
      messageId: 'm1',
      tasks: [
        { taskId: 'task-2', position: 2, title: 'Second task', status: 'IN_PROGRESS' },
        { taskId: 'task-1', position: 1, title: 'First task', status: 'COMPLETED' },
        { taskId: 'task-3', position: 3, title: 'Third task', status: 'PENDING' },
      ],
    };

    render(<TaskExecutionPlan taskPlan={taskPlan} />);

    const toggle = screen.getByRole('button', { name: 'messageList.taskPlan.title' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('1 completed · 1 in progress · 1 pending')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getAllByText(/task$/).map((node) => node.textContent)).toEqual([
      'First task',
      'Second task',
      'Third task',
    ]);
  });

  it('collapses completed plans by default and supports toggling', () => {
    const taskPlan: TaskPlanSnapshot = {
      planId: 'plan-2',
      version: 1,
      title: 'Completed plan',
      status: 'COMPLETED',
      sessionId: 's1',
      messageId: 'm1',
      tasks: [{ taskId: 'task-1', position: 1, title: 'Completed task', status: 'COMPLETED' }],
    };

    render(<TaskExecutionPlan taskPlan={taskPlan} />);

    const toggle = screen.getByRole('button', { name: 'messageList.taskPlan.title' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Completed task')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Completed task')).toBeInTheDocument();
  });

  it('preserves the user toggle across refreshed plan IDs and completion in the same conversation', () => {
    const plan: TaskPlanSnapshot = {
      planId: 'snapshot-1',
      version: 1,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 'session-1',
      messageId: 'message-1',
      tasks: [{ taskId: 'task-1', position: 1, title: 'Work', status: 'IN_PROGRESS' }],
    };
    const view = render(<TaskExecutionPlan taskPlan={plan} />);
    const toggle = screen.getByRole('button', { name: 'messageList.taskPlan.title' });
    fireEvent.click(toggle);

    const completedPlan: TaskPlanSnapshot = {
      ...plan,
      planId: 'snapshot-2',
      version: 2,
      status: 'COMPLETED',
      tasks: [{ ...plan.tasks[0], status: 'COMPLETED' }],
    };
    view.rerender(<TaskExecutionPlan taskPlan={completedPlan} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Work')).toBeInTheDocument();

    fireEvent.click(toggle);
    view.rerender(<TaskExecutionPlan taskPlan={{ ...completedPlan, planId: 'snapshot-3', version: 3 }} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    view.rerender(<TaskExecutionPlan taskPlan={{ ...plan, sessionId: 'session-2' }} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the latest execution by default and allows selecting an earlier attempt', async () => {
    mockTeamSnapshot = {
      schemaVersion: 2,
      eventKind: 'agent-teams/snapshot',
      team: {
        teamId: 'team-1',
        captainSessionId: 'root',
        members: [{ id: 'external-engineer', name: 'Engineer', byclawSessionId: 'current-member-session' }],
        tasks: [{ id: 'task-1', subject: 'Implement feature', assignee: 'Engineer' }],
      },
    };
    const taskPlan: TaskPlanSnapshot = {
      planId: 'plan-3',
      version: 2,
      title: 'Plan',
      status: 'ACTIVE',
      sessionId: 'root',
      messageId: 'root-message',
      tasks: [
        {
          taskId: 'task-1',
          position: 1,
          title: 'Implement feature',
          status: 'IN_PROGRESS',
          executions: [
            {
              attempt: 1,
              attemptId: 'attempt-1',
              runs: [{ sessionId: 'child', messageId: 'child-message-1' }],
              assignee: 'Engineer',
            },
            {
              attempt: 2,
              attemptId: 'attempt-2',
              runs: [{ sessionId: 'child', messageId: 'child-message-2' }],
              assignee: 'Engineer',
            },
          ],
        },
      ],
    };

    render(<TaskExecutionPlan taskPlan={taskPlan} />);
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.title' }));
    expect(screen.getByText('Run 1')).toBeInTheDocument();
    expect(screen.getByText('Run 2')).toBeInTheDocument();
    expect(screen.getAllByText('Conversation 1')).toHaveLength(2);
    const latestExecutionButton = screen.getByRole('button', { name: 'Implement feature Open latest execution' });
    fireEvent.click(latestExecutionButton);
    await waitFor(() => expect(latestExecutionButton).toBeEnabled());
    expect(mockLocateMessage).toHaveBeenLastCalledWith({
      sessionId: 'child',
      messageId: 'child-message-2',
      preserveAgentContext: true,
    });

    const firstExecutionButton = screen.getByRole('button', { name: 'Implement feature Run 1 Conversation 1' });
    fireEvent.click(firstExecutionButton);
    await waitFor(() => expect(firstExecutionButton).toBeEnabled());
    expect(mockLocateMessage).toHaveBeenLastCalledWith({
      sessionId: 'child',
      messageId: 'child-message-1',
      preserveAgentContext: true,
    });
    expect(mockSetSessionId).not.toHaveBeenCalled();
  });

  it('keeps an unavailable latest conversation visible without opening an older one', async () => {
    render(
      <TaskExecutionPlan
        taskPlan={{
          planId: 'plan-4',
          version: 1,
          title: 'Plan',
          status: 'ACTIVE',
          sessionId: 'root',
          messageId: 'root-message',
          tasks: [
            {
              taskId: 'task-1',
              teamId: 'team-1',
              position: 1,
              title: 'Review',
              status: 'IN_PROGRESS',
              executions: [
                {
                  attempt: 1,
                  runs: [
                    { sessionId: 'child', messageId: 'old-message', runId: 'child:1' },
                    { runId: 'child:2', childTurn: 2 },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.title' }));
    expect(screen.queryByRole('button', { name: 'Review Open latest execution' })).not.toBeInTheDocument();
    expect(screen.getByText(/messageList.taskPlan.noExecution/)).toBeInTheDocument();
    const availableExecutionButton = screen.getByRole('button', { name: 'Review Run 1 Conversation 1' });
    fireEvent.click(availableExecutionButton);
    await waitFor(() => expect(availableExecutionButton).toBeEnabled());
    expect(mockLocateMessage).toHaveBeenCalledWith({
      sessionId: 'child',
      messageId: 'old-message',
      preserveAgentContext: true,
    });
  });

  it('does not render empty execution placeholders as a first attempt', () => {
    render(
      <TaskExecutionPlan
        taskPlan={{
          planId: 'plan-empty-execution',
          version: 1,
          title: 'Plan',
          status: 'COMPLETED',
          sessionId: 'root',
          messageId: 'root-message',
          tasks: [
            {
              taskId: 'task-1',
              teamId: 'team-1',
              position: 1,
              title: 'Review',
              status: 'COMPLETED',
              executions: [{ attempt: 1, attemptId: 'attempt-1', runs: [] }],
            },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.title' }));
    expect(screen.queryByText('Run 1')).not.toBeInTheDocument();
    expect(screen.queryByText('messageList.taskPlan.noExecution')).not.toBeInTheDocument();
  });

  it('shows immediate feedback while locating an execution', async () => {
    let resolveLocate: () => void = () => undefined;
    mockLocateMessage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveLocate = resolve;
        })
    );
    render(
      <TaskExecutionPlan
        taskPlan={{
          planId: 'plan-loading',
          version: 1,
          title: 'Plan',
          status: 'COMPLETED',
          sessionId: 'root',
          messageId: 'root-message',
          tasks: [
            {
              taskId: 'task-1',
              position: 1,
              title: 'Review',
              status: 'COMPLETED',
              executions: [{ attempt: 1, runs: [{ sessionId: 'child', messageId: 'child-message' }] }],
            },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'messageList.taskPlan.title' }));
    const executionButton = screen.getByRole('button', { name: 'Review Run 1 Conversation 1' });
    fireEvent.click(executionButton);
    expect(executionButton).toBeDisabled();
    expect(executionButton).toHaveAttribute('aria-busy', 'true');

    resolveLocate();
    await waitFor(() => expect(executionButton).toBeEnabled());
  });
});
