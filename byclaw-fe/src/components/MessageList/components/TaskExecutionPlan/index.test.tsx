import { fireEvent, render, screen } from '@testing-library/react';
import type { TaskPlanSnapshot } from '@/typescript/message';
import type { AgentTeamsSnapshot } from '@/components/MessagesComp/ToolCall/AgentTeamsActivity';
import TaskExecutionPlan from './index';

const mockLocateMessage = jest.fn();
const mockSetSessionId = jest.fn();
let mockTeamSnapshot: AgentTeamsSnapshot | undefined;

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
      return id;
    },
  }),
}));

describe('TaskExecutionPlan', () => {
  beforeEach(() => {
    mockLocateMessage.mockClear();
    mockSetSessionId.mockClear();
    mockTeamSnapshot = undefined;
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

  it('opens the latest execution by default and allows selecting an earlier attempt', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Implement feature Open latest execution' }));
    expect(mockLocateMessage).toHaveBeenLastCalledWith({
      sessionId: 'child',
      messageId: 'child-message-2',
      preserveAgentContext: true,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Implement feature Run 1 Conversation 1' }));
    expect(mockLocateMessage).toHaveBeenLastCalledWith({
      sessionId: 'child',
      messageId: 'child-message-1',
      preserveAgentContext: true,
    });
    expect(mockSetSessionId).not.toHaveBeenCalled();
  });

  it('keeps an unavailable latest conversation visible without opening an older one', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Review Run 1 Conversation 1' }));
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
});
