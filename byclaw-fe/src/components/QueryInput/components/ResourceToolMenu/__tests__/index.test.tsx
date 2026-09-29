import { fireEvent, render, screen } from '@testing-library/react';
import ResourceToolMenu from '..';
import { useChatResourceProject } from '@/components/ChatLayoutComp/ChatResourceWorkspace/useChatResourceProject';
import ProjectSpaceTab from '@/layout/sider/components/ProjectSpaceList/ProjectSpaceTab';
import FileResourcePanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel';
import ProjectDataSources from '@/components/ProjectDataSources';
import { useSessionDataSourcesVisible } from '@/components/ChatLayoutComp/ChatResourceWorkspace/useSessionDataSourcesVisible';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { ResourceType } from '../../../RichInput/utils/constants';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: () => ({}),
}));
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/useChatResourceProject', () => ({
  useChatResourceProject: jest.fn(() => ({ project: undefined, loading: false })),
}));
jest.mock('@/layout/sider/components/ProjectSpaceList/ProjectSpaceTab', () => jest.fn(() => null));
jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({
  useActiveSiderAgent: jest.fn(() => ({ resourceId: 'sidebar-agent' })),
}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/layout/sider/components/EmployeeList', () => () => null);
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel', () => jest.fn(() => null));
jest.mock('@/components/ProjectDataSources', () => jest.fn(() => <div>project data content</div>));
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/useSessionDataSourcesVisible', () => ({
  useSessionDataSourcesVisible: jest.fn(() => false),
}));
jest.mock('../../ConnectorControl', () => () => null);
jest.mock('../../../RichInput/mentionPopover/resourceTabsCompact', () => () => null);
jest.mock('../FilePicker', () => ({ onSelect }: any) => (
  <button onClick={() => onSelect({ id: '/notes.md' }, 'COMMON_FILE')}>quote file</button>
));

describe('resource menu local shared tab', () => {
  it.each([undefined, 'existing-session'])('supports selecting files in session %s', (sessionId) => {
    const onSelect = jest.fn();
    render(<ResourceToolMenu sessionId={sessionId} onSelect={onSelect} />);
    expect(screen.queryByText('quote file')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'chatResource.localSharedFile' }));
    fireEvent.click(screen.getByRole('button', { name: 'quote file' }));
    expect(onSelect).toHaveBeenCalledWith({ id: '/notes.md' }, ResourceType.commonFile);
  });
});

