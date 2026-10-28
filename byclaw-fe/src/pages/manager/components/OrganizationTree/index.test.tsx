import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import OrganizationTree from '.';

const mockDispatch = jest.fn();
jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => require('@/locales/zh-CN/manager').default[id] || id }),
}));
jest.mock('@/pages/manager/components/AntdIcon', () => () => null);

const org = { orgId: 10, parentOrgId: -1, orgName: '研发部' };
const props = () => ({
  treeData: [org],
  selectedOrg: org,
  setSelectedOrg: jest.fn(),
  onSelect: jest.fn(),
  canEdit: true,
  setVisible: jest.fn(),
  setType: jest.fn(),
  setInfo: jest.fn(),
  getTree: jest.fn(),
  setTreeData: jest.fn(),
  setSearchValue: jest.fn(),
  onChange: jest.fn(),
});

beforeEach(() => jest.clearAllMocks());

it('opens the edit form from the tree menu after loading complete organization details', async () => {
  const handlers = props();
  const record = { ...org, orgCode: 'dev', orgDesc: '说明', administratorIds: ['8'] };
  mockDispatch.mockImplementation((action) => action.success({ data: record }));
  render(<OrganizationTree {...handlers} />);
  fireEvent.click(screen.getByRole('button', { name: '组织操作' }));
  fireEvent.click(await screen.findByText('编辑组织'));
  expect(mockDispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'orgMgr/searchOrg', payload: { orgId: 10 } })
  );
  expect(handlers.setInfo).toHaveBeenCalledWith(record);
  expect(handlers.setType).toHaveBeenCalledWith('edit');
  expect(handlers.setVisible).toHaveBeenCalledWith(true);
});

it('does not open an incomplete edit form when loading the organization fails', async () => {
  const handlers = props();
  mockDispatch.mockImplementation((action) => action.fail({ msg: '组织查询失败' }));
  render(<OrganizationTree {...handlers} />);
  fireEvent.click(screen.getByRole('button', { name: '组织操作' }));
  fireEvent.click(await screen.findByText('编辑组织'));
  await waitFor(() => expect(handlers.setVisible).not.toHaveBeenCalled());
  expect(handlers.setInfo).not.toHaveBeenCalled();
});

it('updates menu visibility when edit permission changes without changing the selected organization', () => {
  const handlers = props();
  const { rerender } = render(<OrganizationTree {...handlers} canEdit={false} />);
  expect(screen.queryByRole('button', { name: '组织操作' })).not.toBeInTheDocument();
  rerender(<OrganizationTree {...handlers} canEdit />);
  expect(screen.getByRole('button', { name: '组织操作' })).toBeInTheDocument();
  rerender(<OrganizationTree {...handlers} canEdit={false} />);
  expect(screen.queryByRole('button', { name: '组织操作' })).not.toBeInTheDocument();
});
