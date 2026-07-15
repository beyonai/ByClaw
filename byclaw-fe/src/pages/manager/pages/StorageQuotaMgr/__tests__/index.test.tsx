import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from 'antd';
import dayjs from 'dayjs';

import StorageQuotaMgr, { buildRecycleQuery } from '..';

jest.setTimeout(15_000);

const mockQueryStorageUsers = jest.fn();
const mockQueryActiveStorageGrants = jest.fn();
const mockQueryStoragePackages = jest.fn();
const mockQueryStorageRecycles = jest.fn();
const mockGrantStoragePackage = jest.fn();
const mockQueryStorageCancellations = jest.fn();
const mockPreviewStorageGrantCancellation = jest.fn();
const mockCancelStorageGrant = jest.fn();
const mockApproveStorageChange = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, React.ReactNode>) =>
      values ? `${id}:${Object.values(values).join(',')}` : id,
  }),
}));

jest.mock('@/pages/manager/components/Pagination', () => ({
  __esModule: true,
  default: ({ pagination }: any) => (
    <div>
      <span data-testid="pagination-state">{`${pagination.current}/${pagination.pageSize}`}</span>
      <button type="button" onClick={() => pagination.onChange(2, pagination.pageSize)}>
        next page
      </button>
      <button type="button" onClick={() => pagination.onChange(2, 20)}>
        change page size
      </button>
    </div>
  ),
}));

