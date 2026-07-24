import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import { listTasks } from '@/service/devloop';
import SessionOverviewDrawer from '../SessionOverviewDrawer';

// 单测只校验任务看板行为，避免加载 Umi 运行时及其 Node 环境依赖。
jest.mock('@umijs/max', () => {
  // 保持 intl 引用稳定，避免依赖翻译函数的查询 effect 在测试中重复执行。
  const intl = {
    formatMessage: ({ id }: { id: string }) => id,
  };

  return {
    useIntl: () => intl,
  };
});

jest.mock('antd', () => {
  const antd = jest.requireActual('antd');
  // Jest 的 CommonJS 实际模块直接导出 dayjs 函数，不读取 default，避免点击预设时调用 undefined。
  const mockDayjs = jest.requireActual('dayjs');

  return {
    ...antd,
    // 用按钮模拟日期组件的“本周”预设，避免 RangePicker 在 JSDOM 中的受控值循环影响任务看板断言。
    DatePicker: {
      ...antd.DatePicker,
      RangePicker: ({ onChange }: any) => (
        <button
          data-testid="task-board-range-picker-week"
          onClick={() => {
            const now = mockDayjs();
            const weekStart = now.subtract((now.day() + 6) % 7, 'day').startOf('day');
            onChange?.([weekStart, weekStart.add(6, 'day').endOf('day')]);
          }}
        >
          select-week
        </button>
      ),
    },
  };
});

jest.mock('@/service/devloop', () => ({
  listTasks: jest.fn(),
}));

jest.mock(
  '../TaskDetailDrawer',
  () =>
    ({ task, canEnterSession, onEnterSession }: any) =>
      task ? (
        <button
          data-testid="task-board-enter-session"
          disabled={!canEnterSession}
          onClick={() => onEnterSession?.(task)}
        >
          enter-session
        </button>
      ) : null
);

const mockListTasks = listTasks as jest.MockedFunction<typeof listTasks>;

describe('SessionOverviewDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 看板现在按状态并行请求，测试数据按请求状态分别返回，避免同一任务出现在多个状态列。
    mockListTasks.mockImplementation(async (query) => ({
      pageNum: query.pageNum || 1,
      pageSize: 30,
      total: query.status === 'pending' || query.status === 'in_progress' ? 1 : 0,
      totalPages: 1,
      list:
        query.status === 'pending'
          ? [
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
            ]
          : query.status === 'in_progress'
          ? [
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
            ]
          : [],
    }));
  });

  it('queries four status columns with independent page size', async () => {
    const now = dayjs();
    const weekStart = now.subtract((now.day() + 6) % 7, 'day').startOf('day');
    render(<SessionOverviewDrawer open onClose={jest.fn()} projectId={10000811} projectName="百应研发项目" />);

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalledTimes(4);
    });
    const requests = mockListTasks.mock.calls.map(([query]) => query);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: 10000811,
          // 默认查本自然周，日期取值前端仍统一按天边界对齐。
          createTimeStart: weekStart.format('YYYY-MM-DD HH:mm:ss'),
          createTimeEnd: weekStart.add(6, 'day').endOf('day').format('YYYY-MM-DD HH:mm:ss'),
          // 组件默认勾选“只看我的”，与同事统一后的 onlyMine 参数保持一致。
          onlyMine: true,
          pageNum: 1,
          pageSize: 30,
          status: 'pending',
        }),
        expect.objectContaining({ status: 'in_progress', pageNum: 1, pageSize: 30 }),
        expect.objectContaining({ status: 'paused', pageNum: 1, pageSize: 30 }),
        expect.objectContaining({ status: 'completed', pageNum: 1, pageSize: 30 }),
      ])
    );
    expect(await screen.findByText('当天待开始任务')).toBeInTheDocument();
    expect(await screen.findByText('当天进行中任务')).toBeInTheDocument();
  });

  it('activates the week tab after selecting the current week in the date picker', async () => {
    render(<SessionOverviewDrawer open onClose={jest.fn()} projectId={10000811} />);

    await screen.findByText('当天待开始任务');
    fireEvent.click(screen.getByText('projectSpace.taskBoard.preset.today'));
    fireEvent.click(screen.getByTestId('task-board-range-picker-week'));

    await waitFor(() => {
      const now = dayjs();
      const weekStart = now.subtract((now.day() + 6) % 7, 'day').startOf('day');
      expect(mockListTasks).toHaveBeenLastCalledWith(
        expect.objectContaining({
          createTimeStart: weekStart.format('YYYY-MM-DD HH:mm:ss'),
          createTimeEnd: weekStart.add(6, 'day').endOf('day').format('YYYY-MM-DD HH:mm:ss'),
        })
      );
    });

    const weekTab = screen
      .getByText('projectSpace.taskBoard.preset.week')
      .closest('.ant-segmented-item') as HTMLElement;
    expect(weekTab).toHaveClass('ant-segmented-item-selected');
  });

  it('does not re-query after the initial task request fails', async () => {
    mockListTasks.mockRejectedValueOnce(new Error('整体任务视图查询失败'));

    render(<SessionOverviewDrawer open onClose={jest.fn()} projectId={10000811} projectName="百应研发项目" />);

    await waitFor(() => {
      expect(mockListTasks).toHaveBeenCalledTimes(4);
    });
    // 等待失败请求触发的状态更新完成，防止依赖变化再次触发初始查询。
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockListTasks).toHaveBeenCalledTimes(4);
  });

  it('passes the eligible task session-entry action to the task detail drawer', async () => {
    const onEnterSession = jest.fn();
    render(
      <SessionOverviewDrawer
        open
        onClose={jest.fn()}
        projectId={10000811}
        canEnterSession={(task) => task.taskId === 1}
        onEnterSession={onEnterSession}
      />
    );

    fireEvent.click(await screen.findByText('当天待开始任务'));
    const enterSessionButton = await screen.findByTestId('task-board-enter-session');
    expect(enterSessionButton).toBeEnabled();

    fireEvent.click(enterSessionButton);
    expect(onEnterSession).toHaveBeenCalledWith(expect.objectContaining({ taskId: 1, sessionId: 1 }));
  });
});
