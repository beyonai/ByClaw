import { fireEvent, render as renderComponent, screen, waitFor } from '@testing-library/react';
import RecoveryPanel from '../RecoveryPanel';
import { ConfigProvider } from 'antd';
import type { ReactElement } from 'react';
import {
  actOnRecoveryMessage,
  listRecoveryMessages,
  listRecoveryQueues,
} from '@/pages/manager/service/SandboxRecovery';

// Exercise real Ant Design forms while avoiding animation timing under parallel CI load.
jest.setTimeout(20000);
const render = (element: ReactElement) =>
  renderComponent(<ConfigProvider theme={{ token: { motion: false } }}>{element}</ConfigProvider>);

jest.mock('@/pages/manager/service/SandboxRecovery', () => ({
  listRecoveryQueues: jest.fn(),
  listRecoveryMessages: jest.fn(),
  actOnRecoveryMessage: jest.fn(),
  listRecoveryHistory: jest.fn().mockResolvedValue([]),
}));

const queue = { stream: 'queue', group: 'group', kind: 'COMMAND', pending: 1, waiting: 0 };
const task = {
  id: '1-0',
  kind: 'COMMAND',
  state: 'PENDING',
  userCode: 'test-user',
  userName: '测试用户',
  resourceName: '测试专家团',
  content: '仅运行一次测试',
  sessionId: '101',
  workerOnline: false,
  deliveries: 1,
  idleMs: 120000,
  queuedAt: 1,
  canWake: true,
  canDismiss: true,
  canConfirmWake: false,
  actionHint: '可唤醒沙箱',
};

beforeEach(() => {
  jest.clearAllMocks();
  (listRecoveryQueues as jest.Mock).mockResolvedValue({ items: [queue], nextCursor: '0' });
  (listRecoveryMessages as jest.Mock).mockResolvedValue({ items: [task] });
  (actOnRecoveryMessage as jest.Mock).mockResolvedValue({ message: '唤醒请求已接受' });
});

it('opens task detail without consuming or replaying a message', async () => {
  render(<RecoveryPanel />);
  fireEvent.click(await screen.findByText('待确认任务'));
  expect(await screen.findByText('测试专家团')).toBeInTheDocument();
  fireEvent.click(screen.getByText('详情 / 处理'));
  expect(await screen.findByText('准确停止时间')).toBeInTheDocument();
  expect(screen.getByText('未知（Redis 不记录进程退出时间）')).toBeInTheDocument();
  expect(actOnRecoveryMessage).not.toHaveBeenCalled();
});

it('requires a reason and confirmation before wake, then refreshes original task', async () => {
  render(<RecoveryPanel />);
  fireEvent.click(await screen.findByText('待确认任务'));
  fireEvent.click(await screen.findByText('详情 / 处理'));
  fireEvent.click(await screen.findByRole('button', { name: '唤醒沙箱' }));
  fireEvent.click(screen.getByRole('button', { name: /OK|确 定|确定/ }));
  expect(await screen.findByText('请填写处理原因')).toBeInTheDocument();
  expect(actOnRecoveryMessage).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('处理原因（将记录操作者和时间）'), { target: { value: '已核对测试任务' } });
  fireEvent.click(screen.getByRole('button', { name: /OK|确 定|确定/ }));
  await waitFor(() => expect(actOnRecoveryMessage).toHaveBeenCalledWith(queue, '1-0', 'WAKE', '已核对测试任务'));
  await waitFor(() => expect(listRecoveryMessages).toHaveBeenCalledTimes(2));
});

it('disables wake and dismissal for an online worker', async () => {
  (listRecoveryMessages as jest.Mock).mockResolvedValue({
    items: [{ ...task, workerOnline: true, canWake: false, canDismiss: false }],
  });
  render(<RecoveryPanel />);
  fireEvent.click(await screen.findByText('待确认任务'));
  fireEvent.click(await screen.findByText('详情 / 处理'));
  expect(await screen.findByRole('button', { name: '唤醒沙箱' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '移出待确认' })).toBeDisabled();
});

it('makes incomplete scanning explicit and preserves earlier queues on continuation', async () => {
  (listRecoveryQueues as jest.Mock)
    .mockResolvedValueOnce({ items: [queue], nextCursor: '27' })
    .mockResolvedValueOnce({ items: [], nextCursor: '0' });
  render(<RecoveryPanel />);
  expect(await screen.findByText('扫描尚未完成，当前结果不是全部队列')).toBeInTheDocument();
  fireEvent.click(screen.getByText('继续扫描队列'));
  await waitFor(() => expect(listRecoveryQueues).toHaveBeenCalledWith('27'));
  expect(await screen.findByText('本次扫描已完成')).toBeInTheDocument();
  expect(screen.getByText('待确认任务')).toBeInTheDocument();
});
