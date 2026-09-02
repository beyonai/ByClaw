import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import dayjs from 'dayjs';
import { listOperationTasks, listTasks } from '@/service/devloop';
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
  listOperationTasks: jest.fn(),
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
const mockListOperationTasks = listOperationTasks as jest.MockedFunction<typeof listOperationTasks>;

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

  // 看板卡片右上角直接显示类型中文，未知类型不显示标签。
  it('labels develop task cards with the task type and drops unknown types', async () => {
    mockListTasks.mockImplementation(async (query) => ({
      pageNum: query.pageNum || 1,
      pageSize: 30,
      total: query.status === 'pending' ? 2 : 0,
      totalPages: 1,
      list:
        query.status === 'pending'
          ? [
              {
                taskId: 1,
                sessionId: 1,
                projectId: 10000811,
                title: '架构任务卡',
                status: 'pending',
                taskType: 'architect',
              },
              // 后端新增类型时前端不猜，没有对应图标就不显示，避免显示成错的那一类。
              {
                taskId: 2,
                sessionId: 2,
                projectId: 10000811,
                title: '未知类型任务卡',
                status: 'pending',
                taskType: 'whatever',
              },
            ]
          : [],
    }));

    render(<SessionOverviewDrawer open onClose={jest.fn()} projectId={10000811} />);

    const architectHeader = (await screen.findByText('架构任务卡')).closest('.kanbanCardHeader') as HTMLElement;
    const architectTag = architectHeader.querySelector('.kanbanCardTypeTagArchitect') as HTMLElement;
    // useIntl 在本文件被 mock 成回 id，断言 key 即可确认取的是架构任务那条文案。
    expect(architectTag).toHaveTextContent('projectSpace.detail.task.type.architect');

    const unknownHeader = screen.getByText('未知类型任务卡').closest('.kanbanCardHeader') as HTMLElement;
    expect(unknownHeader.querySelector('.kanbanCardTypeTag')).not.toBeInTheDocument();
  });

  // 运营任务接口回的是 operationType，共用这张卡时不能借研发任务的四角色标签。
  it('skips the task-type tag for operation projects', async () => {
    // 看板四列并行请求，按状态过滤避免同一任务出现在多列后断言拿到多个同名节点。
    mockListOperationTasks.mockImplementation(async (query) => ({
      pageNum: query.pageNum || 1,
      pageSize: 30,
      total: query.status === 'todo' ? 1 : 0,
      totalPages: 1,
      list:
        query.status === 'todo'
          ? [{ taskId: 3, sessionId: 3, projectId: 10000811, title: '运营采集任务', operationType: 'collect' }]
          : [],
    }));

    render(<SessionOverviewDrawer open onClose={jest.fn()} projectId={10000811} operationProject />);

    const operationHeader = (await screen.findByText('运营采集任务')).closest('.kanbanCardHeader') as HTMLElement;
    expect(operationHeader.querySelector('.kanbanCardTypeTag')).not.toBeInTheDocument();
  });

  // 任务 Tab 的「视图」模式内嵌同一份看板：不能再套 Drawer，否则内容被塞进浮层。
  it('renders the board without a drawer shell when embedded', async () => {
    const { container } = render(<SessionOverviewDrawer embedded open projectId={10000811} />);

    expect(await screen.findByText('当天待开始任务')).toBeInTheDocument();
    expect(container.querySelector('.taskBoardEmbedded')).toBeInTheDocument();
    expect(document.querySelector('.ant-drawer')).not.toBeInTheDocument();
    // 内嵌与抽屉共用同一套查询：四个状态列照样各查一次。
    expect(mockListTasks).toHaveBeenCalledTimes(4);
  });

  // 内嵌时 open=false 表示父级切回了列表模式，看板要整体消失且不再发请求。
  it('renders nothing when embedded and closed', () => {
    const { container } = render(<SessionOverviewDrawer embedded open={false} projectId={10000811} />);

    expect(container.querySelector('.taskBoardEmbedded')).not.toBeInTheDocument();
    expect(mockListTasks).not.toHaveBeenCalled();
  });
});
