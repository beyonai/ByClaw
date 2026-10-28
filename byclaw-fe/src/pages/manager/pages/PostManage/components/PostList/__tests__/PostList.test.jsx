import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { message, Modal } from 'antd';
import zh from '@/locales/zh-CN/manager';
import en from '@/locales/en-US/manager';
import { addPositionUsers, getUsersByOrgId, removePositionUsers } from '@/pages/manager/service/OrgCenter';
import PostList from '..';

jest.setTimeout(15000);

let mockLocale = 'zh';
const mockIntl = {
  formatMessage: ({ id }, values = {}) => {
    const text = (mockLocale === 'en' ? en : zh)[id] || id;
    return text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
  },
};
const mockDispatch = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  useDispatch: () => mockDispatch,
  useSelector: () => false,
}));
jest.mock('@/pages/manager/service/OrgCenter', () => ({
  addPositionUsers: jest.fn(),
  removePositionUsers: jest.fn(),
  getUsersByOrgId: jest.fn(),
}));
jest.mock('@/pages/manager/components/Ellipsis', () => ({ children }) => <span>{children}</span>);
jest.mock('@/pages/manager/components/ausong/Layout', () => ({ children, right }) => (
  <div>
    {children}
    {right}
  </div>
));
jest.mock('@/pages/manager/components/AntdIcon', () => ({ onClick }) => <span onClick={onClick} />);
jest.mock('@/pages/manager/components/KnowledgeBaseAuthor', () => () => null);
jest.mock('@/pages/manager/components/DigitalEmployeeAuthor', () => () => null);
jest.mock('../../PostResource', () => () => <div>resource-panel</div>);

const members = [
  { userId: 7, userName: '张三', userTypes: 'ORD_USER', pathName: '研发部' },
  { userId: 8, userName: '李四', userTypes: 'ORD_USER', pathName: '研发部' },
];
let mockMembersPage;
let confirmSpy;

