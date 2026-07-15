import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';

import StorageAddonManagerModal from '../StorageAddonManagerModal';

const mockGetStoragePackages = jest.fn();
const mockGetStorageGrants = jest.fn();
const mockQueryStorageChanges = jest.fn();
const mockApplyStorageAddition = jest.fn();
const mockPreviewStorageCancellation = jest.fn();
const mockApplyStorageCancellation = jest.fn();
const mockWithdrawStorageCancellation = jest.fn();
const mockArchiveStorageCancellation = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, React.ReactNode>) =>
      values ? `${id}:${Object.values(values).join(',')}` : id,
  }),
}));

jest.mock('../service', () => ({
  applyStorageAddition: (...args: any[]) => mockApplyStorageAddition(...args),
  applyStorageCancellation: (...args: any[]) => mockApplyStorageCancellation(...args),
  archiveStorageCancellation: (...args: any[]) => mockArchiveStorageCancellation(...args),
  getStorageGrants: (...args: any[]) => mockGetStorageGrants(...args),
  getStoragePackages: (...args: any[]) => mockGetStoragePackages(...args),
  previewStorageCancellation: (...args: any[]) => mockPreviewStorageCancellation(...args),
  queryStorageChanges: (...args: any[]) => mockQueryStorageChanges(...args),
  withdrawStorageCancellation: (...args: any[]) => mockWithdrawStorageCancellation(...args),
}));

const grants = [
  {
    grantId: 'grant-1',
    userId: 'user-1',
    packageId: 'package-1',
    packageName: '1G存储增值包',
    grantedBytes: 1024 ** 3,
    grantStatus: 'ACTIVE',
    grantSource: 'APPLICATION',
    grantedTime: '2026-07-15 09:00:00',
  },
  {
    grantId: 'grant-2',
    userId: 'user-1',
    packageId: 'package-2',
    packageName: '512M存储增值包',
    grantedBytes: 512 * 1024 ** 2,
    grantStatus: 'ACTIVE',
    grantSource: 'ADMIN',
    grantedTime: '2026-07-15 09:10:00',
  },
];

