import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import AgentTeamsActivity, { isAgentTeamsSnapshot } from '../AgentTeamsActivity';

const mockDispatch = jest.fn();
const mockSetSessionId = jest.fn();

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useSelector: (selector: (state: any) => unknown) =>
    selector({
      session: {
        sessionList: [
          {
            sessionId: '100',
            sessionName: '成员自我介绍安排',
            projectId: '902',
            objectId: 903,
            objectType: 'Agent',
          },
        ],
      },
    }),
}));

jest.mock('@/hooks/useGlobal', () => () => ({
  sessionId: '100',
  setSessionId: mockSetSessionId,
}));

jest.mock('antd', () => ({
  Drawer: ({ children, open, title }: any) =>
    open ? (
      <aside role="dialog" aria-label={title}>
        {children}
      </aside>
    ) : null,
  Progress: ({ percent }: any) => <span>{percent}%</span>,
}));

const snapshot = {
  source: 'EXTERNAL',
  schemaVersion: 2,
  eventKind: 'agent-teams/snapshot',
  archived: false,
  capturedAt: '2026-08-28T08:00:00.000Z',
  team: {
    teamId: 'team-1',
    name: 'ByClaw研发专家团',
    captainSessionId: 'external-root-1',
    members: [
      {
        id: 'external-child-1',
        byclawSessionId: '200',
        name: '架构舵手',
        role: '架构负责人',
        status: 'active',
        activity: 'working',
        progress: 50,
        done: 1,
        total: 2,
        currentTask: '分析父子会话架构',
        unread: 0,
      },
    ],
    tasks: [
      {
        id: 'task-1',
        subject: '分析父子会话架构',
        status: 'in_progress',
        state: 'running',
        assignee: '架构舵手',
        dependencies: [],
        depth: 0,
      },
    ],
    messageCount: 0,
    captainInbox: [],
  },
} as const;

describe('AgentTeamsActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recognizes only schema-v2 AgentTeams snapshots', () => {
    expect(isAgentTeamsSnapshot(snapshot)).toBe(true);
    expect(isAgentTeamsSnapshot({ ...snapshot, schemaVersion: 1 })).toBe(false);
    expect(isAgentTeamsSnapshot({ ...snapshot, eventKind: 'tool.call' })).toBe(false);
  });

  it('opens the activity panel and navigates to a persisted child session', () => {
    render(<AgentTeamsActivity snapshot={snapshot} />);

    expect(screen.getByText('ByClaw研发专家团')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开 AgentTeams 活动面板' }));

    const panel = screen.getByRole('dialog', { name: 'AgentTeams 活动面板' });
    expect(panel).toBeInTheDocument();
    expect(within(panel).getAllByText('分析父子会话架构')).toHaveLength(2);
    fireEvent.click(within(panel).getByRole('button', { name: '打开架构舵手子会话' }));

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'session/addSession',
      payload: expect.objectContaining({
        sessionId: '200',
        parentSessionId: 100,
        sessionName: '架构舵手',
      }),
    });
    expect(mockSetSessionId).toHaveBeenCalledWith('200');
  });
});
