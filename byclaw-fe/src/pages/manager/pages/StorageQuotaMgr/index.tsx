import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import { useIntl } from '@umijs/max';
import FileBrowserPanel from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel';
import Pagination from '@/pages/manager/components/Pagination';
import PackageManagerModal from './components/PackageManagerModal';
import {
  downloadStorageRecyclePreview,
  grantStoragePackage,
  queryStoragePackages,
  queryStorageRecyclePreview,
  queryStorageRecycles,
  queryStorageSettings,
  queryStorageUsers,
  resetStorage,
  restoreStorage,
  updateStorageSettings,
} from '@/pages/manager/service/StorageQuotaMgr';
import styles from './index.module.less';

const { RangePicker } = DatePicker;

const formatBytes = (bytes = 0) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
};

const formatTime = (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');

const usageStatusColors: Record<string, string> = {
  NORMAL: 'success',
  WARNING: 'warning',
  EXCEEDED: 'error',
  RESETTING: 'processing',
  RESTORING: 'processing',
};

const recycleStatusColors: Record<string, string> = {
  ARCHIVING: 'processing',
  AVAILABLE: 'success',
  RESTORING: 'processing',
  RESTORED: 'default',
  PURGING: 'processing',
  PURGED: 'default',
  EXPIRED: 'warning',
  DELETING: 'processing',
  DELETED: 'default',
  FAILED: 'error',
};

const recycleStatuses = ['ARCHIVING', 'AVAILABLE', 'RESTORING', 'RESTORED', 'PURGING', 'PURGED', 'FAILED'];

interface QueryState {
  userCode?: string;
  usageStatus?: string;
  packageId?: string;
  hasValidRecycle?: boolean;
  recycleCreatedStart?: string;
  recycleCreatedEnd?: string;
  recycleExpiredStart?: string;
  recycleExpiredEnd?: string;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
}

interface SortState {
  field?: string;
  order?: 'ascend' | 'descend';
}

interface RecycleQueryState {
  recycleStatus?: string;
  createdStart?: string;
  createdEnd?: string;
  expiredStart?: string;
  expiredEnd?: string;
}

const DEFAULT_SORT_STATE: SortState = { field: 'usedBytes', order: 'descend' };
const createDefaultQuery = (): QueryState => ({ sortField: 'usedBytes', sortOrder: 'desc' });
const createDefaultRecycleQuery = (): RecycleQueryState => ({});

export const buildRecycleQuery = (values: any): RecycleQueryState => ({
  recycleStatus: values.recycleStatus,
  createdStart: values.createdRange?.[0]?.format('YYYY-MM-DD HH:mm:ss'),
  createdEnd: values.createdRange?.[1]?.format('YYYY-MM-DD HH:mm:ss'),
  expiredStart: values.expiredRange?.[0]?.format('YYYY-MM-DD HH:mm:ss'),
  expiredEnd: values.expiredRange?.[1]?.format('YYYY-MM-DD HH:mm:ss'),
});

const StorageQuotaMgr: React.FC = () => {
  const intl = useIntl();
  const { message: messageApi, modal } = App.useApp();
  const [packages, setPackages] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [recycleModalOpen, setRecycleModalOpen] = useState(false);
  const [recycleRecords, setRecycleRecords] = useState<any[]>([]);
  const [recycleUser, setRecycleUser] = useState<any>();
  const [recycleQueryParams, setRecycleQueryParams] = useState<RecycleQueryState>(createDefaultRecycleQuery);
  const [recyclePagination, setRecyclePagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [recyclePreviewOpen, setRecyclePreviewOpen] = useState(false);
  const [previewRecycle, setPreviewRecycle] = useState<any>();
  const [packageManagerOpen, setPackageManagerOpen] = useState(false);
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [grantUser, setGrantUser] = useState<any>();
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [queryParams, setQueryParams] = useState<QueryState>(createDefaultQuery);
  const [sortState, setSortState] = useState<SortState>({ ...DEFAULT_SORT_STATE });
  const [validRecycleOnly, setValidRecycleOnly] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const usersRequestIdRef = useRef(0);
  const recycleRequestIdRef = useRef(0);
  const [queryForm] = Form.useForm();
  const [recycleQueryForm] = Form.useForm();
  const [grantForm] = Form.useForm();
  const [settingsForm] = Form.useForm();

  const t = (id: string, values?: Record<string, React.ReactNode>) => intl.formatMessage({ id }, values);

  const loadMetadata = async () => {
    const [packageResponse, settingsResponse] = await Promise.all([queryStoragePackages(), queryStorageSettings()]);
    setPackages(packageResponse?.data || []);
    const settings = settingsResponse?.data;
    if (settings) {
      settingsForm.setFieldsValue({
        defaultQuotaGb: settings.defaultQuotaBytes / 1024 ** 3,
        warningPercent: settings.warningPercent,
        recycleRetentionDays: settings.recycleRetentionDays,
        downgradeGraceDays: settings.downgradeGraceDays,
      });
    }
  };

  const loadUsers = async ({
    query = queryParams,
    current = pagination.current,
    pageSize = pagination.pageSize,
  }: {
    query?: QueryState;
    current?: number;
    pageSize?: number;
  } = {}) => {
    const requestId = ++usersRequestIdRef.current;
    setLoading(true);
    try {
      const response = await queryStorageUsers({ ...query, pageNum: current, pageSize });
      if (requestId !== usersRequestIdRef.current) return;
      const pageData = response?.data || {};
      const records = pageData.records || pageData.list || [];
      setUsers(records);
      setPagination({
        current: Number(pageData.current || current),
        pageSize: Number(pageData.size || pageSize),
        total: Number(pageData.total ?? records.length),
      });
    } finally {
      if (requestId === usersRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadMetadata();
    loadUsers({ query: createDefaultQuery(), current: 1, pageSize: 10 });
  }, []);

  const saveSettings = async () => {
    const values = await settingsForm.validateFields();
    await updateStorageSettings({
      defaultQuotaBytes: values.defaultQuotaGb * 1024 ** 3,
      warningPercent: values.warningPercent,
      recycleRetentionDays: values.recycleRetentionDays,
      downgradeGraceDays: values.downgradeGraceDays,
    });
    messageApi.success(t('storageQuota.policy.saved'));
    setSettingsModalOpen(false);
    await loadMetadata();
  };

  const enabledPackages = packages.filter((item) => item.status === 'ENABLED');

  const openGrant = (record: any) => {
    if (!enabledPackages.length) {
      messageApi.warning(t('storageQuota.package.emptyWarning'));
      return;
    }
    setGrantUser(record);
    setGrantModalOpen(true);
    grantForm.setFieldsValue({ packageId: enabledPackages.length === 1 ? enabledPackages[0].packageId : undefined });
  };

  const grant = async () => {
    const values = await grantForm.validateFields();
    await grantStoragePackage({ userId: grantUser.userId, packageId: values.packageId, remark: values.remark });
    messageApi.success(t('storageQuota.grant.success'));
    setGrantModalOpen(false);
    grantForm.resetFields();
    await Promise.all([loadUsers(), loadMetadata()]);
  };

  const openPackageManager = async () => {
    setPackageManagerOpen(true);
    await loadMetadata();
  };

  const reset = (record: any) => {
    modal.confirm({
      title: t('storageQuota.reset.title'),
      content: t('storageQuota.reset.confirm'),
      okType: 'danger',
      onOk: async () => {
        await resetStorage({ userId: record.userId });
        messageApi.success(t('storageQuota.reset.success'));
        await loadUsers();
      },
    });
  };

  const loadRecycles = async ({
    user = recycleUser,
    query = recycleQueryParams,
    current = recyclePagination.current,
    pageSize = recyclePagination.pageSize,
  }: {
    user?: any;
    query?: RecycleQueryState;
    current?: number;
    pageSize?: number;
  } = {}) => {
    if (!user?.userId) return;
    const requestId = ++recycleRequestIdRef.current;
    setRecycleLoading(true);
    try {
      const response = await queryStorageRecycles({
        userId: user.userId,
        ...query,
        pageNum: current,
        pageSize,
      });
      if (requestId !== recycleRequestIdRef.current) return;
      const pageData = response?.data || {};
      const records = Array.isArray(pageData) ? pageData : pageData.records || pageData.list || [];
      setRecycleRecords(records);
      setRecyclePagination({
        current: Number(Array.isArray(pageData) ? current : pageData.current || current),
        pageSize: Number(Array.isArray(pageData) ? pageSize : pageData.size || pageSize),
        total: Number(Array.isArray(pageData) ? records.length : pageData.total ?? records.length),
      });
    } finally {
      if (requestId === recycleRequestIdRef.current) {
        setRecycleLoading(false);
      }
    }
  };

  const openRecycles = async (record: any) => {
    const nextQuery = createDefaultRecycleQuery();
    recycleQueryForm.resetFields();
    setRecycleUser(record);
    setRecycleQueryParams(nextQuery);
    setRecyclePagination({ current: 1, pageSize: 10, total: 0 });
    setRecycleRecords([]);
    setRecycleModalOpen(true);
    await loadRecycles({ user: record, query: nextQuery, current: 1, pageSize: 10 });
  };

  const searchRecycles = async (values: any) => {
    const nextQuery = buildRecycleQuery(values);
    setRecycleQueryParams(nextQuery);
    setRecyclePagination((previous) => ({ ...previous, current: 1 }));
    await loadRecycles({ query: nextQuery, current: 1, pageSize: recyclePagination.pageSize });
  };

  const clearRecycleSearch = async () => {
    recycleQueryForm.resetFields();
    const nextQuery = createDefaultRecycleQuery();
    setRecycleQueryParams(nextQuery);
    setRecyclePagination((previous) => ({ ...previous, current: 1 }));
    await loadRecycles({ query: nextQuery, current: 1, pageSize: recyclePagination.pageSize });
  };

  const changeRecyclePage = async (current: number, pageSize: number) => {
    const nextCurrent = pageSize !== recyclePagination.pageSize ? 1 : current;
    setRecyclePagination((previous) => ({ ...previous, current: nextCurrent, pageSize }));
    await loadRecycles({ query: recycleQueryParams, current: nextCurrent, pageSize });
  };

  const openRecyclePreview = (record: any) => {
    setPreviewRecycle(record);
    setRecyclePreviewOpen(true);
  };

  const listRecyclePreview = useCallback(
    (path: string) =>
      queryStorageRecyclePreview({
        userId: recycleUser?.userId,
        recycleId: previewRecycle?.recycleId,
        path,
      }),
    [recycleUser?.userId, previewRecycle?.recycleId]
  );

  const downloadRecyclePreview = useCallback(
    (path: string) => downloadStorageRecyclePreview(recycleUser?.userId, previewRecycle?.recycleId, path),
    [recycleUser?.userId, previewRecycle?.recycleId]
  );

  const restore = (record: any) => {
    modal.confirm({
      title: t('storageQuota.recycle.restoreTitle'),
      content: t('storageQuota.recycle.restoreConfirm'),
      onOk: async () => {
        await restoreStorage({ userId: recycleUser.userId, recycleId: record.recycleId });
        messageApi.success(t('storageQuota.recycle.restoreSuccess'));
        const targetPage =
          recycleRecords.length === 1 && recyclePagination.current > 1
            ? recyclePagination.current - 1
            : recyclePagination.current;
        await Promise.all([
          loadRecycles({ query: recycleQueryParams, current: targetPage, pageSize: recyclePagination.pageSize }),
          loadUsers(),
        ]);
      },
    });
  };

  const buildQuery = (values: any, hasValidRecycle = validRecycleOnly): QueryState => ({
    userCode: values.userCode?.trim() || undefined,
    usageStatus: values.usageStatus,
    packageId: values.packageId,
    hasValidRecycle: hasValidRecycle || undefined,
    recycleCreatedStart: values.recycleCreatedRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
    recycleCreatedEnd: values.recycleCreatedRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
    recycleExpiredStart: values.recycleExpiredRange?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss'),
    recycleExpiredEnd: values.recycleExpiredRange?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss'),
    sortField: sortState.field,
    sortOrder: sortState.order === 'ascend' ? 'asc' : sortState.order === 'descend' ? 'desc' : undefined,
  });

  const search = async (values: any) => {
    const nextQuery = buildQuery(values);
    setQueryParams(nextQuery);
    setPagination((previous) => ({ ...previous, current: 1 }));
    await loadUsers({ query: nextQuery, current: 1, pageSize: pagination.pageSize });
  };

  const clearSearch = async () => {
    queryForm.resetFields();
    setValidRecycleOnly(false);
    const nextQuery = createDefaultQuery();
    setQueryParams(nextQuery);
    setSortState({ ...DEFAULT_SORT_STATE });
    setPagination((previous) => ({ ...previous, current: 1 }));
    await loadUsers({ query: nextQuery, current: 1, pageSize: pagination.pageSize });
  };

  const changeValidRecycleOnly = async (checked: boolean) => {
    setValidRecycleOnly(checked);
    const nextQuery = buildQuery(queryForm.getFieldsValue(), checked);
    setQueryParams(nextQuery);
    setPagination((previous) => ({ ...previous, current: 1 }));
    await loadUsers({ query: nextQuery, current: 1, pageSize: pagination.pageSize });
  };

  const handleTableChange: TableProps<any>['onChange'] = async (_nextPagination, _filters, sorter) => {
    const sorterItem = Array.isArray(sorter) ? sorter[0] : sorter;
    const nextSort: SortState = sorterItem?.order
      ? { field: String(sorterItem.columnKey || sorterItem.field), order: sorterItem.order }
      : { ...DEFAULT_SORT_STATE };
    const nextQuery: QueryState = {
      ...queryParams,
      sortField: nextSort.field,
      sortOrder: nextSort.order === 'ascend' ? 'asc' : nextSort.order === 'descend' ? 'desc' : undefined,
    };
    setSortState(nextSort);
    setQueryParams(nextQuery);
    setPagination((previous) => ({ ...previous, current: 1 }));
    await loadUsers({
      query: nextQuery,
      current: 1,
      pageSize: pagination.pageSize,
    });
  };

  const changePage = async (current: number, pageSize: number) => {
    const nextCurrent = pageSize !== pagination.pageSize ? 1 : current;
    setPagination((previous) => ({ ...previous, current: nextCurrent, pageSize }));
    await loadUsers({ query: queryParams, current: nextCurrent, pageSize });
  };

  const renderUsageStatus = (status?: string, firstQuotaLimit?: boolean) => (
    <Space size={[4, 4]} wrap>
      <Tag color={usageStatusColors[status || ''] || 'default'}>{t(`storageQuota.status.${status || 'UNKNOWN'}`)}</Tag>
      {firstQuotaLimit ? <Tag color="orange">{t('storageQuota.status.firstQuotaLimit')}</Tag> : null}
    </Space>
  );

  const renderRecycleStatus = (status?: string) => (
    <Tag color={recycleStatusColors[status || ''] || 'default'}>
      {t(`storageQuota.recycleStatus.${status || 'FAILED'}`)}
    </Tag>
  );

  const columns: TableProps<any>['columns'] = [
    { title: t('storageQuota.column.userCode'), dataIndex: 'userCode', key: 'userCode', width: 150 },
    {
      title: t('storageQuota.column.usage'),
      key: 'usedBytes',
      width: 210,
      sorter: true,
      sortOrder: sortState.field === 'usedBytes' ? sortState.order : null,
      render: (_, record) => {
        const total = Number(record.totalQuotaBytes || 0);
        const used = Number(record.usedBytes || 0);
        const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 100;
        return (
          <Space direction="vertical" size={0} style={{ width: 180 }}>
            <span>
              {formatBytes(used)} / {formatBytes(total)}
            </span>
            <Progress percent={percent} size="small" status={percent >= 100 ? 'exception' : 'normal'} />
          </Space>
        );
      },
    },
    {
      title: t('storageQuota.column.status'),
      dataIndex: 'usageStatus',
      key: 'usageStatus',
      width: 160,
      sorter: true,
      sortOrder: sortState.field === 'usageStatus' ? sortState.order : null,
      render: (value, record) => renderUsageStatus(value, record.firstQuotaLimit),
    },
    {
      title: t('storageQuota.column.packageLevel'),
      dataIndex: 'activePackages',
      key: 'activePackages',
      width: 220,
      render: (activePackages: any[] = []) =>
        activePackages.length ? (
          <Space size={[4, 4]} wrap>
            {activePackages.map((item) => (
              <Tooltip key={item.packageId} title={`+${formatBytes(item.totalGrantedBytes)}`}>
                <Tag color="blue">
                  {item.packageName}
                  {item.quantity > 1 ? ` ${t('storageQuota.package.quantity', { quantity: item.quantity })}` : ''}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        ) : (
          <Tag>{t('storageQuota.package.base')}</Tag>
        ),
    },
    {
      title: t('storageQuota.column.recycleCreatedTime'),
      dataIndex: 'recycleCreatedTime',
      key: 'recycleCreatedTime',
      width: 180,
      sorter: true,
      sortOrder: sortState.field === 'recycleCreatedTime' ? sortState.order : null,
      render: formatTime,
    },
    {
      title: t('storageQuota.column.recycleExpiredTime'),
      dataIndex: 'recycleExpiredTime',
      key: 'recycleExpiredTime',
      width: 180,
      sorter: true,
      sortOrder: sortState.field === 'recycleExpiredTime' ? sortState.order : null,
      render: formatTime,
    },
    {
      title: t('storageQuota.column.operation'),
      key: 'operation',
      fixed: 'right',
      width: 330,
      render: (_, record) => {
        const validRecycleCount = Math.max(0, Number(record.validRecycleCount || 0));
        return (
          <Space size={[8, 8]} wrap>
            <Button size="small" onClick={() => openGrant(record)}>
              {t('storageQuota.action.grantPackage')}
            </Button>
            <Button size="small" danger onClick={() => reset(record)}>
              {t('storageQuota.action.resetStorage')}
            </Button>
            <Badge
              count={validRecycleCount}
              overflowCount={99}
              size="small"
              offset={[-2, 2]}
              title={t('storageQuota.recycle.validCount', { count: validRecycleCount })}
            >
              <Button size="small" onClick={() => openRecycles(record)}>
                {t('storageQuota.action.recycleBin')}
              </Button>
            </Badge>
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      title={intl.formatMessage({ id: 'menu.storageQuota', defaultMessage: '存储配额管理' })}
      className={styles.card}
      styles={{ body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
    >
      <Space className={styles.actionToolbar} wrap>
        <Button type="primary" onClick={openPackageManager}>
          {t('storageQuota.action.packageManager')}
        </Button>
        <Button onClick={() => setSettingsModalOpen(true)}>{t('storageQuota.action.storagePolicy')}</Button>
        <Checkbox checked={validRecycleOnly} onChange={(event) => changeValidRecycleOnly(event.target.checked)}>
          <Tooltip title={t('storageQuota.filter.validRecycleOnlyTooltip')}>
            <span>{t('storageQuota.filter.validRecycleOnly')}</span>
          </Tooltip>
        </Checkbox>
      </Space>

      <Form
        form={queryForm}
        name="storage-quota-query"
        layout="vertical"
        onFinish={search}
        className={styles.queryForm}
      >
        <div className={styles.queryGrid}>
          <Form.Item name="userCode" label={t('storageQuota.filter.userCode')} className={styles.queryCompact}>
            <Input allowClear placeholder={t('storageQuota.filter.userCodePlaceholder')} />
          </Form.Item>
          <Form.Item name="usageStatus" label={t('storageQuota.filter.status')} className={styles.queryCompact}>
            <Select
              allowClear
              placeholder={t('storageQuota.filter.statusPlaceholder')}
              options={['NORMAL', 'WARNING', 'EXCEEDED', 'RESETTING', 'RESTORING'].map((value) => ({
                value,
                label: t(`storageQuota.status.${value}`),
              }))}
            />
          </Form.Item>
          <Form.Item name="packageId" label={t('storageQuota.filter.package')} className={styles.queryCompact}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t('storageQuota.filter.packagePlaceholder')}
              options={packages.map((item) => ({
                value: item.packageId,
                label: t('storageQuota.package.option', {
                  name: item.packageName,
                  size: formatBytes(item.addonBytes),
                }),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="recycleCreatedRange"
            label={t('storageQuota.filter.createdTime')}
            className={styles.queryDate}
          >
            <RangePicker
              allowClear
              style={{ width: '100%' }}
              placeholder={[t('storageQuota.filter.datePlaceholderStart'), t('storageQuota.filter.datePlaceholderEnd')]}
            />
          </Form.Item>
          <Form.Item
            name="recycleExpiredRange"
            label={t('storageQuota.filter.expiredTime')}
            className={styles.queryDate}
          >
            <RangePicker
              allowClear
              style={{ width: '100%' }}
              placeholder={[t('storageQuota.filter.datePlaceholderStart'), t('storageQuota.filter.datePlaceholderEnd')]}
            />
          </Form.Item>
          <div className={styles.queryActions}>
            <Button type="primary" htmlType="submit">
              {t('storageQuota.action.search')}
            </Button>
            <Button onClick={clearSearch}>{t('storageQuota.action.clear')}</Button>
          </div>
        </div>
      </Form>

      <div className={styles.tableViewport} data-testid="storage-quota-table-viewport">
        <Table
          rowKey="storageQuotaId"
          loading={loading}
          dataSource={users}
          columns={columns}
          scroll={{ x: 1480 }}
          pagination={false}
          sticky
          onChange={handleTableChange}
        />
      </div>
      <Pagination
        pageAllCount={users.length}
        paginationBorderBox={styles.paginationFixed}
        tableFooterBox={styles.paginationFixed}
        pagination={{
          current: pagination.current,
          pageSize: pagination.pageSize,
          total: pagination.total,
          onChange: changePage,
          showSelectInf: false,
        }}
      />

      <PackageManagerModal
        open={packageManagerOpen}
        packages={packages}
        onClose={() => setPackageManagerOpen(false)}
        onPackagesChanged={loadMetadata}
      />

      <Modal
        open={grantModalOpen}
        title={t('storageQuota.grant.title', { userCode: grantUser?.userCode || '-' })}
        onCancel={() => {
          setGrantModalOpen(false);
          grantForm.resetFields();
        }}
        onOk={grant}
        forceRender
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {!grantUser?.hasGrantHistory ? (
            <Alert type="info" showIcon message={t('storageQuota.grant.firstHint')} />
          ) : null}
          <Form form={grantForm} name="storage-quota-grant" layout="vertical" style={{ width: '100%' }}>
            <Form.Item name="packageId" label={t('storageQuota.grant.package')} rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={enabledPackages.map((item) => ({
                  value: item.packageId,
                  label: t('storageQuota.package.option', {
                    name: item.packageName,
                    size: formatBytes(item.addonBytes),
                  }),
                }))}
              />
            </Form.Item>
            <Form.Item name="remark" label={t('storageQuota.grant.remark')}>
              <Input.TextArea rows={3} placeholder={t('storageQuota.grant.remarkPlaceholder')} maxLength={512} />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        open={settingsModalOpen}
        title={t('storageQuota.policy.title')}
        onCancel={() => setSettingsModalOpen(false)}
        onOk={saveSettings}
        forceRender
      >
        <Form form={settingsForm} name="storage-quota-settings" layout="vertical">
          <Form.Item name="defaultQuotaGb" label={t('storageQuota.policy.defaultQuota')} rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} suffix="GB" />
          </Form.Item>
          <Form.Item name="warningPercent" label={t('storageQuota.policy.warningPercent')} rules={[{ required: true }]}>
            <InputNumber min={1} max={99} style={{ width: '100%' }} suffix="%" />
          </Form.Item>
          <Form.Item
            name="recycleRetentionDays"
            label={t('storageQuota.policy.recycleDays')}
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} suffix={t('storageQuota.policy.dayUnit')} />
          </Form.Item>
          <Form.Item
            name="downgradeGraceDays"
            label={t('storageQuota.policy.downgradeGraceDays')}
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} suffix={t('storageQuota.policy.dayUnit')} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={recycleModalOpen}
        width={1180}
        title={t('storageQuota.recycle.title', {
          userCode: recycleUser?.userCode ? ` · ${recycleUser.userCode}` : '',
        })}
        footer={null}
        destroyOnHidden
        onCancel={() => {
          recycleRequestIdRef.current += 1;
          setRecycleModalOpen(false);
        }}
      >
        <Form
          form={recycleQueryForm}
          name="storage-recycle-query"
          layout="vertical"
          onFinish={searchRecycles}
          className={styles.recycleQueryForm}
        >
          <div className={styles.recycleQueryGrid}>
            <Form.Item
              name="recycleStatus"
              label={t('storageQuota.filter.status')}
              className={styles.recycleQueryStatus}
            >
              <Select
                allowClear
                placeholder={t('storageQuota.filter.statusPlaceholder')}
                options={recycleStatuses.map((value) => ({
                  value,
                  label: t(`storageQuota.recycleStatus.${value}`),
                }))}
              />
            </Form.Item>
            <Form.Item
              name="createdRange"
              label={t('storageQuota.filter.createdTime')}
              className={styles.recycleQueryDate}
            >
              <RangePicker
                allowClear
                showTime={{ format: 'HH:mm:ss' }}
                format="YYYY-MM-DD HH:mm:ss"
                style={{ width: '100%' }}
                placeholder={[
                  t('storageQuota.filter.timePlaceholderStart'),
                  t('storageQuota.filter.timePlaceholderEnd'),
                ]}
              />
            </Form.Item>
            <Form.Item
              name="expiredRange"
              label={t('storageQuota.filter.expiredTime')}
              className={styles.recycleQueryDate}
            >
              <RangePicker
                allowClear
                showTime={{ format: 'HH:mm:ss' }}
                format="YYYY-MM-DD HH:mm:ss"
                style={{ width: '100%' }}
                placeholder={[
                  t('storageQuota.filter.timePlaceholderStart'),
                  t('storageQuota.filter.timePlaceholderEnd'),
                ]}
              />
            </Form.Item>
            <div className={styles.recycleQueryActions}>
              <Button type="primary" htmlType="submit">
                {t('storageQuota.action.search')}
              </Button>
              <Button onClick={clearRecycleSearch}>{t('storageQuota.action.clear')}</Button>
            </div>
          </div>
        </Form>

        <div className={styles.recycleTable}>
          <Table
            rowKey="recycleId"
            loading={recycleLoading}
            dataSource={recycleRecords}
            pagination={false}
            scroll={{ x: 920 }}
            columns={[
              {
                title: t('storageQuota.column.archiveBytes'),
                dataIndex: 'archiveBytes',
                width: 150,
                render: (value) => formatBytes(value),
              },
              {
                title: t('storageQuota.column.status'),
                dataIndex: 'recycleStatus',
                width: 140,
                render: renderRecycleStatus,
              },
              {
                title: t('storageQuota.column.recycleCreatedTime'),
                dataIndex: 'startedTime',
                width: 210,
                render: formatTime,
              },
              {
                title: t('storageQuota.column.recycleExpiredTime'),
                dataIndex: 'retentionUntil',
                width: 210,
                render: formatTime,
              },
              {
                title: t('storageQuota.column.operation'),
                width: 180,
                render: (_, record) =>
                  record.recycleStatus === 'AVAILABLE' ? (
                    <Space>
                      <Button size="small" onClick={() => openRecyclePreview(record)}>
                        {t('storageQuota.action.preview')}
                      </Button>
                      <Button type="primary" size="small" onClick={() => restore(record)}>
                        {t('storageQuota.action.restore')}
                      </Button>
                    </Space>
                  ) : (
                    '-'
                  ),
              },
            ]}
          />
        </div>
        <Pagination
          pageAllCount={recycleRecords.length}
          paginationBorderBox={styles.recyclePagination}
          tableFooterBox={styles.recyclePagination}
          pagination={{
            current: recyclePagination.current,
            pageSize: recyclePagination.pageSize,
            total: recyclePagination.total,
            onChange: changeRecyclePage,
            showSelectInf: false,
          }}
        />
      </Modal>

      <Modal
        open={recyclePreviewOpen}
        width={1080}
        title={t('storageQuota.recycle.previewTitle', {
          userCode: recycleUser?.userCode ? ` · ${recycleUser.userCode}` : '',
        })}
        footer={null}
        destroyOnHidden
        onCancel={() => {
          setRecyclePreviewOpen(false);
          setPreviewRecycle(undefined);
        }}
      >
        <Alert type="info" showIcon message={t('storageQuota.recycle.previewReadonly')} style={{ marginBottom: 12 }} />
        <div style={{ height: 520 }}>
          {recyclePreviewOpen && recycleUser?.userId && previewRecycle?.recycleId ? (
            <FileBrowserPanel
              resourceId={`recycle-${recycleUser.userId}-${previewRecycle.recycleId}`}
              mode="preview"
              initialPath="/"
              listProvider={listRecyclePreview}
              downloadProvider={downloadRecyclePreview}
              showSearch={false}
              showDownloadAction={false}
            />
          ) : null}
        </div>
      </Modal>
    </Card>
  );
};

export default StorageQuotaMgr;
