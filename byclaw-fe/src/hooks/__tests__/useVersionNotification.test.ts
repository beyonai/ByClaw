jest.mock('@umijs/max', () => ({
  useSelector: jest.fn(),
  useIntl: jest.fn(() => ({
    formatMessage: jest.fn(({ id }: { id: string }) => {
      if (id === 'versionNotification.viewDetailsTip') {
        return 'Click to view version details';
      }
      return id;
    }),
  })),
}));

jest.mock('@/pages/manager/service/NotificationMgr', () => ({
  getLatestVersionNotification: jest.fn(),
}));

jest.mock('@/components/Markdown', () => () => null);

import { renderHook, waitFor } from '@testing-library/react';
import { useSelector } from '@umijs/max';
import { getLatestVersionNotification as fetchLatestVersionNotification } from '@/pages/manager/service/NotificationMgr';
import useAppStore from '@/models/common/useAppStore';
import {
  VERSION_NOTIFICATION_READ_IDS_STORAGE_KEY,
  hasReadVersionNotification,
  saveReadVersionNotificationId,
} from '../useVersionNotification';
import useVersionNotification from '../useVersionNotification';

const mockUseSelector = useSelector as jest.Mock;
const mockFetchLatestVersionNotification = fetchLatestVersionNotification as jest.Mock;

describe('useVersionNotification read storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves version notification ids and detects previously read ids', () => {
    expect(hasReadVersionNotification('version-1')).toBe(false);

    saveReadVersionNotificationId('version-1');

    expect(hasReadVersionNotification('version-1')).toBe(true);
    expect(JSON.parse(localStorage.getItem(VERSION_NOTIFICATION_READ_IDS_STORAGE_KEY) || '[]')).toEqual(['version-1']);
  });

  it('does not duplicate saved ids', () => {
    saveReadVersionNotificationId('version-1');
    saveReadVersionNotificationId('version-1');

    expect(JSON.parse(localStorage.getItem(VERSION_NOTIFICATION_READ_IDS_STORAGE_KEY) || '[]')).toEqual(['version-1']);
  });
});

describe('useVersionNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    useAppStore.setState({ versionNotification: null });
    mockUseSelector.mockImplementation((selector) => selector({ user: { userInfo: { id: 'user-1' } } }));
  });

  it('emits tips and saves read id after clicking the version notification tip', async () => {
    const eventEmitter = { emit: jest.fn() };
    mockFetchLatestVersionNotification.mockResolvedValue({
      code: 0,
      data: {
        id: 'version-1',
        title: 'Version 1',
        content: 'content',
      },
    });

    renderHook(() => useVersionNotification(eventEmitter));

    await waitFor(() => {
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'beyond-titlewriter-set-assistanttips',
        expect.objectContaining({ tips: 'Click to view version details' })
      );
    });

    expect(hasReadVersionNotification('version-1')).toBe(false);
    const [, payload] = eventEmitter.emit.mock.calls.find(([type]) => type === 'beyond-titlewriter-set-assistanttips');
    payload.onClick();

    expect(hasReadVersionNotification('version-1')).toBe(true);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'beyond-main-driver-open-type',
      expect.objectContaining({ canClose: true, title: 'Version 1' })
    );
  });

  it('does not emit tips when latest version notification id was already read', async () => {
    const eventEmitter = { emit: jest.fn() };
    saveReadVersionNotificationId('version-1');
    mockFetchLatestVersionNotification.mockResolvedValue({
      code: 0,
      data: {
        id: 'version-1',
        title: 'Version 1',
        content: 'content',
      },
    });

    renderHook(() => useVersionNotification(eventEmitter));

    await waitFor(() => {
      expect(mockFetchLatestVersionNotification).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});