jest.mock('@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/pages/manager/service/StorageQuotaMgr', () => ({
  approveStorageCancellation: (...args: any[]) => mockApproveStorageChange(...args),
  cancelStorageGrant: (...args: any[]) => mockCancelStorageGrant(...args),
  deleteStoragePackage: jest.fn(),
  downloadStorageRecyclePreview: jest.fn(),
  grantStoragePackage: (...args: any[]) => mockGrantStoragePackage(...args),
  queryStoragePackages: (...args: any[]) => mockQueryStoragePackages(...args),
  queryStorageCancellations: (...args: any[]) => mockQueryStorageCancellations(...args),
  queryActiveStorageGrants: (...args: any[]) => mockQueryActiveStorageGrants(...args),
  queryStorageRecyclePreview: jest.fn(),
  queryStorageRecycles: (...args: any[]) => mockQueryStorageRecycles(...args),
  queryStorageSettings: jest.fn(() => Promise.resolve({ data: undefined })),
  queryStorageUsers: (...args: any[]) => mockQueryStorageUsers(...args),
  resetStorage: jest.fn(),
  restoreStorage: jest.fn(),
  previewStorageGrantCancellation: (...args: any[]) => mockPreviewStorageGrantCancellation(...args),
  rejectStorageCancellation: jest.fn(),
  updateStorageSettings: jest.fn(),
  upsertStoragePackage: jest.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const renderStorageQuotaMgr = () =>
  render(
    <App>
      <StorageQuotaMgr />
    </App>
  );

const pageResponse = (current: number, size: number, userCode: string, validRecycleCount = 0) => ({
  data: {
    current,
    size,
    total: 59,
    records: [
      {
        storageQuotaId: current,
        userId: current,
        userCode,
        usedBytes: 0,
        totalQuotaBytes: 1024,
        usageStatus: 'NORMAL',
        validRecycleCount,
        activePackages: [],
      },
    ],
  },
});

describe('StorageQuotaMgr pagination', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    const originalConsoleError = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      if (String(args[0]).includes('[antd: InputNumber] `addonAfter` is deprecated')) return;
      originalConsoleError(...args);
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryActiveStorageGrants.mockResolvedValue({ data: { current: 1, size: 10, total: 0, records: [] } });
    mockQueryStoragePackages.mockResolvedValue({ data: [] });
    mockQueryStorageRecycles.mockResolvedValue({ data: { current: 1, size: 10, total: 0, records: [] } });
    mockGrantStoragePackage.mockResolvedValue({ data: {} });
    mockQueryStorageCancellations.mockResolvedValue({ data: { current: 1, size: 10, total: 0, records: [] } });
    mockPreviewStorageGrantCancellation.mockResolvedValue({ data: undefined });
    mockCancelStorageGrant.mockResolvedValue({ data: {} });
    mockApproveStorageChange.mockResolvedValue({ data: {} });
  });

  it('updates the controlled page immediately and ignores an older response', async () => {
    const firstRequest = deferred<any>();
    const secondRequest = deferred<any>();
    mockQueryStorageUsers.mockReturnValueOnce(firstRequest.promise).mockReturnValueOnce(secondRequest.promise);

    renderStorageQuotaMgr();

    await waitFor(() => expect(mockQueryStorageUsers).toHaveBeenCalledTimes(1));
    expect(mockQueryStorageUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortField: 'usedBytes', sortOrder: 'desc', pageNum: 1, pageSize: 10 })
    );
    expect(screen.getByTestId('pagination-state')).toHaveTextContent('1/10');

    fireEvent.click(screen.getByRole('button', { name: 'next page' }));

    expect(screen.getByTestId('pagination-state')).toHaveTextContent('2/10');
    expect(mockQueryStorageUsers).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 2, pageSize: 10 }));

    await act(async () => {
      secondRequest.resolve(pageResponse(2, 10, 'page-two-user'));
    });
    expect(await screen.findByText('page-two-user')).toBeInTheDocument();

    await act(async () => {
      firstRequest.resolve(pageResponse(1, 10, 'stale-page-one-user'));
    });

    expect(screen.getByTestId('pagination-state')).toHaveTextContent('2/10');
    expect(screen.getByText('page-two-user')).toBeInTheDocument();
    expect(screen.queryByText('stale-page-one-user')).not.toBeInTheDocument();
  });

  it('resets to page one immediately when page size changes', async () => {
    const pageSizeRequest = deferred<any>();
    mockQueryStorageUsers
      .mockResolvedValueOnce(pageResponse(1, 10, 'page-one-user'))
      .mockReturnValueOnce(pageSizeRequest.promise);

    renderStorageQuotaMgr();
    await screen.findByText('page-one-user');

    fireEvent.click(screen.getByRole('button', { name: 'change page size' }));

    expect(screen.getByTestId('pagination-state')).toHaveTextContent('1/20');
    expect(mockQueryStorageUsers).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 1, pageSize: 20 }));

    await act(async () => {
      pageSizeRequest.resolve(pageResponse(1, 20, 'page-size-twenty-user'));
    });
    expect(await screen.findByText('page-size-twenty-user')).toBeInTheDocument();
  });

  it('filters valid recycle users in one click and displays the valid record count', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'recycle-user', 3));

    renderStorageQuotaMgr();
    await screen.findByText('recycle-user');

    expect(screen.getByTitle('storageQuota.recycle.validCount:3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'storageQuota.filter.validRecycleOnly' }));

    await waitFor(() =>
      expect(mockQueryStorageUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ hasValidRecycle: true, pageNum: 1, pageSize: 10 })
      )
    );
    expect(screen.getByRole('checkbox', { name: 'storageQuota.filter.validRecycleOnly' })).toBeChecked();
  });

  it('paginates recycle records through the shared pagination and keeps newest records first', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'recycle-user', 1));
    mockQueryStorageRecycles.mockImplementation(({ pageNum, pageSize }: any) =>
      Promise.resolve({
        data: {
          current: pageNum,
          size: pageSize,
          total: 12,
          records: [
            {
              recycleId: 'newest',
              archiveBytes: 2048,
              recycleStatus: 'AVAILABLE',
              startedTime: '2026-07-14 18:30:00',
              retentionUntil: '2026-07-21 18:30:00',
            },
            {
              recycleId: 'older',
              archiveBytes: 1024,
              recycleStatus: 'RESTORED',
              startedTime: '2026-07-14 17:30:00',
              retentionUntil: '2026-07-21 17:30:00',
            },
          ],
        },
      })
    );

    renderStorageQuotaMgr();
    await screen.findByText('recycle-user');
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.recycleBin' }));

    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(mockQueryStorageRecycles).toHaveBeenLastCalledWith({ userId: 1, pageNum: 1, pageSize: 10 })
    );
    const rows = within(dialog).getAllByRole('row');
    expect(within(rows[1]).getByText('2026-07-14 18:30:00')).toBeInTheDocument();
    expect(within(rows[2]).getByText('2026-07-14 17:30:00')).toBeInTheDocument();
    expect(within(dialog).getByTestId('pagination-state')).toHaveTextContent('1/10');

    fireEvent.click(within(dialog).getByRole('button', { name: 'next page' }));

    expect(within(dialog).getByTestId('pagination-state')).toHaveTextContent('2/10');
    await waitFor(() =>
      expect(mockQueryStorageRecycles).toHaveBeenLastCalledWith({ userId: 1, pageNum: 2, pageSize: 10 })
    );
  });

  it('builds status and exact created/expired time-range filters for recycle queries', () => {
    expect(
      buildRecycleQuery({
        recycleStatus: 'AVAILABLE',
        createdRange: [dayjs('2026-07-14 17:00:01'), dayjs('2026-07-14 18:00:02')],
        expiredRange: [dayjs('2026-07-21 17:00:03'), dayjs('2026-07-21 18:00:04')],
      })
    ).toEqual({
      recycleStatus: 'AVAILABLE',
      createdStart: '2026-07-14 17:00:01',
      createdEnd: '2026-07-14 18:00:02',
      expiredStart: '2026-07-21 17:00:03',
      expiredEnd: '2026-07-21 18:00:04',
    });
  });

  it('opens add-on management and pages active grants through the shared pagination view', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'quota-user'));
    mockQueryActiveStorageGrants.mockResolvedValue({
      data: {
        current: 1,
        size: 10,
        total: 1,
        records: [
          {
            grantId: '9001',
            userCode: 'active-grant-user',
            packageName: '标准扩容包',
            grantedBytes: 1024 ** 3,
            grantStatus: 'ACTIVE',
            grantSource: 'ADMIN',
            grantedByCode: 'adminvip',
            grantedTime: '2026-07-14 12:00:00',
          },
        ],
      },
    });

    renderStorageQuotaMgr();
    await screen.findByText('quota-user');

    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.packageManager' }));
    fireEvent.click(screen.getByRole('tab', { name: 'storageQuota.package.activeTab' }));

    await waitFor(() =>
      expect(mockQueryActiveStorageGrants).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageNum: 1, pageSize: 10 })
      )
    );
    expect(await screen.findByText('active-grant-user')).toBeInTheDocument();
    expect(screen.getByText('标准扩容包')).toBeInTheDocument();
  });

  it('pages unified add-on records with the shared pagination component', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'quota-user'));
    mockQueryStorageCancellations.mockResolvedValue({
      data: {
        current: 1,
        size: 10,
        total: 1,
        records: [
          {
            downgradeId: 'cancel-1',
            userCode: 'cancel-user',
            requestType: 'CANCEL_PACKAGE',
            packageName: '1G存储增值包',
            downgradeStatus: 'REQUESTED',
            requestSource: 'USER',
            beforeQuotaBytes: 3 * 1024 ** 3,
            targetQuotaBytes: 2 * 1024 ** 3,
            overageBytes: 0,
            reason: '不再需要',
            requestedTime: '2026-07-15 09:00:00',
          },
        ],
      },
    });

    renderStorageQuotaMgr();
    await screen.findByText('quota-user');
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.packageManager' }));
    fireEvent.click(screen.getByRole('tab', { name: 'storageQuota.cancel.managementTab' }));

    expect(await screen.findByText('cancel-user')).toBeInTheDocument();
    expect(screen.getByText('storageQuota.changeType.CANCEL_PACKAGE')).toBeInTheDocument();
    expect(screen.getByText('storageQuota.cancelStatus.REQUESTED')).toBeInTheDocument();
    expect(mockQueryStorageCancellations).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageNum: 1, pageSize: 10 })
    );
  });

  it('lets an administrator approve a user add-on request from unified records', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'quota-user'));
    mockQueryStorageCancellations.mockResolvedValue({
      data: {
        current: 1,
        size: 10,
        total: 1,
        records: [
          {
            downgradeId: 'add-1',
            userCode: 'apply-user',
            requestType: 'ADD_PACKAGE',
            packageNames: '1G存储增值包',
            changeBytes: 1024 ** 3,
            downgradeStatus: 'REQUESTED',
            requestSource: 'USER',
            beforeQuotaBytes: 2 * 1024 ** 3,
            targetQuotaBytes: 3 * 1024 ** 3,
            overageBytes: 0,
            reason: '项目扩容',
            requestedTime: '2026-07-15 10:00:00',
          },
        ],
      },
    });

    renderStorageQuotaMgr();
    await screen.findByText('quota-user');
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.packageManager' }));
    fireEvent.click(screen.getByRole('tab', { name: 'storageQuota.cancel.managementTab' }));

    expect(await screen.findByText('storageQuota.changeType.ADD_PACKAGE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.change.approve' }));
    const dialogs = await screen.findAllByRole('dialog');
    const reviewDialog = dialogs[dialogs.length - 1];
    expect(within(reviewDialog).getByText('storageQuota.change.reviewApproveTitle')).toBeInTheDocument();
    fireEvent.click(within(reviewDialog).getByRole('button', { name: 'storageQuota.change.approve' }));

    await waitFor(() =>
      expect(mockApproveStorageChange).toHaveBeenCalledWith({ downgradeId: 'add-1', reviewRemark: undefined })
    );
  });

  it('disables edit and delete only for packages with active user entitlements', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'quota-user'));
    mockQueryStoragePackages.mockResolvedValue({
      data: [
        {
          packageId: '11',
          packageCode: 'UNUSED',
          packageName: '当前无生效权益增值包',
          addonBytes: 1024 ** 3,
          status: 'ENABLED',
          sortNo: 1,
          usedUserCount: 0,
        },
        {
          packageId: '12',
          packageCode: 'USED',
          packageName: '当前有生效权益增值包',
          addonBytes: 2 * 1024 ** 3,
          status: 'ENABLED',
          sortNo: 2,
          usedUserCount: 1,
        },
      ],
    });

    renderStorageQuotaMgr();
    await screen.findByText('quota-user');
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.packageManager' }));

    const usedRow = (await screen.findByText('当前有生效权益增值包')).closest('tr');
    const unusedRow = screen.getByText('当前无生效权益增值包').closest('tr');
    expect(usedRow).not.toBeNull();
    expect(unusedRow).not.toBeNull();
    expect(within(usedRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.edit' })).toBeDisabled();
    expect(within(usedRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.delete' })).toBeDisabled();
    expect(within(unusedRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.edit' })).toBeEnabled();
    expect(within(unusedRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.delete' })).toBeEnabled();
  });

  it('shows an empty active-entitlement view while leaving an inactive package editable', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'quota-user'));
    mockQueryStoragePackages.mockResolvedValue({
      data: [
        {
          packageId: '13',
          packageCode: 'REVOKED_HISTORY',
          packageName: '历史权益已失效增值包',
          addonBytes: 1024 ** 3,
          status: 'ENABLED',
          sortNo: 1,
          usedUserCount: 0,
        },
      ],
    });

    renderStorageQuotaMgr();
    await screen.findByText('quota-user');
    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.packageManager' }));

    const packageRow = (await screen.findByText('历史权益已失效增值包')).closest('tr');
    expect(packageRow).not.toBeNull();
    expect(within(packageRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.edit' })).toBeEnabled();
    expect(within(packageRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.delete' })).toBeEnabled();

    fireEvent.click(screen.getByRole('tab', { name: 'storageQuota.package.activeTab' }));

    expect(await screen.findByText('storageQuota.package.activeEmpty')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockQueryActiveStorageGrants).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageNum: 1, pageSize: 10 })
      )
    );
  });

  it('refreshes package usage after a grant so used definitions are protected immediately', async () => {
    mockQueryStorageUsers.mockResolvedValue(pageResponse(1, 10, 'quota-user'));
    const initialPackageRequest = deferred<any>();
    const unusedPackage = {
      packageId: '11',
      packageCode: 'PACKAGE_1G',
      packageName: '待授予增值包',
      addonBytes: 1024 ** 3,
      status: 'ENABLED',
      sortNo: 1,
      usedUserCount: 0,
    };
    mockQueryStoragePackages
      .mockReturnValueOnce(initialPackageRequest.promise)
      .mockResolvedValue({ data: [{ ...unusedPackage, usedUserCount: 1 }] });

    renderStorageQuotaMgr();
    await screen.findByText('quota-user');
    await act(async () => {
      initialPackageRequest.resolve({ data: [unusedPackage] });
    });

    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.grantPackage' }));
    const grantDialog = await screen.findByRole('dialog');
    fireEvent.click(within(grantDialog).getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(mockGrantStoragePackage).toHaveBeenCalledWith(expect.objectContaining({ packageId: '11' }))
    );
    await waitFor(() => expect(mockQueryStoragePackages).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'storageQuota.action.packageManager' }));
    const usedRow = (await screen.findByText('待授予增值包')).closest('tr');
    expect(usedRow).not.toBeNull();
    expect(within(usedRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.edit' })).toBeDisabled();
    expect(within(usedRow as HTMLElement).getByRole('button', { name: 'storageQuota.action.delete' })).toBeDisabled();
  });
});
