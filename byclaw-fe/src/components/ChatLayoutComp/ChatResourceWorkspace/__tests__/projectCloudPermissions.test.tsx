import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Modal, message } from 'antd';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import {
  createFolder,
  deleteFolder,
  moveKnowledgeItems,
  removeFile,
  renameFolder,
  renameKnowledgeFile,
  uploadFiles,
} from '@/service/knowledgeCenter';
import FileResourcePanel from '../FileResourcePanel';

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    // 保留真实树的加载和交互逻辑；关闭动画，避免折叠期间的 listChanging 吞掉下一次点击。
    Tree: (props: import('antd').TreeProps) => <actual.Tree {...props} motion={false} />,
  };
});

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
  moveKnowledgeItems: jest.fn(),
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

// 两个独立动作分别验证，避免共享 5 秒预算，并等待刷新和弹窗关闭完成。
it('allows a readable member to rename a folder', async () => {
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
  await waitFor(() => expect(screen.queryByRole('button', { name: 'confirm rename' })).not.toBeInTheDocument());
});

it('allows a readable member to create a folder', async () => {
  await openPanel();
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
  await waitFor(() => expect(screen.queryByRole('button', { name: 'confirm folder' })).not.toBeInTheDocument());
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

// 使用真实 Ant Tree，覆盖回调节点与 treeData 不是同一对象时的异步下钻行为。
const expandMoveFolder = async (name: string) => {
  const dialog = screen.getByRole('dialog');
  const title = await within(dialog).findByText(name);
  const row = title.closest('.ant-tree-treenode')!;
  fireEvent.click(row.querySelector('.ant-tree-switcher')!);
};

it('expands the move root when directory data arrives after the dialog opens', async () => {
  await openPanel();
  let resolveDirectories!: (value: any) => void;
  jest.mocked(queryProjectCloudDrive).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveDirectories = resolve;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: 'old.md:move' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByText('reports')).not.toBeInTheDocument();

  // 先挂载空树再返回目录，覆盖 defaultExpandParent 过滤尚不存在的根键的场景。
  await act(async () => {
    resolveDirectories(items);
  });
  await waitFor(() => expect(within(dialog).getByText('reports')).toBeVisible());
  const root = within(dialog).getByText('chatResource.rootDirectory').closest('.ant-tree-treenode')!;
  expect(root).toHaveAttribute('aria-expanded', 'true');
  // 修复初始化后仍允许用户主动折叠和展开。
  fireEvent.click(root.querySelector('.ant-tree-switcher')!);
  await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'false'));
  fireEvent.click(root.querySelector('.ant-tree-switcher')!);
  await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'true'));
});

it('loads nested move destinations and submits the selected full directory path', async () => {
  jest.mocked(queryProjectCloudDrive).mockImplementation(async (_resourceId, path) => {
    if (path === '/') return items;
    if (path === '/reports/') {
      return [
        { name: 'monthly', path: '/reports/monthly/', isDir: true },
        { name: 'ignored.txt', path: '/reports/ignored.txt', isDir: false },
      ];
    }
    if (path === '/reports/monthly/') {
      return [{ name: 'archive', path: '/reports/monthly/archive/', isDir: true }];
    }
    return [];
  });
  await openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'old.md:move' }));
  await expandMoveFolder('reports');
  await expandMoveFolder('monthly');
  const dialog = screen.getByRole('dialog');
  fireEvent.click(await within(dialog).findByText('archive'));
  expect(within(dialog).queryByText('ignored.txt')).not.toBeInTheDocument();
  expect(queryProjectCloudDrive).toHaveBeenCalledWith(100, '/reports/', 'zh-CN');
  expect(queryProjectCloudDrive).toHaveBeenCalledWith(100, '/reports/monthly/', 'zh-CN');
  fireEvent.click(within(dialog).getByRole('button', { name: /OK|确.*定/i }));
  await waitFor(() =>
    expect(moveKnowledgeItems).toHaveBeenCalledWith({
      resourceId: 100,
      sourcePath: ['/reports/old.md'],
      targetDirectoryPath: '/reports/monthly/archive/',
    })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('marks an empty move destination as a leaf while keeping it selectable', async () => {
  jest.mocked(queryProjectCloudDrive).mockImplementation(async (_resourceId, path) => (path === '/' ? items : []));
  await openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'old.md:move' }));
  await expandMoveFolder('reports');
  const dialog = screen.getByRole('dialog');
  const title = within(dialog).getByText('reports');
  await waitFor(() =>
    expect(title.closest('.ant-tree-treenode')!.querySelector('.ant-tree-switcher-noop')).not.toBeNull()
  );
  fireEvent.click(title);
  fireEvent.click(within(dialog).getByRole('button', { name: /OK|确.*定/i }));
  await waitFor(() =>
    expect(moveKnowledgeItems).toHaveBeenCalledWith({
      resourceId: 100,
      sourcePath: ['/reports/old.md'],
      targetDirectoryPath: '/reports/',
    })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
