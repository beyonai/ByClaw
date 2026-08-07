import { renderHook, waitFor } from '@testing-library/react';
import { getProject, listProjects } from '@/pages/projectSpace/service';
import { useChatResourceProject } from '../useChatResourceProject';

jest.mock('@/pages/projectSpace/service', () => ({
  getProject: jest.fn(),
  listProjects: jest.fn(),
}));

const mockGetProject = getProject as jest.MockedFunction<typeof getProject>;
const mockListProjects = listProjects as jest.MockedFunction<typeof listProjects>;

describe('useChatResourceProject', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the conversation project when a project id exists', async () => {
    mockGetProject.mockResolvedValue({
      projectId: 12,
      projectName: '研发项目',
      projectType: 'develop',
    } as any);

    const { result } = renderHook(() => useChatResourceProject(12));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetProject).toHaveBeenCalledWith(12);
    expect(mockListProjects).not.toHaveBeenCalled();
    expect(result.current.project).toMatchObject({ projectId: '12', projectType: 'develop' });
  });

  it('falls back to the default project for a conversation without a project', async () => {
    mockListProjects.mockResolvedValue({
      rows: [
        { projectId: 1, projectName: '普通项目', projectType: 'normal' },
        { projectId: 2, projectName: '默认项目', projectType: 'default', resourceId: 'agent-default' },
      ],
    } as any);

    const { result } = renderHook(() => useChatResourceProject());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetProject).not.toHaveBeenCalled();
    expect(mockListProjects).toHaveBeenCalledWith({ pageNum: 1, pageSize: 200 });
    expect(result.current.project).toMatchObject({ projectId: '2', projectType: 'default' });
  });
});
