import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceUserBar from '../WorkspaceUserBar';

const mockUserMenuClick = jest.fn();
const mockSetLocale = jest.fn();

jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  setLocale: (...args: any[]) => mockSetLocale(...args),
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: () => ({
    userId: 1,
    userName: '测试用户',
    avatar: '/avatar.png',
    userCode: 'test-user',
  }),
}));

jest.mock('../../SandboxStatus', () => () => <span>sandbox-status</span>);

jest.mock('@/layout/header/useUserDropdown', () => ({
  __esModule: true,
  default: () => ({
    userDropdownItems: [{ key: 'settings', label: '设置' }],
    onUserDropdownClick: mockUserMenuClick,
    userDropdownRender: undefined,
  }),
}));

describe('WorkspaceUserBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the user avatar and name and opens the migrated user menu on hover', async () => {
    render(<WorkspaceUserBar />);

    expect(screen.getByRole('img', { name: '测试用户' })).toHaveAttribute('src', '/avatar.png');
    expect(screen.getByText('测试用户')).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTitle('测试用户'));

    await waitFor(() => {
      expect(screen.getByText('设置')).toBeInTheDocument();
    });
  });

  it('shows the locale switch before sandbox status and switches to English', async () => {
    render(<WorkspaceUserBar />);

    const localeSwitch = screen.getByRole('button', { name: 'settings.language' });
    const sandboxStatus = screen.getByText('sandbox-status');
    expect(localeSwitch.compareDocumentPosition(sandboxStatus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(localeSwitch);
    fireEvent.click(await screen.findByText('English'));

    expect(mockSetLocale).toHaveBeenCalledWith('en-US');
  });
});
