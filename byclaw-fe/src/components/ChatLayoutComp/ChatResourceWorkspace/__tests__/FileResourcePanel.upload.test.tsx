import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { message } from 'antd';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';
import { ensureFolder, listFiles, uploadFiles, type FileBrowserItem } from '@/service/fileBrowser';
import { uploadFiles as uploadKnowledgeFiles } from '@/service/knowledgeCenter';
import { getLocaleIntl } from '@/testUtils/localeIntl';
import { getProject } from '@/pages/projectSpace/service';
import FileResourcePanel from '../FileResourcePanel';

const MB = 1024 * 1024;
const mockIntl = getLocaleIntl();
let mockConfig: Partial<IAgentFileUploadConf> | undefined;

jest.mock('antd', () => {
  const actualAntd = jest.requireActual<typeof import('antd')>('antd');
  return {
    ...actualAntd,
    // 上传用例保留真实 Upload/Button，仅隔离未打开的移动弹窗与悬浮提示。
    Modal: () => null,
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});
jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  useIntl: () => mockIntl,
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ uploadFileConfig: mockConfig }),
}));
jest.mock('@/service/fileBrowser', () => ({ ensureFolder: jest.fn(), listFiles: jest.fn(), uploadFiles: jest.fn() }));
jest.mock('@/service/knowledgeCenter', () => ({ uploadFiles: jest.fn() }));
jest.mock('@/service/devloop', () => ({ listProjectRepos: jest.fn() }));
jest.mock('@/service/file', () => ({ downloadResourceFile: jest.fn() }));
jest.mock('@/utils/file', () => ({ downloadFile: jest.fn() }));
jest.mock('@/components/ProjectCloudDrive', () => ({ queryProjectCloudDrive: jest.fn() }));
jest.mock('@/components/QueryInput/withDrag', () => ({ DragType: {} }));
jest.mock('../useChatResourceProject', () => ({ useChatResourceProject: () => ({}) }));
jest.mock('@/pages/projectSpace/service', () => ({ getProject: jest.fn() }));
jest.mock('../FilePreviewPanel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/layout/sider/components/FileSiderPanel/components/CreateFolderModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/layout/sider/components/FileSiderPanel/components/FileTreeList', () => ({
  FilePathTooltip: () => null,
}));
jest.mock('@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock', () => ({
  __esModule: true,
  default: function FileSpaceBlockMock({
    contentBefore,
    items,
    loading,
    onAction,
    onNodeClick,
    getDisplayName,
  }: {
    contentBefore: ReactNode;
    items: FileBrowserItem[];
    loading: boolean;
    onAction: (action: string, item: FileBrowserItem) => void;
    onNodeClick: (event: React.MouseEvent, item: FileBrowserItem) => void;
    getDisplayName?: (item: FileBrowserItem) => string;
  }) {
    return (
      <section aria-label="File space" aria-busy={loading}>
        {contentBefore}
        {items.map((item) => (
          <button key={`open-${item.path}`} type="button" onClick={(event) => onNodeClick(event, item)}>
            Open {getDisplayName?.(item) || item.name}
          </button>
        ))}
        {items.map((item) => (
          <button key={item.path} type="button" onClick={() => onAction('upload', item)}>
            Upload to {item.name}
          </button>
        ))}
      </section>
    );
  },
}));

function createFile(name: string, size: number) {
  // 保留真实 File/FormData 行为，仅替换大小元数据以避免分配大文件。
  const file = new File(['content'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

it('navigates from the DSH project directory to shared root and uploads into the selected directory', async () => {
  jest.mocked(listFiles).mockResolvedValue([]);
  await act(async () => {
    render(
      <FileResourcePanel
        scope="shared"
        sessionId="7"
        projectId={12}
        project={{ projectId: 12, projectName: '测试项目' } as any}
        runtimeType="dsh"
        resourceId="42"
        onOpenDetail={jest.fn()}
      />
    );
  });
  expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/by/.shared/project_12/' }));
  expect(ensureFolder).toHaveBeenCalledWith({ resourceId: '42', path: '/by/.shared/project_12/' });
  expect(jest.mocked(ensureFolder).mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(listFiles).mock.invocationCallOrder[0]
  );
  expect(screen.getByText('测试项目')).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '本地共享' }));
  });
  expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/by/.shared/' }));
  expect(ensureFolder).toHaveBeenCalledTimes(1);
  const input = screen
    .getByRole('region', { name: 'File space' })
    .querySelector<HTMLInputElement>('input[type="file"]');
  await chooseFiles(input!, [createFile('root.pdf', 1)]);
  expect(uploadFiles).toHaveBeenCalledWith('42', '/by/.shared/', expect.any(Array));
});

