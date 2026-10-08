import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

jest.mock('../../../skillExport', () => ({
  buildSkillBundle: jest.fn().mockResolvedValue(new Blob(['zip'])),
  saveSkillFile: jest.fn(),
}));

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
    <div>
      {children}
      {hasMore && <button onClick={next}>load more</button>}
    </div>
  ),
}));
jest.mock('../../ResourceCard', () => ({
  __esModule: true,
  default: ({ actionConfig, resource, enableFavorites }: any) => (
    <div
      data-testid="resource-card"
      data-resource-id={resource.resourceId}
      data-favorited={String(resource.favorited)}
      data-favorites-enabled={String(enableFavorites)}
      data-resource-status={resource.resourceStatus}
      data-can-off-shelf={String(resource.canOffShelf)}
      data-can-apply-use={String(resource.canApplyUse)}
      data-use-apply-pending={String(resource.useApplyPending)}
      data-resource-name={resource.resourceName}
      data-hidden-menu-keys={JSON.stringify(actionConfig.hiddenMenuItemKeys)}
      data-type-tag={String(actionConfig.showResourceTypeTag)}
      data-enterprise-publication={String(actionConfig.enablePublishToEnterprise)}
      data-manage-workspace={String(actionConfig.canManageWorkspaceSkill)}
    >
      <button onClick={() => actionConfig.onShelf()}>publish</button>
      <button onClick={() => actionConfig.onUnShelf()}>unpublish</button>
      <button onClick={() => actionConfig.onDeleteData()}>deregister</button>
      <button onClick={() => actionConfig.onApplyUse()}>apply use</button>
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
  (queryResourceDetail as jest.Mock).mockResolvedValue({
    resourceId: '10',
    operationPermissions: { canOffShelf: true },
  });
  (queryWorkspacePersonalSkillList as jest.Mock).mockResolvedValue({ data: [] });
  [shelfResource, unShelfResource, deregisterResource].forEach((operation) =>
    (operation as jest.Mock).mockResolvedValue({ code: 0 })
  );
});

it.each(['SKILL', 'KG_DOC', 'TOOL'])('shows loading while the initial %s request is pending', async (resourceType) => {
  let finish!: (value: any) => void;
  (listResourceUseAuth as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  renderList({ resourceType, activeTab: 'personal', myResourcesOnly: false });

  expect(screen.getByText('common.loading')).toBeInTheDocument();
  expect(screen.queryByText('common.noData')).toBeNull();
  expect(screen.queryByTestId('resource-card')).toBeNull();

  await act(async () => {
    finish({ data: { list: [], total: 0 } });
  });
  expect(await screen.findByText('common.noData')).toBeInTheDocument();
  expect(screen.queryByText('common.loading')).toBeNull();
});

it('keeps my personal resources loading until workspace skills finish loading', async () => {
  let finish!: (value: any) => void;
  (queryWorkspacePersonalSkillList as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  renderList({ resourceType: 'SKILL', activeTab: 'personal', myResourcesOnly: true });
  await waitFor(() => expect(queryWorkspacePersonalSkillList).toHaveBeenCalled());
  expect(screen.getByText('common.loading')).toBeInTheDocument();
  expect(screen.queryByTestId('resource-card')).toBeNull();

  await act(async () => {
    finish({ data: [] });
  });
  expect(await screen.findByTestId('resource-card')).toBeInTheDocument();
  expect(screen.queryByText('common.loading')).toBeNull();
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

it.each(['SKILL', 'KG_DOC', 'TOOL'])('refreshes only the applied %s row', async (resourceType) => {
  const rows = [
    { resourceId: '10', resourceName: 'First', resourceStatus: '2', canApplyUse: true, useApplyPending: false },
    { resourceId: '11', resourceName: 'Second', resourceStatus: '2', canApplyUse: true, useApplyPending: false },
  ];
  (listResourceUseAuth as jest.Mock).mockResolvedValue({ data: { list: rows, total: 2 } });
  let finishDetail!: (value: any) => void;
  (queryResourceDetail as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishDetail = resolve;
      })
  );
  const onApplyUse = jest.fn().mockResolvedValue(true);
  const refresh = renderList({ resourceType, myResourcesOnly: false, enableFavorites: true, onApplyUse });
  const cards = await screen.findAllByTestId('resource-card');
  fireEvent.click(screen.getAllByText('apply use')[0]);
  fireEvent.click(screen.getAllByText('apply use')[0]);

  await waitFor(() => expect(cards[0]).toHaveAttribute('data-use-apply-pending', 'true'));
  expect(cards[0]).toHaveAttribute('data-can-apply-use', 'false');
  expect(cards[1]).toHaveAttribute('data-use-apply-pending', 'false');
  expect(cards[1]).toHaveAttribute('data-can-apply-use', 'true');
  expect(queryResourceDetail).toHaveBeenCalledTimes(1);
  expect(queryResourceDetail).toHaveBeenCalledWith({ resourceId: '10' });
  expect(onApplyUse).toHaveBeenCalledWith(expect.objectContaining({ resourceId: '10' }));
  expect(onApplyUse).toHaveBeenCalledTimes(1);
  act(() =>
    window.dispatchEvent(
      new CustomEvent('resourceFavoriteChanged', {
        detail: { resourceId: '10', favorited: true, favoriteCount: 8 },
      })
    )
  );

  await act(async () => {
    finishDetail({
      resourceId: '10',
      resourceName: 'Updated first',
      favorited: false,
      operationPermissions: { useApplyPending: true, canApplyUse: false },
    });
  });

  const updatedCards = screen.getAllByTestId('resource-card');
  expect(updatedCards[0]).toBe(cards[0]);
  expect(updatedCards[1]).toBe(cards[1]);
  expect(updatedCards[0]).toHaveAttribute('data-resource-name', 'Updated first');
  expect(updatedCards[0]).toHaveAttribute('data-favorited', 'true');
  expect(updatedCards[1]).toHaveAttribute('data-resource-name', 'Second');
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});

it('does not refresh or mark a row pending after a failed use application', async () => {
  const onApplyUse = jest.fn().mockResolvedValue(false);
  const refresh = renderList({ onApplyUse });
  const card = await screen.findByTestId('resource-card');
  await act(async () => {
    fireEvent.click(screen.getByText('apply use'));
  });

  expect(onApplyUse).toHaveBeenCalledTimes(1);
  expect(queryResourceDetail).not.toHaveBeenCalled();
  expect(card).toHaveAttribute('data-use-apply-pending', 'undefined');
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});

it('keeps a submitted application pending when its row detail refresh fails', async () => {
  (queryResourceDetail as jest.Mock).mockRejectedValue(new Error('Detail unavailable'));
  const warning = jest.spyOn(message, 'warning').mockImplementation(() => (() => undefined) as any);
  const onApplyUse = jest.fn().mockResolvedValue(true);
  const refresh = renderList({ onApplyUse });
  const card = await screen.findByTestId('resource-card');
  fireEvent.click(screen.getByText('apply use'));

  await waitFor(() => expect(warning).toHaveBeenCalledWith('resource.rowRefreshFailed'));
  expect(card).toHaveAttribute('data-use-apply-pending', 'true');
  expect(card).toHaveAttribute('data-can-apply-use', 'false');
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  warning.mockRestore();
});

it('ignores an applied row detail response after the search changes', async () => {
  const onApplyUse = jest.fn().mockResolvedValue(true);
  let finishDetail!: (value: any) => void;
  (queryResourceDetail as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finishDetail = resolve;
      })
  );
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const listForSearch = (searchValue: string) => (
    <QueryClientProvider client={queryClient}>
      <ResourceList
        resourceType="SKILL"
        activeTab="enterprise"
        searchValue={searchValue}
        catalogId=""
        dropdownParam={{}}
        resourceName="Skill"
        onDetail={jest.fn()}
        onEdit={jest.fn()}
        onAuth={jest.fn()}
        onApplyUse={onApplyUse}
        onRefresh={jest.fn()}
      />
    </QueryClientProvider>
  );
  const view = render(listForSearch('first'));
  await screen.findByTestId('resource-card');
  fireEvent.click(screen.getByText('apply use'));
  await waitFor(() => expect(queryResourceDetail).toHaveBeenCalledWith({ resourceId: '10' }));

  (listResourceUseAuth as jest.Mock).mockResolvedValue({
    data: { list: [{ resourceId: '10', resourceName: 'New search row', useApplyPending: false }], total: 1 },
  });
  view.rerender(listForSearch('second'));
  await waitFor(() =>
    expect(screen.getByTestId('resource-card')).toHaveAttribute('data-resource-name', 'New search row')
  );
  await act(async () => {
    finishDetail({
      resourceId: '10',
      resourceName: 'Old request row',
      operationPermissions: { canApplyUse: false, useApplyPending: true },
    });
  });

  expect(screen.getByTestId('resource-card')).toHaveAttribute('data-resource-name', 'New search row');
  expect(screen.getByTestId('resource-card')).toHaveAttribute('data-use-apply-pending', 'false');
  expect(listResourceUseAuth).toHaveBeenCalledTimes(2);
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
    data: {
      list: [
        { resourceId: '10', resourceBizType: 'TOOLKIT', resourceStatus: '3' },
        { resourceId: '11', resourceBizType: 'TOOLKIT', resourceStatus: '3' },
      ],
      total: 2,
    },
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
  (shelfResource as jest.Mock).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
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
    for (const key of ['shelfData', 'unShelfData', 'deleteData', 'delete']) {
      expect(hiddenKeys.includes(key)).toBe(!props.myResourcesOnly);
    }
    // 仅我可用的技能允许展示发布入口，其他浏览场景继续隐藏。
    expect(hiddenKeys.includes('publishToEnterprise')).toBe(
      !props.myResourcesOnly && !(props.resourceType === 'SKILL' && props.activeTab === 'personal')
    );
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

it.each(
  ['SKILL', 'KG_DOC', 'TOOL'].flatMap((resourceType) =>
    ['', 'personal', 'enterprise'].map((ownerType) => ({ resourceType, ownerType }))
  )
)('requests available $ownerType $resourceType resources on the server', async ({ resourceType, ownerType }) => {
  renderList({ resourceType, myResourcesOnly: false, activeTab: 'personal', dropdownParam: { ownerType } });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerType: ownerType || undefined,
      availableOnly: true,
      resourceStatus: '2',
    })
  );
  expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
});

it.each([true, false])(
  'ignores stale personal ownership on an enterprise tab, management=%s',
  async (myResourcesOnly) => {
    renderList({ myResourcesOnly, activeTab: 'enterprise', dropdownParam: { ownerType: 'personal' } });
    await screen.findByTestId('resource-card');
    expect(listResourceUseAuth).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'enterprise' }));
  }
);

