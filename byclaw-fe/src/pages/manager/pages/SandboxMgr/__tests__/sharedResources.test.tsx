import { listSharedMembers, listSharedRecords } from '@/pages/manager/service/SharedSandbox';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SharedResources from '../SharedResources';

let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));

jest.mock('@/pages/manager/service/SharedSandbox', () => ({
  listSharedRecords: jest.fn(),
  listSharedMembers: jest.fn(),
  releaseSharedInstance: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = 'zh-CN';
  (listSharedRecords as jest.Mock).mockResolvedValue({
    records: [
      {
        id: 's1',
        sandboxId: 'sandbox-1',
        serviceKey: 'byclaw-sandbox',
        profileKey: 's',
        poolScope: 'GLOBAL',
        status: 'RUNNING',
        capacity: 12,
        occupiedSlots: 3,
        onlineUsers: 2,
      },
    ],
    total: 1,
  });
  (listSharedMembers as jest.Mock).mockResolvedValue({
    records: [{ id: 'm1', sandboxRecordId: 's1', userCode: 'alice', enterpriseId: 'tenant1', status: 'ACTIVE' }],
    total: 1,
  });
});

test('shows shared capacity and opens members of the selected instance', async () => {
  render(<SharedResources canManage={false} />);
  expect(await screen.findByText('sandbox-1')).toBeInTheDocument();
  expect(screen.getByText('3 / 12')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看用户' }));
  expect(await screen.findByText('alice')).toBeInTheDocument();
  await waitFor(() =>
    expect(listSharedMembers).toHaveBeenCalledWith(expect.objectContaining({ sandboxRecordId: 's1' }))
  );
  expect(screen.queryByRole('button', { name: '释放实例' })).not.toBeInTheDocument();
});

test('queries running records by default and allows clearing the status filter', async () => {
  const { container } = render(<SharedResources canManage={false} />);
  await waitFor(() =>
    expect(listSharedRecords).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RUNNING' }))
  );
  const statusFilter = screen.getAllByRole('combobox')[0];
  fireEvent.mouseDown(statusFilter);
  fireEvent.click(screen.getByTitle('已释放'));
  await waitFor(() =>
    expect(listSharedRecords).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RELEASED', pageIndex: 1 }))
  );
  fireEvent.mouseDown(container.querySelector('.ant-select-clear')!);
  await waitFor(() =>
    expect(listSharedRecords).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined, pageIndex: 1 }))
  );
  fireEvent.click(screen.getByRole('button', { name: /刷新/ }));
  await waitFor(() =>
    expect(listSharedRecords).toHaveBeenLastCalledWith(expect.objectContaining({ status: undefined }))
  );
});

test.each([
  ['zh-CN', '按服务标识搜索', '运行中', '未知', '查看用户', '活跃', '释放共享实例？'],
  ['en-US', 'Search by service key', 'Running', 'Unknown', 'View users', 'Active', 'Release shared instance?'],
])(
  'localizes shared records, filters and members in %s',
  async (locale, placeholder, running, unknown, view, active, confirm) => {
    mockLocale = locale;
    render(<SharedResources canManage />);
    expect(screen.getByPlaceholderText(placeholder)).toBeInTheDocument();
    expect(await screen.findByText('sandbox-1')).toBeInTheDocument();
    expect(screen.queryByText('RUNNING')).not.toBeInTheDocument();
    expect(screen.getAllByText(running).length).toBeGreaterThan(0);
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    expect(await screen.findByTitle(unknown)).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle(running).slice(-1)[0]);
    fireEvent.click(screen.getByRole('button', { name: locale === 'zh-CN' ? '释放实例' : 'Release instance' }));
    expect(await screen.findByText(confirm)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: view }));
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText(active)).toBeInTheDocument();
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
  }
);

test('shows a localized fallback when loading fails without an error message', async () => {
  mockLocale = 'en-US';
  (listSharedRecords as jest.Mock).mockRejectedValueOnce(null);
  render(<SharedResources canManage={false} />);
  expect(await screen.findByText('Failed to load. Please try again.')).toBeInTheDocument();
});
