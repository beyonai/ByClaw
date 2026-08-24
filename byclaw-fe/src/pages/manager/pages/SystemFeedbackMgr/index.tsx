import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  ConfigProvider,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  message,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ClearOutlined,
  DownloadOutlined,
  ExportOutlined,
  EyeOutlined,
  FileOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { downloadFile, getFileUrl } from '@/utils/file';
import {
  exportSystemFeedbackList,
  querySystemFeedbackDetail,
  querySystemFeedbackList,
  readSystemFeedbackAttachment,
  SystemFeedbackQueryParams,
  updateSystemFeedbackStatus,
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
  updateDate?: string | number;
  processUserName?: string;
  processDate?: string | number;
  processComment?: string;
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

const formatFeedbackTime = (value?: string | number) => {
  if (!value) {
    return '-';
  }
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : String(value);
};

const detailLabelStyle: React.CSSProperties = {
  width: 120,
  minWidth: 120,
  whiteSpace: 'nowrap',
  wordBreak: 'keep-all',
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
  const pageSizeRef = useRef(20);
  const [queryParams, setQueryParams] = useState<SystemFeedbackQueryParams>({});
  const requestSequenceRef = useRef(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SystemFeedbackItem | null>(null);
  const [targetStatus, setTargetStatus] = useState<string>();
  const [processComment, setProcessComment] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const watchedFeedbackType = Form.useWatch('feedbackType', form);
  const watchedStatus = Form.useWatch('status', form);
  const watchedKeyword = Form.useWatch('keyword', form);

  const feedbackTypeOptions = [
    { value: 'BUG', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.bug' }) },
    { value: 'SUGGESTION', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.suggestion' }) },
    { value: 'INQUIRY', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.inquiry' }) },
    { value: 'OTHER', label: intl.formatMessage({ id: 'systemFeedbackMgr.type.other' }) },
  ];

  const statusOptions = useMemo(
    () => [
      { value: 'pending', label: intl.formatMessage({ id: 'systemFeedbackMgr.status.pending' }), color: 'gold' },
      {
        value: 'processing',
        label: intl.formatMessage({ id: 'systemFeedbackMgr.status.processing' }),
        color: 'blue',
      },
      { value: 'resolved', label: intl.formatMessage({ id: 'systemFeedbackMgr.status.resolved' }), color: 'green' },
      { value: 'closed', label: intl.formatMessage({ id: 'systemFeedbackMgr.status.closed' }), color: 'default' },
    ],
    [intl]
  );

  const statusTransitionMap: Record<string, string[]> = {
    pending: ['processing', 'closed'],
    processing: ['resolved', 'closed'],
    resolved: ['processing', 'closed'],
    closed: [],
  };

  const getFeedbackTypeLabel = (type?: string) =>
    feedbackTypeOptions.find((item) => item.value === type)?.label || type || '-';

  const getFeedbackTypeClassName = (type?: string) => {
    const typeClassMap: Record<string, string> = {
      BUG: styles.typeBug,
      SUGGESTION: styles.typeSuggestion,
      INQUIRY: styles.typeInquiry,
      OTHER: styles.typeOther,
    };
    return `${styles.typeTag} ${typeClassMap[type?.toUpperCase() || 'OTHER'] || styles.typeOther}`;
  };

  const renderStatus = (status?: string) => {
    const normalizedStatus = status?.toLowerCase() || 'pending';
    const option = statusOptions.find((item) => item.value === normalizedStatus);
    const statusClassMap: Record<string, string> = {
      pending: styles.statusPending,
      processing: styles.statusProcessing,
      resolved: styles.statusResolved,
      closed: styles.statusClosed,
    };
    return option ? (
      <Tag className={`${styles.statusTag} ${statusClassMap[normalizedStatus]}`}>{option.label}</Tag>
    ) : (
      status || '-'
    );
  };

  const loadData = useCallback(async (nextPage: number, nextPageSize: number, filters: SystemFeedbackQueryParams) => {
    const requestSequence = ++requestSequenceRef.current;
    setLoading(true);
    try {
      const response = await querySystemFeedbackList({
        ...filters,
        pageNum: nextPage,
        pageSize: nextPageSize,
      });
      // 筛选快速变化时，只允许最后一次请求更新页面，避免旧结果覆盖新结果。
      if (requestSequence !== requestSequenceRef.current) {
        return;
      }
      const data = getResponseData(response) || {};
      pageSizeRef.current = data.pageSize || nextPageSize;
      setList(data.list || []);
      setPageInfo({
        pageNum: data.pageNum || nextPage,
        pageSize: data.pageSize || nextPageSize,
        total: data.total || 0,
      });
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // 文本输入和下拉筛选统一防抖，避免每次按键或快速切换都立即请求接口。
    const timer = window.setTimeout(() => {
      const filters = {
        feedbackType: watchedFeedbackType || undefined,
        status: watchedStatus || undefined,
        keyword: watchedKeyword?.trim() || undefined,
      };
      setQueryParams(filters);
      loadData(1, pageSizeRef.current, filters);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [loadData, watchedFeedbackType, watchedKeyword, watchedStatus]);

  const handleReset = () => {
    form.resetFields();
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

  const handleRefresh = () => {
    loadData(pageInfo.pageNum, pageInfo.pageSize, queryParams);
  };

  const handleViewDetail = async (feedbackId: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    setTargetStatus(undefined);
    setProcessComment('');
    try {
      const response = await querySystemFeedbackDetail(feedbackId);
      setDetail(getResponseData(response));
    } finally {
      setDetailLoading(false);
    }
  };

  const availableTargetStatuses = statusOptions.filter((item) =>
    statusTransitionMap[detail?.status?.toLowerCase() || 'pending']?.includes(item.value)
  );

  const handleStatusUpdate = async () => {
    if (!detail || !targetStatus) {
      message.warning(intl.formatMessage({ id: 'systemFeedbackMgr.status.targetRequired' }));
      return;
    }
    setStatusUpdating(true);
    try {
      const response = await updateSystemFeedbackStatus({
        feedbackId: detail.id,
        status: targetStatus,
        processComment: processComment.trim() || undefined,
      });
      setDetail(getResponseData(response));
      setTargetStatus(undefined);
      setProcessComment('');
      message.success(intl.formatMessage({ id: 'systemFeedbackMgr.status.updateSuccess' }));
      await loadData(pageInfo.pageNum, pageInfo.pageSize, queryParams);
    } catch {
      message.error(intl.formatMessage({ id: 'systemFeedbackMgr.status.updateFailed' }));
    } finally {
      setStatusUpdating(false);
    }
  };

  const columns = [
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.filter.type' }),
      dataIndex: 'feedbackType',
      width: 130,
      render: (value: string) => <Tag className={getFeedbackTypeClassName(value)}>{getFeedbackTypeLabel(value)}</Tag>,
    },
    {
      title: intl.formatMessage({ id: 'systemFeedbackMgr.filter.title' }),
      dataIndex: 'title',
      width: 220,
      ellipsis: { showTitle: false },
      render: (value: string, record: SystemFeedbackItem) => (
        <Tooltip title={value}>
          <Button type="link" className={styles.titleLink} onClick={() => handleViewDetail(record.id)}>
            {value || '-'}
          </Button>
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
      title: intl.formatMessage({ id: 'common.status' }),
      dataIndex: 'status',
      width: 110,
      render: renderStatus,
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
      title: intl.formatMessage({ id: 'systemFeedbackMgr.table.createTime' }),
      dataIndex: 'createDate',
      width: 180,
      render: formatFeedbackTime,
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
      {/* 筛选和页面操作保持在同一行，操作区靠右展示。 */}
      <Form form={form} className={styles.filterForm}>
        <Form.Item name="feedbackType" className={styles.filterType}>
          <Select
            allowClear
            options={feedbackTypeOptions}
            placeholder={intl.formatMessage({ id: 'systemFeedbackMgr.filter.typePlaceholder' })}
          />
        </Form.Item>
        <Form.Item name="status" className={styles.filterStatus}>
          <Select
            allowClear
            options={statusOptions}
            placeholder={intl.formatMessage({ id: 'systemFeedbackMgr.filter.statusPlaceholder' })}
          />
        </Form.Item>
        <Form.Item name="keyword" className={styles.filterKeyword}>
          <Input allowClear placeholder={intl.formatMessage({ id: 'systemFeedbackMgr.filter.keywordPlaceholder' })} />
        </Form.Item>
        <div className={styles.filterActions}>
          <Button icon={<ClearOutlined />} onClick={handleReset}>
            {intl.formatMessage({ id: 'common.reset' })}
          </Button>
          <Button icon={<ExportOutlined />} loading={exporting} onClick={handleExport}>
            {intl.formatMessage({ id: 'systemFeedbackMgr.action.export' })}
          </Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={handleRefresh}>
            {intl.formatMessage({ id: 'common.refresh' })}
          </Button>
        </div>
      </Form>

      <div className={styles.tableSection}>
        <Table
          className={styles.table}
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1380, y: 'calc(100vh - 260px)' }}
          pagination={{
            current: pageInfo.pageNum,
            pageSize: pageInfo.pageSize,
            total: pageInfo.total,
            showSizeChanger: true,
            showTotal: (total) => intl.formatMessage({ id: 'systemFeedbackMgr.pagination.total' }, { total }),
            onChange: (page, pageSize) => loadData(page, pageSize, queryParams),
          }}
        />
      </div>

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
            <Descriptions
              bordered
              column={2}
              size="small"
              className={styles.detailDescriptions}
              labelStyle={detailLabelStyle}
            >
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
                {renderStatus(detail.status)}
              </Descriptions.Item>
            </Descriptions>

            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>
                {intl.formatMessage({ id: 'systemFeedbackMgr.detail.process' })}
              </div>
              <Descriptions
                bordered
                column={2}
                size="small"
                className={styles.detailDescriptions}
                labelStyle={detailLabelStyle}
              >
                <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.detail.processUser' })}>
                  {detail.processUserName || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={intl.formatMessage({ id: 'systemFeedbackMgr.detail.processTime' })}>
                  {formatDateTime(detail.processDate)}
                </Descriptions.Item>
                <Descriptions.Item
                  label={intl.formatMessage({ id: 'systemFeedbackMgr.detail.processComment' })}
                  span={2}
                >
                  {detail.processComment || '-'}
                </Descriptions.Item>
              </Descriptions>
              {availableTargetStatuses.length > 0 && (
                <div className={styles.statusAction}>
                  <ConfigProvider
                    theme={{
                      components: {
                        Segmented: {
                          itemSelectedBg: '#1677ff',
                          itemSelectedColor: '#ffffff',
                        },
                      },
                    }}
                  >
                    <Segmented
                      block
                      className={styles.statusSegmented}
                      value={targetStatus}
                      options={availableTargetStatuses.map((item) => ({
                        label: item.label,
                        value: item.value,
                      }))}
                      onChange={(value) => setTargetStatus(String(value))}
                    />
                  </ConfigProvider>
                  <div className={styles.processCommentField}>
                    <Input.TextArea
                      value={processComment}
                      maxLength={1000}
                      rows={3}
                      showCount
                      placeholder={intl.formatMessage({ id: 'systemFeedbackMgr.status.commentPlaceholder' })}
                      onChange={(event) => setProcessComment(event.target.value)}
                    />
                  </div>
                  <div className={styles.statusActionFooter}>
                    <Button type="primary" loading={statusUpdating} onClick={handleStatusUpdate}>
                      {intl.formatMessage({ id: 'systemFeedbackMgr.status.confirm' })}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>
                {intl.formatMessage({ id: 'systemFeedbackMgr.detail.system' })}
              </div>
              <Descriptions
                bordered
                column={2}
                size="small"
                className={styles.detailDescriptions}
                labelStyle={detailLabelStyle}
              >
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
