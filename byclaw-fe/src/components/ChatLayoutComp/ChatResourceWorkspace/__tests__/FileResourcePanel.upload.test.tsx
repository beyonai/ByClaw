import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message, type MenuProps } from 'antd';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import MessageFilePreviewPanel from '@/components/MessageList/components/FileRender/components/Previewer/MessageFilePreviewPanel';
import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';
import { downloadFile, ensureFolder, listFiles, uploadFiles, type FileBrowserItem } from '@/service/fileBrowser';
import { downloadResourceFile } from '@/service/file';
import { uploadFiles as uploadKnowledgeFiles } from '@/service/knowledgeCenter';
import { getLocaleIntl } from '@/testUtils/localeIntl';
import { getProject } from '@/pages/projectSpace/service';
import FileResourcePanel from '../FileResourcePanel';
import useResourceAttachmentPreview from '../useResourceAttachmentPreview';

const MB = 1024 * 1024;
const mockIntl = getLocaleIntl();
let mockConfig: Partial<IAgentFileUploadConf> | undefined;
let mockSessions: Array<{ sessionId: string; sessionName?: string }> = [];
let mockExpandAction: false | 'click' | 'doubleClick' | undefined;

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
  useSelector: (selector: any) => selector({ user: { userInfo: { userCode: 'user-a' } } }),
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ uploadFileConfig: mockConfig }),
}));
jest.mock('@/service/fileBrowser', () => ({
  downloadFile: jest.fn(),
  ensureFolder: jest.fn(),
  listFiles: jest.fn(),
  uploadFiles: jest.fn(),
}));
jest.mock('@/service/knowledgeCenter', () => ({ uploadFiles: jest.fn() }));
jest.mock('@/service/devloop', () => ({ listProjectRepos: jest.fn() }));
jest.mock('@/service/file', () => ({ downloadResourceFile: jest.fn() }));
jest.mock('@/utils/file', () => ({ downloadFile: jest.fn() }));
jest.mock('@/components/ProjectCloudDrive', () => ({ queryProjectCloudDrive: jest.fn() }));
jest.mock('@/components/QueryInput/withDrag', () => ({
  DragType: { commonFile: 'commonFile', commonFolder: 'commonFolder' },
}));
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
    expandAction,
    onAction,
    onLoadData,
    onNodeClick,
    getDisplayName,
    getActionItems,
  }: {
    contentBefore: ReactNode;
    items: FileBrowserItem[];
    loading: boolean;
    expandAction?: false | 'click' | 'doubleClick';
    onAction: (action: string, item: FileBrowserItem) => void;
    onLoadData: (item: FileBrowserItem) => Promise<void>;
    onNodeClick: (event: React.MouseEvent, item: FileBrowserItem) => void;
    getDisplayName?: (item: FileBrowserItem) => string;
    getActionItems: (item: FileBrowserItem) => MenuProps['items'];
  }) {
    mockExpandAction = expandAction;
    return (
      <section aria-label="File space" aria-busy={loading}>
        {contentBefore}
        {items.map((item) => (
          <button
            key={`open-${item.path}`}
            type="button"
            onClick={(event) => {
              if (item.isDir && expandAction !== false) void onLoadData(item);
              onNodeClick(event, item);
            }}
          >
            Open {getDisplayName?.(item) || item.name}
          </button>
        ))}
        {items
          .filter((item) => getActionItems(item)?.some((action) => action?.key === 'preview'))
          .map((item) => (
            <button
              key={`preview-${item.path}`}
              type="button"
              onClick={() => onAction('preview', item)}
            >
              Preview {item.name}
            </button>
          ))}
        {items.map((item) => (
          <button key={item.path} type="button" onClick={() => onAction('upload', item)}>
            Upload to {item.name}
          </button>
        ))}
        {items.map((item) => (
          <button key={`quote-${item.path}`} type="button" onClick={() => onAction('quote', item)}>
            Quote {item.name}
          </button>
        ))}
        {items
          .filter((item) => item.isDir)
          .map((item) => (
            <button key={`expand-${item.path}`} type="button" onClick={() => void onLoadData(item)}>
              Expand {getDisplayName?.(item) || item.name}
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
  expect(ensureFolder).not.toHaveBeenCalled();
  expect(screen.getByText('测试项目')).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '本地共享' }));
  });
  expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/by/.shared/' }));
  expect(ensureFolder).not.toHaveBeenCalled();
  const input = screen
    .getByRole('region', { name: 'File space' })
    .querySelector<HTMLInputElement>('input[type="file"]');
  await chooseFiles(input!, [createFile('root.pdf', 1)]);
  expect(ensureFolder).toHaveBeenCalledTimes(1);
  expect(ensureFolder).toHaveBeenCalledWith({ resourceId: '42', path: '/by/.shared/' });
  expect(uploadFiles).toHaveBeenCalledWith(
    '42',
    '/by/.shared/',
    expect.any(Array),
    expect.any(Function),
    undefined,
    expect.objectContaining({ ownerKey: 'user-a' })
  );
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

