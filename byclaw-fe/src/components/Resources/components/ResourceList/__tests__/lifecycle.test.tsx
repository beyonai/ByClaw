import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResourceList from '..';
import {
  listResourceUseAuth,
  queryResourceDetail,
  shelfResource,
  unShelfResource,
  deregisterResource,
  queryWorkspacePersonalSkillList,
} from '@/pages/manager/service/resources';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: (selector: any) =>
    selector({ user: { userInfo: {} }, employees: { defaultDigEmployeeId: 'employee-1' } }),
}));
jest.mock('@/hooks/useGlobal', () => ({ __esModule: true, default: () => ({}) }));
jest.mock('../../../useResourceInstallTargetContext', () => ({
  __esModule: true,
  default: () => ({ mode: 'select' }),
}));
jest.mock('../../../workspaceSkill/useDigitalEmployeeManagePermission', () => ({
  useDigitalEmployeeManagePermission: () => true,
}));
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({ queryInstalledResourceIds: jest.fn() }));
jest.mock('@/pages/manager/service/resources', () => ({
  listResourceUseAuth: jest.fn(),
  queryResourceDetail: jest.fn(),
  shelfResource: jest.fn(),
  unShelfResource: jest.fn(),
  deregisterResource: jest.fn(),
  queryWorkspacePersonalSkillList: jest.fn(),
}));
jest.mock('@/components/InfiniteScroll', () => ({
  __esModule: true,
  default: ({ children, next, hasMore }: any) => (
    <div>{children}{hasMore && <button onClick={next}>load more</button>}</div>
  ),
}));
jest.mock('../../ResourceCard', () => ({
  __esModule: true,
  default: ({ actionConfig, resource }: any) => (
    <div
      data-testid="resource-card"
      data-resource-status={resource.resourceStatus}
      data-can-off-shelf={String(resource.canOffShelf)}
      data-hidden-menu-keys={JSON.stringify(actionConfig.hiddenMenuItemKeys)}
      data-type-tag={String(actionConfig.showResourceTypeTag)}
      data-enterprise-publication={String(actionConfig.enablePublishToEnterprise)}
    >
      <button onClick={() => actionConfig.onShelf()}>publish</button>
      <button onClick={() => actionConfig.onUnShelf()}>unpublish</button>
      <button onClick={() => actionConfig.onDeleteData()}>deregister</button>
    </div>
  ),
}));

const renderList = (props: Record<string, any> = {}) => {
  const refresh = jest.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ResourceList
        resourceType="TOOL"
        activeTab="enterprise"
        searchValue=""
        catalogId=""
        resourceName="Tool"
        dropdownParam={{ resourceStatus: '3' }}
        myResourcesOnly
        onDetail={jest.fn()}
        onEdit={jest.fn()}
        onAuth={jest.fn()}
        onApplyUse={jest.fn()}
        onAuditUse={jest.fn()}
        onRefresh={refresh}
        {...props}
      />
    </QueryClientProvider>
  );
  return refresh;
};

beforeEach(() => {
  jest.clearAllMocks();
  (listResourceUseAuth as jest.Mock).mockResolvedValue({
    data: { list: [{ resourceId: '10', resourceBizType: 'TOOLKIT', ownerType: 'enterprise' }], total: 1 },
  });
  (queryResourceDetail as jest.Mock).mockResolvedValue({ resourceId: '10', operationPermissions: { canOffShelf: true } });
  (queryWorkspacePersonalSkillList as jest.Mock).mockResolvedValue({ data: [] });
  [shelfResource, unShelfResource, deregisterResource].forEach((operation) =>
    (operation as jest.Mock).mockResolvedValue({ code: 0 })
  );
});

it.each([
  ['publish', shelfResource],
  ['unpublish', unShelfResource],
  ['deregister', deregisterResource],
] as const)('dispatches %s without reloading the list', async (label, operation) => {
  const refresh = renderList({ dropdownParam: { resourceStatus: '' } });
  fireEvent.click(await screen.findByText(label));
  await waitFor(() => expect(operation).toHaveBeenCalledWith({ resourceId: '10' }));
  const status = label === 'publish' ? '2' : label === 'unpublish' ? '3' : '-1';
  if (label === 'deregister') {
    await waitFor(() => expect(screen.queryByTestId('resource-card')).toBeNull());
  } else {
    await waitFor(() => expect(screen.getByTestId('resource-card')).toHaveAttribute('data-resource-status', status));
  }
  expect(refresh).not.toHaveBeenCalled();
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  if (label === 'deregister') {
    expect(queryResourceDetail).not.toHaveBeenCalled();
  } else {
    expect(queryResourceDetail).toHaveBeenCalledWith({ resourceId: '10' });
    expect(screen.getByTestId('resource-card')).toHaveAttribute('data-can-off-shelf', 'true');
  }
});

