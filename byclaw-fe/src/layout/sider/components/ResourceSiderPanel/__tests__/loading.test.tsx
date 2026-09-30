import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { queryDigitalEmployeeSkillResources } from '@/components/Resources/workspaceSkill/queryDigitalEmployeeSkillResources';
import ResourceSiderPanel from '../index';

const mockEventEmitter = { on: jest.fn(), off: jest.fn() };
let mockEmployeeId: string | undefined = 'employee-1';
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: any) => id }),
  useSelector: () => ({ userInfo: { userCode: 'user-1' } }),
}));
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: mockEventEmitter }));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/components/QueryInput/withDrag', () => ({ DragType: {} }));
jest.mock('@/components/Resources/components/ResourceDetail', () => () => null);
jest.mock('@/components/Resources/components/PropertyDetail', () => () => null);
jest.mock('@/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer', () => () => null);
jest.mock('@/pages/manager/components/AuthListDrawer/AddAuthModal', () => () => null);
jest.mock('@/pages/manager/service/resources', () => ({
  queryDigEmployeeRelResourceAuth: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
}));
jest.mock('@/pages/manager/service/DigitalResourceMgr', () => ({}));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({}));
jest.mock('@/pages/manager/layout/sider/menuConfig', () => ({}));
jest.mock('@/utils', () => ({}));
jest.mock('@/utils/auth', () => ({}));
jest.mock('@/components/Resources/workspaceSkill/queryDigitalEmployeeSkillResources', () => ({
  queryDigitalEmployeeSkillResources: jest.fn(),
}));
jest.mock('@/components/Resources/workspaceSkill/useWorkspaceSkillActions', () => ({
  useWorkspaceSkillActions: () => ({}),
}));
jest.mock('@/components/Resources/workspaceSkill/useDigitalEmployeeManagePermission', () => ({
  useDigitalEmployeeManagePermission: () => false,
}));
jest.mock('../useEnterpriseSkillPublication', () => ({
  useEnterpriseSkillPublication: () => ({ canPublish: () => false }),
}));
jest.mock('../../useResourceCenterRouter', () => () => ({ toggleCenter: jest.fn() }));
jest.mock('../../ActiveSiderAgentBar', () => ({
  useActiveSiderAgent: () => ({ resourceId: mockEmployeeId }),
}));
jest.mock('../ResourceSiderListItem', () => ({
  __esModule: true,
  PROPERTY_RESOURCE_TYPE: 'PROPERTY',
  default: ({ item }: any) => <div>{item.resourceName}</div>,
}));
jest.mock('../../InfiniteScrollAntdList', () => ({
  __esModule: true,
  default: ({ dataSource, renderItem }: any) => <div>{dataSource.map(renderItem)}</div>,
}));

const emptyResult = { rows: [], boundRows: [], workspaceRows: [], pageNum: 1, total: 0, response: {} };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(queryDigitalEmployeeSkillResources).mockReset();
  mockEmployeeId = 'employee-1';
});

it('shows a retry action after failure and retries with the current search keyword', async () => {
  const query = jest.mocked(queryDigitalEmployeeSkillResources);
  query.mockResolvedValueOnce({ rows: [], boundRows: [], workspaceRows: [], pageNum: 1, total: 0, response: {} });
  await act(async () => {
    render(<ResourceSiderPanel resourceType="SKILL" embedded />);
  });
  expect(query).toHaveBeenCalledTimes(1);
  query.mockRejectedValueOnce(new Error('unavailable'));
  const search = screen.getByRole('textbox');
  fireEvent.change(search, { target: { value: 'report' } });
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', charCode: 13, keyCode: 13 });
  expect(await screen.findByText('resourceTabs.loadFailed')).toBeInTheDocument();
  const row = { resourceId: 'skill-1', resourceName: 'loaded skill', resourceBizType: 'SKILL' };
  query.mockResolvedValueOnce({
    rows: [row],
    boundRows: [row],
    workspaceRows: [],
    pageNum: 1,
    total: 1,
    response: {},
  });
  fireEvent.click(screen.getByRole('button', { name: 'workspaceSider.retry' }));
  expect(await screen.findByText('loaded skill')).toBeInTheDocument();
  expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'report', resourceId: 'employee-1' }));
  expect(search).toHaveValue('report');
  expect(screen.queryByText('resourceTabs.loadFailed')).not.toBeInTheDocument();
});

