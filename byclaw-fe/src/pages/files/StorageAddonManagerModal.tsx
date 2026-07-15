import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import { useIntl } from '@umijs/max';
import Pagination from '@/pages/manager/components/Pagination';
import {
  applyStorageAddition,
  applyStorageCancellation,
  archiveStorageCancellation,
  getStorageGrants,
  getStoragePackages,
  previewStorageCancellation,
  queryStorageChanges,
  withdrawStorageCancellation,
} from './service';
import type {
  StorageCancellationData,
  StorageCancellationPreview,
  StorageGrantData,
  StoragePackageData,
} from './service';
import styles from './index.module.less';

interface StorageAddonManagerModalProps {
  open: boolean;
  onClose: () => void;
  onChanged?: (changeType: StorageAddonChangeType) => Promise<void> | void;
}

export type StorageAddonChangeType = 'ADDITION_SUBMITTED' | 'CANCELLATION_SUBMITTED' | 'CHANGE_WITHDRAWN' | 'ARCHIVED';

interface ChangeQuery {
  downgradeStatus?: string;
  requestType?: string;
}

const CHANGE_STATUSES = ['REQUESTED', 'GRACE', 'ARCHIVING', 'COMPLETED', 'ARCHIVED', 'CANCELLED', 'REJECTED'];

const formatBytes = (bytes = 0) => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
};

