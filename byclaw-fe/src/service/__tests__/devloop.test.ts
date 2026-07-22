import { getTaskPhases, listRequirementsByProject, listTasks } from '../devloop';

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Devloop task service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes creation time range and pagination to the task list endpoint', () => {
    const query = {
      projectId: 203,
      createTimeStart: '2026-07-01 00:00:00',
      createTimeEnd: '2026-07-21 23:59:59',
      taskName: '优化登录流程',
      pageNum: 2,
      pageSize: 20,
    };

    listTasks(query);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/devloop/task/list', query);
  });

  it('sends the requirement title to the project requirement endpoint', () => {
    listRequirementsByProject(203, '优化登录流程');

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/devloop/project/requirements', {
      projectId: 203,
      title: '优化登录流程',
    });
  });

  it('queries the v2 task state projection by session id', () => {
    getTaskPhases(123);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/devloop/task/phases', { sessionId: 123 });
  });
});
