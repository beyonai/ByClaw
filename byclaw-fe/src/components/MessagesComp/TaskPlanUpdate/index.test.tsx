import { render, screen } from '@testing-library/react';
import TaskPlanUpdate from './index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, number>) => {
      if (id === 'messageList.taskPlan.updated') return 'Task plan updated';
      if (id === 'messageList.taskPlan.progress') return `${values?.completed}/${values?.total} completed`;
      return id;
    },
  }),
}));

describe('TaskPlanUpdate', () => {
  it('renders a compact transcript summary for a generic 2008 plan event', () => {
    render(
      <TaskPlanUpdate
        messageListItemContent={{
          substance: JSON.stringify({
            steps: [
              {
                sub_steps: [
                  { step_description: 'Test', tool_metadata: { status: 'completed' } },
                  { step_description: 'Deploy', tool_metadata: { status: 'in_progress' } },
                ],
              },
            ],
          }),
        }}
      />
    );

    expect(screen.getByText('Task plan updated')).toBeInTheDocument();
    expect(screen.getByText('1/2 completed')).toBeInTheDocument();
    expect(screen.queryByText('Test')).not.toBeInTheDocument();
    expect(screen.queryByText('Deploy')).not.toBeInTheDocument();
  });
});