it('opens the current session directly when clicking the virtual sessions directory', async () => {
  jest
    .mocked(listFiles)
    .mockImplementation(async ({ path }) =>
      path === '/by/.sessions/' ? [{ name: '8798', path: '/by/.sessions/8798/', isDir: true }] : []
    );
  await act(async () => {
    render(
      <FileResourcePanel
        scope="shared"
        sessionId="8798"
        projectId={-1}
        project={
          {
            projectId: '-1',
            projectName: '默认项目',
            sessions: [{ sessionId: '8798', sessionName: '你好' }],
          } as any
        }
        runtimeType="dsh"
        resourceId="42"
        onOpenDetail={jest.fn()}
      />
    );
  });
  expect(screen.getByRole('button', { name: 'Open 过程文件' })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open 过程文件' }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/by/.sessions/8798/' }));
  expect(screen.getByText('过程文件')).toBeInTheDocument();
});

it('returns from the virtual sessions directory to the DSH project root', async () => {
  jest.mocked(listFiles).mockResolvedValue([]);
  await act(async () => {
    render(
      <FileResourcePanel
        scope="shared"
        sessionId="8798"
        projectId={-1}
        project={{ projectId: '-1', projectName: '默认项目', sessions: [{ sessionId: '8798' }] } as any}
        runtimeType="dsh"
        resourceId="42"
        onOpenDetail={jest.fn()}
      />
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open 过程文件' }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '默认项目' }));
  });

  expect(ensureFolder).not.toHaveBeenCalled();
  expect(listFiles).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/by/.shared/project_-1/' }));
  expect(screen.getByRole('button', { name: 'Open 过程文件' })).toBeInTheDocument();
});

it('expands process files directly from the current session directory', async () => {
  jest.mocked(listFiles).mockImplementation(async ({ path }) => {
    if (path === '/by/.sessions/11407993/') {
      return [{ name: 'artifacts', path: '/by/.sessions/11407993/artifacts/', isDir: true }];
    }
    return [];
  });
  await act(async () => {
    render(
      <FileResourcePanel
        scope="shared"
        sessionId="11407993"
        projectId={-1}
        runtimeType="dsh"
        resourceId="42"
        onOpenDetail={jest.fn()}
      />
    );
  });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Expand 过程文件' }));
  });

  expect(listFiles).toHaveBeenCalledWith(
    expect.objectContaining({ resourceId: '42', path: '/by/.sessions/11407993/' })
  );
  expect(listFiles).not.toHaveBeenCalledWith(expect.objectContaining({ path: '/by/.sessions/' }));
});

