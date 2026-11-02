import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ensureFolder, listFiles, uploadFiles } from '@/service/fileBrowser';
import { uploadFiles as uploadKnowledgeFiles } from '@/service/knowledgeCenter';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import { getLocaleIntl } from '@/testUtils/localeIntl';
import FileResourcePanel from '../FileResourcePanel';

const mockIntl = getLocaleIntl();
const mockUser = { userCode: 'user-a', userId: '1', enterpriseId: '1' };
jest.mock('@umijs/max', () => ({
  getLocale: () => 'zh-CN',
  useIntl: () => mockIntl,
  useSelector: (selector: any) => selector({ user: { userInfo: mockUser } }),
}));
jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ uploadFileConfig: { maxFileSize: 512, maxFileCount: 5 }, EventEmitter: { emit: jest.fn() } }),
}));
jest.mock('@/service/fileBrowser', () => ({ ensureFolder: jest.fn(), listFiles: jest.fn(), uploadFiles: jest.fn() }));
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
jest.mock('../PersonalKnowledgeSaveDialogs', () => ({ __esModule: true, default: () => null }));
jest.mock('@/layout/sider/components/FileSiderPanel/components/CreateFolderModal', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal', () => ({
  __esModule: true,
  default: () => null,
}));

type Attempt = {
  resource: string;
  path: string;
  file: File;
  report: (event: any) => void;
  resolve: (result?: any) => void;
  reject: (error: Error) => void;
  options: any;
};
let attempts: Attempt[];

beforeEach(() => {
  jest.clearAllMocks();
  attempts = [];
  mockUser.enterpriseId = '1';
  jest.mocked(ensureFolder).mockResolvedValue(undefined);
  jest.mocked(listFiles).mockResolvedValue([{ name: 'reports', path: '/by/.shared/project_-1/reports/', isDir: true }]);
  jest
    .mocked(queryProjectCloudDrive)
    .mockResolvedValue([{ name: 'cloud-folder', path: '/cloud-folder/', isDir: true }]);
  jest.mocked(uploadFiles).mockImplementation(
    (resource, path, files, report, _response, options) =>
      new Promise((resolve, reject) => {
        attempts.push({ resource: String(resource), path, file: files[0], report: report!, resolve, reject, options });
      })
  );
  jest.mocked(uploadKnowledgeFiles).mockImplementation(
    (form, options) =>
      new Promise((resolve, reject) => {
        attempts.push({
          resource: String(form.get('resourceId')),
          path: String(form.get('directoryPath')),
          file: form.get('files') as File,
          report: options!.onUploadProgress!,
          resolve,
          reject,
          options,
        });
      })
  );
});

function panel(sessionId = 'chat-a', scope: 'shared' | 'project' = 'shared', resourceId = '42') {
  return (
    <FileResourcePanel
      scope={scope}
      sessionId={sessionId}
      projectId={-1}
      runtimeType="dsh"
      resourceId={resourceId}
      onOpenDetail={jest.fn()}
    />
  );
}

async function selectFiles(container: HTMLElement, names = ['a.txt', 'b.txt']) {
  const input = container.querySelector('input[type="file"]')!;
  const files = names.map((name) => {
    const file = new File(['payload'], name);
    Object.defineProperty(file, 'size', { value: 9 * 1024 * 1024 });
    return file;
  });
  await act(async () => fireEvent.change(input, { target: { files } }));
}

