import { act, fireEvent, render, screen } from '@testing-library/react';
import { queryDigitalEmployeeSkillResources } from '@/components/Resources/workspaceSkill/queryDigitalEmployeeSkillResources';
import ResourceSiderPanel from '../index';

const mockEventEmitter = { on: jest.fn(), off: jest.fn() };
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
jest.mock('@/pages/manager/service/resources', () => ({}));
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
  useActiveSiderAgent: () => ({ resourceId: 'employee-1' }),
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
