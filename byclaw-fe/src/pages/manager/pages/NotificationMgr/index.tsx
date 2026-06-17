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
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

import Markdown from '@/components/Markdown';
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
  { label: '低', value: 1, color: 'default' },
  { label: '中', value: 2, color: 'blue' },
  { label: '高', value: 3, color: 'orange' },
  { label: '紧急', value: 4, color: 'red' },
];

const normalizeRows = (pageData: any): NoticeRecord[] => {
  const rows = pageData?.records || pageData?.list || pageData?.rows || pageData?.data || [];
  return Array.isArray(rows) ? rows : [];
};

const getTotal = (pageData: any) => Number(pageData?.total ?? pageData?.totalCount ?? 0);

const getPriorityMeta = (priority?: number) => priorityOptions.find((item) => item.value === priority);

const NotificationMgr: React.FC = () => {
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

  const isVersionTab = activeTab === 'version';

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
          message.error(res?.msg || '通知列表查询失败');
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
    [activeTab, isVersionTab, keyword, pagination.current, pagination.pageSize, priority]
  );

  useEffect(() => {
    setKeyword('');
    setPriority(undefined);
    setPagination((prev) => ({ ...prev, current: 1 }));
    fetchList({ current: 1, keyword: '', priority: undefined });
  }, [activeTab]);

  const openCreate = () => {
    setEditingRecord(null);
    form.resetFields();
    form.setFieldsValue({
      priority: 2,
    });
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
        message.error(res?.msg || '通知保存失败');
        return;
      }
      message.success(editingRecord ? '通知已更新' : '通知已创建');
      setFormOpen(false);
      fetchList();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: NoticeRecord) => {
    const res: any = await deleteNotification({ id: record.id });
    if (res?.code !== 0) {
      message.error(res?.msg || '通知删除失败');
      return;
    }
    message.success('通知已删除');
    fetchList();
  };

  const columns = useMemo<ColumnsType<NoticeRecord>>(() => {
    const base: ColumnsType<NoticeRecord> = [
      {
        title: '标题',
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
        title: isVersionTab ? 'Markdown 内容' : '通知内容',
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
        title: '版本号',
        dataIndex: 'extraInfo',
        width: 140,
        render: (value) => value || '-',
      });
    }

    if (!isVersionTab) {
      base.push({
        title: '优先级',
        dataIndex: 'priority',
        width: 96,
        render: (value) => {
          const meta = getPriorityMeta(value);
          return <Tag color={meta?.color}>{meta?.label || '-'}</Tag>;
        },
      });
    }

    base.push(
      {
        title: '创建时间',
        dataIndex: 'createTime',
        width: 180,
        render: (value) => value || '-',
      },
      {
        title: '操作',
        fixed: 'right',
        width: 180,
        render: (_, record) => (
          <Space size={4}>
            <Button type="link" icon={<EyeOutlined />} onClick={() => setPreviewRecord(record)}>
              预览
            </Button>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
              编辑
            </Button>
            <Popconfirm title="确认删除该通知？" onConfirm={() => handleDelete(record)}>
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      }
    );
    return base;
  }, [isVersionTab]);

  const tabItems = [
    { key: 'version', label: '版本通知' },
    { key: 'system', label: '系统通知' },
  ];

  return (
    <div className={styles.container}>
      <Tabs activeKey={activeTab} items={tabItems} onChange={(key) => setActiveTab(key as NoticeTab)} />

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <Input
            allowClear
            placeholder="搜索标题"
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
                placeholder="优先级"
                style={{ width: 120 }}
                value={priority}
                options={priorityOptions.map(({ label, value }) => ({ label, value }))}
                onChange={(value) => {
                  setPriority(value);
                  fetchList({ current: 1, priority: value });
                }}
              />
            </>
          )}
          <Button icon={<SearchOutlined />} onClick={() => fetchList({ current: 1 })}>
            查询
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => fetchList()}>
            刷新
          </Button>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增通知
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
            showTotal: (total) => `共 ${total} 条`,
            onChange: (current, pageSize) => fetchList({ current, pageSize }),
          }}
        />
      </div>

      <Modal
        destroyOnClose
        width={860}
        title={`${editingRecord ? '编辑' : '新增'}${isVersionTab ? '版本通知' : '系统通知'}`}
        open={formOpen}
        confirmLoading={submitting}
        onCancel={() => setFormOpen(false)}
        onOk={handleSubmit}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入通知标题' }]}>
            <Input maxLength={100} placeholder={isVersionTab ? '例如：v1.2.0 更新公告' : '请输入系统通知标题'} />
          </Form.Item>
          {isVersionTab && (
            <Form.Item name="versionNo" label="版本号" rules={[{ required: true, message: '请输入版本号' }]}>
              <Input maxLength={50} placeholder="例如：1.2.0" />
            </Form.Item>
          )}
          <Form.Item
            name="content"
            label={isVersionTab ? 'Markdown 内容' : '通知内容'}
            rules={[{ required: true, message: '请输入通知内容' }]}
          >
            <Input.TextArea
              rows={10}
              showCount
              maxLength={10000}
              placeholder={isVersionTab ? '# 更新内容' : '请输入通知正文'}
            />
          </Form.Item>
          {!isVersionTab && (
            <>
              <Form.Item name="priority" label="优先级" rules={[{ required: true, message: '请选择优先级' }]}>
                <Select options={priorityOptions.map(({ label, value }) => ({ label, value }))} />
              </Form.Item>
              <Form.Item name="expireTime" label="过期时间">
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      <Drawer
        width={720}
        title={previewRecord?.title || '通知预览'}
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