it.each(['3', '-1'])('ignores stale personal status %s and loads published skills', async (resourceStatus) => {
  renderList({ resourceType: 'SKILL', activeTab: 'personal', dropdownParam: { resourceStatus } });
  await screen.findByText('publish');
  expect(listResourceUseAuth).toHaveBeenCalledWith(
    expect.objectContaining({ resourceStatus: '2', permission: 'CREATED_BY_ME' })
  );
  expect(queryWorkspacePersonalSkillList).toHaveBeenCalled();
});

it.each([undefined, null, '', '2'])('includes workspace skills for status %s', async (resourceStatus) => {
  renderList({ resourceType: 'SKILL', activeTab: 'personal', dropdownParam: { resourceStatus } });
  await waitFor(() => expect(queryWorkspacePersonalSkillList).toHaveBeenCalled());
});

it('forces published status in available resources despite a stale filter', async () => {
  renderList({ myResourcesOnly: false, activeTab: 'personal' });
  await screen.findByText('publish');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({ resourceStatus: '2' }));
});

it.each(['KG_DOC', 'SKILL', 'TOOL'])('selects ownership tags only outside my %s resources', async (resourceType) => {
  renderList({ resourceType, myResourcesOnly: false });
  expect(await screen.findByTestId('resource-card')).toHaveAttribute('data-type-tag', 'true');
});

it.each(['KG_DOC', 'SKILL', 'TOOL'])('selects status tags in my %s resources', async (resourceType) => {
  renderList({ resourceType });
  expect(await screen.findByTestId('resource-card')).toHaveAttribute('data-type-tag', 'false');
});

it.each([true, false, undefined])('forwards enterprise publication brand control: %s', async (enabled) => {
  renderList({ enablePublishToEnterprise: enabled });
  expect(await screen.findByTestId('resource-card')).toHaveAttribute(
    'data-enterprise-publication',
    String(enabled === true)
  );
});

it('removes only the changed row when it no longer matches the status filter', async () => {
  (listResourceUseAuth as jest.Mock).mockResolvedValue({
    data: { list: [
      { resourceId: '10', resourceBizType: 'TOOLKIT', resourceStatus: '3' },
      { resourceId: '11', resourceBizType: 'TOOLKIT', resourceStatus: '3' },
    ], total: 2 },
  });
  const refresh = renderList();
  const cards = await screen.findAllByTestId('resource-card');
  fireEvent.click(screen.getAllByText('publish')[0]);
  await waitFor(() => expect(screen.getAllByTestId('resource-card')).toHaveLength(1));
  expect(screen.getByTestId('resource-card')).toBe(cards[1]);
  expect(refresh).not.toHaveBeenCalled();
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
});

it('keeps the list interactive while a lifecycle operation is pending', async () => {
  let finish!: (value: any) => void;
  (shelfResource as jest.Mock).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  renderList({ dropdownParam: { resourceStatus: '' } });
  const card = await screen.findByTestId('resource-card');
  fireEvent.click(screen.getByText('publish'));
  expect(card.closest('.ant-spin-container')).not.toHaveClass('ant-spin-blur');
  expect(screen.getByTestId('resource-card')).toBe(card);
  finish({ code: 0 });
  await waitFor(() => expect(card).toHaveAttribute('data-resource-status', '2'));
});

// 同时覆盖浏览/管理及个人/企业，避免把后端权限当成浏览页展示条件。
it.each(
  ['KG_DOC', 'SKILL', 'TOOL'].flatMap((resourceType) =>
    ['personal', 'enterprise'].flatMap((activeTab) =>
      [false, true].map((myResourcesOnly) => ({ resourceType, activeTab, myResourcesOnly }))
    )
  )
)('scopes management menus for $resourceType / $activeTab / $myResourcesOnly', async (props) => {
  renderList({ ...props, enablePublishToEnterprise: true });
  const cards = await screen.findAllByTestId('resource-card');
  for (const card of cards) {
    const hiddenKeys = JSON.parse(card.getAttribute('data-hidden-menu-keys') || '[]');
    for (const key of ['shelfData', 'unShelfData', 'deleteData', 'delete', 'publishToEnterprise']) {
      expect(hiddenKeys.includes(key)).toBe(!props.myResourcesOnly);
    }
  }
});

it('leaves the row unchanged when the mutation fails', async () => {
  const error = jest.spyOn(message, 'error').mockImplementation(() => undefined as any);
  (shelfResource as jest.Mock).mockRejectedValue(new Error('Denied'));
  const refresh = renderList();
  const card = await screen.findByTestId('resource-card');
  fireEvent.click(screen.getByText('publish'));
  await waitFor(() => expect(error).toHaveBeenCalledWith('Denied'));
  expect(queryResourceDetail).not.toHaveBeenCalled();
  expect(screen.getByTestId('resource-card')).toBe(card);
  expect(refresh).not.toHaveBeenCalled();
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  error.mockRestore();
});

