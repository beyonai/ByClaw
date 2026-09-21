import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ResourceList from '..';
import {
  listResourceUseAuth,
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
  shelfResource: jest.fn(),
  unShelfResource: jest.fn(),
  deregisterResource: jest.fn(),
  queryWorkspacePersonalSkillList: jest.fn(),
}));
jest.mock('@/components/InfiniteScroll', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('../../ResourceCard', () => ({
  __esModule: true,
  default: ({ actionConfig }: any) => (
    <div data-testid="resource-card" data-type-tag={String(actionConfig.showResourceTypeTag)}>
      <button onClick={actionConfig.onShelf}>publish</button>
      <button onClick={actionConfig.onUnShelf}>unpublish</button>
      <button onClick={actionConfig.onDeleteData}>deregister</button>
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
  (queryWorkspacePersonalSkillList as jest.Mock).mockResolvedValue({ data: [] });
  [shelfResource, unShelfResource, deregisterResource].forEach((operation) =>
    (operation as jest.Mock).mockResolvedValue({ code: 0 })
  );
});

it.each([
  ['publish', shelfResource],
  ['unpublish', unShelfResource],
  ['deregister', deregisterResource],
] as const)('dispatches %s and refreshes after success', async (label, operation) => {
  const refresh = renderList();
  fireEvent.click(await screen.findByText(label));
  await waitFor(() => expect(operation).toHaveBeenCalledWith({ resourceId: '10' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

it.each(['3', '-1'])('preserves management filter %s and excludes workspace skills', async (resourceStatus) => {
  renderList({ resourceType: 'SKILL', activeTab: 'personal', dropdownParam: { resourceStatus } });
  await screen.findByText('publish');
  expect(listResourceUseAuth).toHaveBeenCalledWith(
    expect.objectContaining({ resourceStatus, permission: 'CREATED_BY_ME' })
  );
  expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
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
