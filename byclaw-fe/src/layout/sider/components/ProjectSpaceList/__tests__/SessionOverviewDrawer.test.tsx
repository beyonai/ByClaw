import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import { listTasks } from '@/service/devloop';
import SessionOverviewDrawer from '../SessionOverviewDrawer';

jest.mock('@/service/devloop', () => ({
  listTasks: jest.fn(),
}));

jest.mock('../TaskDetailDrawer', () => () => null);

const mockListTasks = listTasks as jest.MockedFunction<typeof listTasks>;

describe('SessionOverviewDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListTasks.mockResolvedValue({
      pageNum: 1,
      pageSize: 20,
      total: 25,
      totalPages: 2,
      list: [
        {
          taskId: 1,
          sessionId: 1,
          projectId: 10000811,
          title: '当天待开始任务',
          status: 'pending',
          statusLabel: '待开始',
          stateAvailable: true,
          progress: 0,
        },
        {
          taskId: 2,
          sessionId: 2,
          projectId: 10000811,
          title: '当天进行中任务',
          status: 'in_progress',
          statusLabel: '进行中',
          stateAvailable: true,
          progress: 50,
        },
      ],
    });
  });

  it('queries the current full day by default and uses server pagination', async () => {
    const today = dayjs();
    render(<SessionOverviewDrawer open onClose={jest.fn()} projectId={10000811} projectName="百应研发项目" />);

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalledWith({
        projectId: 10000811,
        createTimeStart: today.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
        createTimeEnd: today.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
        pageNum: 1,
        pageSize: 20,
      });
    });
    expect(await screen.findByText('当天待开始任务')).toBeInTheDocument();
    expect(await screen.findByText('当天进行中任务')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('2'));

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          projectId: 10000811,
          pageNum: 2,
          pageSize: 20,
        })
      );
    });
  });

  it('does not re-query after the initial task request fails', async () => {
    mockListTasks.mockRejectedValueOnce(new Error('整体任务视图查询失败'));

    render(<SessionOverviewDrawer open onClose={jest.fn()} projectId={10000811} projectName="百应研发项目" />);

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalledTimes(1);
    });
    // 等待失败请求触发的状态更新完成，防止依赖变化再次触发初始查询。
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockListTasks).toHaveBeenCalledTimes(1);
  });
});
