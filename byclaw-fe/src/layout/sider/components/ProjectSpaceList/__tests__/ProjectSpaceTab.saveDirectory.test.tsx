import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectSpaceTab from '../ProjectSpaceTab';
import { downloadFile } from '@/service/fileBrowser';
import { uploadFiles } from '@/service/knowledgeCenter';
import { message } from 'antd';

const mockQueryDrive = jest.fn();
const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
const mockEvents = { emit: jest.fn() };

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return { ...actual, Tree: (props: any) => <actual.Tree {...props} motion={null} /> };
});

jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl }));
jest.mock('@/hooks/useGlobal', () => ({ __esModule: true, default: () => ({ EventEmitter: mockEvents }) }));
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel', () => () => null);
jest.mock('@/components/QueryInput/withDrag', () => ({ DragType: {} }));
jest.mock('@/components/ProjectCloudDrive', () => ({
  queryProjectCloudDrive: (...args: any[]) => mockQueryDrive(...args),
}));
jest.mock('@/service/knowledgeCenter', () => ({ uploadFiles: jest.fn() }));
jest.mock('@/service/fileBrowser', () => ({
  deleteFiles: jest.fn(),
  downloadFile: jest.fn(),
  downloadFolder: jest.fn(),
  renameFile: jest.fn(),
}));
jest.mock('@/service/devloop', () => ({
  listProjectSpaceTree: jest.fn(() => Promise.resolve([])),
  createProjectSpaceFolder: jest.fn(),
  uploadProjectSpaceFiles: jest.fn(),
}));
jest.mock('../CodesTab', () => () => null);
jest.mock('@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock', () => ({
  __esModule: true,
  default: (props: any) => (
    <button
      onClick={() =>
        props.onAction('saveToProject', { name: 'report.txt', path: '/by/projects/42/report.txt', isDir: false })
      }
    >
      Save report
    </button>
  ),
}));

const expandFolder = async (name: string) => {
  const row = screen.getByText(name).closest('[role="treeitem"]') as HTMLElement;
  await act(async () => {
    fireEvent.click(row.querySelector('[class*="-tree-switcher"]') as HTMLElement);
  });
};

describe('project cloud-drive save directory picker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryDrive.mockImplementation((_resourceId: number, path: string) =>
      Promise.resolve(
        path === '/'
          ? [{ name: 'Folder A', path: '/A/', isDir: true }]
          : path === '/A/'
          ? [
              { name: 'Folder B', path: '/A/B/', isDir: true },
              { name: 'file.txt', path: '/A/file.txt', isDir: false },
            ]
          : []
      )
    );
    jest.mocked(downloadFile).mockResolvedValue(new Blob(['test']) as any);
    jest.mocked(uploadFiles).mockResolvedValue({} as any);
  });

  it('loads nested directories when the user expands a root child', async () => {
    render(<ProjectSpaceTab projectId={42} resourceId={100} projectCloudResourceId={200} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    const folder = await screen.findByText('Folder A');
    const row = folder.closest('[role="treeitem"]') as HTMLElement;
    const switcher = row.querySelector('[class*="-tree-switcher"]') as HTMLElement;
    expect(mockQueryDrive).toHaveBeenCalledWith(200, '/');
    await act(async () => {
      fireEvent.click(switcher);
    });
    await waitFor(() => expect(mockQueryDrive).toHaveBeenCalledWith(200, '/A/'));
    await waitFor(() => expect(screen.getByText('Folder B')).toBeVisible());
    expect(screen.queryByText('file.txt')).not.toBeInTheDocument();
    await expandFolder('Folder B');
    await waitFor(() => expect(mockQueryDrive).toHaveBeenCalledWith(200, '/A/B/'));
    fireEvent.click(screen.getByText('Folder B'));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(uploadFiles).toHaveBeenCalled());
    expect(jest.mocked(uploadFiles).mock.calls[0][0].get('directoryPath')).toBe('/A/B/');
  });

  it.each(['/', '/A/'])('preserves saving to %s', async (path) => {
    render(<ProjectSpaceTab projectId={42} resourceId={100} projectCloudResourceId={200} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await screen.findByText('Folder A');
    if (path === '/A/') fireEvent.click(screen.getByText('Folder A'));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(uploadFiles).toHaveBeenCalled());
    expect(jest.mocked(uploadFiles).mock.calls[0][0].get('directoryPath')).toBe(path);
  });

  it('reuses loaded children after collapsing and resets them when reopened', async () => {
    render(<ProjectSpaceTab projectId={42} resourceId={100} projectCloudResourceId={200} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await screen.findByText('Folder A');
    await expandFolder('Folder A');
    await waitFor(() => expect(screen.getByText('Folder B')).toBeVisible());
    await expandFolder('Folder A');
    await waitFor(() =>
      expect(screen.getByText('Folder A').closest('[role="treeitem"]')).toHaveAttribute('aria-expanded', 'false')
    );
    await expandFolder('Folder A');
    expect(mockQueryDrive.mock.calls.filter(([, path]) => path === '/A/')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await screen.findByText('Folder A');
    expect(screen.queryByText('Folder B')).not.toBeInTheDocument();
    await expandFolder('Folder A');
    await screen.findByText('Folder B');
    expect(mockQueryDrive.mock.calls.filter(([, path]) => path === '/A/')).toHaveLength(2);
  });

  it('discards pending directories when the project changes', async () => {
    let resolveChildren: (value: any[]) => void = () => undefined;
    mockQueryDrive.mockImplementation((_id, path) =>
      path === '/'
        ? Promise.resolve([{ name: 'Folder A', path: '/A/', isDir: true }])
        : new Promise((resolve) => {
            resolveChildren = resolve;
          })
    );
    const view = render(<ProjectSpaceTab projectId={42} resourceId={100} projectCloudResourceId={200} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await screen.findByText('Folder A');
    await expandFolder('Folder A');
    await waitFor(() => expect(mockQueryDrive).toHaveBeenCalledWith(200, '/A/'));
    view.rerender(<ProjectSpaceTab projectId={43} resourceId={100} projectCloudResourceId={201} />);
    resolveChildren([{ name: 'Old child', path: '/A/old/', isDir: true }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await screen.findByText('Folder A');
    expect(screen.queryByText('Old child')).not.toBeInTheDocument();
    expect(mockQueryDrive).toHaveBeenCalledWith(201, '/');
  });

  it('reports a failed child load and allows retrying the same directory', async () => {
    const error = jest.spyOn(message, 'error').mockImplementation(() => undefined as any);
    mockQueryDrive.mockReset();
    mockQueryDrive
      .mockResolvedValueOnce([{ name: 'Folder A', path: '/A/', isDir: true }])
      .mockRejectedValueOnce(new Error('directory unavailable'))
      .mockResolvedValueOnce([{ name: 'Folder B', path: '/A/B/', isDir: true }]);
    render(<ProjectSpaceTab projectId={42} resourceId={100} projectCloudResourceId={200} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    await screen.findByText('Folder A');
    await expandFolder('Folder A');
    await waitFor(() => expect(error).toHaveBeenCalledWith('directory unavailable'));
    await waitFor(() =>
      expect(screen.getByText('Folder A').closest('[role="treeitem"]')).toHaveAttribute('aria-expanded', 'false')
    );
    await expandFolder('Folder A');
    expect(await screen.findByText('Folder B')).toBeVisible();
    expect(mockQueryDrive.mock.calls.filter(([, path]) => path === '/A/')).toHaveLength(2);
    error.mockRestore();
  });
});
