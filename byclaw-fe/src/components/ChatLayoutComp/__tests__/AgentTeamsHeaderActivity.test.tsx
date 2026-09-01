import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import {
  clearAgentTeamsSnapshots,
  publishAgentTeamsSnapshot,
} from '@/components/MessagesComp/ToolCall/agentTeamsStore';
import AgentTeamsHeaderActivity from '../AgentTeamsHeaderActivity';

const mockDispatch = jest.fn();
const mockSetSessionId = jest.fn();
const messages: Record<string, string> = {
  'agentTeamsActivity.openPanel': '打开专家团活动面板',
  'agentTeamsActivity.panelTitle': '专家团活动面板',
};

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => messages[id] || id }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({ setSessionId: mockSetSessionId }));
jest.mock('antd', () => ({
  Drawer: ({ children, open, title }: any) =>
    open ? (
      <aside role="dialog" aria-label={title}>
        {children}
      </aside>
    ) : null,
  Progress: ({ percent }: any) => <span>{percent}%</span>,
  Pagination: ({ current, onChange }: any) => (
    <button type="button" aria-label="下一页" onClick={() => onChange(current + 1)}>
      下一页
    </button>
  ),
}));

const snapshot = {
  source: 'DSH',
  schemaVersion: 2,
  eventKind: 'agent-teams/snapshot',
  capturedAt: '2026-08-31T08:00:00Z',
  team: {
    teamId: 'team-1',
    name: 'ByClaw研发专家团',
    captainSessionId: 'dsh-root',
    messageCount: 2,
    members: [
      { id: 'member-1', byclawSessionId: '201', name: '架构舵手', activity: 'working', progress: 60 },
      { id: 'member-2', byclawSessionId: '202', name: '代码工匠', activity: 'idle', progress: 0 },
    ],
    tasks: Array.from({ length: 6 }, (_, index) => ({
      id: `t${index + 1}`,
      subject: `任务 ${index + 1}`,
      status: index === 0 ? 'completed' : index === 1 ? 'claimed' : 'pending',
    })),
  },
} as const;

describe('AgentTeamsHeaderActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearAgentTeamsSnapshots();
    publishAgentTeamsSnapshot('100', snapshot as any);
  });

  it('renders in the title, paginates tasks by five, and opens a member child session', () => {
    render(<AgentTeamsHeaderActivity rootSessionId="100" currentSession={{ sessionId: '100' } as any} />);
    fireEvent.click(screen.getByRole('button', { name: '打开专家团活动面板' }));

    const panel = screen.getByRole('dialog', { name: '专家团活动面板' });
    expect(within(panel).queryByText(/DSH|TEAM RUNTIME/i)).not.toBeInTheDocument();
    expect(within(panel).getByText('待命')).toBeInTheDocument();
    expect(within(panel).getByText('进行中')).toBeInTheDocument();
    expect(within(panel).getByText('任务 1')).toBeInTheDocument();
    expect(within(panel).queryByText('任务 6')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: '下一页' }));
    expect(within(panel).getByText('任务 6')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: '打开架构舵手子会话' }));
    expect(mockSetSessionId).toHaveBeenCalledWith('201');
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'session/addSession' }));
  });
});
