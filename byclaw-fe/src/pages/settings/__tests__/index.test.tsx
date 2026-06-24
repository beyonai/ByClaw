import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

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

  it('expands filtered version details after clicking the version button', async () => {
    await act(async () => {
      render(<Settings />);
    });

    expect(screen.queryByText('2026-06-16 10:00:00')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1.2.3' }));

    expect(screen.getByText('settings.versionInfo.buildTime')).toBeInTheDocument();
    expect(screen.getByText('2026-06-16 10:00:00')).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
    expect(screen.queryByText('abc123')).not.toBeInTheDocument();
    expect(screen.queryByText('abc123def456')).not.toBeInTheDocument();
    expect(screen.queryByText('feat: show version details')).not.toBeInTheDocument();
    expect(screen.queryByText('byclaw-fe')).not.toBeInTheDocument();
  });
});
