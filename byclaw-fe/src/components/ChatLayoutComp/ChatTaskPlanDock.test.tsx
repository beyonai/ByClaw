import { render, screen } from '@testing-library/react';

import type { TaskPlanSnapshot } from '@/typescript/message';
import ChatTaskPlanDock from './ChatTaskPlanDock';

jest.mock('@/components/MessageList/components/TaskExecutionPlan', () => ({
  __esModule: true,
  default: ({ taskPlan }: { taskPlan: TaskPlanSnapshot }) => <div>{taskPlan.title}</div>,
}));

const plan: TaskPlanSnapshot = {
  planId: 'child-plan',
  version: 2,
  title: '子会话任务计划',
  status: 'ACTIVE',
  sessionId: 'child-session',
  messageId: 'child-message',
  tasks: [],
};

describe('ChatTaskPlanDock', () => {
  it('renders a task plan independently from whether the conversation is read-only', () => {
    const view = render(<ChatTaskPlanDock taskPlan={plan} />);

    expect(screen.getByText('子会话任务计划')).toBeInTheDocument();

    view.rerender(<ChatTaskPlanDock taskPlan={{ ...plan, version: 3, title: '子会话任务计划（已更新）' }} />);
    expect(screen.getByText('子会话任务计划（已更新）')).toBeInTheDocument();
  });
});
