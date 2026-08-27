import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
import {
  getTaskChanges,
  getTaskFileDiff,
  listAvailableProjectRepos,
  listProjectRepoTree,
  searchProjectRepoTree,
} from '@/service/devloop';
import CodesTab from '../index';

jest.mock('@/service/devloop', () => ({
  getTaskChanges: jest.fn(),
  getTaskFileDiff: jest.fn(),
  listAvailableProjectRepos: jest.fn(),
  listProjectRepoTree: jest.fn(),
  searchProjectRepoTree: jest.fn(),
}));

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

// 预览面板通过别名引入 less，jest 的路径别名会先于样式映射命中真实文件。
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel', () => (props: any) => (
  <div data-testid="file-preview" data-path={props.path} data-resource-id={props.resourceId}>
    {props.fileName}
  </div>
));

const mockEventEmitter = { emit: jest.fn() };

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: mockEventEmitter }),
}));

jest.mock('@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock', () => (props: any) => (
  <section data-testid={`repo-${props.title}`}>
    <h2>{props.title}</h2>
    {props.headerExtra}
    <button type="button" onClick={props.onRefresh}>
      refresh-{props.title}
    </button>
    <div data-testid={`repo-files-${props.title}`} hidden={props.showAlternateContent}>
      {props.contentBefore}
      <span>{props.currentPath}</span>
      <span>{props.items.map((item: { name: string }) => item.name).join(',')}</span>
    </div>
    <div data-testid={`repo-changes-${props.title}`} hidden={!props.showAlternateContent}>
      {props.alternateContent}
    </div>
    <button
      type="button"
      onClick={() =>
        props.onLoadData({
          name: 'src',
          path: `${props.currentPath}src/`,
          isDir: true,
          key: `${props.currentPath}src/`,
          title: 'src',
          isLeaf: false,
        } as FileTreeItem)
      }
    >
      load-src-{props.title}
    </button>
    <button
      type="button"
      onClick={(event) =>
        props.onNodeClick?.(event, {
          name: 'README.md',
          path: `${props.currentPath}README.md`,
          isDir: false,
          key: `${props.currentPath}README.md`,
          title: 'README.md',
          isLeaf: true,
        } as FileTreeItem)
      }
    >
      open-file-{props.title}
    </button>
    <button
      type="button"
      onClick={() =>
        props.onNodeDoubleClick?.({
          name: 'README.md',
          path: `${props.currentPath}README.md`,
          isDir: false,
          key: `${props.currentPath}README.md`,
          title: 'README.md',
          isLeaf: true,
        } as FileTreeItem)
      }
    >
      quote-file-{props.title}
    </button>
  </section>
));

const mockListAvailableProjectRepos = listAvailableProjectRepos as jest.MockedFunction<
  typeof listAvailableProjectRepos
>;
const mockListProjectRepoTree = listProjectRepoTree as jest.MockedFunction<typeof listProjectRepoTree>;
const mockSearchProjectRepoTree = searchProjectRepoTree as jest.MockedFunction<typeof searchProjectRepoTree>;
const mockGetTaskChanges = getTaskChanges as jest.MockedFunction<typeof getTaskChanges>;
const mockGetTaskFileDiff = getTaskFileDiff as jest.MockedFunction<typeof getTaskFileDiff>;

