import type { IOnOkParams } from '@/components/Resources/components/ResourceFilter';
import {
  ResourceQuickFilterBar,
  ResourceQuickFilterGroup,
} from '@/components/Resources/components/ResourceQuickFilters';
import { getPublicationScopeOptions } from '@/service/employeePublication';
import { useIntl } from '@umijs/max';
import { Button, Checkbox, TreeSelect } from 'antd';
import { useEffect, useState } from 'react';
import styles from './index.module.less';

type AudienceFilter = Pick<IOnOkParams, 'audienceScopeMode' | 'audienceOrgIds' | 'audienceIncludeDescendants'>;

export default function EmployeeOrganizationFilter({
  value,
  onChange,
  className,
}: {
  value: AudienceFilter;
  onChange: (value: AudienceFilter) => void;
  className?: string;
}) {
  const intl = useIntl();
  const [options, setOptions] = useState<Array<{ id: string; pId: string; value: string; title: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    getPublicationScopeOptions()
      .then((rows) => {
        if (active) {
          setOptions(
            rows.map((row) => ({ id: row.orgId, pId: row.parentOrgId, value: row.orgId, title: row.orgName }))
          );
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);

  const mode = value.audienceScopeMode || 'ALL';
  const selected = mode === 'ORGS' ? value.audienceOrgIds || [] : [];
  return (
    <ResourceQuickFilterBar className={className}>
      <div className={styles.controls}>
        <ResourceQuickFilterGroup
          title={intl.formatMessage({ id: 'digitalEmployees.audienceOrganizations' })}
          options={[
            { value: 'ALL', label: intl.formatMessage({ id: 'common.all' }) },
            { value: 'COMPANY', label: intl.formatMessage({ id: 'employeePublication.audience.all' }) },
          ]}
          value={mode}
          onChange={(next) => onChange({ audienceScopeMode: next as 'ALL' | 'COMPANY', audienceOrgIds: [] })}
        />
        <TreeSelect
          className={styles.select}
          aria-label={intl.formatMessage({ id: 'digitalEmployees.audienceFilter.select' })}
          placeholder={intl.formatMessage({ id: 'digitalEmployees.audienceFilter.select' })}
          treeDataSimpleMode
          treeData={options}
          treeCheckable
          treeCheckStrictly
          showSearch
          treeNodeFilterProp="title"
          allowClear
          maxTagCount="responsive"
          loading={loading}
          disabled={loading || failed}
          value={selected.map((id) => ({
            value: id,
            label: options.find((option) => option.value === id)?.title || id,
          }))}
          onChange={(rows) => {
            const ids = rows.map((row: { value: string }) => String(row.value));
            onChange({ audienceScopeMode: ids.length ? 'ORGS' : 'ALL', audienceOrgIds: ids });
          }}
        />
        <Checkbox
          checked={value.audienceIncludeDescendants !== false}
          disabled={!selected.length}
          onChange={(event) => onChange({ audienceIncludeDescendants: event.target.checked })}
        >
          {intl.formatMessage({ id: 'digitalEmployees.audienceFilter.includeDescendants' })}
        </Checkbox>
        {failed && (
          <Button type="link" onClick={() => setReload((count) => count + 1)}>
            {intl.formatMessage({ id: 'digitalEmployees.audienceFilter.retry' })}
          </Button>
        )}
      </div>
    </ResourceQuickFilterBar>
  );
}
