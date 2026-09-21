import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResourceFilter, { getDefaultParams } from '..';
import { digitalEmployeeTypeOptions, permissionOptions, PERMISSION_APPLIED_BY_ME_VALUE } from '../../../constants';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/components/PersonalSelect', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/PersonnelModel', () => ({ dataItemTypeMap: {} }));
jest.mock('@/components/PersonnelModel/const', () => ({ searchTypeMap: {} }));
jest.mock('@/components/OrgSelect/components/RightItemRender', () => ({ __esModule: true, default: () => null }));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: jest.fn().mockResolvedValue({ paramValue: 'commercial' }),
}));
jest.mock('antd', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  Dropdown: ({ popupRender }: any) => <div>{popupRender()}</div>,
}));

const appliedLabel = permissionOptions.find((item) => item.value === PERMISSION_APPLIED_BY_ME_VALUE)!.label;

describe('available employee filters', () => {
  it('hides and clears stale applied permission for available employees', async () => {
    const onOk = jest.fn();
    render(
      <ResourceFilter
        resourceType="DIG_EMPLOYEE"
        activeTab="available"
        hideStatusFilter
        digitalEmployeeTypeFilter
        defaultParam={getDefaultParams({ permission: PERMISSION_APPLIED_BY_ME_VALUE })}
        onOk={onOk}
      />
    );

    expect(screen.queryByText(appliedLabel)).toBeNull();
    expect(screen.queryByText('common.status')).toBeNull();
    fireEvent.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(onOk).toHaveBeenCalledWith(expect.objectContaining({ permission: '' })));
  });

  it.each(
    ['available', 'official'].flatMap((activeTab) =>
      digitalEmployeeTypeOptions.filter((item) => item.value).map((item) => ({ ...item, activeTab }))
    )
  )('submits and resets $value in $activeTab', async ({ value, label, activeTab }) => {
    const onOk = jest.fn();
    render(
      <ResourceFilter
        resourceType="DIG_EMPLOYEE"
        activeTab={activeTab}
        hideStatusFilter
        digitalEmployeeTypeFilter
        defaultParam={getDefaultParams()}
        onOk={onOk}
      />
    );

    fireEvent.click(screen.getByText(label));
    fireEvent.click(screen.getByText('common.confirm'));
    await waitFor(() => expect(onOk).toHaveBeenLastCalledWith(expect.objectContaining({ digitalEmployeeType: value })));
    fireEvent.click(screen.getByText('common.reset'));
    fireEvent.click(screen.getByText('common.confirm'));
    expect(onOk).toHaveBeenLastCalledWith(expect.objectContaining({ digitalEmployeeType: '', permission: '' }));
  });

  // 共享筛选组件不能连带移除官方推荐或其他可用资源的申请筛选。
  it.each([
    ['official', 'DIG_EMPLOYEE'],
    ['available', 'SKILL'],
  ])('retains applied permission for %s / %s', async (activeTab, resourceType) => {
    render(
      <ResourceFilter
        resourceType={resourceType}
        activeTab={activeTab}
        defaultParam={getDefaultParams()}
        onOk={jest.fn()}
      />
    );

    expect(await screen.findByText(appliedLabel)).toBeTruthy();
    expect(screen.queryByText('digitalEmployees.filter.personalGroup')).toBeNull();
  });
});

describe('resource category filter', () => {
  const catalogOptions = [
    { value: '', label: 'All categories' },
    { value: 'sales', label: 'Sales' },
    { value: 'platform', label: 'Platform' },
  ];

  it.each(['personal', 'enterprise'])('confirms and resets categories in %s', (activeTab) => {
    const onOk = jest.fn();
    render(
      <ResourceFilter
        resourceType="SKILL"
        activeTab={activeTab}
        catalogOptions={catalogOptions}
        defaultParam={getDefaultParams({ catalogId: 'sales' })}
        onOk={onOk}
      />
    );

    expect(screen.getByRole('button', { name: 'Sales' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Platform' }));
    expect(onOk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('common.confirm'));
    expect(onOk).toHaveBeenLastCalledWith(expect.objectContaining({ catalogId: 'platform' }));
    fireEvent.click(screen.getByText('common.reset'));
    expect(screen.getByRole('button', { name: 'All categories' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('common.confirm'));
    expect(onOk).toHaveBeenLastCalledWith(expect.objectContaining({ catalogId: '' }));
  });

  it('does not add category fields to other filter consumers', () => {
    const onOk = jest.fn();
    render(<ResourceFilter defaultParam={getDefaultParams()} onOk={onOk} />);
    expect(screen.queryByText('resource.category')).toBeNull();
    fireEvent.click(screen.getByText('common.confirm'));
    expect(onOk.mock.calls[0][0]).not.toHaveProperty('catalogId');
  });
});

// 下架与注销必须提交不同状态值，不能继续把 3 当成注销。
describe('resource lifecycle filters', () => {
  it.each([
    ['resourceStatus.draft', '0'],
    ['resourceStatus.pendingShelf', '1'],
    ['resourceStatus.published', '2'],
    ['resourceStatus.unpublished', '3'],
    ['resource.statusCancelled', '-1'],
  ])('submits %s as %s', (label, value) => {
    const onOk = jest.fn();
    render(<ResourceFilter resourceType="TOOL" alwaysShowStatusFilter defaultParam={getDefaultParams()} onOk={onOk} />);
    fireEvent.click(screen.getAllByText(label)[0]);
    fireEvent.click(screen.getByText('common.confirm'));
    expect(onOk).toHaveBeenLastCalledWith(expect.objectContaining({ resourceStatus: value }));
  });
});
