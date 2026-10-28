import { useEffect, useRef, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import { Alert, Button, DatePicker, Form, Input, Modal, Popover, Select, Space, Table, Tag, message } from 'antd';
import {
  createTenant,
  deleteTenant,
  listTenantPackages,
  listTenants,
  provisionTenant,
  type TenantItem,
  type TenantListFilter,
  type TenantPackage,
} from '../../service/TenantMgr';
import TenantOrganizationModal from './TenantOrganizationModal';
import TenantProvisionProgress from './TenantProvisionProgress';
import { shouldPollTenantProvision, tenantProvisionDisplayStatus } from './provisionStatus';

const stateColor: Record<string, string> = {
  READY: 'green',
  FAILED: 'red',
  MANUAL_REQUIRED: 'orange',
  PROVISIONING: 'blue',
  DELETING: 'orange',
  DELETE_FAILED: 'red',
};

export default function TenantMgr() {
  const intl = useIntl();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const isPlatformAdmin = (userInfo?.usersOrganizations || []).some((org: any) => org.userType === 'PLAT_MAN');
  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [packages, setPackages] = useState<TenantPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TenantItem | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [orgTenant, setOrgTenant] = useState<TenantItem | null>(null);
  const [progressTenant, setProgressTenant] = useState<TenantItem | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [createdRange, setCreatedRange] = useState<[string, string] | null>(null);
  const [sortField, setSortField] = useState<TenantListFilter['sortField']>('createdAt');
  const [sortOrder, setSortOrder] = useState<TenantListFilter['sortOrder']>('desc');
  const requestIdRef = useRef('');
  const [createForm] = Form.useForm();

  const refresh = async (
    nextSortField: TenantListFilter['sortField'] = sortField,
    nextSortOrder: TenantListFilter['sortOrder'] = sortOrder,
    silent = false
  ) => {
    if (!silent) setLoading(true);
    try {
      const result = await listTenants({
        name: nameFilter.trim(),
        createdFrom: createdRange?.[0],
        createdTo: createdRange?.[1],
        sortField: nextSortField,
        sortOrder: nextSortOrder,
      });
      const items = Array.isArray(result) ? result : [];
      setTenants(items);
      setProgressTenant((current) => items.find((item) => item.enterpriseId === current?.enterpriseId) || current);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isPlatformAdmin) return;
    void refresh();
    listTenantPackages()
      .then((result) => setPackages(Array.isArray(result) ? result : []))
      .catch(() => setPackages([]));
  }, [isPlatformAdmin]);

  const hasProvisioningTenant = tenants.some((tenant) => shouldPollTenantProvision(tenant.provisionState));
  useEffect(() => {
    if (!isPlatformAdmin || !hasProvisioningTenant) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(sortField, sortOrder, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isPlatformAdmin, hasProvisioningTenant, nameFilter, createdRange, sortField, sortOrder]);

  if (!isPlatformAdmin) return <Alert type="warning" message={intl.formatMessage({ id: 'tenant.adminOnly' })} />;

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const tenant = await createTenant({
        enterpriseName: values.enterpriseName.trim(),
        packageId: values.packageId,
        requestId: requestIdRef.current,
      });
      message.success(intl.formatMessage({ id: 'tenant.created' }));
      setCreateOpen(false);
      setProgressTenant(tenant);
      createForm.resetFields();
      requestIdRef.current = '';
      await refresh();
    } finally {
      setCreating(false);
    }
  };

  const retryProvision = async () => {
    if (!progressTenant || progressTenant.provisionState !== 'FAILED') return;
    setRetrying(true);
    try {
      await provisionTenant(progressTenant.enterpriseId);
      message.success(intl.formatMessage({ id: 'tenant.retrySubmitted' }));
      const resumed = {
        ...progressTenant,
        provisionState: progressTenant.provisionStage || 'DB_CREATING',
        failureReason: null,
      };
      setProgressTenant(resumed);
      setTenants((items) => items.map((item) => (item.enterpriseId === resumed.enterpriseId ? resumed : item)));
    } finally {
      setRetrying(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget || deleteConfirmation !== deleteTarget.enterpriseName) return;
    setDeleting(true);
    try {
      await deleteTenant(deleteTarget.enterpriseId, deleteTarget.enterpriseName);
      message.success(intl.formatMessage({ id: 'tenant.deleteSubmitted' }));
      setTenants((items) =>
        items.map((item) =>
          item.enterpriseId === deleteTarget.enterpriseId
            ? { ...item, provisionState: 'DELETING', failureReason: null }
            : item
        )
      );
      setDeleteTarget(null);
      setDeleteConfirmation('');
      setProgressTenant(null);
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{intl.formatMessage({ id: 'tenant.title' })}</h2>
        <Space>
          <Button onClick={() => void refresh()}>{intl.formatMessage({ id: 'tenant.refresh' })}</Button>
          <Button
            type="primary"
            onClick={() => {
              requestIdRef.current =
                globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
              setCreateOpen(true);
            }}
          >
            {intl.formatMessage({ id: 'tenant.create' })}
          </Button>
        </Space>
      </Space>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder={intl.formatMessage({ id: 'tenant.search' })}
          allowClear
          value={nameFilter}
          onChange={(event) => setNameFilter(event.target.value)}
          onSearch={() => void refresh()}
          style={{ width: 240 }}
        />
        <DatePicker.RangePicker
          showTime={false}
          onChange={(dates) => {
            const first = dates?.[0];
            const last = dates?.[1];
            if (!first || !last) {
              setCreatedRange(null);
              return;
            }
            setCreatedRange([
              first.startOf('day').format('YYYY-MM-DDTHH:mm:ss'),
              last.add(1, 'day').startOf('day').format('YYYY-MM-DDTHH:mm:ss'),
            ]);
          }}
        />
        <Button onClick={() => void refresh()}>{intl.formatMessage({ id: 'tenant.query' })}</Button>
      </Space>
      <Table<TenantItem>
        rowKey="enterpriseId"
        loading={loading}
        dataSource={tenants}
        tableLayout="fixed"
        scroll={{ x: 1130 }}
        onChange={(_, __, sorter) => {
          if (Array.isArray(sorter)) return;
          const field = sorter.order ? (sorter.field as TenantListFilter['sortField']) : 'createdAt';
          const order = sorter.order === 'ascend' ? 'asc' : 'desc';
          setSortField(field);
          setSortOrder(order);
          void refresh(field, order);
        }}
        columns={[
          {
            title: intl.formatMessage({ id: 'tenant.name' }),
            dataIndex: 'enterpriseName',
            width: 130,
            ellipsis: true,
            sorter: true,
            sortOrder: sortField === 'enterpriseName' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
          },
          { title: intl.formatMessage({ id: 'tenant.enterpriseId' }), dataIndex: 'enterpriseId', width: 110 },
          { title: intl.formatMessage({ id: 'tenant.package' }), dataIndex: 'packageName', width: 90 },
          {
            title: intl.formatMessage({ id: 'tenant.createdAt' }),
            dataIndex: 'createdAt',
            width: 150,
            sorter: true,
            sortOrder: sortField === 'createdAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (value: string | null) => value || '—',
          },
          {
            title: intl.formatMessage({ id: 'tenant.openedAt' }),
            dataIndex: 'openedAt',
            width: 150,
            sorter: true,
            sortOrder: sortField === 'openedAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (value: string | null) => value || '—',
          },
          {
            title: intl.formatMessage({ id: 'tenant.provisionState' }),
            dataIndex: 'provisionState',
            width: 110,
            render: (state: string, tenant: TenantItem) => {
              // 状态码用于颜色和交互，显示文案随当前语言重新计算。
              const status = tenantProvisionDisplayStatus(state);
              const label = intl.formatMessage({ id: `tenant.status.${status}` });
              return (
                <Button
                  type="link"
                  style={{ padding: 0 }}
                  onClick={() => {
                    if (!['DELETING', 'DELETE_FAILED'].includes(state)) setProgressTenant(tenant);
                  }}
                >
                  <Tag color={stateColor[status] || 'default'} style={{ cursor: 'pointer' }}>
                    {label}
                  </Tag>
                </Button>
              );
            },
          },
          {
            title: intl.formatMessage({ id: 'tenant.failureReason' }),
            dataIndex: 'failureReason',
            width: 260,
            render: (value: string | null) =>
              value ? (
                <Popover
                  trigger="click"
                  title={intl.formatMessage({ id: 'tenant.failureReason' })}
                  content={<div style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{value}</div>}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    title={intl.formatMessage({ id: 'tenant.fullReason' })}
                    style={{
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') event.currentTarget.click();
                    }}
                  >
                    {value}
                  </span>
                </Popover>
              ) : (
                '—'
              ),
          },
          {
            title: intl.formatMessage({ id: 'tenant.operations' }),
            width: 190,
            render: (_, tenant) => (
              <Space size={0}>
                <Button
                  type="link"
                  onClick={() => setOrgTenant(tenant)}
                  disabled={tenant.provisionState === 'DELETING'}
                >
                  {intl.formatMessage({ id: 'tenant.addMember' })}
                </Button>
                <Button
                  type="link"
                  danger
                  disabled={tenant.provisionState === 'DELETING'}
                  onClick={() => {
                    setDeleteConfirmation('');
                    setDeleteTarget(tenant);
                  }}
                >
                  {tenant.provisionState === 'DELETE_FAILED'
                    ? intl.formatMessage({ id: 'tenant.retryDelete' })
                    : intl.formatMessage({ id: 'tenant.delete' })}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <TenantOrganizationModal tenant={orgTenant} onClose={() => setOrgTenant(null)} />
      <TenantProvisionProgress
        tenant={progressTenant}
        onClose={() => setProgressTenant(null)}
        onRetry={() => void retryProvision()}
        retrying={retrying}
      />
      <Modal
        title={intl.formatMessage({ id: 'tenant.deleteTitle' }, { name: deleteTarget?.enterpriseName || '' })}
        open={!!deleteTarget}
        okText={intl.formatMessage({ id: 'tenant.confirmDelete' })}
        okButtonProps={{
          danger: true,
          disabled: deleteConfirmation !== deleteTarget?.enterpriseName,
          loading: deleting,
        }}
        onOk={() => void submitDelete()}
        onCancel={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteConfirmation('');
          }
        }}
      >
        <p>{intl.formatMessage({ id: 'tenant.deleteWarning' })}</p>
        <p>{intl.formatMessage({ id: 'tenant.deleteConfirmation' }, { name: deleteTarget?.enterpriseName })}</p>
        <Input
          aria-label={intl.formatMessage({ id: 'tenant.confirmName' })}
          value={deleteConfirmation}
          onChange={(event) => setDeleteConfirmation(event.target.value)}
        />
      </Modal>
      <Modal
        title={intl.formatMessage({ id: 'tenant.create' })}
        open={createOpen}
        okText={intl.formatMessage({ id: 'tenant.createConfirm' })}
        okButtonProps={{ loading: creating }}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="enterpriseName"
            label={intl.formatMessage({ id: 'tenant.name' })}
            rules={[{ required: true, max: 200 }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="packageId" label={intl.formatMessage({ id: 'tenant.package' })} rules={[{ required: true }]}>
            <Select options={packages.map((item) => ({ value: item.id, label: item.packageName }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
