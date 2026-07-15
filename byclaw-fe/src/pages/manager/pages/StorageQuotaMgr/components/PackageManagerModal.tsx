import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import { useIntl } from '@umijs/max';
import Pagination from '@/pages/manager/components/Pagination';
import {
  approveStorageCancellation,
  cancelStorageGrant,
  deleteStoragePackage,
  previewStorageGrantCancellation,
  queryActiveStorageGrants,
  queryStorageCancellations,
  rejectStorageCancellation,
  upsertStoragePackage,
} from '@/pages/manager/service/StorageQuotaMgr';
import styles from '../index.module.less';

interface PackageManagerModalProps {
  open: boolean;
  packages: any[];
  onClose: () => void;
  onPackagesChanged: () => Promise<void>;
}

interface ActiveGrantQuery {
  userCode?: string;
  packageId?: string;
}

interface CancellationQuery {
  userCode?: string;
  downgradeStatus?: string;
  requestType?: string;
}

const cancellationStatusColors: Record<string, string> = {
  REQUESTED: 'processing',
  GRACE: 'warning',
  ARCHIVING: 'processing',
  COMPLETED: 'success',
  ARCHIVED: 'default',
  CANCELLED: 'default',
  REJECTED: 'error',
};

const cancellationStatuses = ['REQUESTED', 'GRACE', 'ARCHIVING', 'COMPLETED', 'ARCHIVED', 'CANCELLED', 'REJECTED'];

const formatBytes = (bytes = 0) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
};

