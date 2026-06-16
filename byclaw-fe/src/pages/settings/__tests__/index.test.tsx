import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import Settings from '..';

const mockUseAppStore = jest.fn();
const mockUseSelector = jest.fn();

jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: () => mockUseAppStore(),
}));

jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(() => 'zh-CN'),
  setLocale: jest.fn(),
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
  useSelector: (selector: (state: any) => any) => mockUseSelector(selector),
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: { type: string }) => <span data-testid={`icon-${type}`} />,
}));

jest.mock('@/service/common/request', () => ({
  globalLogout: jest.fn(),
}));

jest.mock('@/utils', () => ({
  getPublicPath: jest.fn(() => '/'),
}));

jest.mock('../components/PasswordModal', () => ({
  __esModule: true,
  default: () => <div>PasswordModal</div>,
}));

jest.mock('../components/PersonalEmailSettings', () => ({
  __esModule: true,
  default: () => <div>PersonalEmailSettings</div>,
}));

describe('Settings version info', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockUseSelector.mockImplementation((selector: (state: any) => any) =>
      selector({
        user: {
          userInfo: {
            userName: 'Tester',
            userCode: 'U001',
            registerType: '1',
          },
        },
      })
    );

    mockUseAppStore.mockReturnValue({
      versionInfo: {
        version: '1.2.3',
        branch: 'main',
        commit: 'abc123',
        commitFull: 'abc123def456',
        buildTime: '2026-06-16 10:00:00',
        module: 'byclaw-fe',
        commitMsg: 'feat: show version details',
      },
      getVersionInfo: jest.fn(),
    });
  });

  it('expands version details after clicking the version button', () => {
    render(<Settings />);

    expect(screen.queryByText('abc123')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1.2.3' }));

    expect(screen.getByText('abc123')).toBeInTheDocument();
    expect(screen.getByText('byclaw-fe')).toBeInTheDocument();
    expect(screen.getByText('feat: show version details')).toBeInTheDocument();
  });
});
