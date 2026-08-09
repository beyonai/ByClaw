import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
import { listFiles, searchFiles } from '@/service/fileBrowser';
import { getTaskChanges, getTaskFileDiff, listProjectRepos } from '@/service/devloop';
import ReposTab from '../index';

jest.mock('@/service/devloop', () => ({
  getTaskChanges: jest.fn(),
  getTaskFileDiff: jest.fn(),
  listProjectRepos: jest.fn(),
}));

jest.mock('@/service/fileBrowser', () => ({
  listFiles: jest.fn(),
  searchFiles: jest.fn(),
}));

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
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
  </section>
));

const mockListProjectRepos = listProjectRepos as jest.MockedFunction<typeof listProjectRepos>;
const mockListFiles = listFiles as jest.MockedFunction<typeof listFiles>;
const mockSearchFiles = searchFiles as jest.MockedFunction<typeof searchFiles>;
const mockGetTaskChanges = getTaskChanges as jest.MockedFunction<typeof getTaskChanges>;
const mockGetTaskFileDiff = getTaskFileDiff as jest.MockedFunction<typeof getTaskFileDiff>;

describe('ReposTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListProjectRepos.mockResolvedValue([
      { repoId: 1, projectId: 203, repoFullName: 'beyonai/ByClaw' },
      { repoId: 2, projectId: 203, repoFullName: 'standalone-repo' },
    ]);
    mockListFiles.mockImplementation(async ({ path }) => [
      { name: path.endsWith('/ByClaw/') ? 'src' : 'README.md', path: `${path}entry`, isDir: false },
    ]);
    mockSearchFiles.mockResolvedValue([
      { name: 'matched.ts', path: '/.sessions/301/ByClaw/src/matched.ts', isDir: false },
    ]);
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

  it('loads every project repository from its current session directory', async () => {
    render(<ReposTab projectId={203} resourceId="agent-9" sessionId="301" />);

    await waitFor(() => expect(mockListProjectRepos).toHaveBeenCalledWith(203));
    await waitFor(() => {
      expect(mockListFiles).toHaveBeenCalledWith({
        resourceId: 'agent-9',
        path: '/.sessions/301/ByClaw/',
      });
      expect(mockListFiles).toHaveBeenCalledWith({
        resourceId: 'agent-9',
        path: '/.sessions/301/standalone-repo/',
      });
    });

    expect(screen.getByTestId('repo-beyonai/ByClaw')).toHaveTextContent('/.sessions/301/ByClaw/');
    expect(screen.getByTestId('repo-standalone-repo')).toHaveTextContent('/.sessions/301/standalone-repo/');
  });

  it('refreshes one repository and lazily loads nested directories', async () => {
    render(<ReposTab projectId={203} resourceId="agent-9" sessionId="301" />);

    await screen.findByTestId('repo-beyonai/ByClaw');
    mockListFiles.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'refresh-beyonai/ByClaw' }));
    await waitFor(() =>
      expect(mockListFiles).toHaveBeenCalledWith({
        resourceId: 'agent-9',
        path: '/.sessions/301/ByClaw/',
      })
    );

    mockListFiles.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'load-src-beyonai/ByClaw' }));
    await waitFor(() =>
      expect(mockListFiles).toHaveBeenCalledWith({
        resourceId: 'agent-9',
        path: '/.sessions/301/ByClaw/src/',
      })
    );
  });

  it('searches file contents within one repository and restores the file list when cleared', async () => {
    render(<ReposTab projectId={203} resourceId="agent-9" sessionId="301" />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    const searchInput = within(repoBlock).getByPlaceholderText('projectSpace.detail.repo.searchPlaceholder');

    fireEvent.change(searchInput, { target: { value: 'session token' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(mockSearchFiles).toHaveBeenCalledWith({
        resourceId: 'agent-9',
        path: '/.sessions/301/ByClaw/',
        keyword: 'session token',
      })
    );
    expect(repoBlock).toHaveTextContent('matched.ts');

    mockListFiles.mockClear();
    const clearButton = repoBlock.querySelector('.ant-input-clear-icon');
    expect(clearButton).not.toBeNull();
    fireEvent.click(clearButton as Element);

    await waitFor(() =>
      expect(mockListFiles).toHaveBeenCalledWith({
        resourceId: 'agent-9',
        path: '/.sessions/301/ByClaw/',
      })
    );
  });

  it('forwards repository file clicks to the project file preview handler', async () => {
    const onNodeClick = jest.fn();
    render(<ReposTab projectId={203} resourceId="agent-9" sessionId="301" onNodeClick={onNodeClick} />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    fireEvent.click(within(repoBlock).getByRole('button', { name: 'open-file-beyonai/ByClaw' }));

    expect(onNodeClick).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'README.md',
        path: '/.sessions/301/ByClaw/README.md',
        isDir: false,
      })
    );
  });

  it('toggles a persistent code changes view from the git change indicator', async () => {
    render(<ReposTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    const filesView = within(repoBlock).getByTestId('repo-files-beyonai/ByClaw');
    const changesView = within(repoBlock).getByTestId('repo-changes-beyonai/ByClaw');
    const searchInput = within(repoBlock).getByPlaceholderText('projectSpace.detail.repo.searchPlaceholder');

    await waitFor(() => expect(mockGetTaskChanges).toHaveBeenCalledWith(301));
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
    render(<ReposTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    await waitFor(() => expect(mockGetTaskChanges).toHaveBeenCalledWith(301));
    mockListFiles.mockClear();
    mockGetTaskChanges.mockClear();

    fireEvent.click(within(repoBlock).getByRole('button', { name: 'refresh-beyonai/ByClaw' }));

    await waitFor(() => {
      expect(mockListFiles).toHaveBeenCalledWith({
        resourceId: 'agent-9',
        path: '/.sessions/301/ByClaw/',
      });
      expect(mockGetTaskChanges).toHaveBeenCalledWith(301);
    });
  });

  it('opens the migrated local file diff modal from the code changes view', async () => {
    render(<ReposTab projectId={203} resourceId="agent-9" sessionId="301" codeChangesEnabled />);

    const repoBlock = await screen.findByTestId('repo-beyonai/ByClaw');
    const changesButton = await within(repoBlock).findByRole('button', {
      name: 'projectSpace.detail.repo.showCodeChanges',
    });
    fireEvent.click(changesButton);
    fireEvent.click(within(repoBlock).getByRole('button', { name: /changed\.ts/ }));

    await waitFor(() => expect(mockGetTaskFileDiff).toHaveBeenCalledWith(301, 'src/changed.ts', 1));
    expect(await screen.findByText('+new value')).toBeInTheDocument();
  });
});
