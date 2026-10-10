import { fireEvent, render, screen, within } from '@testing-library/react';
import ResourceQuickFilters from '..';
import {
  ALL_KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES,
  ALL_RESOURCE_BIZ_TYPE_VALUES,
  digitalEmployeeTypeOptions,
  knowledgeResourceBizTypeOptions,
  resourceBizTypeOptions,
} from '../../../constants';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

describe('resource quick filters', () => {
  it.each(
    ['TOOL', 'KG_DOC'].flatMap((resourceType) =>
      ['personal', 'enterprise', 'favorites'].map((activeTab) => ({ resourceType, activeTab }))
    )
  )('changes business types immediately in $resourceType / $activeTab', ({ resourceType, activeTab }) => {
    const options = resourceType === 'KG_DOC' ? knowledgeResourceBizTypeOptions : resourceBizTypeOptions;
    const allTypes = resourceType === 'KG_DOC' ? ALL_KNOWLEDGE_RESOURCE_BIZ_TYPE_VALUES : ALL_RESOURCE_BIZ_TYPE_VALUES;
    const onChange = jest.fn();
    const { rerender } = render(
      <ResourceQuickFilters
        resourceType={resourceType}
        activeTab={activeTab}
        resourceBizTypeFilter
        value={{ resourceBizTypeList: [...allTypes] }}
        onChange={onChange}
      />
    );
    const types = within(screen.getByRole('button', { name: options[1].label }).closest('[role="group"]')!);
    expect(screen.getByRole('group', { name: 'resource.type' })).toBeInTheDocument();
    if (activeTab === 'personal') {
      const sources = within(screen.getByRole('group', { name: 'resource.source' }));
      const suffix = resourceType === 'KG_DOC' ? 'Knowledge' : 'Tool';
      fireEvent.click(sources.getByRole('button', { name: `resource.tag.enterprise${suffix}` }));
      expect(onChange).toHaveBeenLastCalledWith({ ownerType: 'enterprise' });
    } else {
      expect(screen.queryByRole('group', { name: 'resource.source' })).toBeNull();
    }
    expect(types.getAllByRole('button')).toHaveLength(options.length);
    expect(types.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');

    for (const item of options.filter((option) => option.value)) {
      fireEvent.click(types.getByRole('button', { name: item.label }));
      expect(onChange).toHaveBeenLastCalledWith({ resourceBizTypeList: [item.value] });
      rerender(
        <ResourceQuickFilters
          resourceType={resourceType}
          activeTab={activeTab}
          resourceBizTypeFilter
          value={{ resourceBizTypeList: [item.value] }}
          onChange={onChange}
        />
      );
      expect(types.getByRole('button', { name: item.label })).toHaveAttribute('aria-pressed', 'true');
      expect(types.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'false');
    }

    fireEvent.click(types.getByRole('button', { name: 'common.all' }));
    expect(onChange).toHaveBeenLastCalledWith({ resourceBizTypeList: [] });
    rerender(
      <ResourceQuickFilters
        resourceType={resourceType}
        activeTab={activeTab}
        resourceBizTypeFilter
        value={{ resourceBizTypeList: [] }}
        onChange={onChange}
      />
    );
    expect(types.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each(['SKILL', 'KG_DOC', 'DIG_EMPLOYEE'])('does not add tool types to %s', (resourceType) => {
    render(
      <ResourceQuickFilters
        resourceType={resourceType}
        activeTab="personal"
        resourceBizTypeFilter
        value={{}}
        onChange={jest.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'resource.agent' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'resource.toolkit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'resource.mcp' })).toBeNull();
  });

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

  it('offers only enterprise types in recommendations and retains permission filtering', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <ResourceQuickFilters
        resourceType="DIG_EMPLOYEE"
        activeTab="official"
        value={{ digitalEmployeeType: 'PERSONAL_GROUP', permission: 'AUTHORIZED_TO_ME' }}
        onChange={onChange}
      />
    );

    const types = within(screen.getByRole('group', { name: 'resource.type' }));
    expect(types.getAllByRole('button')).toHaveLength(3);
    expect(types.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');
    for (const item of digitalEmployeeTypeOptions.filter((option) => option.value.startsWith('PERSONAL_'))) {
      expect(types.queryByRole('button', { name: item.label })).toBeNull();
    }
    for (const item of digitalEmployeeTypeOptions.filter((option) => option.value.startsWith('ENTERPRISE_'))) {
      fireEvent.click(types.getByRole('button', { name: item.label }));
      expect(onChange).toHaveBeenLastCalledWith({ digitalEmployeeType: item.value });
      rerender(
        <ResourceQuickFilters
          resourceType="DIG_EMPLOYEE"
          activeTab="official"
          value={{ digitalEmployeeType: item.value, permission: 'AUTHORIZED_TO_ME' }}
          onChange={onChange}
        />
      );
      expect(types.getByRole('button', { name: item.label })).toHaveAttribute('aria-pressed', 'true');
    }
    fireEvent.click(types.getByRole('button', { name: 'common.all' }));
    expect(onChange).toHaveBeenLastCalledWith({ digitalEmployeeType: '' });
    const permissions = within(screen.getByRole('group', { name: 'common.belong' }));
    expect(permissions.getByRole('button', { name: 'resource.authorizedToMe' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(permissions.getByRole('button', { name: 'resource.appliedByMe' }));
    expect(onChange).toHaveBeenLastCalledWith({ permission: 'APPLIED_BY_ME' });
  });

  it('displays all for a stale personal employee type in recommendations', () => {
    render(
      <ResourceQuickFilters
        resourceType="DIG_EMPLOYEE"
        activeTab="official"
        value={{ digitalEmployeeType: 'PERSONAL_EMPLOYEE' }}
        onChange={jest.fn()}
      />
    );
    const types = within(screen.getByRole('group', { name: 'resource.type' }));
    expect(types.getByRole('button', { name: 'common.all' })).toHaveAttribute('aria-pressed', 'true');
  });
});
