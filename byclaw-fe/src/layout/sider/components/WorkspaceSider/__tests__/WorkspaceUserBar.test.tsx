import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkspaceUserBar from '../WorkspaceUserBar';

const mockUserMenuClick = jest.fn();

jest.mock('@umijs/max', () => ({
  useSelector: () => ({
    userId: 1,
    userName: '测试用户',
    avatar: '/avatar.png',
  }),
}));

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
});
