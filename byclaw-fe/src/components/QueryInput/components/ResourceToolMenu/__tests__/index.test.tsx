import { fireEvent, render, screen } from '@testing-library/react';
import ResourceToolMenu from '..';
import { useChatResourceProject } from '@/components/ChatLayoutComp/ChatResourceWorkspace/useChatResourceProject';
import ProjectSpaceTab from '@/layout/sider/components/ProjectSpaceList/ProjectSpaceTab';
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
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel', () => () => null);
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

  it('uses the sidebar visibility rules before a conversation has been created', () => {
    render(<ResourceToolMenu projectId={42} onSelect={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'queryInput.tools.processFile' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'queryInput.tools.projectCloud' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'chatResource.projectSpace' })).toBeNull();
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