it('preserves ownership and available scope when loading the next page', async () => {
  (listResourceUseAuth as jest.Mock)
    .mockResolvedValueOnce({
      data: { list: [{ resourceId: '10', resourceBizType: 'SKILL', ownerType: 'enterprise' }], total: 2 },
    })
    .mockResolvedValueOnce({
      data: { list: [{ resourceId: '11', resourceBizType: 'SKILL', ownerType: 'enterprise' }], total: 2 },
    });
  renderList({
    resourceType: 'SKILL',
    activeTab: 'personal',
    myResourcesOnly: false,
    dropdownParam: { ownerType: 'enterprise' },
  });
  fireEvent.click(await screen.findByText('load more'));
  await waitFor(() => expect(listResourceUseAuth).toHaveBeenCalledTimes(2));
  expect(listResourceUseAuth).toHaveBeenLastCalledWith(
    expect.objectContaining({
      pageNum: 2,
      ownerType: 'enterprise',
      availableOnly: true,
      resourceStatus: '2',
    })
  );
  // 请求发出时旧卡片已存在，需等待分页结果合并后的数量。
  await waitFor(() => expect(screen.getAllByTestId('resource-card')).toHaveLength(2));
  expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
});

it.each(['SKILL', 'KG_DOC', 'TOOL'])(
  'ignores stale category filters in my enterprise %s resources',
  async (resourceType) => {
    renderList({
      resourceType,
      catalogId: 'old-category',
      dropdownParam: { catalogId: 'old-filter', resourceStatus: '3' },
    });
    await screen.findByTestId('resource-card');
    expect(listResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogId: undefined,
        resourceStatus: '3',
        ownerType: 'enterprise',
      })
    );
  }
);

