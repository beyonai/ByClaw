import { createManualRequirement, getTaskPhases, listRequirementsByProject, listTasks } from '../devloop';

jest.mock('@/service/common/request', () => ({
  POST: jest.fn(),
}));

import { POST } from '@/service/common/request';

const mockPOST = POST as jest.MockedFunction<typeof POST>;

describe('Devloop task service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes only-mine filter, creation time range, and pagination to the task list endpoint', () => {
    const query = {
      projectId: 203,
      onlyMine: true,
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

  // 覆盖所有手工录入字段（含来源类型）的前后端请求契约。
  it('posts manual requirements to the project requirement endpoint', () => {
    const requirement = {
      projectId: 203,
      sourceType: 'customer_feedback' as const,
      branch: 'develop',
      title: 'Improve login flow',
      originalContent: 'Customers report that the login flow has too many steps.',
      productContent: 'Simplify the flow while retaining security checks.',
    };

    createManualRequirement(requirement);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/devloop/requirement/create', requirement);
  });
});
