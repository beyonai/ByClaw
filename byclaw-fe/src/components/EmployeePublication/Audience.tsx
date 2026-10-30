import { getPublicationScopeOptions, type PublicationTarget } from '@/service/employeePublication';
import { useIntl } from '@umijs/max';
import { Alert, Button, Radio, Space, Table, Tag, TreeSelect, message } from 'antd';
import { useEffect, useState } from 'react';

export default function PublicationAudience({
  targets,
  editable,
  update,
  value,
  onChange,
  busy,
  canReview,
  onReview,
}: {
  targets: PublicationTarget[];
  editable: boolean;
  update: boolean;
  value: string[];
  onChange: (value: string[]) => void;
  busy: boolean;
  canReview: boolean;
  onReview: (orgId: string, approved: boolean) => void;
}) {
  const intl = useIntl();
  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!editable || update) return undefined;
    let active = true;
    setLoading(true);
    getPublicationScopeOptions()
      .then((rows) => {
        if (active)
          setOptions(
            rows.map((row) => ({ id: row.orgId, pId: row.parentOrgId, value: row.orgId, title: row.orgName }))
          );
      })
      .catch((error) => {
        if (active) message.error(error?.message || intl.formatMessage({ id: 'employeePublication.refreshFailed' }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [editable, update]);
  const reviewColumn = {
    title: intl.formatMessage({ id: 'common.operation' }),
    key: 'actions',
    render: (_: any, row: PublicationTarget) =>
      row.canReview && row.status === 'PENDING' ? (
        <Space>
          <Button size="small" disabled={busy} onClick={() => onReview(row.orgId, true)}>
            {intl.formatMessage({ id: 'employeePublication.audience.approve' })}
          </Button>
          <Button size="small" disabled={busy} onClick={() => onReview(row.orgId, false)}>
            {intl.formatMessage({ id: 'employeePublication.toolbar.reject' })}
          </Button>
        </Space>
      ) : null,
  };
  const all = value.includes('-1');
  return (
    <Space direction="vertical" style={{ width: '100%', marginBlock: 12 }}>
      <strong>{intl.formatMessage({ id: 'employeePublication.audience.title' })}</strong>
      {editable && !update && (
        <>
          <Radio.Group
            value={all ? 'ALL' : 'ORGS'}
            disabled={busy}
            onChange={(event) => onChange(event.target.value === 'ALL' ? ['-1'] : [])}
          >
            <Radio value="ALL">{intl.formatMessage({ id: 'employeePublication.audience.all' })}</Radio>
            <Radio value="ORGS">{intl.formatMessage({ id: 'employeePublication.audience.organizations' })}</Radio>
          </Radio.Group>
          {!all && (
            <TreeSelect
              aria-label={intl.formatMessage({ id: 'employeePublication.audience.organizations' })}
              style={{ width: '100%' }}
              treeData={options}
              treeDataSimpleMode
              treeCheckable
              allowClear
              showCheckedStrategy={TreeSelect.SHOW_PARENT}
              value={value}
              loading={loading}
              disabled={busy || loading}
              onChange={(ids) => onChange(ids.map(String))}
            />
          )}
        </>
      )}
      <Alert
        type="info"
        showIcon
        message={intl.formatMessage({
          id: update ? 'employeePublication.audience.updateHint' : 'employeePublication.audience.initialHint',
        })}
      />
      <Table<PublicationTarget>
        size="small"
        pagination={false}
        rowKey="orgId"
        dataSource={targets}
        columns={[
          {
            title: intl.formatMessage({ id: 'employeePublication.audience.title' }),
            render: (_, row) =>
              row.orgId === '-1' ? intl.formatMessage({ id: 'employeePublication.audience.all' }) : row.orgName,
          },
          {
            title: intl.formatMessage({ id: 'employeePublication.audience.status' }),
            render: (_, row) => (
              <Tag color={row.status === 'APPROVED' ? 'success' : row.status === 'REJECTED' ? 'error' : 'processing'}>
                {intl.formatMessage({ id: `employeePublication.audience.${row.status}` })}
              </Tag>
            ),
          },
          { title: intl.formatMessage({ id: 'employeePublication.audience.reviewer' }), dataIndex: 'reviewerName' },
          { title: intl.formatMessage({ id: 'employeePublication.audience.comment' }), dataIndex: 'comment' },
          ...(canReview ? [reviewColumn] : []),
        ]}
      />
    </Space>
  );
}
