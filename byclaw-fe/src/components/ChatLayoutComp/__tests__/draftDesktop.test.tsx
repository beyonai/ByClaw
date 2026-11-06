import { act, fireEvent, render, screen } from '@testing-library/react';
import ChatTitle from '../ChatTitle';
import { getDesktopOwner, selectDesktop, useDesktopWorkspace } from '@/utils/desktopWorkspace';
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
it('keeps a real draft title desktop entry mounted through formal session creation', () => {
  mockAdminVip = false;
  sessionStorage.clear();
  useDesktopWorkspace.setState({ owners: {}, activeOwner: '', visible: false });
  const view = render(<ChatTitle agentType={'main' as any} />);
  fireEvent.click(screen.getByTitle('远程桌面'));
  const request = mockEmit.mock.calls.find(([name]) => name === 'beyond-drawer-view')?.[1];
  expect(request.content.owner).toMatch(/^temporary:/);
  act(() => selectDesktop(request.content.owner, { sandboxId: 'draft-sandbox', instance: 'vnc' }));
  view.rerender(<ChatTitle agentType={'main' as any} sessionId="formal" />);
  expect(screen.getByTitle('远程桌面')).toBeInTheDocument();
  expect(getDesktopOwner(JSON.stringify(['session', 'formal'])).refs).toEqual([
    { sandboxId: 'draft-sandbox', instance: 'vnc' },
  ]);
  expect(useDesktopWorkspace.getState().owners[request.content.owner]).toBeUndefined();
});

it('offers template saving to administrators only after the draft receives its session ID', () => {
  mockAdminVip = true;
  const view = render(<ChatTitle agentType={'main' as any} />);
  expect(screen.getByTitle('远程桌面')).toBeInTheDocument();
  expect(screen.queryByText('chatTitle.saveAsTemplate')).not.toBeInTheDocument();
  view.rerender(<ChatTitle agentType={'main' as any} sessionId="formal" />);
  expect(screen.getByText('chatTitle.saveAsTemplate')).toBeInTheDocument();
});