it('renders the real shared project tree toolbar and isolates each file progress, failure and retry', async () => {
  const { container } = render(panel());
  await screen.findAllByRole('treeitem');
  expect(screen.getByRole('button', { name: '上传' })).toBeInTheDocument();
  expect(ensureFolder).not.toHaveBeenCalled();
  await selectFiles(container);
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts.map(({ file }) => file.name)).toEqual(['a.txt', 'b.txt']);
  expect(attempts[0]).toMatchObject({
    resource: '42',
    path: '/by/.shared/project_-1/',
    options: { ownerKey: 'user-a' },
  });
  act(() => {
    attempts[0].report({ loaded: 2, total: 8, phase: 'uploading' });
    attempts[1].report({ loaded: 6, total: 8, phase: 'uploading' });
  });
  const a = screen.getByRole('group', { name: 'a.txt' });
  const b = screen.getByRole('group', { name: 'b.txt' });
  expect(within(a).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  expect(within(b).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75');
  await act(async () => {
    attempts[0].reject(new Error('a offline'));
    attempts[1].resolve();
  });
  expect(within(a).getByText('a offline')).toBeInTheDocument();
  expect(within(b).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  fireEvent.click(within(a).getByRole('button', { name: '重试此文件' }));
  await waitFor(() => expect(attempts).toHaveLength(3));
  expect(attempts[2]).toMatchObject({ resource: '42', path: '/by/.shared/project_-1/' });
  expect(attempts[2].file).toBe(attempts[0].file);
  await act(async () => attempts[2].resolve());
  expect(within(a).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
});

it('hides old progress and rejects stale continuation after a same-resource chat/category switch', async () => {
  const { container, rerender } = render(panel());
  await screen.findAllByRole('treeitem');
  await selectFiles(container, ['old.txt']);
  await waitFor(() => expect(attempts).toHaveLength(1));
  rerender(panel('chat-b'));
  expect(screen.queryByRole('group', { name: 'old.txt' })).not.toBeInTheDocument();
  await screen.findAllByRole('treeitem');
  const calls = jest.mocked(listFiles).mock.calls.length;
  act(() => attempts[0].report({ loaded: 8, total: 8 }));
  await act(async () => attempts[0].resolve());
  expect(jest.mocked(listFiles).mock.calls).toHaveLength(calls);
  expect(() => attempts[0].options.checkContext()).toThrow();
  await selectFiles(container, ['next.txt']);
  await waitFor(() => expect(attempts).toHaveLength(2));
  await act(async () => attempts[1].reject(new Error('offline')));
  expect(screen.getByRole('button', { name: '重试此文件' })).toBeInTheDocument();
  rerender(panel('chat-b', 'project'));
  await screen.findAllByRole('treeitem');
  expect(screen.queryByRole('button', { name: '重试此文件' })).not.toBeInTheDocument();
});

it('keeps project knowledge uploads on their original API with independent failure and retry', async () => {
  const { container } = render(panel('chat-a', 'project', 'cloud-42'));
  await screen.findAllByRole('treeitem');
  await selectFiles(container);
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(uploadFiles).not.toHaveBeenCalled();
  expect(attempts.map(({ resource, path }) => ({ resource, path }))).toEqual([
    { resource: 'cloud-42', path: '/' },
    { resource: 'cloud-42', path: '/' },
  ]);
  act(() => attempts[0].report({ loaded: 2, total: 8 }));
  const a = screen.getByRole('group', { name: 'a.txt' });
  await act(async () => {
    attempts[0].resolve({ summary: { failed: 1 }, failedItems: [{ error: 'knowledge rejected' }] });
    attempts[1].resolve({ summary: { failed: 0 } });
  });
  expect(within(a).getByText('knowledge rejected')).toBeInTheDocument();
  fireEvent.click(within(a).getByRole('button', { name: '重试此文件' }));
  await waitFor(() => expect(attempts).toHaveLength(3));
  expect(attempts[2]).toMatchObject({ resource: 'cloud-42', path: '/' });
  await act(async () => attempts[2].resolve({ summary: { failed: 0 } }));
});

it('captures the original directory and rejects its retry after navigating the actual tree', async () => {
  const { container } = render(panel());
  await screen.findAllByRole('treeitem');
  await selectFiles(container, ['original.txt']);
  await waitFor(() => expect(attempts).toHaveLength(1));
  fireEvent.click(screen.getByText('reports'));
  await waitFor(() =>
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ path: '/by/.shared/project_-1/reports/' }))
  );
  await waitFor(() => expect(screen.queryByRole('group', { name: 'original.txt' })).not.toBeInTheDocument());
  expect(attempts[0].path).toBe('/by/.shared/project_-1/');
  expect(() => attempts[0].options.checkContext()).toThrow();
  await act(async () => attempts[0].reject(new Error('old failure')));
  expect(screen.queryByRole('button', { name: '重试此文件' })).not.toBeInTheDocument();
  await selectFiles(container, ['nested.txt']);
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts[1].path).toBe('/by/.shared/project_-1/reports/');
  await act(async () => attempts[1].resolve());
});

it('does not refresh a new employee with an old completed upload', async () => {
  const { container, rerender } = render(panel());
  await screen.findAllByRole('treeitem');
  await selectFiles(container, ['old-employee.txt']);
  await waitFor(() => expect(attempts).toHaveLength(1));
  rerender(panel('chat-a', 'shared', '43'));
  await waitFor(() => expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ resourceId: '43' })));
  const calls = jest.mocked(listFiles).mock.calls.length;
  await act(async () => attempts[0].resolve());
  expect(jest.mocked(listFiles).mock.calls).toHaveLength(calls);
  expect(screen.queryByRole('group', { name: 'old-employee.txt' })).not.toBeInTheDocument();
  await selectFiles(container, ['new-employee.txt']);
  await waitFor(() => expect(attempts).toHaveLength(2));
  expect(attempts[1].resource).toBe('43');
  await act(async () => attempts[1].resolve());
});

it('replaces a pending listing when tenant identity changes with the same resource and chat', async () => {
  let finishOld: (value: any) => void;
  jest.mocked(listFiles).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  const { container, rerender } = render(panel());
  await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(1));
  mockUser.enterpriseId = '2';
  rerender(panel());
  await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(2));
  await screen.findAllByRole('treeitem');
  await act(async () =>
    finishOld!([{ name: 'old-tenant.txt', path: '/by/.shared/project_-1/old-tenant.txt', isDir: false }])
  );
  expect(screen.queryByText('old-tenant.txt')).not.toBeInTheDocument();
  expect(screen.getByText('reports')).toBeInTheDocument();
  expect(container.querySelector('.ant-spin-spinning')).not.toBeInTheDocument();
});

it.each([
  { scope: 'project' as const, progress: { loaded: 2, total: 8 }, hasResumeHint: false },
  { scope: 'shared' as const, progress: { loaded: 2, total: 8 }, hasResumeHint: false },
  { scope: 'shared' as const, progress: { loaded: 2, total: 8, resumed: false }, hasResumeHint: true },
])(
  'keeps the original failure and shows chunk recovery only for the resumable transport: $scope/$hasResumeHint',
  async ({ scope, progress, hasResumeHint }) => {
    const { container } = render(panel('chat-a', scope));
    await screen.findAllByRole('treeitem');
    await selectFiles(container, ['failed.pdf']);
    await waitFor(() => expect(attempts).toHaveLength(1));
    act(() => attempts[0].report(progress));
    await act(async () => attempts[0].reject(new Error('HTTP 500: Internal Server Error')));
    const row = screen.getByRole('group', { name: 'failed.pdf' });
    expect(within(row).getByText('HTTP 500: Internal Server Error')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: '重试此文件' })).toBeInTheDocument();
    const hint = within(row).queryByText(mockIntl.formatMessage({ id: 'fileBrowser.upload.resumeHint' }));
    if (hasResumeHint) expect(hint).toBeInTheDocument();
    else expect(hint).not.toBeInTheDocument();
  }
);
