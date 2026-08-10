import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
import {
  getProjectRepoFileContent,
  listProjectRepoBranches,
  listProjectRepoTree,
  listProjectRepos,
} from '@/service/devloop';
import ReposTab from '../index';

jest.mock('@/service/devloop', () => ({
  getProjectRepoFileContent: jest.fn(),
  listProjectRepoBranches: jest.fn(),
  listProjectRepoTree: jest.fn(),
  listProjectRepos: jest.fn(),
}));

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: jest.fn() } }),
}));

jest.mock('@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock', () => (props: any) => (
  <section data-testid={`repo-${props.title}`}>
    <h2>{props.title}</h2>
    {props.headerExtra}
    <button type="button" onClick={props.onRefresh}>
      refresh
    </button>
    <div data-testid={`repo-files-${props.title}`}>
      {props.items.map((item: { name: string }) => item.name).join(',')}
    </div>
    <button
      type="button"
      onClick={() =>
        props.onLoadData({
          name: 'src',
          path: 'src',
          isDir: true,
          key: 'src',
          title: 'src',
          isLeaf: false,
        } as FileTreeItem)
      }
    >
      load-directory
    </button>
    <button
      type="button"
      onClick={(event) =>
        props.onNodeClick?.(event, {
          name: 'README.md',
          path: 'README.md',
          isDir: false,
          key: 'README.md',
          title: 'README.md',
          isLeaf: true,
        } as FileTreeItem)
      }
    >
      open-file
    </button>
  </section>
));

const mockListProjectRepos = listProjectRepos as jest.MockedFunction<typeof listProjectRepos>;
const mockListProjectRepoBranches = listProjectRepoBranches as jest.MockedFunction<typeof listProjectRepoBranches>;
const mockListProjectRepoTree = listProjectRepoTree as jest.MockedFunction<typeof listProjectRepoTree>;
const mockGetProjectRepoFileContent = getProjectRepoFileContent as jest.MockedFunction<
  typeof getProjectRepoFileContent
>;

describe('ReposTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListProjectRepos.mockResolvedValue([
      { repoId: 1, projectId: 203, repoFullName: 'acme/one', defaultBranch: 'main' },
      { repoId: 2, projectId: 203, repoFullName: 'acme/two', defaultBranch: 'develop' },
    ]);
    mockListProjectRepoBranches.mockImplementation(async (repoId) =>
      repoId === 1 ? [{ name: 'main' }, { name: 'feature/demo' }] : [{ name: 'develop' }]
    );
    mockListProjectRepoTree.mockImplementation(async ({ path }) =>
      path
        ? [{ name: 'App.tsx', path: `${path}/App.tsx`, type: 'file' }]
        : [{ name: 'src', path: 'src', type: 'directory' }]
    );
    mockGetProjectRepoFileContent.mockResolvedValue({
      name: 'README.md',
      path: 'README.md',
      branch: 'main',
      content: '# demo',
      binary: false,
    });
  });

  it('loads every project repository using its default branch', async () => {
    render(<ReposTab projectId={203} onOpenDetail={jest.fn()} />);

    expect(await screen.findByTestId('repo-acme/one')).toBeInTheDocument();
    expect(screen.getByTestId('repo-acme/two')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1, ref: 'main' });
      expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 2, ref: 'develop' });
    });
  });

  it('switches branch, lazily loads a directory, and reads file content', async () => {
    const onOpenDetail = jest.fn();
    render(<ReposTab projectId={203} onOpenDetail={onOpenDetail} />);
    const repoBlock = await screen.findByTestId('repo-acme/one');

    fireEvent.click(within(repoBlock).getByRole('button', { name: /main/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'feature/demo' }));
    await waitFor(() =>
      expect(mockListProjectRepoTree).toHaveBeenCalledWith({ projectId: 203, repoId: 1, ref: 'feature/demo' })
    );

    fireEvent.click(within(repoBlock).getByRole('button', { name: 'load-directory' }));
    await waitFor(() =>
      expect(mockListProjectRepoTree).toHaveBeenCalledWith({
        projectId: 203,
        repoId: 1,
        path: '/src/',
        ref: 'feature/demo',
      })
    );

    fireEvent.click(within(repoBlock).getByRole('button', { name: 'open-file' }));
    await waitFor(() => {
      expect(mockGetProjectRepoFileContent).toHaveBeenCalledWith({
        repoId: 1,
        branch: 'feature/demo',
        path: 'README.md',
      });
      expect(onOpenDetail).toHaveBeenCalled();
    });
  });
});