it.each(
  ['SKILL', 'KG_DOC', 'TOOL'].flatMap((resourceType) =>
    ['personal', 'enterprise'].map((activeTab) => ({ resourceType, activeTab }))
  )
)(
  'excludes deregistered rows and stale categories for my $activeTab $resourceType',
  async ({ resourceType, activeTab }) => {
    renderList({
      resourceType,
      activeTab,
      catalogId: 'old-category',
      dropdownParam: { catalogId: 'old-filter', resourceStatus: '' },
    });
    await screen.findByTestId('resource-card');
    expect(listResourceUseAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeDeleted: true,
        catalogId: undefined,
        resourceStatus: activeTab === 'personal' ? '2' : '',
      })
    );
  }
);

it('exports only resource library skills across filtered pages without changing the displayed list', async () => {
  const { buildSkillBundle, saveSkillFile } = jest.requireMock('../../../skillExport');
  (listResourceUseAuth as jest.Mock).mockImplementation(({ pageNum }) =>
    Promise.resolve({
      data: { list: [{ resourceId: pageNum === 1 ? '1' : '2', resourceBizType: 'SKILL' }], total: 31 },
    })
  );
  (queryWorkspacePersonalSkillList as jest.Mock).mockResolvedValue({
    data: [{ skillName: 'local', skillPath: '/workspace/skills/local' }],
  });
  const exportContainer = document.createElement('span');
  document.body.appendChild(exportContainer);
  renderList({
    resourceType: 'SKILL',
    activeTab: 'personal',
    myResourcesOnly: false,
    searchValue: 'demo',
    exportContainer,
  });
  await waitFor(() => expect(screen.getAllByTestId('resource-card')).toHaveLength(1));
  const exportButton = screen.getByRole('button', { name: /resource\.skillExport\.all/ });
  expect(exportContainer).toContainElement(exportButton);
  expect(document.getElementById('SKILLListScroller')).not.toContainElement(exportButton);
  fireEvent.click(exportButton);
  await waitFor(() => expect(saveSkillFile).toHaveBeenCalled());
  expect(listResourceUseAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      pageNum: 2,
      keyword: 'demo',
      availableOnly: true,
      resourceStatus: '2',
    })
  );
  expect(buildSkillBundle).toHaveBeenCalledWith(
    [expect.objectContaining({ resourceId: '1' }), expect.objectContaining({ resourceId: '2' })],
    undefined
  );
  expect(screen.getAllByTestId('resource-card')).toHaveLength(1);
  expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
  exportContainer.remove();
});

