import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

import Markdown from '@/components/Markdown';
import useAppStore from '@/models/common/useAppStore';
import {
  BIZ_TYPE_SYSTEM,
  BIZ_TYPE_VERSION,
  buildNotificationPayload,
  createNotification,
  deleteNotification,
  queryNotificationPage,
  updateNotification,
} from '@/pages/manager/service/NotificationMgr';

import styles from './index.module.less';

const { Text } = Typography;

type NoticeTab = 'version' | 'system';

type NoticeRecord = {
  id: string;
  title?: string;
  content?: string;
  bizType?: number;
  priority?: number;
  isRead?: string;
  senderId?: string;
  createTime?: string;
  readTime?: string;
  expireTime?: string;
  extraInfo?: string;
};

type NoticeFormValues = {
  title: string;
  versionNo?: string;
  content: string;
  priority?: number;
  expireTime?: Dayjs;
};

const tabBizTypeMap: Record<NoticeTab, number> = {
  version: BIZ_TYPE_VERSION,
  system: BIZ_TYPE_SYSTEM,
};

const priorityOptions = [
  { labelId: 'systemNotification.priority.low', value: 1, color: 'default' },
  { labelId: 'systemNotification.priority.medium', value: 2, color: 'blue' },
  { labelId: 'systemNotification.priority.high', value: 3, color: 'orange' },
  { labelId: 'systemNotification.priority.urgent', value: 4, color: 'red' },
];

const normalizeRows = (pageData: any): NoticeRecord[] => {
  const rows = pageData?.records || pageData?.list || pageData?.rows || pageData?.data || [];
  return Array.isArray(rows) ? rows : [];
};

const getTotal = (pageData: any) => Number(pageData?.total ?? pageData?.totalCount ?? 0);

const getPriorityMeta = (priority?: number) => priorityOptions.find((item) => item.value === priority);