it('refreshes from the first page with the applied keyword and replaces the previous skills', async () => {
  const query = jest.mocked(queryDigitalEmployeeSkillResources);
  const row = { resourceId: 'skill-1', resourceName: 'old skill', resourceBizType: 'SKILL' };
  query.mockResolvedValue({ ...emptyResult, rows: [row], boundRows: [row], total: 1 });
  await act(async () => {
    render(<ResourceSiderPanel resourceType="SKILL" embedded />);
  });
  const search = screen.getByRole('textbox');
  fireEvent.change(search, { target: { value: 'report' } });
  fireEvent.keyDown(search, { key: 'Enter', code: 'Enter', charCode: 13, keyCode: 13 });
  await waitFor(() => expect(screen.getByRole('button', { name: 'common.refresh' })).toBeEnabled());
  expect(screen.getByText('old skill')).toBeInTheDocument();

  // 未提交的输入不应改变刷新时已生效的筛选条件。
  fireEvent.change(search, { target: { value: 'unsubmitted' } });
  const updated = { ...row, resourceId: 'skill-2', resourceName: 'new skill' };
  query.mockResolvedValueOnce({ ...emptyResult, rows: [updated], workspaceRows: [updated] });
  fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));

  expect(await screen.findByText('new skill')).toBeInTheDocument();
  expect(screen.queryByText('old skill')).not.toBeInTheDocument();
  expect(query).toHaveBeenCalledTimes(3);
  expect(query).toHaveBeenLastCalledWith(
    expect.objectContaining({
      resourceId: 'employee-1',
      keyword: 'report',
      pageNum: 1,
      includeWorkspace: true,
    })
  );
  expect(search).toHaveValue('unsubmitted');
});

it('prevents duplicate refresh requests while loading and allows refreshing an empty list', async () => {
  const query = jest.mocked(queryDigitalEmployeeSkillResources);
  let finish!: (value: typeof emptyResult) => void;
  query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  render(<ResourceSiderPanel resourceType="SKILL" embedded />);
  const refresh = screen.getByRole('button', { name: 'common.refresh' });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(query).toHaveBeenCalledTimes(1);
  await act(async () => finish(emptyResult));
  expect(refresh).toBeEnabled();

  query.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  fireEvent.click(refresh);
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(query).toHaveBeenCalledTimes(2);
  await act(async () => finish(emptyResult));
  expect(refresh).toBeEnabled();
});

it('allows refreshing again after a failed refresh', async () => {
  const query = jest.mocked(queryDigitalEmployeeSkillResources);
  query.mockResolvedValueOnce(emptyResult).mockRejectedValueOnce(new Error('unavailable'));
  await act(async () => {
    render(<ResourceSiderPanel resourceType="SKILL" embedded />);
  });
  const refresh = screen.getByRole('button', { name: 'common.refresh' });
  fireEvent.click(refresh);
  expect(await screen.findByText('resourceTabs.loadFailed')).toBeInTheDocument();
  expect(refresh).toBeEnabled();
  query.mockResolvedValueOnce(emptyResult);
  fireEvent.click(refresh);
  await waitFor(() => expect(refresh).toBeEnabled());
  expect(screen.queryByText('resourceTabs.loadFailed')).not.toBeInTheDocument();
  expect(query).toHaveBeenCalledTimes(3);
});

it('disables refresh when no employee is selected', () => {
  mockEmployeeId = undefined;
  render(<ResourceSiderPanel resourceType="SKILL" embedded />);
  const refresh = screen.getByRole('button', { name: 'common.refresh' });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(queryDigitalEmployeeSkillResources).not.toHaveBeenCalled();
});

it('does not add the skill refresh action to the tool list', async () => {
  await act(async () => {
    render(<ResourceSiderPanel resourceType="TOOL" embedded />);
  });
  expect(screen.queryByRole('button', { name: 'common.refresh' })).not.toBeInTheDocument();
  expect(queryDigitalEmployeeSkillResources).not.toHaveBeenCalled();
});
