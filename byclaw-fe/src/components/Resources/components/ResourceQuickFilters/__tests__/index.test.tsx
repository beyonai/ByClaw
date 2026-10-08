import { fireEvent, render, screen, within } from '@testing-library/react';
import ResourceQuickFilters from '..';
import { digitalEmployeeTypeOptions } from '../../../constants';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

describe('resource quick filters', () => {
  it.each([
    ['SKILL', 'Skill'],
    ['KG_DOC', 'Knowledge'],
    ['TOOL', 'Tool'],
  ])('changes ownership and permission immediately for %s', (resourceType, suffix) => {
    const onChange = jest.fn();
    const { rerender } = render(
      <ResourceQuickFilters resourceType={resourceType} activeTab="personal" value={{}} onChange={onChange} />
    );
    const types = within(screen.getByRole('group', { name: 'resource.type' }));
    const permissions = within(screen.getByRole('group', { name: 'common.belong' }));

    expect(types.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');
    expect(permissions.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');
    expect(permissions.queryByRole('button', { name: 'resource.appliedByMe' })).toBeNull();

    for (const ownerType of ['personal', 'enterprise']) {
      fireEvent.click(types.getByRole('button', { name: `resource.tag.${ownerType}${suffix}` }));
      expect(onChange).toHaveBeenLastCalledWith({ ownerType });
    }
    for (const [label, permission] of [
      ['resource.createdByMe', 'CREATED_BY_ME'],
      ['resource.authorizedToMe', 'AUTHORIZED_TO_ME'],
    ]) {
      fireEvent.click(permissions.getByRole('button', { name: label }));
      expect(onChange).toHaveBeenLastCalledWith({ permission });
    }

    rerender(
      <ResourceQuickFilters
        resourceType={resourceType}
        activeTab="personal"
        value={{ ownerType: 'enterprise', permission: 'AUTHORIZED_TO_ME' }}
        onChange={onChange}
      />
    );
    expect(types.getByRole('button', { name: `resource.tag.enterprise${suffix}` })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(permissions.getByRole('button', { name: 'resource.authorizedToMe' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(types.getByRole('button', { name: 'common.all' }));
    expect(onChange).toHaveBeenLastCalledWith({ ownerType: '' });
    fireEvent.click(permissions.getByRole('button', { name: 'common.all' }));
    expect(onChange).toHaveBeenLastCalledWith({ permission: '' });
  });

  it.each(['enterprise', 'favorites'])('retains applied permission and fixed ownership in %s', (activeTab) => {
    const onChange = jest.fn();
    render(
      <ResourceQuickFilters
        resourceType="SKILL"
        activeTab={activeTab}
        value={{ permission: 'APPLIED_BY_ME' }}
        onChange={onChange}
      />
    );

    expect(screen.queryByRole('group', { name: 'resource.type' })).toBeNull();
    const applied = screen.getByRole('button', { name: 'resource.appliedByMe' });
    expect(applied).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(applied);
    expect(onChange).toHaveBeenLastCalledWith({ permission: 'APPLIED_BY_ME' });
  });

  it.each([
    ['SKILL', 'personal'],
    ['DIG_EMPLOYEE', 'available'],
  ])('displays all for stale applied permission in available %s resources', (resourceType, activeTab) => {
    render(
      <ResourceQuickFilters
        resourceType={resourceType}
        activeTab={activeTab}
        value={{ permission: 'APPLIED_BY_ME' }}
        onChange={jest.fn()}
      />
    );

    const permissions = within(screen.getByRole('group', { name: 'common.belong' }));
    expect(permissions.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');
    expect(permissions.queryByRole('button', { name: 'resource.appliedByMe' })).toBeNull();
  });

  it.each(['available', 'favorites'])('supports all four employee types in %s', (activeTab) => {
    const onChange = jest.fn();
    const { rerender } = render(
      <ResourceQuickFilters resourceType="DIG_EMPLOYEE" activeTab={activeTab} value={{}} onChange={onChange} />
    );
    const types = within(screen.getByRole('group', { name: 'resource.type' }));
    expect(types.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');

    for (const item of digitalEmployeeTypeOptions.filter((option) => option.value)) {
      fireEvent.click(types.getByRole('button', { name: item.label }));
      expect(onChange).toHaveBeenLastCalledWith({ digitalEmployeeType: item.value });
      rerender(
        <ResourceQuickFilters
          resourceType="DIG_EMPLOYEE"
          activeTab={activeTab}
          value={{ digitalEmployeeType: item.value }}
          onChange={onChange}
        />
      );
      expect(types.getByRole('button', { name: item.label })).toHaveAttribute('aria-pressed', 'true');
    }

    fireEvent.click(types.getByRole('button', { name: 'common.all' }));
    expect(onChange).toHaveBeenLastCalledWith({ digitalEmployeeType: '' });
    const permissions = within(screen.getByRole('group', { name: 'common.belong' }));
    if (activeTab === 'available') {
      expect(permissions.queryByRole('button', { name: 'resource.appliedByMe' })).toBeNull();
    } else {
      fireEvent.click(permissions.getByRole('button', { name: 'resource.appliedByMe' }));
      expect(onChange).toHaveBeenLastCalledWith({ permission: 'APPLIED_BY_ME' });
    }
  });

  it('hides employee type filtering only in enterprise recommendations and retains permission filtering', () => {
    const onChange = jest.fn();
    render(
      <ResourceQuickFilters
        resourceType="DIG_EMPLOYEE"
        activeTab="official"
        value={{ digitalEmployeeType: 'PERSONAL_GROUP', permission: 'AUTHORIZED_TO_ME' }}
        onChange={onChange}
      />
    );

    expect(screen.queryByRole('group', { name: 'resource.type' })).toBeNull();
    for (const item of digitalEmployeeTypeOptions.filter((option) => option.value)) {
      expect(screen.queryByRole('button', { name: item.label })).toBeNull();
    }
    const permissions = within(screen.getByRole('group', { name: 'common.belong' }));
    expect(permissions.getByRole('button', { name: 'resource.authorizedToMe' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(permissions.getByRole('button', { name: 'resource.appliedByMe' }));
    expect(onChange).toHaveBeenLastCalledWith({ permission: 'APPLIED_BY_ME' });
  });
});
