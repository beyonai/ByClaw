import {
  createManualRequirement,
  getLocalRepoChanges,
  getLocalRepoFileDiff,
  getTaskChanges,
  listProjectRepoBranches,
  listProjectRepoTree,
  getTaskPhases,
  listAvailableProjectRepos,
  listProjectRepos,
  listRequirementsByProject,
  listTasks,
} from '../devloop';

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

  it('queries repositories associated with the current project', () => {
    listProjectRepos(203);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/project/repo/list', { projectId: 203 });
  });

  it('queries repositories that are both configured and present in the workspace', () => {
    listAvailableProjectRepos(203);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/project/repo/available-list', { projectId: 203 });
  });

  it('queries task changes for the selected repository', () => {
    getTaskChanges(301, 20014947);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/devloop/task/changes', {
      sessionId: 301,
      repoId: 20014947,
    });
  });

  // 覆盖所有手工录入字段（含来源类型和关联仓库）的前后端请求契约。
  it('posts manual requirements to the project requirement endpoint', () => {
    const requirement = {
      projectId: 203,
      sourceType: 'customer_feedback' as const,
      branch: 'develop',
      repoId: 301,
      title: 'Improve login flow',
      originalContent: 'Customers report that the login flow has too many steps.',
      productContent: 'Simplify the flow while retaining security checks.',
    };

    createManualRequirement(requirement);

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/devloop/requirement/create', requirement);
  });

  it('locates a registered repository by repoId when browsing the repository tree', () => {
    listProjectRepoTree({ projectId: 203, repoId: 900, path: 'src' });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/project/repo/tree', {
      projectId: 203,
      repoId: 900,
      path: 'src',
    });
  });

  it('locates an unregistered project-space repository by repositoryPath instead of faking a repoId', () => {
    listProjectRepoTree({ projectId: 203, repositoryPath: 'repos/deepseek-harness', ref: 'master' });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/project/repo/tree', {
      projectId: 203,
      repositoryPath: 'repos/deepseek-harness',
      ref: 'master',
    });
  });

  it('passes the project-space repository path to the branch list endpoint', () => {
    listProjectRepoBranches({ projectId: 203, repositoryPath: 'repos/deepseek-harness' });

    expect(mockPOST).toHaveBeenCalledWith('/byaiService/project/repo/branch/list', {
      projectId: 203,
      repositoryPath: 'repos/deepseek-harness',
    });
  });

  it('queries project-space local changes and file diff by repository path', () => {
    getLocalRepoChanges({ projectId: 203, repositoryPath: 'repos/deepseek-harness', sessionId: 123 });
    getLocalRepoFileDiff({
      projectId: 203,
      repositoryPath: 'repos/deepseek-harness',
      filePath: 'README.md',
      sessionId: 123,
    });

    expect(mockPOST).toHaveBeenNthCalledWith(1, '/byaiService/project/repo/local-changes', {
      projectId: 203,
      repositoryPath: 'repos/deepseek-harness',
      sessionId: 123,
    });
    expect(mockPOST).toHaveBeenNthCalledWith(2, '/byaiService/project/repo/local-file-diff', {
      projectId: 203,
      repositoryPath: 'repos/deepseek-harness',
      filePath: 'README.md',
      sessionId: 123,
    });
  });
});