describe('resource menu categories', () => {
  it('reports the natural category height instead of the stretched panel height', () => {
    const originalObserver = global.ResizeObserver;
    global.ResizeObserver = jest.fn(() => ({ observe: jest.fn(), disconnect: jest.fn() })) as any;
    const heightSpy = jest
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return Array.from(this.children).filter((child) => child.tagName === 'BUTTON').length * 42;
      });
    try {
      const onNavigationHeightChange = jest.fn();
      const { unmount } = render(
        <ResourceToolMenu
          projectId={42}
          sessionId="session-1"
          onSelect={jest.fn()}
          onNavigationHeightChange={onNavigationHeightChange}
        />
      );
      expect(onNavigationHeightChange).toHaveBeenCalledWith(9 * 42 + 16);
      unmount();
    } finally {
      heightSpy.mockRestore();
      global.ResizeObserver = originalObserver;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (useActiveSiderAgent as jest.Mock).mockReturnValue({ resourceId: 'sidebar-agent' });
    (useChatResourceProject as jest.Mock).mockReturnValue({ project: undefined, loading: false });
    (useSessionDataSourcesVisible as jest.Mock).mockReturnValue(false);
  });

  it('shows project data between cloud and space using the sidebar session scope', () => {
    (useSessionDataSourcesVisible as jest.Mock).mockReturnValue(true);
    const { rerender } = render(<ResourceToolMenu projectId={42} sessionId="session-1" onSelect={jest.fn()} />);
    expect(useSessionDataSourcesVisible).toHaveBeenCalledWith('session-1', 42);
    const names = screen.getAllByRole('button').map((button) => button.textContent);
    const dataIndex = names.indexOf('dataSource.title');
    expect(names.slice(dataIndex - 1, dataIndex + 2)).toEqual([
      'queryInput.tools.projectCloud',
      'dataSource.title',
      'chatResource.projectSpace',
    ]);
    expect(ProjectDataSources).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'dataSource.title' }));
    expect((ProjectDataSources as jest.Mock).mock.calls.slice(-1)[0][0]).toEqual({ sessionId: 'session-1' });

    rerender(<ResourceToolMenu projectId={43} sessionId="session-2" onSelect={jest.fn()} />);
    expect(useSessionDataSourcesVisible).toHaveBeenCalledWith('session-2', 43);
    expect((ProjectDataSources as jest.Mock).mock.calls.slice(-1)[0][0]).toEqual({ sessionId: 'session-2' });

    (useSessionDataSourcesVisible as jest.Mock).mockReturnValue(false);
    rerender(<ResourceToolMenu projectId={-1} sessionId="session-3" onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'dataSource.title' })).toBeNull();
    expect(screen.queryByText('project data content')).toBeNull();
    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
  });

  it('shows new-task project data while loading and follows the selected project', () => {
    (useChatResourceProject as jest.Mock).mockReturnValue({ project: undefined, loading: true });
    const { rerender } = render(<ResourceToolMenu onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'dataSource.title' }));
    expect(ProjectDataSources).not.toHaveBeenCalled();

    rerender(<ResourceToolMenu projectId={42} onSelect={jest.fn()} />);
    expect((ProjectDataSources as jest.Mock).mock.calls.slice(-1)[0][0]).toEqual({ projectId: 42 });
    rerender(<ResourceToolMenu projectId={43} onSelect={jest.fn()} />);
    expect((ProjectDataSources as jest.Mock).mock.calls.slice(-1)[0][0]).toEqual({ projectId: 43 });

    jest.clearAllMocks();
    rerender(<ResourceToolMenu projectId={-1} onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'dataSource.title' })).toBeNull();
    expect(screen.queryByText('project data content')).toBeNull();
    expect(ProjectDataSources).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
  });

  it('keeps capabilities first and all file categories together at the end', () => {
    render(<ResourceToolMenu projectId={42} sessionId="session-1" onSelect={jest.fn()} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'common.digitalEmployee',
      'queryInput.tools.skill',
      'queryInput.tools.tool',
      'queryInput.tools.knowledge',
      'queryInput.tools.connector',
      'queryInput.tools.processFile',
      'chatResource.localSharedFile',
      'queryInput.tools.projectCloud',
      'chatResource.projectSpace',
    ]);
  });

  it('shows project space before a conversation has been created', () => {
    render(<ResourceToolMenu projectId={42} onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'queryInput.tools.processFile' })).toBeNull();
    expect(screen.getByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'queryInput.tools.projectCloud' }).querySelector('.anticon-cloud')
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'chatResource.localSharedFile' }).querySelector('.anticon-cloud')
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'chatResource.projectSpace' }));
    expect((ProjectSpaceTab as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({ projectId: 42, sessionId: undefined })
    );
  });

  it.each([undefined, -1, 42])('hides process files for a new task in project %s', (projectId) => {
    const { rerender } = render(<ResourceToolMenu projectId={projectId} sessionId="session-1" onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'queryInput.tools.processFile' }));
    expect(FileResourcePanel).toHaveBeenCalled();

    jest.clearAllMocks();
    rerender(<ResourceToolMenu projectId={projectId} onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'queryInput.tools.processFile' })).toBeNull();
    expect(FileResourcePanel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
  });

  it('keeps the new-task space entry while loading and follows project selection until -1', () => {
    (useChatResourceProject as jest.Mock).mockReturnValue({ project: undefined, loading: true });
    const { rerender } = render(<ResourceToolMenu onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'chatResource.projectSpace' }));
    expect(ProjectSpaceTab).not.toHaveBeenCalled();

    rerender(<ResourceToolMenu projectId={42} onSelect={jest.fn()} />);
    expect((ProjectSpaceTab as jest.Mock).mock.calls.slice(-1)[0][0].projectId).toBe(42);
    rerender(<ResourceToolMenu projectId={43} onSelect={jest.fn()} />);
    expect((ProjectSpaceTab as jest.Mock).mock.calls.slice(-1)[0][0].projectId).toBe(43);

    jest.clearAllMocks();
    rerender(<ResourceToolMenu projectId={-1} onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'chatResource.projectSpace' })).toBeNull();
    expect(ProjectSpaceTab).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
  });

  it('keeps the new-task cloud tab visible while the project selection is loading', () => {
    (useChatResourceProject as jest.Mock).mockReturnValue({ project: undefined, loading: true });
    const { rerender } = render(<ResourceToolMenu onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'queryInput.tools.projectCloud' }));
    expect(FileResourcePanel).not.toHaveBeenCalled();

    rerender(<ResourceToolMenu projectId={42} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeTruthy();

    rerender(<ResourceToolMenu projectId={-1} onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeNull();
  });

  it('hides the new-task cloud tab when the resolved project is the default project', () => {
    (useChatResourceProject as jest.Mock).mockReturnValue({ project: { projectId: -1 }, loading: false });
    render(<ResourceToolMenu onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'chatResource.projectSpace' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'dataSource.title' })).toBeNull();
  });

  it.each(['view', 'object', 'ontology'])('ignores retired resource category %s from stale state', (activeKey) => {
    render(<ResourceToolMenu projectId={42} activeKey={activeKey} onSelect={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
    expect(screen.queryByText(activeKey)).toBeNull();
  });

  it('loads the same project space component and resource scope as the sidebar', () => {
    render(
      <ResourceToolMenu
        projectId={42}
        projectCloudResourceId={123}
        sessionId="session-1"
        agentId="fallback-agent"
        resourceAgentIds=" scoped-agent,other-agent "
        onSelect={jest.fn()}
      />
    );
    expect(ProjectSpaceTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'chatResource.projectSpace' }));
    expect((ProjectSpaceTab as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        projectId: 42,
        sessionId: 'session-1',
        resourceId: 'sidebar-agent',
        projectCloudResourceId: '123',
      })
    );
  });

  it('hides unavailable project categories and ignores a hidden initial category', () => {
    render(<ResourceToolMenu projectId={-1} activeKey="projectCode" onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'chatResource.projectSpace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
    expect(ProjectSpaceTab).not.toHaveBeenCalled();
  });

  it('switches cloud drive scope and hides it immediately for -1 even with stale project details', () => {
    (useChatResourceProject as jest.Mock).mockReturnValue({
      project: { projectId: 42, cloudResourceId: 'cloud-42' },
      loading: false,
    });
    const { rerender } = render(<ResourceToolMenu projectId={42} onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'queryInput.tools.projectCloud' }));
    expect((FileResourcePanel as jest.Mock).mock.calls.slice(-1)[0][0]).toEqual(
      expect.objectContaining({ scope: 'project', projectId: 42, resourceId: 'cloud-42' })
    );

    jest.clearAllMocks();
    rerender(<ResourceToolMenu projectId={43} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeTruthy();
    expect(FileResourcePanel).not.toHaveBeenCalled();

    rerender(<ResourceToolMenu projectId={43} projectCloudResourceId="cloud-43" onSelect={jest.fn()} />);
    expect((FileResourcePanel as jest.Mock).mock.calls.slice(-1)[0][0]).toEqual(
      expect.objectContaining({ scope: 'project', projectId: 43, resourceId: 'cloud-43' })
    );

    jest.clearAllMocks();
    rerender(<ResourceToolMenu projectId={-1} onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeNull();
    expect(FileResourcePanel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
  });

  it('resolves a missing project using the same project hook as the sidebar', () => {
    (useChatResourceProject as jest.Mock).mockReturnValue({ project: { projectId: 42 }, loading: false });
    render(<ResourceToolMenu sessionId="session-1" activeKey="projectCode" onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeTruthy();
    expect((ProjectSpaceTab as jest.Mock).mock.calls[0][0].projectId).toBe(42);
  });

  it('uses the project resource and cloud drive as fallbacks just like the sidebar', () => {
    (useActiveSiderAgent as jest.Mock).mockReturnValue({});
    (useChatResourceProject as jest.Mock).mockReturnValue({
      project: { projectId: 42, resourceId: 456, cloudResourceId: 789 },
      loading: false,
    });
    render(<ResourceToolMenu sessionId="session-1" activeKey="projectCode" onSelect={jest.fn()} />);
    expect((ProjectSpaceTab as jest.Mock).mock.calls[0][0]).toEqual(
      expect.objectContaining({
        projectId: 42,
        resourceId: '456',
        projectCloudResourceId: '789',
      })
    );
    expect(screen.queryByRole('button', { name: 'chatResource.projectCode' })).toBeNull();
  });

  it('unmounts a visited category and returns to employees when it becomes hidden', () => {
    const { rerender } = render(<ResourceToolMenu projectId={42} sessionId="session-1" onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'chatResource.projectSpace' }));
    jest.clearAllMocks();
    rerender(<ResourceToolMenu projectId={-1} sessionId="session-2" onSelect={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'chatResource.projectSpace' })).toBeNull();
    expect(screen.getByRole('button', { name: 'common.digitalEmployee' }).className).toContain('Active');
    expect(ProjectSpaceTab).not.toHaveBeenCalled();
  });
});
