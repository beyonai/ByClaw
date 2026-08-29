import { fireEvent, render, screen } from '@testing-library/react';
import type { TaskPlanSnapshot } from '@/typescript/message';
import TaskExecutionPlan from './index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, number>) => {
      if (id === 'messageList.taskPlan.progress') return `${values?.completed}/${values?.total} completed`;
      if (id === 'messageList.taskPlan.summary.COMPLETED') return `${values?.count} completed`;
      if (id === 'messageList.taskPlan.summary.IN_PROGRESS') return `${values?.count} in progress`;
      if (id === 'messageList.taskPlan.summary.PENDING') return `${values?.count} pending`;
      return id;
    },
  }),
}));

describe('TaskExecutionPlan', () => {
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
});
