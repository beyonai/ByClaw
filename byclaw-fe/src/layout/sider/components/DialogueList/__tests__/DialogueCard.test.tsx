import React from 'react';
import { act, render, screen } from '@testing-library/react';

import DialogueCard from '../DialogueCard';
import { chatSessionRuntimeManager } from '@/utils/chatSessionRuntimeManager';

jest.mock('@umijs/max', () => ({
  useDispatch: () => jest.fn(() => Promise.resolve()),
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useNavigate: () => jest.fn(),
  useSelector: (selector: any) =>
    selector({
      session: {
        sessionLoading: false,
        editLoading: false,
        delLoading: false,
      },
      employees: {
        employeesList: [],
      },
    }),
}));

jest.mock('antd', () => ({
  Badge: ({ children, count, dot, status }: any) => (
    <div data-testid="badge" data-count={count ?? ''} data-dot={dot ? 'true' : 'false'} data-status={status ?? ''}>
      {children}
    </div>
  ),
  Dropdown: ({ children }: any) => <>{children}</>,
  Input: (props: any) => <input {...props} />,
  Popconfirm: ({ children }: any) => <>{children}</>,
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: { type: string }) => <span data-testid="antd-icon">{type}</span>,
}));

jest.mock('@/components/ChatAvatar', () => ({
  __esModule: true,
  default: ({ session }: any) => <div data-testid="chat-avatar">{session.sessionId}</div>,
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    sessionId: '',
    setAgentId: jest.fn(),
    setSessionId: jest.fn(),
  }),
}));

jest.mock('@/hooks/useTracker', () => ({
  __esModule: true,
  default: () => ({
    trackerEmployeeClick: jest.fn(),
  }),
}));

const session = {
  sessionId: 'session-1',
  sessionName: '会话 1',
  sessionContent: 'hello',
  unreadCount: 5,
};

describe('DialogueCard', () => {
  beforeEach(() => {
    chatSessionRuntimeManager.clear();
  });

  it('shows processing badge while the session is running', () => {
    render(<DialogueCard item={session as any} cannotActionList={['edit', 'delete']} />);

    expect(screen.getByTestId('badge')).toHaveAttribute('data-status', '');
    expect(screen.getByTestId('badge')).toHaveAttribute('data-count', '5');

    act(() => {
      chatSessionRuntimeManager.register({
        clientRequestId: 'request-1',
        sessionId: 'session-1',
      });
    });

    expect(screen.getByTestId('badge')).toHaveAttribute('data-status', 'processing');
    expect(screen.getByTestId('badge')).toHaveAttribute('data-count', '');

    act(() => {
      chatSessionRuntimeManager.complete('request-1');
    });

    expect(screen.getByTestId('badge')).toHaveAttribute('data-status', '');
    expect(screen.getByTestId('badge')).toHaveAttribute('data-count', '5');
  });
});