it('keeps the successful state when the detail refresh fails', async () => {
  const warning = jest.spyOn(message, 'warning').mockImplementation(() => undefined as any);
  (queryResourceDetail as jest.Mock).mockRejectedValue(new Error('Detail unavailable'));
  const refresh = renderList({ dropdownParam: { resourceStatus: '' } });
  const card = await screen.findByTestId('resource-card');
  fireEvent.click(screen.getByText('publish'));
  await waitFor(() => expect(card).toHaveAttribute('data-resource-status', '2'));
  expect(warning).toHaveBeenCalledWith('resource.rowRefreshFailed');
  expect(refresh).not.toHaveBeenCalled();
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  warning.mockRestore();
});

it.each(['SKILL', 'KG_DOC', 'TOOL'])('forces published requests for my personal %s resources', async (resourceType) => {
  renderList({ resourceType, activeTab: 'personal', dropdownParam: { resourceStatus: '3' } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({ resourceStatus: '2' }));
});

it.each(['1', '-1'])('drops removed enterprise status %s', async (resourceStatus) => {
  renderList({ activeTab: 'enterprise', dropdownParam: { resourceStatus } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({ resourceStatus: '2' }));
});

it.each(['', '0', '2', '3'])('preserves supported enterprise status %s', async (resourceStatus) => {
  renderList({ activeTab: 'enterprise', dropdownParam: { resourceStatus } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({ resourceStatus }));
});

it.each(['SKILL', 'KG_DOC', 'TOOL'].flatMap((resourceType) =>
  ['', 'personal', 'enterprise'].map((ownerType) => ({ resourceType, ownerType }))
))('requests available $ownerType $resourceType resources on the server', async ({ resourceType, ownerType }) => {
  renderList({ resourceType, myResourcesOnly: false, activeTab: 'personal', dropdownParam: { ownerType } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({
    ownerType: ownerType || undefined,
    availableOnly: true,
    resourceStatus: '2',
  }));
  if (resourceType === 'SKILL') {
    if (ownerType === 'enterprise') expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
    else expect(queryWorkspacePersonalSkillList).toHaveBeenCalled();
  }
});

it.each([true, false])('ignores stale personal ownership on an enterprise tab, management=%s', async (myResourcesOnly) => {
  renderList({ myResourcesOnly, activeTab: 'enterprise', dropdownParam: { ownerType: 'personal' } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'enterprise' }));
});

it('preserves ownership and available scope when loading the next page', async () => {
  (listResourceUseAuth as jest.Mock).mockResolvedValueOnce({
    data: { list: [{ resourceId: '10', resourceBizType: 'SKILL', ownerType: 'enterprise' }], total: 2 },
  }).mockResolvedValueOnce({
    data: { list: [{ resourceId: '11', resourceBizType: 'SKILL', ownerType: 'enterprise' }], total: 2 },
  });
  renderList({ resourceType: 'SKILL', activeTab: 'personal', myResourcesOnly: false,
    dropdownParam: { ownerType: 'enterprise' } });
  fireEvent.click(await screen.findByText('load more'));
  await waitFor(() => expect(listResourceUseAuth).toHaveBeenCalledTimes(2));
  expect(listResourceUseAuth).toHaveBeenLastCalledWith(expect.objectContaining({
    pageNum: 2, ownerType: 'enterprise', availableOnly: true, resourceStatus: '2',
  }));
  expect(await screen.findAllByTestId('resource-card')).toHaveLength(2);
  expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
});

it.each(['SKILL', 'KG_DOC', 'TOOL'])('ignores stale category filters in my enterprise %s resources', async (resourceType) => {
  renderList({ resourceType, catalogId: 'old-category', dropdownParam: { catalogId: 'old-filter', resourceStatus: '3' } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({
    catalogId: undefined, resourceStatus: '3', ownerType: 'enterprise',
  }));
});

it.each(['SKILL', 'KG_DOC', 'TOOL'].flatMap((resourceType) =>
  ['personal', 'enterprise'].map((activeTab) => ({ resourceType, activeTab }))
))('excludes deregistered rows and stale categories for my $activeTab $resourceType', async ({ resourceType, activeTab }) => {
  renderList({ resourceType, activeTab, catalogId: 'old-category',
    dropdownParam: { catalogId: 'old-filter', resourceStatus: '' } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({
    excludeDeleted: true, catalogId: undefined,
    resourceStatus: activeTab === 'personal' ? '2' : '',
  }));
});