beforeEach(() => {
  jest.clearAllMocks();
  mockLocale = 'zh';
  mockMembersPage = () => ({ rows: members, total: 2, pageNum: 1, pageSize: 10 });
  mockDispatch.mockImplementation((action) => {
    if (action.type === 'postManage/getPostMemberList') action.success({ data: mockMembersPage(action.payload) });
    return Promise.resolve({ data: [] });
  });
  addPositionUsers.mockResolvedValue(undefined);
  removePositionUsers.mockResolvedValue(undefined);
  getUsersByOrgId.mockResolvedValue({ rows: [{ userId: 9, userName: '王五', userCode: 'user9' }], total: 1 });
  confirmSpy = jest.spyOn(Modal, 'confirm').mockReturnValue({ destroy: jest.fn() });
  jest.spyOn(message, 'success').mockImplementation(() => {});
  jest.spyOn(message, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const selectMember = (name) => {
  fireEvent.click(within(screen.getByRole('row', { name: new RegExp(name) })).getByRole('checkbox'));
};

const openBatchMenu = async () => {
  fireEvent.click(screen.getByRole('button', { name: /批量操作|Batch Actions/ }));
  return screen.findByRole('menu');
};

test('adds selected users to the current position and refreshes members', async () => {
  getUsersByOrgId.mockImplementation(({ pageNum }) =>
    Promise.resolve({
      rows: [{ userId: pageNum === 2 ? 10 : 9, userName: pageNum === 2 ? '赵六' : '王五', userCode: 'user' }],
      total: 11,
    })
  );
  render(<PostList selectedPost={10} record={{}} />);
  const menu = await openBatchMenu();
  fireEvent.click(within(menu).getByText('批量添加用户'));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('王五');
  fireEvent.click(within(within(dialog).getByRole('row', { name: /王五/ })).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByTitle('2'));
  await within(dialog).findByText('赵六');
  fireEvent.click(within(within(dialog).getByRole('row', { name: /赵六/ })).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: '确 定' }));
  await waitFor(() => expect(addPositionUsers).toHaveBeenCalledWith({ positionId: 10, userIds: [9, 10] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mockDispatch.mock.calls.filter(([action]) => action.type === 'postManage/getPostMemberList')).toHaveLength(2);
});

test('does not enable bulk removal until users are selected', async () => {
  render(<PostList selectedPost={10} record={{}} />);
  const menu = await openBatchMenu();
  expect(within(menu).getByRole('menuitem', { name: '批量移除用户' })).toHaveAttribute('aria-disabled', 'true');
  expect(removePositionUsers).not.toHaveBeenCalled();
});

test('removes only the row user after confirmation', async () => {
  render(<PostList selectedPost={10} record={{}} />);
  fireEvent.click(within(screen.getByRole('row', { name: /张三/ })).getByRole('button', { name: '删除' }));
  expect(removePositionUsers).not.toHaveBeenCalled();
  const confirmation = confirmSpy.mock.calls[0][0];
  expect(confirmation.content).toContain('1 个用户');
  await act(async () => confirmation.onOk());
  expect(removePositionUsers).toHaveBeenCalledWith({ positionId: 10, userIds: [7] });
});

test('keeps selected users across pages for bulk removal', async () => {
  mockMembersPage = ({ pageNum }) => ({
    rows: pageNum === 2 ? [members[1]] : [members[0]],
    total: 11,
    pageNum,
    pageSize: 10,
  });
  render(<PostList selectedPost={10} record={{}} />);
  selectMember('张三');
  fireEvent.click(screen.getByTitle('2'));
  await screen.findByText('李四');
  selectMember('李四');
  const menu = await openBatchMenu();
  fireEvent.click(within(menu).getByText('批量移除用户'));
  await act(async () => confirmSpy.mock.calls[0][0].onOk());
  expect(removePositionUsers).toHaveBeenCalledWith({ positionId: 10, userIds: [7, 8] });
  expect(screen.getByText('已选中 0 个用户')).toBeInTheDocument();
});

test('returns to the previous page when the last member on the last page is removed', async () => {
  mockMembersPage = ({ pageNum }) => ({ rows: [members[0]], total: 11, pageNum, pageSize: 10 });
  render(<PostList selectedPost={10} record={{}} />);
  fireEvent.click(screen.getByTitle('2'));
  fireEvent.click(within(screen.getByRole('row', { name: /张三/ })).getByRole('button', { name: '删除' }));
  await act(async () => confirmSpy.mock.calls[0][0].onOk());
  const calls = mockDispatch.mock.calls.filter(([action]) => action.type === 'postManage/getPostMemberList');
  expect(calls.at(-1)[0].payload.pageNum).toBe(1);
});

test('resets selection and ignores an old confirmation after switching positions', async () => {
  const view = render(<PostList selectedPost={10} record={{}} />);
  selectMember('张三');
  fireEvent.click(within(screen.getByRole('row', { name: /张三/ })).getByRole('button', { name: '删除' }));
  view.rerender(<PostList selectedPost={11} record={{}} />);
  expect(screen.getByText('已选中 0 个用户')).toBeInTheDocument();
  await act(async () => confirmSpy.mock.calls[0][0].onOk());
  expect(removePositionUsers).not.toHaveBeenCalled();
});

test('keeps the add dialog and selection when the server rejects the change', async () => {
  addPositionUsers.mockRejectedValue(new Error('request failed'));
  render(<PostList selectedPost={10} record={{}} />);
  const menu = await openBatchMenu();
  fireEvent.click(within(menu).getByText('批量添加用户'));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('王五');
  fireEvent.click(within(within(dialog).getByRole('row', { name: /王五/ })).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: '确 定' }));
  await waitFor(() => expect(message.error).toHaveBeenCalledWith('request failed'));
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByText('已选中 1 个用户')).toBeInTheDocument();
  expect(message.success).not.toHaveBeenCalled();
});

test('uses English button and confirmation labels and hides member actions on resource tabs', async () => {
  mockLocale = 'en';
  render(<PostList selectedPost={10} record={{}} />);
  expect(screen.getByRole('button', { name: /Batch Actions/ })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('row', { name: /张三/ })).getByRole('button', { name: 'Delete' }));
  expect(confirmSpy.mock.calls[0][0]).toMatchObject({
    title: 'Delete Position Membership',
    okText: 'Delete',
    cancelText: 'Cancel',
  });
  const menu = await openBatchMenu();
  expect(within(menu).getByText('Add Users in Bulk')).toBeInTheDocument();
  expect(within(menu).getByText('Remove Users in Bulk')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: en['orgMgr.tabs.employee'] }));
  expect(screen.queryByRole('button', { name: /Batch Actions/ })).not.toBeInTheDocument();
});
