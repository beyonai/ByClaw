import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { listFiles } from '@/service/fileBrowser';
import { ResourceType } from '../../../RichInput/utils/constants';
import FilePicker from '../FilePicker';

let mockResourceId: string | undefined = 'employee-resource';
jest.mock('@/layout/sider/components/ActiveSiderAgentBar', () => ({
  useActiveSiderAgent: () => ({ resourceId: mockResourceId }),
}));
jest.mock('@/service/fileBrowser', () => ({ listFiles: jest.fn() }));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const sharedRootPath = '/by/.shared/';
const folder = { name: '资料', path: `${sharedRootPath}资料/`, isDir: true };
const nestedFolder = { name: '产品', path: `${sharedRootPath}资料/产品/`, isDir: true };
const file = { name: '需求.md', path: `${sharedRootPath}资料/产品/需求.md`, isDir: false };

const expand = (name: string) => {
  const row = screen.getByText(name).closest('.ant-tree-treenode')!;
  fireEvent.click(row.querySelector('.ant-tree-switcher')!);
};

const openQuoteMenu = async (row: HTMLElement) => {
  fireEvent.mouseEnter(row.querySelector('.treeActionTrigger')!);
  return screen.findByText('common.quote');
};

describe('chat resource file picker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResourceId = 'employee-resource';
    (listFiles as jest.Mock).mockImplementation(({ path }) =>
      Promise.resolve({
        data: path === sharedRootPath ? [folder] : path === folder.path ? [nestedFolder] : [file],
      })
    );
  });

  it('loads the resource center root and quotes folders and deeply nested files', async () => {
    const onSelect = jest.fn();
    render(<FilePicker onSelect={onSelect} />);
    await screen.findByText(folder.name);
    expect(screen.queryByText('chatResource.localSharedFile')).toBeNull();
    expect(screen.queryByRole('button', { name: 'refresh' })).toBeNull();
    expect(listFiles).toHaveBeenCalledWith({ resourceId: 'employee-resource', path: sharedRootPath });
    const folderRow = screen.getByText(folder.name).closest('.ant-tree-treenode') as HTMLElement;
    fireEvent.click(await openQuoteMenu(folderRow));
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: folder.path,
        collectionName: folder.name,
        resourceId: 'employee-resource',
        type: 'directory',
      }),
      ResourceType.commonFolder
    );
    expand(folder.name);
    await screen.findByText(nestedFolder.name);
    expand(nestedFolder.name);
    await screen.findByText(file.name);
    // rc-tree 将双击处理绑定在节点内容上，外层行不是事件触发入口。
    fireEvent.doubleClick(screen.getByText(file.name));
    expect(listFiles).toHaveBeenCalledWith({ resourceId: 'employee-resource', path: nestedFolder.path });
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: file.path,
        collectionName: file.name,
        resourceId: 'employee-resource',
        type: 'file',
      }),
      ResourceType.commonFile
    );
  });

  it('ignores stale requests after the resource center employee changes', async () => {
    let resolveOld: (value: any) => void = () => undefined;
    (listFiles as jest.Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    const { rerender } = render(<FilePicker onSelect={jest.fn()} />);
    mockResourceId = 'another-employee';
    rerender(<FilePicker onSelect={jest.fn()} />);
    await screen.findByText(folder.name);
    await act(async () => resolveOld({ data: [{ name: 'old.txt', path: '/old.txt', isDir: false }] }));
    expect(screen.queryByText('old.txt')).toBeNull();
    expect(listFiles).toHaveBeenLastCalledWith({ resourceId: 'another-employee', path: sharedRootPath });
  });

  it('shows a failed root request without restoring the removed header', async () => {
    (listFiles as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    render(<FilePicker onSelect={jest.fn()} />);
    await screen.findByText('fileBrowser.error.loadFailed');
    expect(screen.queryByRole('button', { name: 'refresh' })).toBeNull();
    expect(screen.queryByText('chatResource.localSharedFile')).toBeNull();
  });

  it('reloads previously expanded folders after switching employees', async () => {
    const { rerender } = render(<FilePicker onSelect={jest.fn()} />);
    await screen.findByText(folder.name);
    expand(folder.name);
    await screen.findByText(nestedFolder.name);
    mockResourceId = 'another-employee';
    rerender(<FilePicker onSelect={jest.fn()} />);
    await waitFor(() => expect(screen.queryByText(nestedFolder.name)).toBeNull());
    await screen.findByText(folder.name);
    expand(folder.name);
    await screen.findByText(nestedFolder.name);
    expect((listFiles as jest.Mock).mock.calls.filter(([params]) => params.path === folder.path)).toHaveLength(2);
  });

  it('does not request files without a resource center employee', async () => {
    mockResourceId = undefined;
    render(<FilePicker onSelect={jest.fn()} />);
    await waitFor(() => expect(screen.getByText('common.noData')).toBeTruthy());
    expect(listFiles).not.toHaveBeenCalled();
  });
});