const formatTime = (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-');

const statusColors: Record<string, string> = {
  REQUESTED: 'processing',
  GRACE: 'warning',
  ARCHIVING: 'processing',
  COMPLETED: 'success',
  ARCHIVED: 'default',
  CANCELLED: 'default',
  REJECTED: 'error',
};

const StorageAddonManagerModal: React.FC<StorageAddonManagerModalProps> = ({ open, onClose, onChanged }) => {
  const intl = useIntl();
  const { message: messageApi } = App.useApp();
  const t = (id: string, values?: Record<string, React.ReactNode>) => intl.formatMessage({ id }, values);
  const [activeTab, setActiveTab] = useState('active');
  const [baseLoading, setBaseLoading] = useState(false);
  const [changeLoading, setChangeLoading] = useState(false);
  const [packages, setPackages] = useState<StoragePackageData[]>([]);
  const [grants, setGrants] = useState<StorageGrantData[]>([]);
  const [changes, setChanges] = useState<StorageCancellationData[]>([]);
  const [changeQuery, setChangeQuery] = useState<ChangeQuery>({});
  const [changePagination, setChangePagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [addOpen, setAddOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [selectedGrantIds, setSelectedGrantIds] = useState<React.Key[]>([]);
  const [preview, setPreview] = useState<StorageCancellationPreview>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const changeRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const [addForm] = Form.useForm();
  const [cancelForm] = Form.useForm();
  const [changeForm] = Form.useForm();

  const loadBaseData = useCallback(async () => {
    setBaseLoading(true);
    try {
      const [packageResponse, grantResponse] = await Promise.all([getStoragePackages(), getStorageGrants()]);
      setPackages(packageResponse?.data || []);
      setGrants(grantResponse?.data || []);
    } finally {
      setBaseLoading(false);
    }
  }, []);

  const loadChanges = useCallback(
    async ({
      query = {},
      current = 1,
      pageSize = 10,
    }: {
      query?: ChangeQuery;
      current?: number;
      pageSize?: number;
    } = {}) => {
      const requestId = ++changeRequestIdRef.current;
      setChangeLoading(true);
      try {
        const response = await queryStorageChanges({ ...query, pageNum: current, pageSize });
        if (requestId !== changeRequestIdRef.current) return;
        const pageData = response?.data || {};
        const records = pageData.records || pageData.list || [];
        setChanges(records);
        setChangePagination({
          current: Number(pageData.current || current),
          pageSize: Number(pageData.size || pageSize),
          total: Number(pageData.total ?? records.length),
        });
      } finally {
        if (requestId === changeRequestIdRef.current) setChangeLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (open) {
      setActiveTab('active');
      setChangeQuery({});
      setChangePagination((previous) => ({ ...previous, current: 1, pageSize: 10 }));
      changeForm.resetFields();
      void Promise.all([loadBaseData(), loadChanges({ query: {}, current: 1, pageSize: 10 })]);
      return;
    }
    setAddOpen(false);
    setCancelOpen(false);
    setSelectedGrantIds([]);
    setPreview(undefined);
    addForm.resetFields();
    cancelForm.resetFields();
  }, [addForm, cancelForm, changeForm, loadBaseData, loadChanges, open]);

  const submitAddition = async () => {
    const values = await addForm.validateFields();
    setSubmitting(true);
    try {
      await applyStorageAddition({ packageId: values.packageId, reason: values.reason.trim() });
      messageApi.success(t('storageQuota.user.addSubmitted'));
      setAddOpen(false);
      addForm.resetFields();
      await Promise.all([
        loadBaseData(),
        loadChanges({ query: changeQuery, current: 1, pageSize: changePagination.pageSize }),
      ]);
      await onChanged?.('ADDITION_SUBMITTED');
    } finally {
      setSubmitting(false);
    }
  };

  const selectCancellationGrants = async (keys: React.Key[]) => {
    setSelectedGrantIds(keys);
    setPreview(undefined);
    if (!keys.length) return;
    const requestId = ++previewRequestIdRef.current;
    setPreviewLoading(true);
    try {
      const response = await previewStorageCancellation(keys.map(String));
      if (requestId === previewRequestIdRef.current) setPreview(response?.data);
    } finally {
      if (requestId === previewRequestIdRef.current) setPreviewLoading(false);
    }
  };

  const submitCancellation = async () => {
    const values = await cancelForm.validateFields();
    if (!preview || !selectedGrantIds.length) return;
    setSubmitting(true);
    try {
      await applyStorageCancellation({ grantIds: selectedGrantIds.map(String), reason: values.reason.trim() });
      messageApi.success(t('storageQuota.user.cancelSubmitted'));
      setCancelOpen(false);
      setSelectedGrantIds([]);
      setPreview(undefined);
      cancelForm.resetFields();
      await Promise.all([
        loadBaseData(),
        loadChanges({ query: changeQuery, current: 1, pageSize: changePagination.pageSize }),
      ]);
      await onChanged?.('CANCELLATION_SUBMITTED');
    } finally {
      setSubmitting(false);
    }
  };

  const withdrawChange = async (downgradeId: string) => {
    await withdrawStorageCancellation(downgradeId);
    messageApi.success(t('storageQuota.user.changeWithdrawn'));
    await Promise.all([
      loadBaseData(),
      loadChanges({ query: changeQuery, current: changePagination.current, pageSize: changePagination.pageSize }),
    ]);
    await onChanged?.('CHANGE_WITHDRAWN');
  };

  const archiveChange = async (downgradeId: string) => {
    await archiveStorageCancellation(downgradeId);
    messageApi.success(t('storageQuota.user.archiveSubmitted'));
    await Promise.all([
      loadBaseData(),
      loadChanges({ query: changeQuery, current: changePagination.current, pageSize: changePagination.pageSize }),
    ]);
    await onChanged?.('ARCHIVED');
  };

  const searchChanges = async (values: ChangeQuery) => {
    const nextQuery = {
      downgradeStatus: values.downgradeStatus || undefined,
      requestType: values.requestType || undefined,
    };
    setChangeQuery(nextQuery);
    setChangePagination((previous) => ({ ...previous, current: 1 }));
    await loadChanges({ query: nextQuery, current: 1, pageSize: changePagination.pageSize });
  };

  const resetChanges = async () => {
    changeForm.resetFields();
    setChangeQuery({});
    setChangePagination((previous) => ({ ...previous, current: 1 }));
    await loadChanges({ query: {}, current: 1, pageSize: changePagination.pageSize });
  };

  const changeChangePage = async (current: number, pageSize: number) => {
    const nextCurrent = pageSize !== changePagination.pageSize ? 1 : current;
    setChangePagination((previous) => ({ ...previous, current: nextCurrent, pageSize }));
    await loadChanges({ query: changeQuery, current: nextCurrent, pageSize });
  };

  const grantColumns: TableProps<StorageGrantData>['columns'] = [
    {
      title: t('storageQuota.user.packageName'),
      dataIndex: 'packageName',
      width: 200,
      render: (value) => value || '-',
    },
    {
      title: t('storageQuota.user.capacity'),
      dataIndex: 'grantedBytes',
      width: 140,
      render: (value) => `+${formatBytes(Number(value || 0))}`,
    },
    {
      title: t('storageQuota.user.grantSource'),
      dataIndex: 'grantSource',
      width: 140,
      render: (value) => t(`storageQuota.user.grantSource.${value || 'UNKNOWN'}`),
    },
    { title: t('storageQuota.user.grantedTime'), dataIndex: 'grantedTime', width: 180, render: formatTime },
  ];

  const changeColumns: TableProps<StorageCancellationData>['columns'] = [
    {
      title: t('storageQuota.user.changeType'),
      dataIndex: 'requestType',
      width: 110,
      render: (value) => (
        <Tag color={value === 'ADD_PACKAGE' ? 'blue' : 'orange'}>{t(`storageQuota.changeType.${value}`)}</Tag>
      ),
    },
    {
      title: t('storageQuota.user.packageName'),
      dataIndex: 'packageNames',
      width: 190,
      ellipsis: true,
      render: (value, record) => value || record.packageName || '-',
    },
    {
      title: t('storageQuota.user.changeCapacity'),
      dataIndex: 'changeBytes',
      width: 130,
      render: (value, record) =>
        `${record.requestType === 'ADD_PACKAGE' ? '+' : '-'}${formatBytes(Number(value || 0))}`,
    },
    {
      title: t('storageQuota.user.changeStatus'),
      dataIndex: 'downgradeStatus',
      width: 125,
      render: (value) => <Tag color={statusColors[value] || 'default'}>{t(`storageQuota.cancelStatus.${value}`)}</Tag>,
    },
    {
      title: t('storageQuota.user.targetQuota'),
      dataIndex: 'targetQuotaBytes',
      width: 125,
      render: (value) => formatBytes(Number(value || 0)),
    },
    {
      title: t('storageQuota.user.changeReason'),
      dataIndex: 'reason',
      width: 180,
      ellipsis: true,
      render: (value) => value || '-',
    },
    { title: t('storageQuota.user.requestedTime'), dataIndex: 'requestedTime', width: 175, render: formatTime },
    { title: t('storageQuota.user.graceDeadline'), dataIndex: 'graceDeadline', width: 175, render: formatTime },
    {
      title: t('storageQuota.user.operation'),
      key: 'operation',
      width: 130,
      fixed: 'right',
      render: (_, record) => {
        if (record.downgradeStatus === 'REQUESTED') {
          return (
            <Popconfirm
              title={t('storageQuota.user.withdrawConfirm')}
              onConfirm={() => withdrawChange(record.downgradeId)}
            >
              <Button size="small">{t('storageQuota.user.withdraw')}</Button>
            </Popconfirm>
          );
        }
        if (record.requestType === 'CANCEL_PACKAGE' && record.downgradeStatus === 'GRACE') {
          return (
            <Popconfirm
              title={t('storageQuota.user.archiveConfirm')}
              description={t('storageQuota.user.archiveDescription')}
              onConfirm={() => archiveChange(record.downgradeId)}
            >
              <Button size="small" danger>
                {t('storageQuota.user.archiveNow')}
              </Button>
            </Popconfirm>
          );
        }
        return '-';
      },
    },
  ];

  return (
    <>
      <Modal
        open={open}
        width="min(1120px, calc(100vw - 32px))"
        title={t('storageQuota.user.managerTitle')}
        footer={null}
        destroyOnHidden
        onCancel={onClose}
        styles={{ body: { maxHeight: 'calc(100vh - 170px)', overflow: 'auto' } }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'active',
              label: t('storageQuota.user.activePackages'),
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Space wrap>
                    <Button
                      type="primary"
                      onClick={() => {
                        addForm.resetFields();
                        setAddOpen(true);
                      }}
                    >
                      {t('storageQuota.user.applyAddition')}
                    </Button>
                    <Button
                      danger
                      disabled={!grants.length}
                      onClick={() => {
                        cancelForm.resetFields();
                        setSelectedGrantIds([]);
                        setPreview(undefined);
                        setCancelOpen(true);
                      }}
                    >
                      {t('storageQuota.user.applyCancellation')}
                    </Button>
                    <span>{t('storageQuota.user.stackHint')}</span>
                  </Space>
                  <Table
                    rowKey="grantId"
                    loading={baseLoading}
                    columns={grantColumns}
                    dataSource={grants}
                    pagination={false}
                    scroll={{ x: 700 }}
                    locale={{ emptyText: t('storageQuota.user.noActivePackages') }}
                  />
                </Space>
              ),
            },
            {
              key: 'history',
              label: t('storageQuota.user.changeHistory'),
              children: (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Form form={changeForm} layout="inline" onFinish={searchChanges}>
                    <Form.Item name="requestType">
                      <Select
                        allowClear
                        style={{ width: 160 }}
                        placeholder={t('storageQuota.user.changeTypePlaceholder')}
                        options={['ADD_PACKAGE', 'CANCEL_PACKAGE'].map((value) => ({
                          value,
                          label: t(`storageQuota.changeType.${value}`),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name="downgradeStatus">
                      <Select
                        allowClear
                        style={{ width: 160 }}
                        placeholder={t('storageQuota.user.changeStatusPlaceholder')}
                        options={CHANGE_STATUSES.map((value) => ({
                          value,
                          label: t(`storageQuota.cancelStatus.${value}`),
                        }))}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Space>
                        <Button type="primary" htmlType="submit">
                          {t('storageQuota.user.search')}
                        </Button>
                        <Button onClick={resetChanges}>{t('storageQuota.user.reset')}</Button>
                      </Space>
                    </Form.Item>
                  </Form>
                  <Table
                    rowKey="downgradeId"
                    loading={changeLoading}
                    columns={changeColumns}
                    dataSource={changes}
                    pagination={false}
                    scroll={{ x: 1360 }}
                    locale={{ emptyText: t('storageQuota.user.noChangeHistory') }}
                  />
                  <Pagination
                    pageAllCount={changes.length}
                    pagination={{
                      current: changePagination.current,
                      pageSize: changePagination.pageSize,
                      total: changePagination.total,
                      onChange: changeChangePage,
                      showSelectInf: false,
                    }}
                  />
                </Space>
              ),
            },
          ]}
        />
      </Modal>

      <Modal
        open={addOpen}
        zIndex={1100}
        title={t('storageQuota.user.addTitle')}
        okText={t('storageQuota.user.submitAddition')}
        cancelText={t('common.cancel')}
        confirmLoading={submitting}
        onOk={submitAddition}
        onCancel={() => setAddOpen(false)}
        forceRender
        destroyOnHidden
      >
        <Form form={addForm} name="storage-addon-addition" layout="vertical">
          <Form.Item name="packageId" label={t('storageQuota.user.packageName')} rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={packages.map((item) => ({
                value: item.packageId,
                label: `${item.packageName}（+${formatBytes(item.addonBytes)}）`,
              }))}
            />
          </Form.Item>
          <Alert showIcon type="info" message={t('storageQuota.user.addReviewHint')} style={{ marginBottom: 16 }} />
          <Form.Item
            name="reason"
            label={t('storageQuota.user.addReason')}
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={3} maxLength={512} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={cancelOpen}
        zIndex={1100}
        width="min(820px, calc(100vw - 32px))"
        title={t('storageQuota.user.cancelTitle')}
        okText={t('storageQuota.user.submitCancel')}
        cancelText={t('common.cancel')}
        confirmLoading={submitting}
        okButtonProps={{ disabled: !selectedGrantIds.length || !preview || previewLoading }}
        onOk={submitCancellation}
        onCancel={() => setCancelOpen(false)}
        forceRender
        destroyOnHidden
      >
        <Space direction="vertical" size={16} className={styles.addonCancelContent}>
          <Alert showIcon type="info" message={t('storageQuota.user.multiCancelHint')} />
          <Table
            rowKey="grantId"
            size="small"
            loading={baseLoading}
            columns={grantColumns}
            dataSource={grants}
            pagination={false}
            rowSelection={{ selectedRowKeys: selectedGrantIds, onChange: selectCancellationGrants }}
            scroll={{ x: 700, y: 220 }}
          />
          {preview ? (
            <>
              <Descriptions size="small" column={2} bordered>
                <Descriptions.Item label={t('storageQuota.user.selectedPackages')} span={2}>
                  {preview.packageNames || preview.packageName || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('storageQuota.user.currentQuota')}>
                  {formatBytes(preview.beforeQuotaBytes)}
                </Descriptions.Item>
                <Descriptions.Item label={t('storageQuota.user.targetQuota')}>
                  {formatBytes(preview.targetQuotaBytes)}
                </Descriptions.Item>
                <Descriptions.Item label={t('storageQuota.user.currentUsage')}>
                  {formatBytes(preview.usedBytes + preview.reservedBytes)}
                </Descriptions.Item>
                <Descriptions.Item label={t('storageQuota.user.overage')}>
                  {formatBytes(preview.overageBytes)}
                </Descriptions.Item>
              </Descriptions>
              {preview.overQuotaAfterDowngrade ? (
                <Alert
                  showIcon
                  type="warning"
                  message={t('storageQuota.user.downgradeWarningTitle')}
                  description={t('storageQuota.user.downgradeWarningDescription', {
                    days: preview.graceDays,
                    overage: formatBytes(preview.overageBytes),
                  })}
                />
              ) : (
                <Alert showIcon type="info" message={t('storageQuota.user.downgradeSafe')} />
              )}
            </>
          ) : null}
          <Form form={cancelForm} name="storage-addon-cancellation" layout="vertical">
            <Form.Item
              name="reason"
              label={t('storageQuota.user.cancelReason')}
              rules={[{ required: true, whitespace: true, message: t('storageQuota.user.cancelReasonRequired') }]}
            >
              <Input.TextArea rows={3} maxLength={512} showCount />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </>
  );
};

export default StorageAddonManagerModal;