it('does not reload the current session directory when live session names update', async () => {
  jest
    .mocked(listFiles)
    .mockImplementation(async ({ path }) =>
      path === '/by/.sessions/' ? [{ name: '8798', path: '/by/.sessions/8798/', isDir: true }] : []
    );
  const panel = () => (
    <FileResourcePanel
      scope="shared"
      sessionId="8798"
      projectId={-1}
      project={
        {
          projectId: '-1',
          projectName: '默认项目',
          sessions: [{ sessionId: '8798', sessionName: '' }],
        } as any
      }
      runtimeType="dsh"
      resourceId="42"
      onOpenDetail={jest.fn()}
    />
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(panel());
  });
  expect(mockExpandAction).toBe(false);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Open 过程文件' }));
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  const sessionPathCalls = () =>
    jest.mocked(listFiles).mock.calls.filter(([request]) => request.path === '/by/.sessions/8798/');
  expect(sessionPathCalls()).toHaveLength(1);

  mockSessions = [{ sessionId: '8798', sessionName: '你好' }];
  await act(async () => {
    view.rerender(panel());
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(sessionPathCalls()).toHaveLength(1);
});

it('does not ensure or reload the DSH project root when only live session names update', async () => {
  jest.mocked(listFiles).mockResolvedValue([]);
  const panel = () => (
    <FileResourcePanel
      scope="shared"
      sessionId="8798"
      projectId={-1}
      project={
        {
          projectId: '-1',
          projectName: '默认项目',
          sessions: [{ sessionId: '8798', sessionName: '' }],
        } as any
      }
      runtimeType="dsh"
      resourceId="42"
      onOpenDetail={jest.fn()}
    />
  );
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(panel());
  });
  expect(ensureFolder).not.toHaveBeenCalled();
  expect(listFiles).toHaveBeenCalledTimes(1);

  mockSessions = [{ sessionId: '8798', sessionName: '你好' }];
  await act(async () => {
    view.rerender(panel());
  });

  expect(ensureFolder).not.toHaveBeenCalled();
  expect(listFiles).toHaveBeenCalledTimes(1);
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

it('quotes from the shared panel through the menu callback', async () => {
  const onQuote = jest.fn();
  jest.mocked(listFiles).mockResolvedValue([{ name: 'report.md', path: '/by/.shared/project_12/report.md' }]);
  await act(async () => {
    render(
      <FileResourcePanel
        scope="shared"
        sessionId="7"
        projectId={12}
        runtimeType="dsh"
        resourceId="42"
        onOpenDetail={jest.fn()}
        onQuote={onQuote}
      />
    );
  });
  fireEvent.click(screen.getByRole('button', { name: 'Quote report.md' }));
  expect(onQuote).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'report.md', path: '/by/.shared/project_12/report.md', resourceId: '42' }),
    expect.anything()
  );
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
    const [resourceId, directoryPath] = jest.mocked(uploadFiles).mock.calls[0];
    return { resourceId, directoryPath, files: jest.mocked(uploadFiles).mock.calls.flatMap((call) => call[2]) };
  }
  const [formData] = jest.mocked(uploadKnowledgeFiles).mock.calls[0];
  return {
    resourceId: formData.get('resourceId'),
    directoryPath: formData.get('directoryPath'),
    files: jest.mocked(uploadKnowledgeFiles).mock.calls.flatMap(([form]) => form.getAll('files')),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSessions = [];
  mockExpandAction = undefined;
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

it.each([
  ['project', 390, 'Open'],
  ['project', 1440, 'Preview'],
  ['shared', 390, 'Open'],
  ['shared', 1440, 'Preview'],
] as const)('%s 在 %i 像素视口下通过 %s 将超过 2 MiB 的 HTML 交给附件页签', async (scope, width, action) => {
  const originalWidth = window.innerWidth;
  const onOpenDetail = jest.fn();
  const resourceId = scope === 'project' ? '42' : '43';
  const sessionRoot = '/by/.sessions/7';
  const isProcessFile = scope === 'shared' && action === 'Preview';
  const sharedRoot = isProcessFile ? sessionRoot : '/by/.shared';
  const directory = scope === 'project' ? '/reports' : `${sharedRoot}/reports`;
  const path = `${directory}/report.html`;
  const file = new Blob([new Uint8Array(3_100_000)], { type: 'text/html' });
  const items = [{ path, name: 'report.html', size: file.size, isDir: false }];
  jest.mocked(queryProjectCloudDrive).mockResolvedValue(items);
  jest.mocked(listFiles).mockResolvedValue(items);
  jest.mocked(downloadResourceFile).mockResolvedValue({ fileName: 'report.html', file });
  jest.mocked(downloadFile).mockResolvedValue({ fileName: 'report.html', file });

  function ResourcePreview() {
    const onPreviewFile = useResourceAttachmentPreview(scope, resourceId, onOpenDetail);
    return (
      <FileResourcePanel
        scope={scope}
        sessionId="7"
        resourceId={resourceId}
        onOpenDetail={onOpenDetail}
        canPreviewItem={(item) => !item.isDir}
        onPreviewFile={onPreviewFile}
      />
    );
  }

  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  try {
    render(<ResourcePreview />);
    fireEvent.click(await screen.findByRole('button', { name: `${action} report.html` }));
    await waitFor(() => expect(onOpenDetail).toHaveBeenCalledTimes(1));

    const [panel, options] = onOpenDetail.mock.calls[0];
    expect(options).toEqual({ tabKey: `${scope}-file:${resourceId}:${path}`, title: 'report.html' });
    if (!isValidElement<ComponentProps<typeof MessageFilePreviewPanel>>(panel)) throw new Error('Missing preview panel');
    expect(panel.type).toBe(MessageFilePreviewPanel);
    expect(panel.props.fileType).toBe('html');
    await expect(panel.props.fileItem.downloadRequest?.()).resolves.toEqual({ file, fileName: 'report.html' });
    await panel.props.fileItem.resolvePreviewResource?.('images/chart.svg');
    const imagePath = `${directory}/images/chart.svg`;
    if (scope === 'project') {
      expect(downloadResourceFile).toHaveBeenNthCalledWith(1, { resourceId, directoryPath: path });
      expect(downloadResourceFile).toHaveBeenNthCalledWith(2, { resourceId, directoryPath: imagePath });
      expect(downloadFile).not.toHaveBeenCalled();
    } else {
      expect(downloadFile).toHaveBeenNthCalledWith(1, resourceId, path);
      expect(downloadFile).toHaveBeenNthCalledWith(2, resourceId, imagePath);
      expect(downloadResourceFile).not.toHaveBeenCalled();
    }
    if (isProcessFile) {
      await panel.props.fileItem.resolvePreviewResource?.('../../root.svg');
      expect(downloadFile).toHaveBeenLastCalledWith(resourceId, `${sessionRoot}/root.svg`);
    }
    panel.props.onOpenRelativeFile?.('details.html');
    expect(onOpenDetail).toHaveBeenLastCalledWith(expect.anything(), {
      tabKey: `${scope}-file:${resourceId}:${directory}/details.html`,
      title: 'details.html',
    });
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  }
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

it('refreshes shared project files with one list request and no directory initialization', async () => {
  jest.mocked(listFiles).mockResolvedValue([]);
  const props = {
    scope: 'shared' as const,
    sessionId: '7',
    projectId: 12,
    project: { projectId: 12, projectName: '测试项目' } as any,
    runtimeType: 'dsh' as const,
    resourceId: '42',
    onOpenDetail: jest.fn(),
  };
  const view = render(<FileResourcePanel {...props} refreshKey={1} />);
  await act(async () => {});
  expect(listFiles).toHaveBeenCalledTimes(1);
  expect(ensureFolder).not.toHaveBeenCalled();
  jest.mocked(listFiles).mockClear();
  view.rerender(<FileResourcePanel {...props} refreshKey={2} />);
  await act(async () => {});
  expect(listFiles).toHaveBeenCalledTimes(1);
  expect(listFiles).toHaveBeenCalledWith({ resourceId: '42', path: '/by/.shared/project_12/', language: 'zh-CN' });
  expect(ensureFolder).not.toHaveBeenCalled();
});

it('reports explicit write initialization failures without uploading or treating access failure as an empty directory', async () => {
  jest.mocked(listFiles).mockResolvedValue([]);
  jest.mocked(ensureFolder).mockRejectedValueOnce(new Error('Forbidden'));
  const view = render(<FileResourcePanel scope="shared" sessionId="7" resourceId="42" onOpenDetail={jest.fn()} />);
  await act(async () => {});
  expect(ensureFolder).not.toHaveBeenCalled();
  await chooseFiles(view.container.querySelector('input[type="file"]')!, [createFile('report.pdf', MB)]);
  expect(ensureFolder).toHaveBeenCalledTimes(1);
  expect(uploadFiles).not.toHaveBeenCalled();
  expect(message.error).toHaveBeenCalledWith('Forbidden');
  expect(listFiles).toHaveBeenCalledTimes(1);
});
