import { renderHook, waitFor } from '@testing-library/react';
import { getProject, listProjects } from '@/pages/projectSpace/service';
import { clearChatResourceProjectCache, useChatResourceProject } from '../useChatResourceProject';

jest.mock('@/pages/projectSpace/service', () => ({
  getProject: jest.fn(),
  listProjects: jest.fn(),
}));

const mockGetProject = getProject as jest.MockedFunction<typeof getProject>;
const mockListProjects = listProjects as jest.MockedFunction<typeof listProjects>;

describe('useChatResourceProject', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearChatResourceProjectCache();
  });

  it('reuses the cached project when another conversation belongs to the same project', async () => {
    mockGetProject.mockResolvedValue({
      projectId: 12,
      projectName: '运营项目',
      projectType: 'operation',
    } as any);

    const first = renderHook(() => useChatResourceProject(12));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useChatResourceProject(12));

    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.project).toMatchObject({ projectId: '12', projectType: 'operation' });
    expect(mockGetProject).toHaveBeenCalledTimes(1);
  });

  it('shares one pending request between project consumers', async () => {
    let resolveProject: (value: any) => void = () => undefined;
    mockGetProject.mockReturnValue(
      new Promise((resolve) => {
        resolveProject = resolve;
      }) as any
    );

    const first = renderHook(() => useChatResourceProject(12));
    const second = renderHook(() => useChatResourceProject(12));

    expect(mockGetProject).toHaveBeenCalledTimes(1);
    resolveProject({ projectId: 12, projectName: '研发项目', projectType: 'develop' });

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false);
      expect(second.result.current.loading).toBe(false);
    });
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
