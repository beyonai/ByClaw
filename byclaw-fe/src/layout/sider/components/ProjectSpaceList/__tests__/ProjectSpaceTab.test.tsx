import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { listProjectSpaceTree } from '@/service/devloop';
import { renameFile } from '@/service/fileBrowser';
import ProjectSpaceTab from '../ProjectSpaceTab';

jest.mock('@umijs/max', () => {
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl };
});
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: { emit: jest.fn() } }));
jest.mock('@/components/QueryInput/withDrag', () => ({ DragType: {} }));
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel', () => () => null);
jest.mock('../CodesTab', () => () => null);
jest.mock('@/service/devloop', () => ({ listProjectSpaceTree: jest.fn() }));
jest.mock('@/service/fileBrowser', () => ({ renameFile: jest.fn() }));
jest.mock('@/service/knowledgeCenter', () => ({}));
jest.mock('@/components/ProjectCloudDrive', () => ({ queryProjectCloudDrive: jest.fn() }));

// 保留真实菜单生成逻辑，隔离目录树与文件预览，检查传给公共文件树的菜单内容。
// 同时把 FileSpaceBlock 收到的 getNodeExtra 捕获到测试作用域，用于断言 GitHub 图标的渲染守卫。
let mockGetNodeExtra: ((item: any) => any) | undefined;

jest.mock('@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock', () => (props: any) => {
  mockGetNodeExtra = props.getNodeExtra;
  return (
    <div>
      {props.items.map((item: any) => (
        <div key={item.path} data-testid={item.name}>
          {props.getActionItems(item).map((action: any) => (
            <button
              key={action.key}
              role="menuitem"
              data-danger={action.danger ? 'true' : undefined}
              onClick={() => props.onAction(action.key, item)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
});

it('uses the shared file menu spacing for every project-space action and keeps delete dangerous', async () => {
  jest.mocked(listProjectSpaceTree).mockResolvedValue([
    { name: 'create.png', path: 'create.png', type: 'file' },
    { name: 'reports', path: 'reports', type: 'directory' },
  ] as any);

  render(<ProjectSpaceTab projectId={42} resourceId="100" projectCloudResourceId="200" />);

  const file = within(await screen.findByTestId('create.png'));
  expect(file.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    'common.quote',
    'fileBrowser.action.preview',
    'fileBrowser.action.download',
    'projectSpace.projectDrive.save',
    'fileBrowser.action.rename',
    'fileBrowser.action.delete',
  ]);
  for (const item of screen.getAllByRole('menuitem')) {
    expect(item.firstElementChild).toHaveClass('dropdownMenuItem');
  }
  expect(file.getByText('fileBrowser.action.delete').parentElement).toHaveAttribute('data-danger', 'true');
  const folder = within(screen.getByTestId('reports'));
  expect(folder.queryByText('fileBrowser.action.preview')).not.toBeInTheDocument();
  expect(folder.queryByText('projectSpace.projectDrive.save')).not.toBeInTheDocument();
});

it('renders the GitHub icon only for git repository directories', async () => {
  jest
    .mocked(listProjectSpaceTree)
    .mockResolvedValue([
      { name: 'reports', path: 'reports', type: 'directory', gitRepository: true },
      { name: 'docs', path: 'docs', type: 'directory' },
    ] as any);

  render(<ProjectSpaceTab projectId={42} resourceId="100" projectCloudResourceId="200" />);
  await screen.findByTestId('reports');

  expect(mockGetNodeExtra).toBeDefined();

  const gitNode = mockGetNodeExtra!({
    name: 'reports',
    path: 'reports',
    type: 'directory',
    gitRepository: true,
  } as any);
  expect(gitNode).toBeTruthy();
  const gitView = render(<>{gitNode}</>);
  expect(gitView.getByLabelText('GitHub')).toBeInTheDocument();
  gitView.unmount();

  expect(mockGetNodeExtra!({ name: 'docs', path: 'docs', type: 'directory' } as any)).toBeNull();
  expect(mockGetNodeExtra!({ name: 'create.png', path: 'create.png', type: 'file' } as any)).toBeNull();
});

it('opens the GitHub drawer when the repository icon is clicked', async () => {
  jest
    .mocked(listProjectSpaceTree)
    .mockResolvedValue([
      { name: 'reports', path: 'reports', type: 'directory', gitRepository: true, repoId: 'repo-1' },
    ] as any);

  render(<ProjectSpaceTab projectId={42} resourceId="100" projectCloudResourceId="200" />);
  await screen.findByTestId('reports');

  const node = mockGetNodeExtra!({
    name: 'reports',
    path: 'reports',
    type: 'directory',
    gitRepository: true,
    repoId: 'repo-1',
  } as any);
  const view = render(<>{node}</>);

  // 抽屉未打开时不应出现以目录名为标题的面板。
  expect(screen.queryByText('reports')).not.toBeInTheDocument();

  fireEvent.click(view.getByLabelText('GitHub'));
  view.unmount();

  // 抽屉标题取 gitDrawerItem.name，出现即证明点击链路把节点交给了 setGitDrawerItem。
  expect(await screen.findByText('reports')).toBeInTheDocument();
});

it('enables rename only for a changed nonempty name and guards Enter submission', async () => {
  jest.mocked(renameFile).mockClear();
  jest.mocked(renameFile).mockResolvedValue({} as any);
  jest
    .mocked(listProjectSpaceTree)
    .mockResolvedValue([{ name: 'create.png', path: 'create.png', type: 'file' }] as any);
  render(<ProjectSpaceTab projectId={42} resourceId="100" />);
  fireEvent.click(within(await screen.findByTestId('create.png')).getByText('fileBrowser.action.rename'));

  const dialog = within(await screen.findByRole('dialog'));
  const input = dialog.getByRole('textbox');
  const save = dialog.getByRole('button', { name: 'common.save' });
  expect(input).toHaveValue('create.png');
  expect(save).toBeDisabled();

  fireEvent.change(input, { target: { value: 'renamed.png' } });
  expect(save).toBeEnabled();
  for (const name of ['create.png', ' create.png ', '', '   ']) {
    fireEvent.change(input, { target: { value: name } });
    expect(save).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
    expect(renameFile).not.toHaveBeenCalled();
  }

  fireEvent.change(input, { target: { value: ' renamed.png ' } });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await waitFor(() =>
    expect(renameFile).toHaveBeenCalledWith({
      resourceId: '100',
      sourcePath: '/by/projects/42/create.png',
      newName: 'renamed.png',
    })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
