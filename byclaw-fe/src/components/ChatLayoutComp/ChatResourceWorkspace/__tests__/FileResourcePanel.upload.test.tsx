import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { message } from 'antd';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';
import { listFiles, uploadFiles, type FileBrowserItem } from '@/service/fileBrowser';
import { uploadFiles as uploadKnowledgeFiles } from '@/service/knowledgeCenter';
import { getLocaleIntl } from '@/testUtils/localeIntl';
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
jest.mock('@/service/fileBrowser', () => ({ listFiles: jest.fn(), uploadFiles: jest.fn() }));
jest.mock('@/service/knowledgeCenter', () => ({ uploadFiles: jest.fn() }));
jest.mock('@/service/devloop', () => ({ listProjectRepos: jest.fn() }));
jest.mock('@/service/file', () => ({ downloadResourceFile: jest.fn() }));
jest.mock('@/utils/file', () => ({ downloadFile: jest.fn() }));
jest.mock('@/components/ProjectCloudDrive', () => ({ queryProjectCloudDrive: jest.fn() }));
jest.mock('@/components/QueryInput/withDrag', () => ({ DragType: {} }));
jest.mock('../useChatResourceProject', () => ({ useChatResourceProject: () => ({}) }));
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
  }: {
    contentBefore: ReactNode;
    items: FileBrowserItem[];
    loading: boolean;
    onAction: (action: string, item: FileBrowserItem) => void;
  }) {
    return (
      <section aria-label="File space" aria-busy={loading}>
        {contentBefore}
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

async function renderPanel(scope: 'shared' | 'project') {
  // 列表请求已 mock 为立即完成，显式等待 React 提交状态，避免轮询与渲染竞争。
  await act(async () => {
    render(<FileResourcePanel scope={scope} sessionId="7" resourceId="42" onOpenDetail={jest.fn()} />);
  });
  const region = screen.getByRole('region', { name: 'File space' });
  expect(region).toHaveAttribute('aria-busy', 'false');
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