it.each([false, true])(
  'hides skill sharing and preserves publication in available and my personal skills: %s',
  async (myResourcesOnly) => {
    renderList({ resourceType: 'SKILL', activeTab: 'personal', myResourcesOnly, enablePublishToEnterprise: true });
    const card = await screen.findByTestId('resource-card');
    const hiddenKeys = JSON.parse(card.getAttribute('data-hidden-menu-keys') || '[]');
    expect(hiddenKeys).toContain('share');
    expect(hiddenKeys).not.toContain('publishToEnterprise');
    expect(card).toHaveAttribute('data-enterprise-publication', 'true');
  }
);

it('loads personal directories without a default employee and trusts their personal scope for management', async () => {
  (listResourceUseAuth as jest.Mock).mockResolvedValue({ data: { list: [], total: 0 } });
  (queryWorkspacePersonalSkillList as jest.Mock).mockResolvedValue({
    data: [{ skillName: 'mine', skillPath: '/.openclaw/workspace/skills/mine', personalWorkspace: true }],
  });
  renderList({ resourceType: 'SKILL', activeTab: 'personal', myResourcesOnly: true });
  expect(await screen.findByTestId('resource-card')).toHaveAttribute('data-manage-workspace', 'true');
  expect(queryWorkspacePersonalSkillList).toHaveBeenCalledWith({ keyword: '', personalWorkspace: true });
  const { queryInstalledResourceIds } = jest.requireMock('@/pages/manager/service/DigitalEmployeeMgr');
  expect(queryInstalledResourceIds).not.toHaveBeenCalled();
});