it('resolves project folder labels after returning to shared root and preserves physical paths when entering', async () => {
  jest.mocked(getProject).mockResolvedValue({ data: { projectId: 42, projectName: '其他项目' } } as any);
  jest.mocked(listFiles).mockImplementation(async (request) =>
    request.path === '/by/.shared/'
      ? [
          { name: 'project_-1', path: '/by/.shared/project_-1/', isDir: true },
          { name: 'project_42', path: '/by/.shared/project_42/', isDir: true },
        ]
      : []
  );
  await act(async () => {
    render(
      <FileResourcePanel
        scope="shared"
        sessionId="7"
        projectId={-1}
        runtimeType="dsh"
        resourceId="42"
        onOpenDetail={jest.fn()}
      />
    );
  });
  expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/by/.shared/project_-1/' }));
  expect(screen.getByText('默认项目')).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '本地共享' }));
  });
  expect(screen.getByRole('button', { name: 'Open 默认项目' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open 其他项目' })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open 其他项目' }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/by/.shared/project_42/' }));
  expect(screen.getByText('其他项目')).toBeInTheDocument();
});

it('retries failed project names and refreshes renamed projects on list refresh', async () => {
  jest.mocked(listFiles).mockResolvedValue([{ name: 'project_42', path: '/by/.shared/project_42/', isDir: true }]);
  jest.mocked(getProject).mockRejectedValueOnce(new Error('offline'));
  const panel = (refreshKey: number) => (
    <FileResourcePanel scope="shared" sessionId="7" resourceId="42" refreshKey={refreshKey} onOpenDetail={jest.fn()} />
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(panel(0));
  });
  expect(screen.getByRole('button', { name: 'Open project_42' })).toBeInTheDocument();
  jest.mocked(getProject).mockResolvedValue({ data: { projectId: 42, projectName: '恢复项目' } } as any);
  await act(async () => {
    view.rerender(panel(1));
  });
  expect(screen.getByRole('button', { name: 'Open 恢复项目' })).toBeInTheDocument();
  jest.mocked(getProject).mockResolvedValue({ data: { projectId: 42, projectName: '改名项目' } } as any);
  await act(async () => {
    view.rerender(panel(2));
  });
  expect(screen.getByRole('button', { name: 'Open 改名项目' })).toBeInTheDocument();
});

async function renderPanel(scope: 'shared' | 'project') {
  // 列表请求已 mock 为立即完成，显式等待 React 提交状态，避免轮询与渲染竞争。
  await act(async () => {
    render(<FileResourcePanel scope={scope} sessionId="7" resourceId="42" onOpenDetail={jest.fn()} />);
  });
  const region = screen.getByRole('region', { name: 'File space' });
  expect(region).toHaveAttribute('aria-busy', 'false');
  expect(ensureFolder).not.toHaveBeenCalled();
  const input = region.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('Upload file input is missing');
  return { input };
}

async function chooseFiles(input: HTMLInputElement, files: File[]) {
  // 等待 rc-upload 的异步 beforeUpload 及上传后的列表刷新后再断言。
  await act(async () => {
    fireEvent.change(input, { target: { files } });
  });
}

