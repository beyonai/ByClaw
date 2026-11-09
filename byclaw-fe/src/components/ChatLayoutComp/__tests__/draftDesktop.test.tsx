import { render, screen } from '@testing-library/react';
import ChatTitle from '../ChatTitle';
const mockEmit = jest.fn();
const mockEmitter = { emit: mockEmit };
const mockApp = { isSiderCollapsed: false, getSandboxesInfoUrl: jest.fn().mockResolvedValue([]) };
let mockAdminVip = false;
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
  useSelector: () => null,
  Link: ({ children }: any) => <span>{children}</span>,
}));
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: mockEmitter }));
jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: Object.assign(() => mockApp, { getState: () => mockApp }),
}));
jest.mock('@/utils/auth', () => ({
  isAdminVip: () => mockAdminVip,
  getAuthSnapshot: () => ({ sessionId: 'auth', token: '', ssoToken: '' }),
  getDesktopIdentitySnapshot: () => ({ account: 'user', enterpriseId: 'tenant' }),
}));
jest.mock('@/utils/session', () => ({ sessionHandler: (value: any) => value }));
jest.mock('@/pages/workSpace/Achievements', () => ({
  __esModule: true,
  default: { Trigger: require('react').forwardRef(() => null) },
}));
jest.mock('@/components/ChatAvatar', () => () => null);
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/components/NullableAntdCompWithAnim', () => () => null);
jest.mock('../components/CreateTemplate', () => () => null);
jest.mock('../ProjectSessionActions', () => () => null);
it('keeps the title visible through formal session creation without a desktop entry', () => {
  mockAdminVip = false;
  sessionStorage.clear();
  const view = render(<ChatTitle agentType={'main' as any} />);
  expect(screen.getByText('New Chat')).toBeInTheDocument();
  expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  view.rerender(<ChatTitle agentType={'main' as any} sessionId="formal" />);
  expect(screen.getByText('New Chat')).toBeInTheDocument();
  expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
});

it('offers template saving to administrators only after the draft receives its session ID', () => {
  mockAdminVip = true;
  const view = render(<ChatTitle agentType={'main' as any} />);
  expect(screen.queryByTitle('远程桌面')).not.toBeInTheDocument();
  expect(screen.queryByText('chatTitle.saveAsTemplate')).not.toBeInTheDocument();
  view.rerender(<ChatTitle agentType={'main' as any} sessionId="formal" />);
  expect(screen.getByText('chatTitle.saveAsTemplate')).toBeInTheDocument();
});