// 目录中有技能也不能补入“我可用的”，空状态应完全由资源库结果决定。
it('shows an empty available skill list when only personal directory skills exist', async () => {
  (listResourceUseAuth as jest.Mock).mockResolvedValue({ data: { list: [], total: 0 } });
  (queryWorkspacePersonalSkillList as jest.Mock).mockResolvedValue({
    data: [{ skillName: 'local', skillPath: '/workspace/skills/local', personalWorkspace: true }],
  });
  renderList({ resourceType: 'SKILL', activeTab: 'personal', myResourcesOnly: false });
  expect(await screen.findByText('common.noData')).toBeInTheDocument();
  expect(screen.queryByTestId('resource-card')).toBeNull();
  expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
});

// 模拟离开资源中心后员工目录新增技能，再返回中心；目录数据不能随员工上下文混入。
it.each(['SKILL', 'KG_DOC', 'TOOL'])('queries favorites through the existing paged %s API', async (resourceType) => {
  renderList({
    resourceType,
    activeTab: 'favorites',
    myResourcesOnly: false,
    enableFavorites: true,
    searchValue: 'query',
    catalogId: '20',
  });
  await screen.findByTestId('resource-card');
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  expect(listResourceUseAuth).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerType: 'enterprise',
      includeFavorites: true,
      favoritesOnly: true,
      resourceStatus: '2',
      keyword: 'query',
      catalogId: '20',
    })
  );
  expect(screen.getByTestId('resource-card')).toHaveAttribute('data-favorites-enabled', 'true');
  expect(queryResourceDetail).not.toHaveBeenCalled();
});

it.each([
  { activeTab: 'personal', myResourcesOnly: false },
  { activeTab: 'enterprise', myResourcesOnly: true },
])('keeps favorite queries out of other list scenes (%j)', async (scene) => {
  renderList({ ...scene, enableFavorites: true });
  await screen.findByTestId('resource-card');
  expect((listResourceUseAuth as jest.Mock).mock.calls[0][0]).not.toHaveProperty('includeFavorites');
  expect(screen.getByTestId('resource-card')).toHaveAttribute('data-favorites-enabled', 'false');
});

it('removes only the canceled favorite and fills the shifted page boundary without skipping', async () => {
  const row = (id: number) => ({
    resourceId: `${id}`,
    resourceBizType: 'SKILL',
    ownerType: 'enterprise',
    favorited: true,
    favoriteCount: 5,
  });
  (listResourceUseAuth as jest.Mock).mockResolvedValueOnce({
    data: { list: Array.from({ length: 30 }, (_, i) => row(i + 1)), total: 31 },
  });
  renderList({ resourceType: 'SKILL', activeTab: 'favorites', myResourcesOnly: false, enableFavorites: true });
  expect(await screen.findAllByTestId('resource-card')).toHaveLength(30);
  act(() =>
    window.dispatchEvent(
      new CustomEvent('resourceFavoriteChanged', { detail: { resourceId: '1', favorited: false, favoriteCount: 4 } })
    )
  );
  expect(screen.getAllByTestId('resource-card')).toHaveLength(29);
  expect(listResourceUseAuth).toHaveBeenCalledTimes(1);
  (listResourceUseAuth as jest.Mock).mockResolvedValueOnce({
    data: { list: Array.from({ length: 30 }, (_, i) => row(i + 2)), total: 30 },
  });
  fireEvent.click(screen.getByRole('button', { name: 'load more' }));
  await waitFor(() => expect(screen.getAllByTestId('resource-card')).toHaveLength(30));
  expect(listResourceUseAuth).toHaveBeenLastCalledWith(expect.objectContaining({ pageNum: 1, favoritesOnly: true }));
  expect(screen.getAllByTestId('resource-card').map((card) => card.getAttribute('data-resource-id'))).toEqual(
    Array.from({ length: 30 }, (_, i) => `${i + 2}`)
  );
});

