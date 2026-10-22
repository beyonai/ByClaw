import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigProvider, message } from 'antd';
import AppVersionMgr from '.';
import { getAppVersionCapability, pageAppVersions, updateAppVersion } from '../../service/AppVersion';

let mockLocale = 'en-US';
jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
  useSelector: (selector: (state: unknown) => unknown) => selector({ user: { userInfo: { userCode: 'adminvip' } } }),
}));
jest.mock('../../service/AppVersion', () => ({
  getAppVersionCapability: jest.fn(),
  pageAppVersions: jest.fn(),
  updateAppVersion: jest.fn(),
  createAppVersion: jest.fn(),
  deleteAppVersion: jest.fn(),
  publishAppVersion: jest.fn(),
  offlineAppVersion: jest.fn(),
  uploadAppPackage: jest.fn(),
  buildPackageDownloadUrl: () => '/package/1',
}));
jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    Modal: (props: import('antd').ModalProps) => <actual.Modal {...props} transitionName="" maskTransitionName="" />,
    message: { ...actual.message, success: jest.fn(), error: jest.fn(), warning: jest.fn() },
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = 'en-US';
  jest.mocked(getAppVersionCapability).mockResolvedValue(true);
  jest.mocked(pageAppVersions).mockResolvedValue({
    pageNum: 1,
    pageSize: 10,
    total: 1,
    totalPages: 1,
    list: [
      {
        versionId: '9007199254740993',
        deviceType: 'electron',
        platform: 'macos',
        arch: 'arm64',
        channel: 'stable',
        appVersion: '1.0.0',
        url: 'https://example.com/app.dmg',
        updateType: 'full',
        releaseStatus: 'draft',
        fileName: '中文安装包.dmg',
        updateStatus: '0',
      },
    ],
  });
  jest.mocked(updateAppVersion).mockResolvedValue(undefined);
});

it('localizes the editor and refreshes labels without changing version identifiers or enum values', async () => {
  const view = render(<AppVersionMgr />, {
    wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  });
  await screen.findByText('中文安装包.dmg');
  expect(screen.getByText('Draft')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Edit'));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByLabelText('Version')).toHaveValue('1.0.0');
  expect(dialog.getByText('stable Release')).toBeInTheDocument();
  mockLocale = 'zh-CN';
  view.rerender(<AppVersionMgr />);
  expect(dialog.getByLabelText('版本号')).toHaveValue('1.0.0');
  expect(dialog.getByText('stable 正式')).toBeInTheDocument();
  mockLocale = 'en-US';
  view.rerender(<AppVersionMgr />);
  await act(async () => {
    fireEvent.click(dialog.getByText('Save version'));
  });
  await waitFor(() =>
    expect(updateAppVersion).toHaveBeenCalledWith(
      '9007199254740993',
      expect.objectContaining({
        platform: 'macos',
        arch: 'arm64',
        channel: 'stable',
        updateType: 'full',
        releaseStatus: 'draft',
        appVersion: '1.0.0',
        fileName: '中文安装包.dmg',
        forceUpdate: false,
      })
    )
  );
  expect(message.success).toHaveBeenCalledWith('Version saved');
});
