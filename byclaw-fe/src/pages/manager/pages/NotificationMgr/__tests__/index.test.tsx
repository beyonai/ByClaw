import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import NotificationMgr from '..';

const mockUseAppStore = jest.fn();

jest.setTimeout(20000);

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        'notificationMgr.versionNotice': 'Version Notice',
        'notificationMgr.systemNotice': 'System Notice',
        'notificationMgr.searchTitle': 'Search title',
        'notificationMgr.addNotification': 'Add Notification',
        'notificationMgr.column.title': 'Title',
        'notificationMgr.column.markdownContent': 'Markdown Content',
        'notificationMgr.column.versionNo': 'Version No.',
        'notificationMgr.column.createdAt': 'Created At',
        'notificationMgr.createNoticeTitle': 'Add {type}',
        'notificationMgr.titleRequired': 'Please enter notification title',
        'notificationMgr.versionTitlePlaceholder': 'Example: v1.2.0 update announcement',
        'notificationMgr.versionNoRequired': 'Please enter version number',
        'notificationMgr.versionNoPlaceholder': 'Example: 1.2.0',
        'notificationMgr.contentRequired': 'Please enter notification content',
        'notificationMgr.markdownContentPlaceholder': '# Updates',
        'common.search': 'Search',
        'common.refresh': 'Refresh',
        'common.preview': 'Preview',
        'common.edit': 'Edit',
        'common.delete': 'Delete',
        'common.totalItems': 'Total {total} items',
      };
      return (messages[id] || id)
        .replace('{total}', String(values?.total ?? ''))
        .replace('{type}', String(values?.type ?? ''));
    },
  }),
}));

jest.mock('@/models/common/useAppStore', () => ({
  __esModule: true,
  default: () => mockUseAppStore(),
}));

jest.mock('@/pages/manager/service/NotificationMgr', () => ({
  BIZ_TYPE_SYSTEM: 1,
  BIZ_TYPE_VERSION: 2,
  buildNotificationPayload: jest.fn(),
  createNotification: jest.fn(),
  deleteNotification: jest.fn(),
  queryNotificationPage: jest.fn(() =>
    Promise.resolve({
      code: 0,
      data: {
        records: [],
        current: 1,
        pageSize: 10,
        total: 0,
      },
    })
  ),
  updateNotification: jest.fn(),
}));

jest.mock('@/components/Markdown', () => ({
  __esModule: true,
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));

describe('NotificationMgr i18n', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppStore.mockReturnValue({
      versionInfo: null,
      getVersionInfo: jest.fn(),
    });
  });

  it('renders core labels through intl messages', async () => {
    render(<NotificationMgr />);

    await waitFor(() => {
      expect(screen.getByText('Version Notice')).toBeInTheDocument();
    });

    expect(screen.getByText('System Notice')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search title')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Notification/ })).toBeInTheDocument();
    expect(screen.getAllByText('Title').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Markdown Content').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Version No.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Created At').length).toBeGreaterThan(0);
  });

  it('fills version number but keeps it editable when build version is available for create', async () => {
    mockUseAppStore.mockReturnValue({
      versionInfo: { version: '1.2.3' },
      getVersionInfo: jest.fn(),
    });

    render(<NotificationMgr />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Notification/ }));

    expect(screen.getByDisplayValue('1.2.3')).not.toBeDisabled();
  });

  it('keeps version number editable when build version is unavailable', async () => {
    const getVersionInfo = jest.fn();
    mockUseAppStore.mockReturnValue({
      versionInfo: {},
      getVersionInfo,
    });

    render(<NotificationMgr />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Notification/ }));

    expect(screen.getByPlaceholderText('Example: 1.2.0')).not.toBeDisabled();
    expect(getVersionInfo).not.toHaveBeenCalled();
  });

  it('requests build version and keeps version number editable while version info is missing', async () => {
    const getVersionInfo = jest.fn();
    mockUseAppStore.mockReturnValue({
      versionInfo: null,
      getVersionInfo,
    });

    render(<NotificationMgr />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Notification/ }));

    expect(getVersionInfo).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Example: 1.2.0')).not.toBeDisabled();
  });

  it('disables version number when editing an existing version notification', async () => {
    const { queryNotificationPage } = jest.requireMock('@/pages/manager/service/NotificationMgr');
    queryNotificationPage.mockResolvedValueOnce({
      code: 0,
      data: {
        records: [
          {
            id: 'notice-1',
            title: 'Version 1.0.0',
            content: '# Updates',
            extraInfo: '1.0.0',
            createTime: '2026-06-17 10:00:00',
          },
        ],
        current: 1,
        pageSize: 10,
        total: 1,
      },
    });

    render(<NotificationMgr />);

    fireEvent.click(await screen.findByRole('button', { name: /Edit/ }));

    expect(screen.getByDisplayValue('1.0.0')).toBeDisabled();
  }, 10000);
});