it.each(['enterprise', 'favorites'])(
  'retries an in-flight %s request after a favorite cancellation',
  async (activeTab) => {
    const row = (id: string, favorited = true) => ({
      resourceId: id,
      ownerType: 'enterprise',
      resourceBizType: 'SKILL',
      favorited,
      favoriteCount: favorited ? 1 : 0,
    });
    let finishOld!: (value: any) => void;
    (listResourceUseAuth as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          })
      )
      .mockResolvedValueOnce({
        data: {
          list: activeTab === 'favorites' ? [row('2')] : [row('1', false), row('2')],
          total: activeTab === 'favorites' ? 1 : 2,
        },
      });
    renderList({
      resourceType: 'SKILL',
      activeTab,
      myResourcesOnly: false,
      enableFavorites: true,
      searchValue: 'query',
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent('resourceFavoriteChanged', {
          detail: { resourceId: '1', favorited: false, favoriteCount: 0 },
        })
      );
    });
    await act(async () => {
      finishOld({ data: { list: [row('1'), row('2')], total: 2 } });
    });
    await waitFor(() => expect(listResourceUseAuth).toHaveBeenCalledTimes(2));
    expect(listResourceUseAuth).toHaveBeenLastCalledWith(
      expect.objectContaining({ keyword: 'query', favoritesOnly: activeTab === 'favorites' })
    );
    const cards = screen.getAllByTestId('resource-card');
    if (activeTab === 'favorites') {
      expect(cards.map((card) => card.getAttribute('data-resource-id'))).toEqual(['2']);
    } else {
      expect(cards[0]).toHaveAttribute('data-favorited', 'false');
    }
  }
);

it('retries the current favorite boundary and stays loading until the fresh page completes', async () => {
  const row = (id: number) => ({
    resourceId: `${id}`,
    resourceBizType: 'SKILL',
    ownerType: 'enterprise',
    favorited: true,
  });
  const first = Array.from({ length: 30 }, (_, index) => row(index + 1));
  let finishOld!: (value: any) => void;
  let finishFresh!: (value: any) => void;
  (listResourceUseAuth as jest.Mock)
    .mockResolvedValueOnce({ data: { list: first, total: 31 } })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFresh = resolve;
        })
    );
  renderList({ resourceType: 'SKILL', activeTab: 'favorites', myResourcesOnly: false, enableFavorites: true });
  await waitFor(() => expect(screen.getAllByTestId('resource-card')).toHaveLength(30));
  fireEvent.click(screen.getByRole('button', { name: 'load more' }));
  act(() => {
    window.dispatchEvent(
      new CustomEvent('resourceFavoriteChanged', {
        detail: { resourceId: '1', favorited: false, favoriteCount: 0 },
      })
    );
  });
  await act(async () => {
    finishOld({ data: { list: [row(31)], total: 31 } });
  });
  expect(listResourceUseAuth).toHaveBeenCalledTimes(3);
  expect(screen.getByText('common.loading')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'load more' }));
  expect(listResourceUseAuth).toHaveBeenCalledTimes(3);
  await act(async () => {
    finishFresh({ data: { list: [...first.slice(1), row(31)], total: 30 } });
  });
  await waitFor(() => expect(screen.getAllByTestId('resource-card')).toHaveLength(30));
  expect((listResourceUseAuth as jest.Mock).mock.calls.map(([params]) => params.pageNum)).toEqual([1, 2, 1]);
  expect(screen.getAllByTestId('resource-card').map((card) => card.getAttribute('data-resource-id'))).not.toContain(
    '1'
  );
  expect(screen.queryByRole('button', { name: 'load more' })).toBeNull();
});

it('keeps available skills resource-backed after leaving and reopening the center', async () => {
  (listResourceUseAuth as jest.Mock).mockResolvedValue({
    data: { list: [{ resourceId: 'center-skill', resourceBizType: 'SKILL' }], total: 1 },
  });
  const props = { resourceType: 'SKILL', activeTab: 'personal', myResourcesOnly: false };
  renderList(props);
  expect(await screen.findAllByTestId('resource-card')).toHaveLength(1);
  cleanup();

  (queryWorkspacePersonalSkillList as jest.Mock).mockResolvedValue({
    data: [{ skillName: 'weather-query', skillPath: '/skills/weather-query', personalWorkspace: true }],
  });
  renderList(props);
  expect(await screen.findAllByTestId('resource-card')).toHaveLength(1);
  expect(listResourceUseAuth).toHaveBeenCalledTimes(2);
  expect(listResourceUseAuth).toHaveBeenLastCalledWith(
    expect.objectContaining({ availableOnly: true, resourceBizTypeList: ['SKILL'], resourceStatus: '2' })
  );
  expect(queryWorkspacePersonalSkillList).not.toHaveBeenCalled();
});