function getUploadedRequest(scope: 'shared' | 'project') {
  if (scope === 'shared') {
    const [resourceId, directoryPath, files] = jest.mocked(uploadFiles).mock.calls[0];
    return { resourceId, directoryPath, files };
  }
  const [formData] = jest.mocked(uploadKnowledgeFiles).mock.calls[0];
  return {
    resourceId: formData.get('resourceId'),
    directoryPath: formData.get('directoryPath'),
    files: formData.getAll('files'),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig = { maxFileSize: 512 };
  jest.spyOn(message, 'error').mockImplementation(jest.fn());
  jest.spyOn(message, 'success').mockImplementation(jest.fn());
  const folders: FileBrowserItem[] = [{ name: 'reports', path: '/reports/', isDir: true }];
  jest.mocked(listFiles).mockResolvedValue(folders);
  jest.mocked(queryProjectCloudDrive).mockResolvedValue(folders);
  jest.mocked(uploadFiles).mockResolvedValue({});
  jest.mocked(uploadKnowledgeFiles).mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(['shared', 'project'] as const)('%s file upload size validation', (scope) => {
  it('rejects the entire selection before either upload request', async () => {
    const { input } = await renderPanel(scope);
    await chooseFiles(input, [createFile('small.pdf', MB), createFile('oversized.pdf', 512 * MB + 1)]);

    expect(message.error).toHaveBeenCalledWith(mockIntl.formatMessage({ id: 'upload.fileSizeLimit' }, { size: 512 }));
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(uploadKnowledgeFiles).not.toHaveBeenCalled();
  });

  it('allows exact-limit files even when the batch exceeds the single-file limit', async () => {
    const { input } = await renderPanel(scope);
    const files = [createFile('first.pdf', 512 * MB), createFile('second.pdf', 300 * MB)];
    await chooseFiles(input, files);

    expect(message.success).toHaveBeenCalledTimes(1);
    expect(getUploadedRequest(scope)).toEqual({
      files,
      resourceId: '42',
      directoryPath: scope === 'shared' ? '/by/.shared/' : '/',
    });
    expect(scope === 'shared' ? uploadKnowledgeFiles : uploadFiles).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, { maxFileSize: 0 }])('does not impose a fallback size limit for %p', async (config) => {
    mockConfig = config;
    const { input } = await renderPanel(scope);
    await chooseFiles(input, [createFile('large.pdf', 600 * MB)]);

    expect(message.success).toHaveBeenCalledTimes(1);
    expect(message.error).not.toHaveBeenCalled();
  });

  it('applies the same validation to the directory upload action', async () => {
    await renderPanel(scope);
    const clickSpy = jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Upload to reports' }));
    const selectedInput = clickSpy.mock.contexts[0] as HTMLInputElement;
    if (!selectedInput) throw new Error('Directory upload file input is missing');
    await chooseFiles(selectedInput, [createFile('oversized.pdf', 512 * MB + 1)]);

    expect(message.error).toHaveBeenCalledWith(mockIntl.formatMessage({ id: 'upload.fileSizeLimit' }, { size: 512 }));
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(uploadKnowledgeFiles).not.toHaveBeenCalled();
  });
});

describe('project cloud upload count validation', () => {
  it('rejects an oversized batch before calling the shared knowledge upload endpoint', async () => {
    mockConfig = { maxFileCount: 2, maxFileSize: 0 };
    const { input } = await renderPanel('project');
    const files = Array.from({ length: 3 }, (_, index) => createFile(`document-${index}.pdf`, 1));
    await chooseFiles(input, files);

    expect(message.error).toHaveBeenCalledWith(mockIntl.formatMessage({ id: 'upload.maxFilesLimit' }, { count: 2 }));
    expect(uploadKnowledgeFiles).not.toHaveBeenCalled();
    expect(uploadFiles).not.toHaveBeenCalled();
  });

  it.each([0, 12])('allows twelve files with maxFileCount=%s', async (maxFileCount) => {
    mockConfig = { maxFileCount, maxFileSize: 512 };
    const { input } = await renderPanel('project');
    const files = Array.from({ length: 12 }, (_, index) => createFile(`document-${index}.pdf`, 1));
    await chooseFiles(input, files);

    expect(message.success).toHaveBeenCalledTimes(1);
    expect(getUploadedRequest('project').files).toEqual(files);
    expect(message.error).not.toHaveBeenCalled();
  });

  it('keeps local shared uploads independent of the knowledge batch-count limit', async () => {
    mockConfig = { maxFileCount: 1, maxFileSize: 512 };
    const { input } = await renderPanel('shared');
    const files = [createFile('first.pdf', 1), createFile('second.pdf', 1)];
    await chooseFiles(input, files);

    expect(message.success).toHaveBeenCalledTimes(1);
    expect(getUploadedRequest('shared').files).toEqual(files);
    expect(uploadKnowledgeFiles).not.toHaveBeenCalled();
  });
});