const formatTime = (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');

const PackageManagerModal: React.FC<PackageManagerModalProps> = ({ open, packages, onClose, onPackagesChanged }) => {
  const intl = useIntl();
  const { message: messageApi } = App.useApp();
  const t = (id: string, values?: Record<string, React.ReactNode>) => intl.formatMessage({ id }, values);
  const [activeTab, setActiveTab] = useState('packages');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<any>();
  const [activeGrants, setActiveGrants] = useState<any[]>([]);
  const [activeGrantLoading, setActiveGrantLoading] = useState(false);
  const [activeGrantQuery, setActiveGrantQuery] = useState<ActiveGrantQuery>({});
  const [activeGrantPagination, setActiveGrantPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [cancellations, setCancellations] = useState<any[]>([]);
  const [cancellationLoading, setCancellationLoading] = useState(false);
  const [cancellationQuery, setCancellationQuery] = useState<CancellationQuery>({});
  const [cancellationPagination, setCancellationPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [directCancelOpen, setDirectCancelOpen] = useState(false);
  const [directCancelPreview, setDirectCancelPreview] = useState<any>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState<'approve' | 'reject'>('approve');
  const [reviewRecord, setReviewRecord] = useState<any>();
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const activeGrantRequestIdRef = useRef(0);
  const cancellationRequestIdRef = useRef(0);
  const [packageForm] = Form.useForm();
  const [activeGrantForm] = Form.useForm();
  const [cancellationForm] = Form.useForm();
  const [directCancelForm] = Form.useForm();
  const [reviewForm] = Form.useForm();

  useEffect(() => {
    if (open) {
      setActiveTab('packages');
      setEditorOpen(false);
      return;
    }
    setEditorOpen(false);
    setEditingPackage(undefined);
    setDirectCancelOpen(false);
    setDirectCancelPreview(undefined);
    setReviewOpen(false);
    setReviewRecord(undefined);
    packageForm.resetFields();
    directCancelForm.resetFields();
    reviewForm.resetFields();
  }, [directCancelForm, open, packageForm, reviewForm]);

  const loadActiveGrants = async ({
    query = activeGrantQuery,
    current = activeGrantPagination.current,
    pageSize = activeGrantPagination.pageSize,
  }: {
    query?: ActiveGrantQuery;
    current?: number;
    pageSize?: number;
  } = {}) => {
    const requestId = ++activeGrantRequestIdRef.current;
    setActiveGrantLoading(true);
    try {
      const response = await queryActiveStorageGrants({ ...query, pageNum: current, pageSize });
      if (requestId !== activeGrantRequestIdRef.current) return;
      const pageData = response?.data || {};
      const records = pageData.records || pageData.list || [];
      setActiveGrants(records);
      setActiveGrantPagination({
        current: Number(pageData.current || current),
        pageSize: Number(pageData.size || pageSize),
        total: Number(pageData.total ?? records.length),
      });
    } finally {
      if (requestId === activeGrantRequestIdRef.current) {
        setActiveGrantLoading(false);
      }
    }
  };

  const loadCancellations = async ({
    query = cancellationQuery,
    current = cancellationPagination.current,
    pageSize = cancellationPagination.pageSize,
  }: {
    query?: CancellationQuery;
    current?: number;
    pageSize?: number;
  } = {}) => {
    const requestId = ++cancellationRequestIdRef.current;
    setCancellationLoading(true);
    try {
      const response = await queryStorageCancellations({ ...query, pageNum: current, pageSize });
      if (requestId !== cancellationRequestIdRef.current) return;
      const pageData = response?.data || {};
      const records = pageData.records || pageData.list || [];
      setCancellations(records);
      setCancellationPagination({
        current: Number(pageData.current || current),
        pageSize: Number(pageData.size || pageSize),
        total: Number(pageData.total ?? records.length),
      });
    } finally {
      if (requestId === cancellationRequestIdRef.current) {
        setCancellationLoading(false);
      }
    }
  };

  const openPackageEditor = (storagePackage?: any) => {
    setEditingPackage(storagePackage);
    let formValues: Record<string, any> = { status: 'ENABLED', sortNo: 0 };
    if (storagePackage) {
      formValues = {
        packageCode: storagePackage.packageCode,
        packageName: storagePackage.packageName,
        addonGb: Number(storagePackage.addonBytes || 0) / 1024 ** 3,
        price: storagePackage.price,
        status: storagePackage.status,
        sortNo: storagePackage.sortNo,
        remark: storagePackage.remark,
      };
    }
    packageForm.setFieldsValue(formValues);
    setEditorOpen(true);
  };

  const savePackage = async () => {
    const values = await packageForm.validateFields();
    await upsertStoragePackage({
      packageCode: values.packageCode,
      packageName: values.packageName,
      addonBytes: Math.round(values.addonGb * 1024 ** 3),
      price: values.price,
      status: values.status,
      sortNo: values.sortNo,
      remark: values.remark,
    });
    messageApi.success(t('storageQuota.package.saved'));
    setEditorOpen(false);
    setEditingPackage(undefined);
    packageForm.resetFields();
    await onPackagesChanged();
  };

  const deletePackage = async (packageId: string | number) => {
    await deleteStoragePackage({ packageId });
    messageApi.success(t('storageQuota.package.deleted'));
    await onPackagesChanged();
  };

  const changeTab = async (key: string) => {
    setActiveTab(key);
    if (key === 'activeGrants') {
      activeGrantForm.resetFields();
      setActiveGrantQuery({});
      setActiveGrantPagination((previous) => ({ ...previous, current: 1 }));
      await loadActiveGrants({ query: {}, current: 1, pageSize: activeGrantPagination.pageSize });
    } else if (key === 'cancellations') {
      cancellationForm.resetFields();
      setCancellationQuery({});
      setCancellationPagination((previous) => ({ ...previous, current: 1 }));
      await loadCancellations({ query: {}, current: 1, pageSize: cancellationPagination.pageSize });
    }
  };

  const searchActiveGrants = async (values: any) => {
    const nextQuery: ActiveGrantQuery = {
      userCode: values.userCode?.trim() || undefined,
      packageId: values.packageId,
    };
    setActiveGrantQuery(nextQuery);
    setActiveGrantPagination((previous) => ({ ...previous, current: 1 }));
    await loadActiveGrants({ query: nextQuery, current: 1, pageSize: activeGrantPagination.pageSize });
  };

  const clearActiveGrantSearch = async () => {
    activeGrantForm.resetFields();
    setActiveGrantQuery({});
    setActiveGrantPagination((previous) => ({ ...previous, current: 1 }));
    await loadActiveGrants({ query: {}, current: 1, pageSize: activeGrantPagination.pageSize });
  };

  const changeActiveGrantPage = async (current: number, pageSize: number) => {
    const nextCurrent = pageSize !== activeGrantPagination.pageSize ? 1 : current;
    setActiveGrantPagination((previous) => ({ ...previous, current: nextCurrent, pageSize }));
    await loadActiveGrants({ query: activeGrantQuery, current: nextCurrent, pageSize });
  };

  const searchCancellations = async (values: any) => {
    const nextQuery: CancellationQuery = {
      userCode: values.userCode?.trim() || undefined,
      downgradeStatus: values.downgradeStatus,
      requestType: values.requestType,
    };
    setCancellationQuery(nextQuery);
    setCancellationPagination((previous) => ({ ...previous, current: 1 }));
    await loadCancellations({ query: nextQuery, current: 1, pageSize: cancellationPagination.pageSize });
  };

  const clearCancellationSearch = async () => {
    cancellationForm.resetFields();
    setCancellationQuery({});
    setCancellationPagination((previous) => ({ ...previous, current: 1 }));
    await loadCancellations({ query: {}, current: 1, pageSize: cancellationPagination.pageSize });
  };

  const changeCancellationPage = async (current: number, pageSize: number) => {
    const nextCurrent = pageSize !== cancellationPagination.pageSize ? 1 : current;
    setCancellationPagination((previous) => ({ ...previous, current: nextCurrent, pageSize }));
    await loadCancellations({ query: cancellationQuery, current: nextCurrent, pageSize });
  };

  const openDirectCancellation = async (record: any) => {
    const response = await previewStorageGrantCancellation({ grantId: record.grantId });
    if (!response?.data) return;
    if (response.data.hasOpenRequest) {
      messageApi.warning(t('storageQuota.cancel.alreadyOpen'));
      return;
    }
    setDirectCancelPreview(response.data);
    directCancelForm.resetFields();
    setDirectCancelOpen(true);
  };

  const submitDirectCancellation = async () => {
    if (!directCancelPreview) return;
    const values = await directCancelForm.validateFields();
    setActionSubmitting(true);
    try {
      await cancelStorageGrant({ grantId: directCancelPreview.grantId, reason: values.reason.trim() });
      messageApi.success(t('storageQuota.cancel.directSuccess'));
      setDirectCancelOpen(false);
      setDirectCancelPreview(undefined);
      directCancelForm.resetFields();
      await Promise.all([
        loadActiveGrants(),
        loadCancellations({ query: cancellationQuery, current: cancellationPagination.current }),
      ]);
      await onPackagesChanged();
    } finally {
      setActionSubmitting(false);
    }
  };

  const openReview = (record: any, mode: 'approve' | 'reject') => {
    setReviewRecord(record);
    setReviewMode(mode);
    reviewForm.resetFields();
    setReviewOpen(true);
  };

  const submitReview = async () => {
    if (!reviewRecord) return;
    const values = await reviewForm.validateFields();
    setActionSubmitting(true);
    try {
      if (reviewMode === 'approve') {
        await approveStorageCancellation({
          downgradeId: reviewRecord.downgradeId,
          reviewRemark: values.reviewRemark?.trim() || undefined,
        });
        messageApi.success(t('storageQuota.change.approvedSuccess'));
      } else {
        await rejectStorageCancellation({
          downgradeId: reviewRecord.downgradeId,
          reviewRemark: values.reviewRemark.trim(),
        });
        messageApi.success(t('storageQuota.change.rejectedSuccess'));
      }
      setReviewOpen(false);
      setReviewRecord(undefined);
      reviewForm.resetFields();
      await Promise.all([loadCancellations(), loadActiveGrants()]);
      await onPackagesChanged();
    } finally {
      setActionSubmitting(false);
    }
  };

  const packageColumns: TableProps<any>['columns'] = [
    { title: t('storageQuota.package.code'), dataIndex: 'packageCode', width: 110 },
    { title: t('storageQuota.package.name'), dataIndex: 'packageName', width: 160 },
    {
      title: t('storageQuota.package.capacityShort'),
      dataIndex: 'addonBytes',
      width: 120,
      render: (value) => `+${formatBytes(Number(value || 0))}`,
    },
    {
      title: t('storageQuota.package.price'),
      dataIndex: 'price',
      width: 100,
      render: (value) => (value === null || value === undefined ? '-' : `¥${Number(value).toFixed(2)}`),
    },
    {
      title: t('storageQuota.package.status'),
      dataIndex: 'status',
      width: 90,
      render: (value) => (
        <Tag color={value === 'ENABLED' ? 'success' : 'default'}>{t(`storageQuota.packageStatus.${value}`)}</Tag>
      ),
    },
    {
      title: t('storageQuota.package.usedUserCount'),
      dataIndex: 'usedUserCount',
      width: 120,
      render: (value) => Number(value || 0),
    },
    { title: t('storageQuota.package.sortNo'), dataIndex: 'sortNo', width: 70 },
    {
      title: t('storageQuota.column.operation'),
      key: 'operation',
      width: 150,
      render: (_, record) => {
        const used = Number(record.usedUserCount || 0) > 0;
        const disabledHint = t('storageQuota.package.activeOperationDisabled');
        return (
          <Space>
            <Tooltip title={used ? disabledHint : undefined}>
              <span>
                <Button size="small" disabled={used} onClick={() => openPackageEditor(record)}>
                  {t('storageQuota.action.edit')}
                </Button>
              </span>
            </Tooltip>
            {used ? (
              <Tooltip title={disabledHint}>
                <span>
                  <Button size="small" danger disabled>
                    {t('storageQuota.action.delete')}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Popconfirm
                title={t('storageQuota.package.deleteTitle')}
                description={t('storageQuota.package.deleteConfirm')}
                onConfirm={() => deletePackage(record.packageId)}
              >
                <Button size="small" danger>
                  {t('storageQuota.action.delete')}
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const activeGrantColumns: TableProps<any>['columns'] = [
    { title: t('storageQuota.column.userCode'), dataIndex: 'userCode', width: 105 },
    { title: t('storageQuota.package.name'), dataIndex: 'packageName', width: 135, render: (value) => value || '-' },
    {
      title: t('storageQuota.package.grantedCapacity'),
      dataIndex: 'grantedBytes',
      width: 105,
      render: (value) => `+${formatBytes(Number(value || 0))}`,
    },
    {
      title: t('storageQuota.package.activeStatus'),
      dataIndex: 'grantStatus',
      width: 85,
      render: () => <Tag color="success">{t('storageQuota.grantStatus.ACTIVE')}</Tag>,
    },
    {
      title: t('storageQuota.package.grantSource'),
      dataIndex: 'grantSource',
      width: 100,
      render: (value) => t(`storageQuota.grantSource.${value || 'UNKNOWN'}`),
    },
    {
      title: t('storageQuota.package.grantedBy'),
      dataIndex: 'grantedByCode',
      width: 95,
      render: (value) => value || '-',
    },
    {
      title: t('storageQuota.package.grantedTime'),
      dataIndex: 'grantedTime',
      width: 155,
      render: formatTime,
    },
    {
      title: t('storageQuota.grant.remark'),
      dataIndex: 'remark',
      width: 150,
      ellipsis: true,
      render: (value) => value || '-',
    },
    {
      title: t('storageQuota.column.operation'),
      key: 'operation',
      width: 130,
      fixed: 'right',
      render: (_, record) => (
        <Button size="small" danger onClick={() => openDirectCancellation(record)}>
          {t('storageQuota.cancel.cancelPackage')}
        </Button>
      ),
    },
  ];

  const cancellationColumns: TableProps<any>['columns'] = [
    { title: t('storageQuota.column.userCode'), dataIndex: 'userCode', width: 110 },
    {
      title: t('storageQuota.change.type'),
      dataIndex: 'requestType',
      width: 105,
      render: (value) => (
        <Tag color={value === 'ADD_PACKAGE' ? 'blue' : 'orange'}>{t(`storageQuota.changeType.${value}`)}</Tag>
      ),
    },
    {
      title: t('storageQuota.package.name'),
      dataIndex: 'packageNames',
      width: 170,
      render: (value, record) => value || record.packageName || '-',
    },
    {
      title: t('storageQuota.change.capacity'),
      dataIndex: 'changeBytes',
      width: 115,
      render: (value, record) =>
        `${record.requestType === 'ADD_PACKAGE' ? '+' : '-'}${formatBytes(Number(value || 0))}`,
    },
    {
      title: t('storageQuota.change.status'),
      dataIndex: 'downgradeStatus',
      width: 125,
      render: (value) => (
        <Tag color={cancellationStatusColors[value] || 'default'}>{t(`storageQuota.cancelStatus.${value}`)}</Tag>
      ),
    },
    {
      title: t('storageQuota.cancel.source'),
      dataIndex: 'requestSource',
      width: 105,
      render: (value) => t(`storageQuota.cancelSource.${value || 'UNKNOWN'}`),
    },
    {
      title: t('storageQuota.change.beforeQuota'),
      dataIndex: 'beforeQuotaBytes',
      width: 115,
      render: (value) => formatBytes(Number(value || 0)),
    },
    {
      title: t('storageQuota.change.targetQuota'),
      dataIndex: 'targetQuotaBytes',
      width: 115,
      render: (value) => formatBytes(Number(value || 0)),
    },
    {
      title: t('storageQuota.cancel.overage'),
      dataIndex: 'overageBytes',
      width: 105,
      render: (value) => formatBytes(Number(value || 0)),
    },
    {
      title: t('storageQuota.change.reason'),
      dataIndex: 'reason',
      width: 160,
      ellipsis: true,
      render: (value) => value || '-',
    },
    {
      title: t('storageQuota.cancel.requestedTime'),
      dataIndex: 'requestedTime',
      width: 165,
      render: formatTime,
    },
    {
      title: t('storageQuota.cancel.graceDeadline'),
      dataIndex: 'graceDeadline',
      width: 165,
      render: formatTime,
    },
    {
      title: t('storageQuota.column.operation'),
      key: 'operation',
      width: 170,
      fixed: 'right',
      render: (_, record) =>
        record.downgradeStatus === 'REQUESTED' ? (
          <Space>
            <Button size="small" type="primary" onClick={() => openReview(record, 'approve')}>
              {t('storageQuota.change.approve')}
            </Button>
            <Button size="small" danger onClick={() => openReview(record, 'reject')}>
              {t('storageQuota.change.reject')}
            </Button>
          </Space>
        ) : (
          '-'
        ),
    },
  ];

  return (
    <>
      <Modal
        open={open}
        width="min(1120px, calc(100vw - 32px))"
        title={t('storageQuota.package.managerTitle')}
        footer={null}
        destroyOnHidden
        onCancel={onClose}
        styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' } }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={changeTab}
          items={[
            {
              key: 'packages',
              label: t('storageQuota.package.configTab'),
              children: (
                <div className={styles.packageManagerPanel}>
                  <div className={styles.packageManagerToolbar}>
                    <Button type="primary" onClick={() => openPackageEditor()}>
                      {t('storageQuota.action.addPackage')}
                    </Button>
                  </div>
                  <Table
                    rowKey="packageId"
                    dataSource={packages}
                    columns={packageColumns}
                    pagination={false}
                    scroll={{ x: 920 }}
                  />
                </div>
              ),
            },
            {
              key: 'activeGrants',
              label: t('storageQuota.package.activeTab'),
              children: (
                <div className={styles.packageManagerPanel}>
                  <Form
                    form={activeGrantForm}
                    name="active-storage-grant-query"
                    layout="inline"
                    className={styles.packageGrantQuery}
                    onFinish={searchActiveGrants}
                  >
                    <Form.Item name="userCode">
                      <Input allowClear placeholder={t('storageQuota.filter.userCodePlaceholder')} />
                    </Form.Item>
                    <Form.Item name="packageId">
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder={t('storageQuota.filter.packagePlaceholder')}
                        options={packages.map((item) => ({ value: item.packageId, label: item.packageName }))}
                      />
                    </Form.Item>
                    <Form.Item className={styles.packageGrantActions}>
                      <Space>
                        <Button type="primary" htmlType="submit">
                          {t('storageQuota.action.search')}
                        </Button>
                        <Button onClick={clearActiveGrantSearch}>{t('storageQuota.action.clear')}</Button>
                      </Space>
                    </Form.Item>
                  </Form>
                  <div className={styles.packageGrantTable}>
                    <Table
                      rowKey="grantId"
                      loading={activeGrantLoading}
                      dataSource={activeGrants}
                      columns={activeGrantColumns}
                      pagination={false}
                      locale={{ emptyText: t('storageQuota.package.activeEmpty') }}
                      scroll={{ x: 1060 }}
                    />
                  </div>
                  <Pagination
                    pageAllCount={activeGrants.length}
                    paginationBorderBox={styles.packagePagination}
                    tableFooterBox={styles.packagePagination}
                    pagination={{
                      current: activeGrantPagination.current,
                      pageSize: activeGrantPagination.pageSize,
                      total: activeGrantPagination.total,
                      onChange: changeActiveGrantPage,
                      showSelectInf: false,
                    }}
                  />
                </div>
              ),
            },
            {
              key: 'cancellations',
              label: t('storageQuota.cancel.managementTab'),
              children: (
                <div className={styles.packageManagerPanel}>
                  <Form
                    form={cancellationForm}
                    name="storage-cancellation-query"
                    layout="inline"
                    className={styles.packageGrantQuery}
                    onFinish={searchCancellations}
                  >
                    <Form.Item name="userCode">
                      <Input allowClear placeholder={t('storageQuota.filter.userCodePlaceholder')} />
                    </Form.Item>
                    <Form.Item name="requestType">
                      <Select
                        allowClear
                        style={{ width: 150 }}
                        placeholder={t('storageQuota.change.typePlaceholder')}
                        options={['ADD_PACKAGE', 'CANCEL_PACKAGE'].map((value) => ({
                          value,
                          label: t(`storageQuota.changeType.${value}`),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name="downgradeStatus">
                      <Select
                        allowClear
                        placeholder={t('storageQuota.change.statusPlaceholder')}
                        options={cancellationStatuses.map((value) => ({
                          value,
                          label: t(`storageQuota.cancelStatus.${value}`),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item className={styles.packageGrantActions}>
                      <Space>
                        <Button type="primary" htmlType="submit">
                          {t('storageQuota.action.search')}
                        </Button>
                        <Button onClick={clearCancellationSearch}>{t('storageQuota.action.clear')}</Button>
                      </Space>
                    </Form.Item>
                  </Form>
                  <div className={styles.packageGrantTable}>
                    <Table
                      rowKey="downgradeId"
                      loading={cancellationLoading}
                      dataSource={cancellations}
                      columns={cancellationColumns}
                      pagination={false}
                      locale={{ emptyText: t('storageQuota.change.empty') }}
                      scroll={{ x: 1710 }}
                    />
                  </div>
                  <Pagination
                    pageAllCount={cancellations.length}
                    paginationBorderBox={styles.packagePagination}
                    tableFooterBox={styles.packagePagination}
                    pagination={{
                      current: cancellationPagination.current,
                      pageSize: cancellationPagination.pageSize,
                      total: cancellationPagination.total,
                      onChange: changeCancellationPage,
                      showSelectInf: false,
                    }}
                  />
                </div>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={editorOpen}
        zIndex={1100}
        title={editingPackage ? t('storageQuota.package.editTitle') : t('storageQuota.package.createTitle')}
        onCancel={() => {
          setEditorOpen(false);
          setEditingPackage(undefined);
          packageForm.resetFields();
        }}
        onOk={savePackage}
        forceRender
      >
        <Form form={packageForm} name="storage-quota-package" layout="vertical">
          <Form.Item name="packageCode" label={t('storageQuota.package.code')} rules={[{ required: true }]}>
            <Input disabled={Boolean(editingPackage)} />
          </Form.Item>
          <Form.Item name="packageName" label={t('storageQuota.package.name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="addonGb" label={t('storageQuota.package.capacity')} rules={[{ required: true }]}>
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} suffix="GB" />
          </Form.Item>
          <Form.Item name="price" label={t('storageQuota.package.price')}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="¥" />
          </Form.Item>
          <Form.Item name="status" label={t('storageQuota.package.status')} rules={[{ required: true }]}>
            <Select
              options={['ENABLED', 'DISABLED'].map((value) => ({
                value,
                label: t(`storageQuota.packageStatus.${value}`),
              }))}
            />
          </Form.Item>
          <Form.Item name="sortNo" label={t('storageQuota.package.sortNo')}>
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label={t('storageQuota.grant.remark')}>
            <Input.TextArea rows={3} maxLength={512} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={directCancelOpen}
        zIndex={1100}
        title={t('storageQuota.cancel.directTitle')}
        okText={t('storageQuota.cancel.confirm')}
        cancelText={t('storageQuota.cancel.close')}
        confirmLoading={actionSubmitting}
        onOk={submitDirectCancellation}
        onCancel={() => {
          setDirectCancelOpen(false);
          setDirectCancelPreview(undefined);
          directCancelForm.resetFields();
        }}
        destroyOnHidden
      >
        {directCancelPreview ? (
          <Space direction="vertical" size={16} className={styles.cancelModalContent}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t('storageQuota.column.userCode')} span={2}>
                {directCancelPreview.userCode || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.package.name')} span={2}>
                {directCancelPreview.packageName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.cancel.beforeQuota')}>
                {formatBytes(directCancelPreview.beforeQuotaBytes)}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.cancel.targetQuota')}>
                {formatBytes(directCancelPreview.targetQuotaBytes)}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.cancel.currentUsage')}>
                {formatBytes(directCancelPreview.usedBytes + directCancelPreview.reservedBytes)}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.cancel.overage')}>
                {formatBytes(directCancelPreview.overageBytes)}
              </Descriptions.Item>
            </Descriptions>
            {directCancelPreview.overQuotaAfterDowngrade ? (
              <Alert
                showIcon
                type="warning"
                message={t('storageQuota.cancel.overQuotaTitle')}
                description={t('storageQuota.cancel.overQuotaDescription', {
                  days: directCancelPreview.graceDays,
                  overage: formatBytes(directCancelPreview.overageBytes),
                })}
              />
            ) : (
              <Alert showIcon type="info" message={t('storageQuota.cancel.withinQuota')} />
            )}
            <Form form={directCancelForm} layout="vertical">
              <Form.Item
                name="reason"
                label={t('storageQuota.cancel.reason')}
                rules={[{ required: true, whitespace: true, message: t('storageQuota.cancel.reasonRequired') }]}
              >
                <Input.TextArea rows={3} maxLength={512} showCount />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
      </Modal>

      <Modal
        open={reviewOpen}
        zIndex={1100}
        title={
          reviewMode === 'approve'
            ? t('storageQuota.change.reviewApproveTitle')
            : t('storageQuota.change.reviewRejectTitle')
        }
        okText={reviewMode === 'approve' ? t('storageQuota.change.approve') : t('storageQuota.change.reject')}
        okButtonProps={{ danger: reviewMode === 'reject' }}
        confirmLoading={actionSubmitting}
        onOk={submitReview}
        onCancel={() => {
          setReviewOpen(false);
          setReviewRecord(undefined);
          reviewForm.resetFields();
        }}
        destroyOnHidden
      >
        {reviewRecord ? (
          <Space direction="vertical" size={16} className={styles.cancelModalContent}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label={t('storageQuota.column.userCode')}>
                {reviewRecord.userCode || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.change.type')}>
                {t(`storageQuota.changeType.${reviewRecord.requestType}`)}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.package.name')} span={2}>
                {reviewRecord.packageNames || reviewRecord.packageName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.change.targetQuota')}>
                {formatBytes(reviewRecord.targetQuotaBytes)}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.cancel.overage')}>
                {formatBytes(reviewRecord.overageBytes)}
              </Descriptions.Item>
              <Descriptions.Item label={t('storageQuota.change.reason')} span={2}>
                {reviewRecord.reason || '-'}
              </Descriptions.Item>
            </Descriptions>
            {reviewMode === 'approve' && Number(reviewRecord.overageBytes || 0) > 0 ? (
              <Alert showIcon type="warning" message={t('storageQuota.cancel.reviewOverQuota')} />
            ) : null}
            <Form form={reviewForm} layout="vertical">
              <Form.Item
                name="reviewRemark"
                label={
                  reviewMode === 'approve'
                    ? t('storageQuota.cancel.reviewRemark')
                    : t('storageQuota.cancel.rejectReason')
                }
                rules={
                  reviewMode === 'reject'
                    ? [{ required: true, whitespace: true, message: t('storageQuota.cancel.rejectReasonRequired') }]
                    : []
                }
              >
                <Input.TextArea rows={3} maxLength={512} showCount />
              </Form.Item>
            </Form>
          </Space>
        ) : null}
      </Modal>
    </>
  );
};

export default PackageManagerModal;