const NotificationMgr: React.FC = () => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState<NoticeTab>('version');
  const [keyword, setKeyword] = useState('');
  const [priority, setPriority] = useState<number | undefined>();
  const [list, setList] = useState<NoticeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<NoticeRecord | null>(null);
  const [previewRecord, setPreviewRecord] = useState<NoticeRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<NoticeFormValues>();
  const { versionInfo, getVersionInfo } = useAppStore();

  const isVersionTab = activeTab === 'version';
  const latestVersionNo = versionInfo?.version;
  const canUseLatestVersionNo = Boolean(latestVersionNo);

  const fetchList = useCallback(
    async (params?: Partial<{ current: number; pageSize: number; keyword: string; priority?: number }>) => {
      const nextCurrent = params?.current ?? pagination.current;
      const nextPageSize = params?.pageSize ?? pagination.pageSize;
      const nextKeyword = params && Object.prototype.hasOwnProperty.call(params, 'keyword') ? params.keyword : keyword;
      const nextPriority =
        params && Object.prototype.hasOwnProperty.call(params, 'priority') ? params.priority : priority;

      setLoading(true);
      try {
        const res: any = await queryNotificationPage({
          pageNum: nextCurrent,
          pageSize: nextPageSize,
          bizType: tabBizTypeMap[activeTab],
          title: nextKeyword?.trim() || undefined,
          priority: isVersionTab ? undefined : nextPriority,
        });
        if (res?.code !== 0) {
          message.error(res?.msg || intl.formatMessage({ id: 'notificationMgr.listQueryFailed' }));
          return;
        }
        const pageData = res?.data || {};
        setList(normalizeRows(pageData));
        setPagination({
          current: Number(pageData?.current ?? pageData?.pageNum ?? nextCurrent),
          pageSize: Number(pageData?.size ?? pageData?.pageSize ?? nextPageSize),
          total: getTotal(pageData),
        });
      } finally {
        setLoading(false);
      }
    },
    [activeTab, intl, isVersionTab, keyword, pagination.current, pagination.pageSize, priority]
  );

  useEffect(() => {
    setKeyword('');
    setPriority(undefined);
    setPagination((prev) => ({ ...prev, current: 1 }));
    fetchList({ current: 1, keyword: '', priority: undefined });
  }, [activeTab]);

  useEffect(() => {
    if (formOpen && !editingRecord && isVersionTab && latestVersionNo) {
      form.setFieldValue('versionNo', latestVersionNo);
    }
  }, [editingRecord, form, formOpen, isVersionTab, latestVersionNo]);

  const openCreate = () => {
    setEditingRecord(null);
    form.resetFields();
    form.setFieldsValue({
      priority: 2,
      versionNo: isVersionTab && canUseLatestVersionNo ? latestVersionNo : undefined,
    });
    if (isVersionTab && !versionInfo) {
      getVersionInfo();
    }
    setFormOpen(true);
  };

  const openEdit = (record: NoticeRecord) => {
    setEditingRecord(record);
    form.setFieldsValue({
      title: record.title || '',
      versionNo: record.extraInfo || '',
      content: record.content || '',
      priority: record.priority || 2,
      expireTime: record.expireTime ? dayjs(record.expireTime) : undefined,
    });
    setFormOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const payload = buildNotificationPayload({
        values,
        id: editingRecord?.id,
        bizType: tabBizTypeMap[activeTab],
        isVersion: isVersionTab,
      });
      const res: any = editingRecord ? await updateNotification(payload) : await createNotification(payload);
      if (res?.code !== 0) {
        message.error(res?.msg || intl.formatMessage({ id: 'notificationMgr.saveFailed' }));
        return;
      }
      message.success(
        intl.formatMessage({ id: editingRecord ? 'notificationMgr.updateSuccess' : 'notificationMgr.createSuccess' })
      );
      setFormOpen(false);
      fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: NoticeRecord) => {
    const res: any = await deleteNotification({ id: record.id });
    if (res?.code !== 0) {
      message.error(res?.msg || intl.formatMessage({ id: 'notificationMgr.deleteFailed' }));
      return;
    }
    message.success(intl.formatMessage({ id: 'notificationMgr.deleteSuccess' }));
    fetchList();
  };

  const columns = useMemo<ColumnsType<NoticeRecord>>(() => {
    const base: ColumnsType<NoticeRecord> = [
      {
        title: intl.formatMessage({ id: 'notificationMgr.column.title' }),
        dataIndex: 'title',
        width: 220,
        render: (value) => (
          <Tooltip title={value}>
            <Text ellipsis style={{ maxWidth: 200 }}>
              {value || '-'}
            </Text>
          </Tooltip>
        ),
      },
      {
        title: intl.formatMessage({
          id: isVersionTab ? 'notificationMgr.column.markdownContent' : 'notificationMgr.column.content',
        }),
        dataIndex: 'content',
        render: (value) => (
          <Tooltip title={value}>
            <Text className={styles.contentCell} ellipsis>
              {value || '-'}
            </Text>
          </Tooltip>
        ),
      },
    ];

    if (isVersionTab) {
      base.push({
        title: intl.formatMessage({ id: 'notificationMgr.column.versionNo' }),
        dataIndex: 'extraInfo',
        width: 140,
        render: (value) => value || '-',
      });
    }

    if (!isVersionTab) {
      base.push({
        title: intl.formatMessage({ id: 'notificationMgr.column.priority' }),
        dataIndex: 'priority',
        width: 96,
        render: (value) => {
          const meta = getPriorityMeta(value);
          return <Tag color={meta?.color}>{meta?.labelId ? intl.formatMessage({ id: meta.labelId }) : '-'}</Tag>;
        },
      });
    }

    base.push(
      {
        title: intl.formatMessage({ id: 'notificationMgr.column.createdAt' }),
        dataIndex: 'createTime',
        width: 180,
        render: (value) => value || '-',
      },
      {
        title: intl.formatMessage({ id: 'common.operation' }),
        fixed: 'right',
        width: 180,
        render: (_, record) => (
          <Space size={4}>
            <Button type="link" icon={<EyeOutlined />} onClick={() => setPreviewRecord(record)}>
              {intl.formatMessage({ id: 'common.preview' })}
            </Button>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              {intl.formatMessage({ id: 'common.edit' })}
            </Button>
            <Popconfirm
              title={intl.formatMessage({ id: 'notificationMgr.deleteConfirm' })}
              onConfirm={() => handleDelete(record)}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                {intl.formatMessage({ id: 'common.delete' })}
              </Button>
            </Popconfirm>
          </Space>
        ),
      }
    );
    return base;
  }, [intl, isVersionTab]);

  const tabItems = [
    { key: 'version', label: intl.formatMessage({ id: 'notificationMgr.versionNotice' }) },
    { key: 'system', label: intl.formatMessage({ id: 'notificationMgr.systemNotice' }) },
  ];

  return (
    <div className={styles.container}>
      <Tabs activeKey={activeTab} items={tabItems} onChange={(key) => setActiveTab(key as NoticeTab)} />

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <Input
            allowClear
            placeholder={intl.formatMessage({ id: 'notificationMgr.searchTitle' })}
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => fetchList({ current: 1 })}
          />
          {!isVersionTab && (
            <>
              <Select
                allowClear
                placeholder={intl.formatMessage({ id: 'notificationMgr.column.priority' })}
                style={{ width: 120 }}
                value={priority}
                options={priorityOptions.map(({ labelId, value }) => ({
                  label: intl.formatMessage({ id: labelId }),
                  value,
                }))}
                onChange={(value) => {
                  setPriority(value);
                  fetchList({ current: 1, priority: value });
                }}
              />
            </>
          )}
          <Button icon={<SearchOutlined />} onClick={() => fetchList({ current: 1 })}>
            {intl.formatMessage({ id: 'common.search' })}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
            {intl.formatMessage({ id: 'common.refresh' })}
          </Button>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {intl.formatMessage({ id: 'notificationMgr.addNotification' })}
        </Button>
      </div>

      <div className={styles.tableWrap}>
        <Table<NoticeRecord>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1100 }}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showTotal: (total) => intl.formatMessage({ id: 'common.totalItems' }, { total }),
            onChange: (current, pageSize) => fetchList({ current, pageSize }),
          }}
        />
      </div>

      <Modal
        destroyOnHidden
        width={860}
        title={intl.formatMessage(
          { id: editingRecord ? 'notificationMgr.editNoticeTitle' : 'notificationMgr.createNoticeTitle' },
          {
            type: intl.formatMessage({
              id: isVersionTab ? 'notificationMgr.versionNotice' : 'notificationMgr.systemNotice',
            }),
          }
        )}
        open={formOpen}
        confirmLoading={submitting}
        onCancel={() => setFormOpen(false)}
        onOk={handleSubmit}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label={intl.formatMessage({ id: 'notificationMgr.column.title' })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'notificationMgr.titleRequired' }) }]}
          >
            <Input
              maxLength={100}
              placeholder={intl.formatMessage({
                id: isVersionTab ? 'notificationMgr.versionTitlePlaceholder' : 'notificationMgr.systemTitlePlaceholder',
              })}
            />
          </Form.Item>
          {isVersionTab && (
            <Form.Item
              name="versionNo"
              label={intl.formatMessage({ id: 'notificationMgr.column.versionNo' })}
              rules={[{ required: true, message: intl.formatMessage({ id: 'notificationMgr.versionNoRequired' }) }]}
            >
              <Input
                disabled={Boolean(editingRecord)}
                maxLength={50}
                placeholder={intl.formatMessage({ id: 'notificationMgr.versionNoPlaceholder' })}
              />
            </Form.Item>
          )}
          <Form.Item
            name="content"
            label={intl.formatMessage({
              id: isVersionTab ? 'notificationMgr.column.markdownContent' : 'notificationMgr.column.content',
            })}
            rules={[{ required: true, message: intl.formatMessage({ id: 'notificationMgr.contentRequired' }) }]}
          >
            <Input.TextArea
              rows={10}
              showCount
              maxLength={10000}
              placeholder={intl.formatMessage({
                id: isVersionTab ? 'notificationMgr.markdownContentPlaceholder' : 'notificationMgr.contentPlaceholder',
              })}
            />
          </Form.Item>
          {!isVersionTab && (
            <>
              <Form.Item
                name="priority"
                label={intl.formatMessage({ id: 'notificationMgr.column.priority' })}
                rules={[{ required: true, message: intl.formatMessage({ id: 'notificationMgr.priorityRequired' }) }]}
              >
                <Select
                  options={priorityOptions.map(({ labelId, value }) => ({
                    label: intl.formatMessage({ id: labelId }),
                    value,
                  }))}
                />
              </Form.Item>
              <Form.Item name="expireTime" label={intl.formatMessage({ id: 'notificationMgr.expireTime' })}>
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <Drawer
        width={720}
        title={previewRecord?.title || intl.formatMessage({ id: 'notificationMgr.previewTitle' })}
        open={!!previewRecord}
        onClose={() => setPreviewRecord(null)}
      >
        <div className={styles.drawerContent}>
          {previewRecord?.bizType === BIZ_TYPE_VERSION ? (
            <div className={`${styles.contentPreview} ${styles.markdownPreview}`}>
              <Markdown text={previewRecord?.content || ''} />
            </div>
          ) : (
            <div className={styles.contentPreview}>
              <pre className={styles.plainPreview}>{previewRecord?.content || '-'}</pre>
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
};

export default NotificationMgr;
