import { scopeOptions, type PublishScope, type ScopeOption, validPublishScope } from '@/service/resourcePublication';
import { getIntl, useIntl } from '@umijs/max';
import { Alert, Button, Checkbox, Modal, Radio, Select, Space, TreeSelect } from 'antd';
import { useEffect, useState } from 'react';

function OrganizationSelect({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const intl = useIntl();
  const [options, setOptions] = useState<ScopeOption[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    scopeOptions()
      .then((rows) => {
        if (active) {
          setOptions(rows);
          setError(false);
        }
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [retry]);
  if (error)
    return (
      <Button onClick={() => setRetry((v) => v + 1)}>{intl.formatMessage({ id: 'rp.retryOrganizations' })}</Button>
    );
  const ids = new Set(options.map((o) => o.orgId));
  return (
    <TreeSelect
      aria-label={intl.formatMessage({ id: 'rp.organizations' })}
      style={{ minWidth: 260, width: '100%' }}
      loading={loading}
      treeCheckable
      showSearch
      treeNodeFilterProp="title"
      treeDataSimpleMode
      treeData={options.map((o) => ({
        id: o.orgId,
        pId: ids.has(o.parentOrgId) ? o.parentOrgId : null,
        value: o.orgId,
        title: o.orgName,
      }))}
      value={value}
      onChange={onChange}
      placeholder={intl.formatMessage({ id: 'rp.organizations' })}
    />
  );
}

export default function ScopeSelector({
  value = { mode: 'COMPANY' },
  onChange,
}: {
  value?: PublishScope;
  onChange?: (scope: PublishScope) => void;
}) {
  const intl = useIntl();
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Radio.Group value={value.mode} onChange={(event) => onChange?.({ mode: event.target.value, orgIds: [] })}>
        <Radio value="COMPANY">{intl.formatMessage({ id: 'rp.company' })}</Radio>
        <Radio value="ORGS">{intl.formatMessage({ id: 'rp.organizations' })}</Radio>
      </Radio.Group>
      {value.mode === 'ORGS' && (
        <OrganizationSelect value={value.orgIds || []} onChange={(orgIds) => onChange?.({ mode: 'ORGS', orgIds })} />
      )}
      <Alert type="info" message={intl.formatMessage({ id: 'rp.notice' })} />
    </Space>
  );
}

export const choosePublishScope = () =>
  new Promise<PublishScope | undefined>((resolve) => {
    let scope: PublishScope = { mode: 'COMPANY' };
    const intl = getIntl();
    const Content = () => {
      const [value, setValue] = useState(scope);
      return (
        <ScopeSelector
          value={value}
          onChange={(next) => {
            scope = next;
            setValue(next);
          }}
        />
      );
    };
    Modal.confirm({
      title: intl.formatMessage({ id: 'rp.selectScope' }),
      width: 560,
      content: <Content />,
      onOk: () => {
        if (!validPublishScope(scope)) return Promise.reject(new Error(intl.formatMessage({ id: 'rp.organizations' })));
        resolve(scope);
      },
      onCancel: () => resolve(undefined),
    });
  });

export interface AudienceFilterValue {
  audienceScopeMode?: string;
  audienceOrgIds?: string[];
  audienceIncludeDescendants?: boolean;
}
export function AudienceFilter({
  value,
  onChange,
}: {
  value: AudienceFilterValue;
  onChange: (value: AudienceFilterValue) => void;
}) {
  const intl = useIntl();
  return (
    <Space wrap style={{ marginBottom: 12 }}>
      <span>{intl.formatMessage({ id: 'rp.scope' })}</span>
      <Select
        style={{ width: 150 }}
        value={value.audienceScopeMode || 'ALL'}
        options={['ALL', 'COMPANY', 'ORGS', 'UNSET'].map((mode) => ({
          value: mode,
          label: intl.formatMessage({ id: `rp.filter.${mode}` }),
        }))}
        onChange={(audienceScopeMode) =>
          onChange({ audienceScopeMode, audienceOrgIds: [], audienceIncludeDescendants: true })
        }
      />
      {value.audienceScopeMode === 'ORGS' && (
        <>
          <OrganizationSelect
            value={value.audienceOrgIds || []}
            onChange={(audienceOrgIds) => onChange({ ...value, audienceOrgIds })}
          />
          <Checkbox
            checked={value.audienceIncludeDescendants !== false}
            onChange={(e) => onChange({ ...value, audienceIncludeDescendants: e.target.checked })}
          >
            {intl.formatMessage({ id: 'rp.descendants' })}
          </Checkbox>
        </>
      )}
    </Space>
  );
}
