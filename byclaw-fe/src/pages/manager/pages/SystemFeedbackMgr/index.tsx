import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  message,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { DownloadOutlined, ExportOutlined, EyeOutlined, FileOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { downloadFile, getFileUrl } from '@/utils/file';
import {
  exportSystemFeedbackList,
  querySystemFeedbackDetail,
  querySystemFeedbackList,
  readSystemFeedbackAttachment,
  SystemFeedbackQueryParams,
} from '@/pages/manager/service/SystemFeedbackMgr';
import styles from './index.module.less';

interface SystemFeedbackAttachment {
  attachFileId: number;
  fileName: string;
  fileType?: string;
  createDate?: string;
}

interface SystemFeedbackItem {
  id: number;
  userId?: number;
  userName?: string;
  feedbackType?: string;
  title?: string;
  content?: string;
  contactInfo?: string;
  status?: string;
  systemVersion?: string;
  deviceInfo?: string;
  ipAddress?: string;
  screenshotUrl?: string;
  createDate?: string | number;
  attachmentCount?: number;
  attachments?: SystemFeedbackAttachment[];
}

const getResponseData = (response: any) => response?.data ?? response;

const formatDateTime = (value?: string | number) => {
  if (!value) {
    return '-';
  }
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : String(value);
};

const AttachmentCard = ({ attachment }: { attachment: SystemFeedbackAttachment }) => {
  const intl = useIntl();
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const isImage =
    attachment.fileType?.startsWith('image/') ||
    /\.(png|jpe?g|gif|bmp|webp|svg|tiff?)$/i.test(attachment.fileName || '');

  useEffect(() => {
    if (!isImage) {
      return undefined;
    }

    let active = true;
    let objectUrl = '';
    setLoading(true);
    readSystemFeedbackAttachment(attachment.attachFileId)
      .then((response: any) => {
        if (!active || !response?.file) {
          return;
        }
        objectUrl = URL.createObjectURL(response.file);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (active) {
          message.warning(intl.formatMessage({ id: 'systemFeedbackMgr.detail.previewFailed' }));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [attachment.attachFileId, intl, isImage]);

  const handleDownload = async () => {
    const response: any = await readSystemFeedbackAttachment(attachment.attachFileId, true);
    downloadFile({
      file: response?.file,
      fileName: response?.fileName || attachment.fileName,
    });
  };

  const handlePreview = async () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const response: any = await readSystemFeedbackAttachment(attachment.attachFileId);
    if (!response?.file) {
      return;
    }
    const url = URL.createObjectURL(response.file);
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  return (
    <div className={styles.attachmentCard}>
      <div className={styles.attachmentPreview}>
        {isImage && previewUrl ? (
          <Image
            src={previewUrl}
            alt={attachment.fileName}
            className={styles.attachmentImage}
            preview={{ mask: intl.formatMessage({ id: 'systemFeedbackMgr.detail.preview' }) }}
          />
        ) : (
          <FileOutlined className={styles.attachmentFile} spin={loading} />
        )}
      </div>
      <div className={styles.attachmentMeta}>
        <div className={styles.attachmentNameWrap}>
          <Tooltip title={attachment.fileName}>
            <Typography.Text ellipsis className={styles.attachmentName}>
              {attachment.fileName}
            </Typography.Text>
          </Tooltip>
        </div>
        <Space size={4} className={styles.attachmentActions}>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={handlePreview}>
            {intl.formatMessage({ id: 'systemFeedbackMgr.detail.preview' })}
          </Button>
          <Button type="link" size="small" icon={<DownloadOutlined />} onClick={handleDownload}>
            {intl.formatMessage({ id: 'systemFeedbackMgr.detail.download' })}
          </Button>
        </Space>
      </div>
    </div>
  );
};

const SystemFeedbackMgr = () => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [list, setList] = useState<SystemFeedbackItem[]>([]);
  const [pageInfo, setPageInfo] = useState({ pageNum: 1, pageSize: 20, total: 0 });
  const [queryParams, setQueryParams] = useState<SystemFeedbackQueryParams>({});
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SystemFeedbackItem | null>(null);

  const feedbackTypeOptions = [
    { value: 'BUG', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.bug' }) },
    { value: 'SUGGESTION', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.suggestion' }) },
    { value: 'INQUIRY', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.inquiry' }) },
    { value: 'OTHER', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.other' }) },
  ];

  const getFeedbackTypeLabel = (type?: string) =>
    feedbackTypeOptions.find((item) => item.value === type)?.label || type || '-';

  const loadData = async (nextPage = pageInfo.pageNum, nextPageSize = pageInfo.pageSize, filters = queryParams) => {
    setLoading(true);
    try {
      const response = await querySystemFeedbackList({
        ...filters,
        pageNum: nextPage,
        pageSize: nextPageSize,
      });
      const data = getResponseData(response) || {};
      setList(data.list || []);
      setPageInfo({
        pageNum: data.pageNum || nextPage,
        pageSize: data.pageSize || nextPageSize,
        total: data.total || 0,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(1, 20, {});
  }, []);

  const handleSearch = (values: SystemFeedbackQueryParams) => {
    const filters = {
      feedbackType: values.feedbackType || undefined,
      title: values.title?.trim() || undefined,
      content: values.content?.trim() || undefined,
    };
    setQueryParams(filters);
    loadData(1, pageInfo.pageSize, filters);
  };

  const handleReset = () => {
    form.resetFields();
    setQueryParams({});
    loadData(1, pageInfo.pageSize, {});
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const response: any = await exportSystemFeedbackList(queryParams);
      downloadFile({
        file: response?.file,
        fileName:
          response?.fileName ||
          `${intl.formatMessage({ id: 'systemFeedbackMgr.title' })}_${dayjs().format('YYYYMMDDHHmmss')}.xlsx`,
      });
      message.success(intl.formatMessage({ id: 'systemFeedbackMgr.action.exportSuccess' }));
    } catch {
      message.error(intl.formatMessage({ id: 'systemFeedbackMgr.action.exportFailed' }));
    } finally {
      setExporting(false);
    }
  };

  const handleViewDetail = async (feedbackId: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await querySystemFeedbackDetail(feedbackId);
      setDetail(getResponseData(response));
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = [
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.filter.type' }),
      dataIndex: 'feedbackType',
      width: 130,
      render: (value: string) => <Tag color="blue">{getFeedbackTypeLabel(value)}</Tag>,
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.filter.title' }),
      dataIndex: 'title',
      width: 220,
      ellipsis: { showTitle: false },
      render: (value: string) => (
        <Tooltip title={value}>
          <Typography.Text ellipsis className={styles.ellipsis}>
            {value || '-'}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.filter.content' }),
      dataIndex: 'content',
      ellipsis: { showTitle: false },
      render: (value: string) => (
        <Tooltip title={value}>
          <Typography.Text ellipsis className={styles.ellipsis}>
            {value || '-'}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.table.submitter' }),
      dataIndex: 'userName',
      width: 140,
      render: (value: string) => value || '-',
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.table.contact' }),
      dataIndex: 'contactInfo',
      width: 180,
      ellipsis: true,
      render: (value: string) => value || '-',
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.table.attachments' }),
      dataIndex: 'attachmentCount',
      width: 120,
      align: 'center' as const,
      render: (value: number) => value || 0,
    },
    {
      title: intl.formatMessage({ id: 'common.status' }),
      dataIndex: 'status',
      width: 110,
      render: (value: string) =>
        value?.toUpperCase() === 'PENDING'
          ? intl.formatMessage({ id: 'systemFeedbackMgr.status.pending' })
          : value || '-',
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.table.createTime' }),
      dataIndex: 'createDate',
      width: 180,
      render: formatDateTime,
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.table.operation' }),
      key: 'operation',
      fixed: 'right' as const,
      width: 110,
      render: (_: unknown, record: SystemFeedbackItem) => (
        <Button type="link" onClick={() => handleViewDetail(record.id)}>
          {intl.formatMessage({ id: 'systemFeedbackMgr.action.detail' })}
        </Button>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Typography.Title level={3} className={styles.title}>
          {intl.formatMessage({ id: 'systemFeedbackMgr.title' })}
        </Typography.Title>
        <Button icon={<ExportOutlined />} loading={exporting} onClick={handleExport}>
          {intl.formatMessage({ id: 'systemFeedbackMgr.action.export' })}
        </Button>
      </div>

      <Card className={styles.filterCard}>
        <Form form={form} layout="vertical" className={styles.filterForm} onFinish={handleSearch}>
          <Form.Item
            name="feedbackType"
            label={intl.formatMessage({ id: 'systemFeedbackMgr.filter.type' })}
            className={styles.filterType}
          >
            <Select
              allowClear
              options={feedbackTypeOptions}
              placeholder={intl.formatMessage({ id: 'systemFeedbackMgr.filter.typePlaceholder' })}
            />
          </Form.Item>
          <Form.Item
            name="title"
            label={intl.formatMessage({ id: 'systemFeedbackMgr.filter.title' })}
            className={styles.filterTitle}
          >
            <Input allowClear placeholder={intl.formatMessage({ id: 'systemFeedbackMgr.filter.titlePlaceholder' })} />
          </Form.Item>
          <Form.Item
            name="content"
            label={intl.formatMessage({ id: 'systemFeedbackMgr.filter.content' })}
            className={styles.filterContent}
          >
            <Input allowClear placeholder={intl.formatMessage({ id: 'systemFeedbackMgr.filter.contentPlaceholder' })} />
          </Form.Item>
          <div className={styles.filterActions}>
            <Button onClick={handleReset}>{intl.formatMessage({ id: 'common.reset' })}</Button>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
              {intl.formatMessage({ id: 'common.search' })}
            </Button>
          </div>
        </Form>
      </Card>

      <Card className={styles.tableCard}>
        <Table
          className={styles.table}
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1380, y: 'calc(100vh - 380px)' }}
          pagination={{
            current: pageInfo.pageNum,
            pageSize: pageInfo.pageSize,
            total: pageInfo.total,
            showSizeChanger: true,
            showTotal: (total) => intl.formatMessage({ id: 'systemFeedbackMgr.pagination.total' }, { total }),
            onChange: (page, pageSize) => loadData(page, pageSize),
          }}
        />
      </Card>

      <Drawer
        title={intl.formatMessage({ id: 'systemFeedbackMgr.detail.title' })}
        width={680}
        open={detailOpen}
        loading={detailLoading}
        destroyOnClose
        onClose={() => setDetailOpen(false)}
      >
        {detail && (
          <>
            <div className={styles.detailSectionTitle}>
              {intl.formatMessage({ id: 'systemFeedbackMgr.detail.basic' })}
            </div>
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.detail.feedbackId' })}>
                {detail.id}
              </Descriptions.Item>
              <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.filter.type' })}>
                {getFeedbackTypeLabel(detail.feedbackType)}
              </Descriptions.Item>
              <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.filter.title' })} span={2}>
                {detail.title || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.filter.content' })} span={2}>
                {detail.content || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.table.submitter' })}>
                {detail.userName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.table.contact' })}>
                {detail.contactInfo || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.table.createTime' })}>
                {formatDateTime(detail.createDate)}
              </Descriptions.Item>
              <Descriptions.Item label={intl.formatMessage({ id: 'common.status' })}>
                {detail.status?.toUpperCase() === 'PENDING'
                  ? intl.formatMessage({ id: 'systemFeedbackMgr.status.pending' })
                  : detail.status || '-'}
              </Descriptions.Item>
            </Descriptions>

            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>
                {intl.formatMessage({ id: 'systemFeedbackMgr.detail.system' })}
              </div>
              <Descriptions bordered column={2} size="small">
                <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.detail.systemVersion' })}>
                  {detail.systemVersion || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.detail.ipAddress' })}>
                  {detail.ipAddress || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.detail.deviceInfo' })} span={2}>
                  {detail.deviceInfo || '-'}
                </Descriptions.Item>
              </Descriptions>
            </div>

            {detail.screenshotUrl && (
              <div className={styles.detailSection}>
                <div className={styles.detailSectionTitle}>
                  {intl.formatMessage({ id: 'systemFeedbackMgr.detail.screenshot' })}
                </div>
                <Image
                  src={getFileUrl(detail.screenshotUrl)}
                  alt={intl.formatMessage({ id: 'systemFeedbackMgr.detail.screenshot' })}
                  className={styles.screenshot}
                />
              </div>
            )}

            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>
                {intl.formatMessage({ id: 'systemFeedbackMgr.detail.attachments' })}
              </div>
              {detail.attachments?.length ? (
                <div className={styles.attachmentGrid}>
                  {detail.attachments.map((attachment) => (
                    <AttachmentCard key={attachment.attachFileId} attachment={attachment} />
                  ))}
                </div>
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={intl.formatMessage({ id: 'systemFeedbackMgr.detail.noAttachments' })}
                />
              )}
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
};

export default SystemFeedbackMgr;
