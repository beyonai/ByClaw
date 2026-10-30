import {
  listSharedConfigs,
  listSharedMembers,
  listSharedRecords,
  releaseSharedMember,
} from '@/pages/manager/service/SharedSandbox';
import { act, configure, fireEvent, render as renderComponent, screen, waitFor } from '@testing-library/react';
import SharedResources from '../SharedResources';
import { ConfigProvider } from 'antd';
import type { ReactElement } from 'react';

jest.setTimeout(20000);
// Drawer rendering can exceed the default one-second wait in the full regression suite.
configure({ asyncUtilTimeout: 5000 });
const render = (element: ReactElement) =>
  renderComponent(<ConfigProvider theme={{ token: { motion: false } }}>{element}</ConfigProvider>);

let mockLocale = 'zh-CN';
jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));

jest.mock('@/pages/manager/service/SharedSandbox', () => ({
  listSharedConfigs: jest.fn(),
  launchSharedInstance: jest.fn(),
  listSharedRecords: jest.fn(),
  listSharedMembers: jest.fn(),
  releaseSharedInstance: jest.fn(),
  releaseSharedMember: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  [listSharedMembers, listSharedRecords, releaseSharedMember].forEach((mock) => (mock as jest.Mock).mockReset());
  mockLocale = 'zh-CN';
  (releaseSharedMember as jest.Mock).mockResolvedValue(true);
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
    records: [
      {
        id: 'fd5424b5-7a4a-4f50-ad20-7a86f340b9ea',
        sandboxRecordId: 's1',
        userCode: 'alice',
        userName: 'Alice Chen',
        generation: 4,
        enterpriseId: 'tenant1',
        status: 'ACTIVE',
      },
    ],
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
  expect(screen.queryByRole('button', { name: '释放用户' })).not.toBeInTheDocument();
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
    expect(screen.getAllByText(active).length).toBeGreaterThan(0);
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
  }
);

test('shows a localized fallback when loading fails without an error message', async () => {
  mockLocale = 'en-US';
  (listSharedRecords as jest.Mock).mockRejectedValueOnce(null);
  render(<SharedResources canManage={false} />);
  expect(await screen.findByText('Failed to load. Please try again.')).toBeInTheDocument();
});

test('defaults members to active and searches names while keeping an explicit all-status selection', async () => {
  render(<SharedResources canManage={false} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  expect(await screen.findByText('Alice Chen')).toBeInTheDocument();
  expect(listSharedMembers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ACTIVE', pageIndex: 1 }));
  const search = screen.getByPlaceholderText('按工号或姓名搜索');
  fireEvent.change(search, { target: { value: ' Alice ' } });
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 });
  await waitFor(() =>
    expect(listSharedMembers).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'Alice', status: 'ACTIVE', pageIndex: 1 })
    )
  );
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '用户状态' }));
  fireEvent.click(screen.getByTitle('全部状态'));
  await waitFor(() =>
    expect(listSharedMembers).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'Alice', status: '', pageIndex: 1 })
    )
  );
});

test('releases only the confirmed active member, then refreshes members and instance occupancy', async () => {
  render(<SharedResources canManage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  fireEvent.click(await screen.findByRole('button', { name: '释放用户' }));
  expect(releaseSharedMember).not.toHaveBeenCalled();
  expect(
    screen.getByText('仅释放该用户在此共享实例中的上下文，正在运行的任务会被中断。其他用户不受影响。')
  ).toBeInTheDocument();
  (listSharedMembers as jest.Mock).mockResolvedValueOnce({ records: [], total: 0 });
  fireEvent.click(screen.getAllByRole('button', { name: '释放用户' }).slice(-1)[0]);
  await waitFor(() =>
    expect(releaseSharedMember).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fd5424b5-7a4a-4f50-ad20-7a86f340b9ea', generation: 4 })
    )
  );
  await waitFor(() => expect(screen.queryByText('Alice Chen')).not.toBeInTheDocument());
  expect(listSharedMembers).toHaveBeenCalledTimes(2);
  expect(listSharedRecords).toHaveBeenCalledTimes(2);
});

test('retains the member and shows a release failure without refreshing occupancy', async () => {
  (releaseSharedMember as jest.Mock).mockRejectedValueOnce(new Error('Context deletion failed'));
  render(<SharedResources canManage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  fireEvent.click(await screen.findByRole('button', { name: '释放用户' }));
  fireEvent.click(screen.getAllByRole('button', { name: '释放用户' }).slice(-1)[0]);
  expect(await screen.findByText('Context deletion failed')).toBeInTheDocument();
  expect(screen.getByText('Alice Chen')).toBeInTheDocument();
  expect(listSharedRecords).toHaveBeenCalledTimes(1);
});

test('shows no release action for historical members or read-only viewers', async () => {
  (listSharedMembers as jest.Mock).mockResolvedValueOnce({
    records: [{ id: 'm2', userCode: 'bob', status: 'RELEASED', releaseReason: 'idle' }],
    total: 1,
  });
  render(<SharedResources canManage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  expect(await screen.findByText('bob')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '释放用户' })).not.toBeInTheDocument();
});

