import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import {
  clearAgentTeamsSnapshots,
  publishAgentTeamsSnapshot,
} from '@/components/MessagesComp/ToolCall/agentTeamsStore';
import AgentTeamsHeaderActivity from '../AgentTeamsHeaderActivity';

const mockDispatch = jest.fn();
const mockSetSessionId = jest.fn();
let newMessageHandler: ((message: any) => void) | undefined;
const messages: Record<string, string> = {
  'agentTeamsActivity.openPanel': '打开专家团活动面板',
  'agentTeamsActivity.panelTitle': '专家团活动面板',
};

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => messages[id] || id }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({ setSessionId: mockSetSessionId }));
jest.mock('@/utils/websocket', () => ({
  __esModule: true,
  default: {
    onMessage: jest.fn((_type: string, handler: (message: any) => void) => {
      newMessageHandler = handler;
    }),
    offMessage: jest.fn(),
  },
}));
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
    newMessageHandler = undefined;
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

  it('reopens member activity for a newer child run and ignores an older late terminal', () => {
    publishAgentTeamsSnapshot('100', {
      ...snapshot,
      capturedAt: '2026-08-31T08:01:00Z',
      team: {
        ...snapshot.team,
        members: [
          {
            id: 'member-1',
            byclawSessionId: '201',
            name: '架构舵手',
            activity: 'idle',
            status: 'completed',
            childRunId: 'member-1:1',
            childTurn: 1,
          },
        ],
      },
    } as any);
    render(<AgentTeamsHeaderActivity rootSessionId="100" currentSession={{ sessionId: '100' } as any} />);
    fireEvent.click(screen.getByRole('button', { name: '打开专家团活动面板' }));

    act(() => {
      newMessageHandler?.({
        sessionId: '201',
        streamId: '20-0',
        data: {
          sessionId: '201',
          running: true,
          metadata: JSON.stringify({
            session_scope: 'child',
            external_parent_session_id: '100',
            external_session_id: 'member-1',
            session_status: 'running',
            child_run_id: 'member-1:2',
            child_turn: 2,
          }),
        },
      });
    });
    expect(screen.getByText('执行中')).toBeInTheDocument();

    act(() => {
      newMessageHandler?.({
        sessionId: '201',
        streamId: '21-0',
        data: {
          sessionId: '201',
          running: false,
          metadata: JSON.stringify({
            session_scope: 'child',
            external_parent_session_id: '100',
            external_session_id: 'member-1',
            session_status: 'completed',
            child_run_id: 'member-1:1',
            child_turn: 1,
          }),
        },
      });
    });
    expect(screen.getByText('执行中')).toBeInTheDocument();
  });
});
