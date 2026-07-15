import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import FilesPage from '../index';

const mockGetStorageQuota = jest.fn();
let mockFileBrowserMountCount = 0;

jest.mock('../service', () => ({
  getStorageQuota: (...args: any[]) => mockGetStorageQuota(...args),
}));

jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({
  useActiveSiderAgent: () => ({ resourceId: 'agent-1' }),
}));

jest.mock('../StorageQuotaCard', () => ({
  __esModule: true,
  default: ({ quota, onQuotaChanged }: any) => (
    <div>
      <span data-testid="quota-total">{quota?.totalQuotaBytes}</span>
      <button type="button" onClick={() => onQuotaChanged('CANCELLATION_WITHDRAWN')}>
        withdrawal changed
      </button>
      <button type="button" onClick={() => onQuotaChanged('ARCHIVED')}>
        archive changed
      </button>
    </div>
  ),
}));

jest.mock('@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel', () => {
  const ReactRuntime = require('react');
  return function MockFileBrowserPanel() {
    ReactRuntime.useEffect(() => {
      mockFileBrowserMountCount += 1;
    }, []);
    return <div data-testid="file-browser" />;
  };
});

const quota = (totalQuotaBytes: number) => ({
  data: {
    baseQuotaBytes: totalQuotaBytes,
    addonQuotaBytes: 0,
    totalQuotaBytes,
    usedBytes: 0,
    remainingBytes: totalQuotaBytes,
    usagePercent: 0,
    usageStatus: 'NORMAL',
    provisionStatus: 'READY',
    quotaSyncStatus: 'SYNCED',
  },
});

describe('FilesPage storage state synchronization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileBrowserMountCount = 0;
    mockGetStorageQuota.mockResolvedValue(quota(1024));
  });

  it('refreshes quota for cancellation changes and remounts the file browser only after archive', async () => {
    render(<FilesPage />);

    await waitFor(() => expect(screen.getByTestId('quota-total')).toHaveTextContent('1024'));
    expect(mockFileBrowserMountCount).toBe(1);

    mockGetStorageQuota.mockResolvedValueOnce(quota(2048));
    fireEvent.click(screen.getByRole('button', { name: 'withdrawal changed' }));
    await waitFor(() => expect(screen.getByTestId('quota-total')).toHaveTextContent('2048'));
    expect(mockFileBrowserMountCount).toBe(1);

    mockGetStorageQuota.mockResolvedValueOnce(quota(4096));
    fireEvent.click(screen.getByRole('button', { name: 'archive changed' }));
    await waitFor(() => expect(screen.getByTestId('quota-total')).toHaveTextContent('4096'));
    await waitFor(() => expect(mockFileBrowserMountCount).toBe(2));
    expect(mockGetStorageQuota).toHaveBeenCalledTimes(3);
  });
});