test.each([
  ['zh-CN', '已获得共享资格', '空闲超时'],
  ['en-US', 'Shared eligibility granted', 'Idle timeout'],
])('localizes release reasons in %s and retains unknown diagnostics', async (locale, granted, idle) => {
  mockLocale = locale;
  (listSharedRecords as jest.Mock).mockResolvedValueOnce({
    records: [{ id: 's1', status: 'RUNNING', releaseReason: 'eligibility.granted' }],
    total: 1,
  });
  (listSharedMembers as jest.Mock).mockResolvedValueOnce({
    records: [
      { id: 'fd5424b5-7a4a-4f50-ad20-7a86f340b9ea', userCode: 'alice', status: 'RELEASED', releaseReason: 'idle' },
      { id: 'm2', userCode: 'bob', status: 'RELEASED', releaseReason: 'provider: connection reset' },
    ],
    total: 2,
  });
  render(<SharedResources canManage={false} />);
  expect(await screen.findByText(granted)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: locale === 'zh-CN' ? '查看用户' : 'View users' }));
  expect(await screen.findByText(idle)).toBeInTheDocument();
  expect(screen.getByText('provider: connection reset')).toBeInTheDocument();
});

test('ignores an older member query after the search changes', async () => {
  let resolveInitial!: (value: object) => void;
  (listSharedMembers as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveInitial = resolve;
      })
  );
  render(<SharedResources canManage={false} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  const search = screen.getByPlaceholderText('按工号或姓名搜索');
  fireEvent.change(search, { target: { value: 'Alice' } });
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 });
  expect(await screen.findByText('Alice Chen')).toBeInTheDocument();
  await act(async () =>
    resolveInitial({ records: [{ id: 'stale', userCode: 'stale-user', status: 'ACTIVE' }], total: 1 })
  );
  expect(screen.getByText('Alice Chen')).toBeInTheDocument();
  expect(screen.queryByText('stale-user')).not.toBeInTheDocument();
});

test('does not claim a release succeeded when the selected generation is refused', async () => {
  (releaseSharedMember as jest.Mock).mockResolvedValueOnce(false);
  render(<SharedResources canManage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  fireEvent.click(await screen.findByRole('button', { name: '释放用户' }));
  fireEvent.click(screen.getAllByRole('button', { name: '释放用户' }).slice(-1)[0]);
  expect(await screen.findByText('用户状态已变化，未执行释放，请刷新后重试。')).toBeInTheDocument();
  expect(screen.getByText('Alice Chen')).toBeInTheDocument();
  expect(listSharedRecords).toHaveBeenCalledTimes(1);
});

test('refreshes the current member filter after a release finishes', async () => {
  let finishRelease!: (value: boolean) => void;
  (releaseSharedMember as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRelease = resolve;
      })
  );
  render(<SharedResources canManage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  fireEvent.click(await screen.findByRole('button', { name: '释放用户' }));
  fireEvent.click(screen.getAllByRole('button', { name: '释放用户' }).slice(-1)[0]);
  await waitFor(() => expect(releaseSharedMember).toHaveBeenCalled());
  const search = screen.getByPlaceholderText('按工号或姓名搜索');
  fireEvent.change(search, { target: { value: 'Alice' } });
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', keyCode: 13 });
  expect(await screen.findByText('Alice Chen')).toBeInTheDocument();
  await act(async () => finishRelease(true));
  await waitFor(() => expect(listSharedMembers).toHaveBeenCalledTimes(3));
  expect(listSharedMembers).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'Alice', status: 'ACTIVE' }));
});

test('preserves the parent filter if the drawer closes while releasing', async () => {
  let finishRelease!: (value: boolean) => void;
  (releaseSharedMember as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRelease = resolve;
      })
  );
  render(<SharedResources canManage />);
  fireEvent.click(await screen.findByRole('button', { name: '查看用户' }));
  fireEvent.click(await screen.findByRole('button', { name: '释放用户' }));
  fireEvent.click(screen.getAllByRole('button', { name: '释放用户' }).slice(-1)[0]);
  await waitFor(() => expect(releaseSharedMember).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(screen.getByTitle('已释放'));
  await waitFor(() =>
    expect(listSharedRecords).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RELEASED' }))
  );
  await act(async () => finishRelease(true));
  await waitFor(() => expect(listSharedRecords).toHaveBeenCalledTimes(3));
  expect(listSharedRecords).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'RELEASED' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('launch dialog offers both duration and calendar schedules to managers only', async () => {
  (listSharedConfigs as jest.Mock).mockResolvedValue([
    { serviceKey: 'byclaw-sandbox', profileKey: 's', enabled: true },
  ]);
  render(<SharedResources canManage />);
  fireEvent.click(screen.getByRole('button', { name: '启动共享资源' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('定期释放'));
  expect(screen.getByLabelText('指定时长')).toBeInTheDocument();
  expect(screen.getByLabelText('指定日期时间')).toBeInTheDocument();
});
