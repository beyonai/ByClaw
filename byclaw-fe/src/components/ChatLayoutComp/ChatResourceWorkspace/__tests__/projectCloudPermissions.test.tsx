import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal, message } from 'antd';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import {
  createFolder,
  deleteFolder,
  removeFile,
  renameFolder,
  renameKnowledgeFile,
  uploadFiles,
} from '@/service/knowledgeCenter';
import FileResourcePanel from '../FileResourcePanel';

jest.mock('@umijs/max', () => {
  const intl = { locale: 'zh-CN', formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl, getLocale: () => 'zh-CN' };
});
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: { emit: jest.fn() } }));
jest.mock('../useChatResourceProject', () => ({ useChatResourceProject: () => ({}) }));
jest.mock('@/pages/projectSpace/hooks/useInfiniteScroll', () => ({ useInfiniteScroll: () => null }));
jest.mock('@/components/ProjectCloudDrive', () => ({ queryProjectCloudDrive: jest.fn() }));
jest.mock('@/components/QueryInput/withDrag', () => ({ DragType: {} }));
jest.mock('@/service/devloop', () => ({}));
jest.mock('@/service/fileBrowser', () => ({}));
jest.mock('@/service/file', () => ({}));
jest.mock('@/utils/file', () => ({}));
jest.mock('../FilePreviewPanel', () => () => null);
jest.mock('@/layout/sider/components/FileSiderPanel/components/FileTreeList', () => ({
  FilePathTooltip: () => null,
}));
jest.mock('@/service/knowledgeCenter', () => ({
  createFolder: jest.fn(),
  renameFolder: jest.fn(),
  deleteFolder: jest.fn(),
  removeFile: jest.fn(),
  renameKnowledgeFile: jest.fn(),
  uploadFiles: jest.fn(),
}));
// 保留面板真实菜单与动作处理，只将树和输入弹窗替换为可交互的轻量视图。
jest.mock('@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock', () => (props: any) => (
  <div>
    {props.contentBefore}
    {props.items.map((item: any) => (
      <div key={item.path}>
        {props.getActionItems(item).map((action: any) => (
          <button key={action.key} disabled={action.disabled} onClick={() => props.onAction(action.key, item)}>
            {item.name}:{action.key}
          </button>
        ))}
      </div>
    ))}
  </div>
));
jest.mock(
  '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal',
  () => (props: any) => props.open ? <button onClick={() => props.onOk('new.md')}>confirm rename</button> : null
);
jest.mock(
  '@/layout/sider/components/FileSiderPanel/components/CreateFolderModal',
  () => (props: any) =>
    props.open ? (
      <div>
        <input aria-label="folder name" value={props.value} onChange={(event) => props.onChange(event.target.value)} />
        <button onClick={props.onOk}>confirm folder</button>
      </div>
    ) : null
);

const items = [
  {
    name: 'old.md',
    path: '/reports/old.md',
    isDir: false,
    createBy: 999,
    createStaffName: 'another user',
    canManageItem: true,
  },
  {
    name: 'reports',
    path: '/reports/',
    isDir: true,
    createBy: 999,
    createStaffName: 'another user',
    canManageItem: true,
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(queryProjectCloudDrive).mockResolvedValue(items as any);
  jest.mocked(renameKnowledgeFile).mockResolvedValue({ data: [], summary: { total: 1, succeeded: 1, failed: 0 } });
  jest.spyOn(message, 'success').mockImplementation(jest.fn());
  jest.spyOn(message, 'error').mockImplementation(jest.fn());
  jest.spyOn(Modal, 'confirm').mockImplementation((options) => {
    void options.onOk?.();
    return { destroy: jest.fn(), update: jest.fn() };
  });
});

afterEach(() => jest.restoreAllMocks());

const openPanel = async () => {
  render(<FileResourcePanel scope="project" sessionId="s1" projectId={42} resourceId="100" onOpenDetail={jest.fn()} />);
  await screen.findByRole('button', { name: 'old.md:rename' });
};

it('allows the project creator or adminvip to delete files and folders created by other users', async () => {
  await openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'old.md:delete' }));
  await waitFor(() => expect(removeFile).toHaveBeenCalledWith({ resourceId: '100', directoryPath: '/reports/old.md' }));
  fireEvent.click(screen.getByRole('button', { name: 'reports:delete' }));
  await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith({ resourceId: 100, directoryPath: '/reports/' }));
});

it('renames a file without fileId using its resource and full path', async () => {
  await openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'old.md:rename' }));
  fireEvent.click(screen.getByRole('button', { name: 'confirm rename' }));
  await waitFor(() =>
    expect(renameKnowledgeFile).toHaveBeenCalledWith({
      resourceId: 100,
      filePath: '/reports/old.md',
      fileName: 'new.md',
    })
  );
});

it('keeps the rename dialog open when the knowledge service reports an item failure', async () => {
  jest.mocked(renameKnowledgeFile).mockResolvedValue({
    data: [{ sourcePath: '/reports/old.md', targetPath: null, success: false, error: 'already exists' }],
    summary: { total: 1, succeeded: 0, failed: 1 },
  });
  await openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'old.md:rename' }));
  fireEvent.click(screen.getByRole('button', { name: 'confirm rename' }));
  await waitFor(() => expect(message.error).toHaveBeenCalledWith('already exists'));
  expect(screen.getByRole('button', { name: 'confirm rename' })).toBeInTheDocument();
  expect(message.success).not.toHaveBeenCalled();
});

it('allows a readable member to rename and create folders', async () => {
  await openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'reports:rename' }));
  fireEvent.click(screen.getByRole('button', { name: 'confirm rename' }));
  await waitFor(() =>
    expect(renameFolder).toHaveBeenCalledWith({
      resourceId: 100,
      directoryPath: '/reports/',
      directoryName: 'new.md',
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'fileBrowser.toolbar.newFolder' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'folder name' }), { target: { value: 'created' } });
  fireEvent.click(screen.getByRole('button', { name: 'confirm folder' }));
  await waitFor(() =>
    expect(createFolder).toHaveBeenCalledWith(
      {
        resourceId: 100,
        directoryPath: '/',
        directoryName: 'created',
        directoryDescription: '',
      },
      { responseCfg: { hideErrorTips: true } }
    )
  );
});

it('allows a readable member to upload files to the project cloud drive', async () => {
  await openPanel();
  const file = new File(['hello'], 'new.md', { type: 'text/markdown' });
  const input = document.querySelector('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files: [file] } });
  await waitFor(() => expect(uploadFiles).toHaveBeenCalled());
  const form = jest.mocked(uploadFiles).mock.calls[0][0];
  expect(form.get('resourceId')).toBe('100');
  expect(form.get('directoryPath')).toBe('/');
  expect((form.get('files') as File).name).toBe('new.md');
});

it('disables rename and delete for another member while keeping upload and folder creation available', async () => {
  jest
    .mocked(queryProjectCloudDrive)
    .mockResolvedValue(items.map((item) => ({ ...item, canManageItem: false })) as any);
  await openPanel();
  for (const name of ['old.md', 'reports']) {
    for (const action of ['rename', 'delete', 'move']) {
      const button = screen.getByRole('button', { name: `${name}:${action}` });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
  }
  expect(Modal.confirm).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'confirm rename' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'fileBrowser.toolbar.upload' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'fileBrowser.toolbar.newFolder' })).toBeEnabled();
});