describe('StorageAddonManagerModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStoragePackages.mockResolvedValue({
      data: [
        {
          packageId: 'package-1',
          packageCode: 'ADDON_1G',
          packageName: '1G存储增值包',
          addonBytes: 1024 ** 3,
          status: 'ENABLED',
        },
      ],
    });
    mockGetStorageGrants.mockResolvedValue({ data: grants });
    mockQueryStorageChanges.mockResolvedValue({ data: { records: [], current: 1, size: 10, total: 0 } });
    mockApplyStorageAddition.mockResolvedValue({ data: {} });
    mockApplyStorageCancellation.mockResolvedValue({ data: {} });
    mockPreviewStorageCancellation.mockImplementation(async (grantIds: string[]) => ({
      data: {
        grantId: grantIds[0],
        grantIds,
        userId: 'user-1',
        packageNames: grantIds.length > 1 ? '1G存储增值包、512M存储增值包' : '1G存储增值包',
        grantedBytes: grantIds.length > 1 ? 1.5 * 1024 ** 3 : 1024 ** 3,
        beforeQuotaBytes: 3.5 * 1024 ** 3,
        targetQuotaBytes: grantIds.length > 1 ? 2 * 1024 ** 3 : 2.5 * 1024 ** 3,
        usedBytes: 2.7 * 1024 ** 3,
        reservedBytes: 0,
        overageBytes: grantIds.length > 1 ? 0.7 * 1024 ** 3 : 0.2 * 1024 ** 3,
        overQuotaAfterDowngrade: true,
        hasOpenRequest: false,
        graceDays: 7,
      },
    }));
  });

  it('submits an add-on request using an enabled package so capacity can stack after approval', async () => {
    const onChanged = jest.fn();
    render(
      <App>
        <StorageAddonManagerModal open onClose={jest.fn()} onChanged={onChanged} />
      </App>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'storageQuota.user.applyAddition' }));
    const dialogs = await screen.findAllByRole('dialog');
    const addDialog = dialogs[dialogs.length - 1];
    fireEvent.mouseDown(within(addDialog).getByRole('combobox'));
    fireEvent.click(await screen.findByText(/1G存储增值包（\+1\.00 GB）/));
    fireEvent.change(within(addDialog).getByLabelText('storageQuota.user.addReason'), {
      target: { value: '需要更多项目空间' },
    });
    fireEvent.click(within(addDialog).getByRole('button', { name: 'storageQuota.user.submitAddition' }));

    await waitFor(() =>
      expect(mockApplyStorageAddition).toHaveBeenCalledWith({
        packageId: 'package-1',
        reason: '需要更多项目空间',
      })
    );
    expect(onChanged).toHaveBeenCalledWith('ADDITION_SUBMITTED');
  });

  it('previews and submits cancellation for multiple concrete add-on grants', async () => {
    const onChanged = jest.fn();
    render(
      <App>
        <StorageAddonManagerModal open onClose={jest.fn()} onChanged={onChanged} />
      </App>
    );

    expect((await screen.findAllByText('1G存储增值包')).length).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.user.applyCancellation' }));
    const dialogs = await screen.findAllByRole('dialog');
    const cancelDialog = dialogs[dialogs.length - 1];
    const checkboxes = within(cancelDialog).getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);

    await waitFor(() => expect(mockPreviewStorageCancellation).toHaveBeenLastCalledWith(['grant-1', 'grant-2']));
    expect(await within(cancelDialog).findByText('storageQuota.user.downgradeWarningTitle')).toBeInTheDocument();
    const cancelReason = cancelDialog.querySelector('textarea');
    expect(cancelReason).not.toBeNull();
    fireEvent.change(cancelReason as HTMLTextAreaElement, {
      target: { value: '缩减闲置空间' },
    });
    fireEvent.click(within(cancelDialog).getByRole('button', { name: 'storageQuota.user.submitCancel' }));

    await waitFor(() =>
      expect(mockApplyStorageCancellation).toHaveBeenCalledWith({
        grantIds: ['grant-1', 'grant-2'],
        reason: '缩减闲置空间',
      })
    );
    expect(onChanged).toHaveBeenCalledWith('CANCELLATION_SUBMITTED');
  });

  it('uses server-side paged unified records and withdraws a pending add request', async () => {
    const onChanged = jest.fn();
    mockQueryStorageChanges.mockResolvedValue({
      data: {
        records: [
          {
            downgradeId: 'change-1',
            requestType: 'ADD_PACKAGE',
            downgradeStatus: 'REQUESTED',
            packageNames: '1G存储增值包',
            changeBytes: 1024 ** 3,
            targetQuotaBytes: 4 * 1024 ** 3,
          },
        ],
        current: 1,
        size: 10,
        total: 1,
      },
    });
    mockWithdrawStorageCancellation.mockResolvedValue({ data: {} });

    render(
      <App>
        <StorageAddonManagerModal open onClose={jest.fn()} onChanged={onChanged} />
      </App>
    );

    fireEvent.click(await screen.findByText('storageQuota.user.changeHistory'));
    expect(await screen.findByText('storageQuota.changeType.ADD_PACKAGE')).toBeInTheDocument();
    expect(mockQueryStorageChanges).toHaveBeenCalledWith({ pageNum: 1, pageSize: 10 });
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.user.withdraw' }));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));

    await waitFor(() => expect(mockWithdrawStorageCancellation).toHaveBeenCalledWith('change-1'));
    expect(onChanged).toHaveBeenCalledWith('CHANGE_WITHDRAWN');
  });

  it('refreshes quota and file browser after immediate archive of a cancellation change', async () => {
    const onChanged = jest.fn();
    mockQueryStorageChanges.mockResolvedValue({
      data: {
        records: [
          {
            downgradeId: 'change-2',
            requestType: 'CANCEL_PACKAGE',
            downgradeStatus: 'GRACE',
            packageNames: '1G存储增值包',
            changeBytes: 1024 ** 3,
            targetQuotaBytes: 2 * 1024 ** 3,
          },
        ],
        current: 1,
        size: 10,
        total: 1,
      },
    });
    mockArchiveStorageCancellation.mockResolvedValue({ data: {} });

    render(
      <App>
        <StorageAddonManagerModal open onClose={jest.fn()} onChanged={onChanged} />
      </App>
    );

    fireEvent.click(await screen.findByText('storageQuota.user.changeHistory'));
    fireEvent.click(await screen.findByRole('button', { name: 'storageQuota.user.archiveNow' }));
    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));

    await waitFor(() => expect(mockArchiveStorageCancellation).toHaveBeenCalledWith('change-2'));
    expect(onChanged).toHaveBeenCalledWith('ARCHIVED');
  });
});
