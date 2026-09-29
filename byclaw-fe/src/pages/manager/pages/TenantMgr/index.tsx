import { useEffect, useRef, useState } from 'react';
import { useSelector } from '@umijs/max';
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
import { tenantProvisionDisplayStatus } from './provisionStatus';

const stateColor: Record<string, string> = {
  已开通: 'green',
  失败: 'red',
  开通中: 'blue',
  删除中: 'orange',
  删除失败: 'red',
};

export default function TenantMgr() {
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

  const hasProvisioningTenant = tenants.some(
    (tenant) => !['READY', 'FAILED', 'UNAVAILABLE'].includes(tenant.provisionState)
  );
  useEffect(() => {
    if (!isPlatformAdmin || !hasProvisioningTenant) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(sortField, sortOrder, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isPlatformAdmin, hasProvisioningTenant, nameFilter, createdRange, sortField, sortOrder]);

  if (!isPlatformAdmin) return <Alert type="warning" message="仅平台管理员可管理租户。" />;

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    setCreating(true);
    try {
      const tenant = await createTenant({
        enterpriseName: values.enterpriseName.trim(),
        packageId: values.packageId,
        requestId: requestIdRef.current,
      });
      message.success('租户已创建，正在执行开通流程');
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
    if (!progressTenant) return;
    setRetrying(true);
    try {
      await provisionTenant(progressTenant.enterpriseId);
      message.success('已重新提交开通任务');
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
      message.success('已提交租户删除，正在清理沙箱和数据');
      setTenants((items) => items.map((item) => item.enterpriseId === deleteTarget.enterpriseId
        ? { ...item, provisionState: 'DELETING', failureReason: null } : item));
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
        <h2 style={{ margin: 0 }}>租户管理</h2>
        <Space>
          <Button onClick={() => void refresh()}>刷新</Button>
          <Button
            type="primary"
            onClick={() => {
              requestIdRef.current =
                globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
              setCreateOpen(true);
            }}
          >
            创建租户
          </Button>
        </Space>
      </Space>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder="按租户名称搜索"
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
        <Button onClick={() => void refresh()}>查询</Button>
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
            title: '租户名称',
            dataIndex: 'enterpriseName',
            width: 130,
            ellipsis: true,
            sorter: true,
            sortOrder: sortField === 'enterpriseName' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
          },
          { title: '企业 ID', dataIndex: 'enterpriseId', width: 110 },
          { title: '套餐', dataIndex: 'packageName', width: 90 },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            width: 150,
            sorter: true,
            sortOrder: sortField === 'createdAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (value: string | null) => value || '—',
          },
          {
            title: '开通时间',
            dataIndex: 'openedAt',
            width: 150,
            sorter: true,
            sortOrder: sortField === 'openedAt' ? (sortOrder === 'asc' ? 'ascend' : 'descend') : null,
            render: (value: string | null) => value || '—',
          },
          {
            title: '开通状态',
            dataIndex: 'provisionState',
            width: 110,
            render: (state: string, tenant: TenantItem) => {
              const label = tenantProvisionDisplayStatus(state);
              return (
                <Button type="link" style={{ padding: 0 }}
                  onClick={() => {
                    if (!['DELETING', 'DELETE_FAILED'].includes(state)) setProgressTenant(tenant);
                  }}>
                  <Tag color={stateColor[label] || 'default'} style={{ cursor: 'pointer' }}>
                    {label}
                  </Tag>
                </Button>
              );
            },
          },
          {
            title: '开通失败原因',
            dataIndex: 'failureReason',
            width: 260,
            render: (value: string | null) =>
              value ? (
                <Popover
                  trigger="click"
                  title="开通失败原因"
                  content={<div style={{ maxWidth: 420, overflowWrap: 'anywhere' }}>{value}</div>}
                >
                  <span
                    role="button"
                    tabIndex={0}
                    title="点击查看完整原因"
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
            title: '操作',
            width: 190,
            render: (_, tenant) => (
              <Space size={0}>
                <Button type="link" onClick={() => setOrgTenant(tenant)} disabled={tenant.provisionState === 'DELETING'}>
                  添加成员
                </Button>
                <Button type="link" danger disabled={tenant.provisionState === 'DELETING'}
                  onClick={() => {
                    setDeleteConfirmation('');
                    setDeleteTarget(tenant);
                  }}>
                  {tenant.provisionState === 'DELETE_FAILED' ? '重试删除' : '删除租户'}
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
        title={`删除租户：${deleteTarget?.enterpriseName || ''}`}
        open={!!deleteTarget}
        okText="确认删除"
        okButtonProps={{ danger: true, disabled: deleteConfirmation !== deleteTarget?.enterpriseName, loading: deleting }}
        onOk={() => void submitDelete()}
        onCancel={() => {
          if (!deleting) {
            setDeleteTarget(null);
            setDeleteConfirmation('');
          }
        }}
      >
        <p>删除后将释放该租户的数据库和数据服务沙箱，并删除其私有持久化数据。此操作不可撤销。</p>
        <p>请输入租户名称 <strong>{deleteTarget?.enterpriseName}</strong> 以确认：</p>
        <Input aria-label="输入租户名称确认删除" value={deleteConfirmation}
          onChange={(event) => setDeleteConfirmation(event.target.value)} />
      </Modal>
      <Modal
        title="创建租户"
        open={createOpen}
        okText="创建"
        okButtonProps={{ loading: creating }}
        onOk={() => void submitCreate()}
        onCancel={() => setCreateOpen(false)}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="enterpriseName" label="租户名称" rules={[{ required: true, max: 200 }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="packageId" label="套餐" rules={[{ required: true }]}>
            <Select options={packages.map((item) => ({ value: item.id, label: item.packageName }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