describe('CodesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListAvailableProjectRepos.mockResolvedValue([
      {
        repoId: 1,
        projectId: 203,
        repoFullName: 'beyonai/ByClaw',
        repoType: 'workspace',
        path: '/by/projects/203/',
      },
      {
        repoId: 2,
        projectId: 203,
        repoFullName: 'beyonai/byclaw-test',
        repoType: 'code',
        path: '/by/projects/203/beyonai/byclaw-test/',
      },
    ]);
    mockListProjectRepoTree.mockImplementation(async ({ path = '' }) =>
      path
        ? [{ name: 'README.md', path: `${path}/README.md`, type: 'file' }]
        : [{ name: 'src', path: 'src', type: 'directory' }]
    );
    mockSearchProjectRepoTree.mockResolvedValue([{ name: 'matched.ts', path: 'src/matched.ts', type: 'file' }]);
    mockGetTaskChanges.mockResolvedValue({
      status: 'ok',
      source: 'local',
      repoId: 1,
      repoFullName: 'beyonai/ByClaw',
      headBranch: 'feature/repos-tab',
      files: [
        {
          filename: 'src/changed.ts',
          status: 'modified',
          additions: 3,
          deletions: 1,
        },
      ],
    });
    mockGetTaskFileDiff.mockResolvedValue({
      status: 'ok',
      filename: 'src/changed.ts',
      diff: '@@ -1 +1 @@\n-old value\n+new value',
    });
  });

  it('loads the workspace repository from its current session directory', async () => {
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" />);

    await waitFor(() => expect(mockListAvailableProjectRepos).toHaveBeenCalledWith(203));
    await waitFor(() => expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1 }));

    expect(screen.getByTestId('repo-beyonai/ByClaw')).toHaveTextContent('/by/projects/203/');
    expect(screen.queryByTestId('repo-beyonai/byclaw-test')).toBeNull();
  });

  it('switches to a configured submodule repository and loads its files and changes', async () => {
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled />);

    const workspace = await screen.findByTestId('repo-beyonai/ByClaw');
    fireEvent.click(within(workspace).getByRole('button', { name: 'beyonai/ByClaw' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'beyonai/byclaw-test' }));

    const submodule = await screen.findByTestId('repo-beyonai/byclaw-test');
    expect(within(submodule).getByTestId('repo-files-beyonai/byclaw-test')).toHaveTextContent(
      '/by/projects/203/beyonai/byclaw-test/'
    );
    await waitFor(() => {
      expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 2 });
      expect(mockGetTaskChanges).toHaveBeenCalledWith(301, 2);
    });
  });

  it('keeps the session code file list empty when no matching worktree exists', async () => {
    mockListAvailableProjectRepos.mockResolvedValue([]);

    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" />);

    await screen.findByText('projectSpace.detail.repo.emptyRepositories');
    expect(mockListProjectRepoTree).not.toHaveBeenCalled();
  });

  it('refreshes one repository and lazily loads nested directories', async () => {
    const { rerender } = render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" refreshKey={0} />);

    await screen.findByTestId('repo-beyonai/ByClaw');
    mockListProjectRepoTree.mockClear();

    rerender(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" refreshKey={1} />);
    await waitFor(() => expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1 }));

    mockListProjectRepoTree.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'load-src-beyonai/ByClaw' }));
    await waitFor(() =>
      expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1, path: 'src' })
    );
  });

  it('searches file contents within one repository and restores the file list when cleared', async () => {
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    const searchInput = within(repoBlock).getByPlaceholderText('projectSpace.detail.repo.searchPlaceholder');

    fireEvent.change(searchInput, { target: { value: 'session token' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(mockSearchProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1, keyword: 'session token' })
    );
    expect(repoBlock).toHaveTextContent('matched.ts');

    mockListProjectRepoTree.mockClear();
    const clearButton = repoBlock.querySelector('.ant-input-clear-icon');
    expect(clearButton).not.toBeNull();
    fireEvent.click(clearButton as Element);

    await waitFor(() => expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1 }));
  });

  it('forwards repository file clicks to the project file preview handler', async () => {
    const onNodeClick = jest.fn();
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" onNodeClick={onNodeClick} />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    fireEvent.click(within(repoBlock).getByRole('button', { name: 'open-file-beyonai/ByClaw' }));

    expect(onNodeClick).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'README.md',
        path: '/by/projects/203/README.md',
        isDir: false,
      })
    );
  });

  it('opens a repository file preview tab when no click handler is provided', async () => {
    jest.useFakeTimers();
    const onOpenDetail = jest.fn();
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" onOpenDetail={onOpenDetail} />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    fireEvent.click(within(repoBlock).getByRole('button', { name: 'open-file-beyonai/ByClaw' }));

    expect(onOpenDetail).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onOpenDetail).toHaveBeenCalledWith(expect.anything(), {
      tabKey: 'repo-file:/by/projects/203/README.md',
      title: 'README.md',
    });
    jest.useRealTimers();
  });

  it('quotes a repository file on double click and cancels the pending preview', async () => {
    jest.useFakeTimers();
    const onOpenDetail = jest.fn();
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" onOpenDetail={onOpenDetail} />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    fireEvent.click(within(repoBlock).getByRole('button', { name: 'open-file-beyonai/ByClaw' }));
    fireEvent.click(within(repoBlock).getByRole('button', { name: 'quote-file-beyonai/ByClaw' }));

    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(onOpenDetail).not.toHaveBeenCalled();
    expect(mockEventEmitter.emit).toHaveBeenCalledWith('queryInput-insert-item', {
      item: expect.objectContaining({
        id: '/by/projects/203/README.md',
        collectionName: 'README.md',
        resourceId: 'agent-9',
        type: 'file',
      }),
      type: 'COMMON_FILE',
    });
    jest.useRealTimers();
  });

  it('toggles a persistent code changes view from the git change indicator', async () => {
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    const filesView = within(repoBlock).getByTestId('repo-files-beyonai/ByClaw');
    const changesView = within(repoBlock).getByTestId('repo-changes-beyonai/ByClaw');
    const searchInput = within(repoBlock).getByPlaceholderText('projectSpace.detail.repo.searchPlaceholder');

    await waitFor(() => expect(mockGetTaskChanges).toHaveBeenCalledWith(301, 1));
    const changesButton = within(repoBlock).getByRole('button', {
      name: 'projectSpace.detail.repo.showCodeChanges',
    });
    expect(changesButton).toHaveTextContent('1');
    expect(filesView).not.toHaveAttribute('hidden');
    expect(changesView).toHaveAttribute('hidden');

    fireEvent.change(searchInput, { target: { value: 'kept value' } });
    fireEvent.click(changesButton);
    expect(filesView).toHaveAttribute('hidden');
    expect(changesView).not.toHaveAttribute('hidden');
    expect(changesView).toHaveTextContent('changed.ts');

    fireEvent.click(changesButton);
    expect(filesView).not.toHaveAttribute('hidden');
    expect(changesView).toHaveAttribute('hidden');
    expect(searchInput).toHaveValue('kept value');
  });

  it('refreshes repository files and code changes together', async () => {
    const { rerender } = render(
      <CodesTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled refreshKey={0} />
    );

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    await waitFor(() => expect(mockGetTaskChanges).toHaveBeenCalledWith(301, 1));
    mockListProjectRepoTree.mockClear();
    mockGetTaskChanges.mockClear();

    rerender(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled refreshKey={1} />);

    await waitFor(() => {
      expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1 });
      expect(mockGetTaskChanges).toHaveBeenCalledWith(301, 1);
    });
  });

  it('opens the migrated local file diff modal from the code changes view', async () => {
    render(<CodesTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    const changesButton = await within(repoBlock).findByRole('button', {
      name: 'projectSpace.detail.repo.showCodeChanges',
    });
    fireEvent.click(changesButton);
    fireEvent.click(within(repoBlock).getByRole('button', { name: /changed\.ts/ }));

    await waitFor(() => expect(mockGetTaskFileDiff).toHaveBeenCalledWith(301, 'src/changed.ts', 1));
    expect(await screen.findByText('+new value')).toBeInTheDocument();
  }, 10000);
});
