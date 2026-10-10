import {
  getPublication,
  previewPublication,
  listPublications,
  publicationAction,
  publicationUrl,
  type Publication,
} from '@/service/employeePublication';
import useEmployeePublicationCapabilities from '@/hooks/useEmployeePublicationCapabilities';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useIntl, useNavigate } from '@umijs/max';
import { Alert, Button, Empty, Segmented, Space, Table, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import styles from './AuditList.module.less';
import { publicationErrorMessage } from '@/utils/publicationError';
import usePublicationConfirmation from './usePublicationConfirmation';

const statusAppearance = {
  DRAFT: { color: 'default', icon: <EditOutlined /> },
  PENDING: { color: 'processing', icon: <ClockCircleOutlined /> },
  APPLYING: { color: 'processing', icon: <SyncOutlined spin /> },
  PUBLISHED: { color: 'success', icon: <CheckCircleOutlined /> },
  REJECTED: { color: 'error', icon: <CloseCircleOutlined /> },
  WITHDRAWN: { color: 'default', icon: <MinusCircleOutlined /> },
  FAILED: { color: 'error', icon: <ExclamationCircleOutlined /> },
};
const formatTime = (value?: string) =>
  value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';

function PublicationNote({ text, error = false }: { text: string; error?: boolean }) {
  const intl = useIntl();
  return (
    <div className={styles.noteBlock}>
      <span className={error ? styles.errorLabel : styles.secondary}>
        {error
          ? intl.formatMessage({ id: 'employeePublication.audit.failureReason' })
          : intl.formatMessage({ id: 'employeePublication.audit.reviewComment' })}
      </span>
      <Typography.Paragraph
        className={styles.note}
        type={error ? 'danger' : undefined}
        ellipsis={{
          rows: 2,
          expandable: 'collapsible',
          symbol: (expanded) =>
            expanded
              ? intl.formatMessage({ id: 'employeePublication.collapse' })
              : intl.formatMessage({ id: 'employeePublication.expand' }),
        }}
      >
        {text}
      </Typography.Paragraph>
    </div>
  );
}

interface PublicationAuditListProps {
  onAuditComplete?: () => void;
  initialReview?: boolean;
  toolbarExtra?: ReactNode;
}

function EnabledPublicationAuditList({
  capabilities,
  onAuditComplete,
  initialReview = false,
  toolbarExtra,
}: PublicationAuditListProps & { capabilities: { administrator: boolean } }) {
  const intl = useIntl();
  // 状态说明按当前语言生成，切换语言时不沿用模块初始化时的文案。
  const statusDescription: Record<string, string> = {
    DRAFT: intl.formatMessage({ id: 'employeePublication.audit.draftDescription' }),
    PENDING: intl.formatMessage({ id: 'employeePublication.audit.pendingDescription' }),
    APPLYING: intl.formatMessage({ id: 'employeePublication.audit.applyingDescription' }),
    REJECTED: intl.formatMessage({ id: 'employeePublication.audit.rejectedDescription' }),
    WITHDRAWN: intl.formatMessage({ id: 'employeePublication.audit.withdrawnDescription' }),
    FAILED: intl.formatMessage({ id: 'employeePublication.audit.failedDescription' }),
  };
  const reviewPlaceholder: Record<string, string> = {
    DRAFT: intl.formatMessage({ id: 'employeePublication.audit.notSubmitted' }),
    PENDING: intl.formatMessage({ id: 'employeePublication.audit.awaitingReview' }),
  };
  const detailLabel = (row: Publication, review: boolean, administrator?: boolean) => {
    if (row.status === 'DRAFT' && !review)
      return intl.formatMessage({ id: 'employeePublication.audit.continueEditing' });
    if (['REJECTED', 'WITHDRAWN', 'PUBLISHED'].includes(row.status))
      return intl.formatMessage({ id: 'employeePublication.audit.viewResult' });
    if (row.status === 'PENDING' && administrator && row.canReview)
      return intl.formatMessage({ id: 'employeePublication.audit.viewOrEdit' });
    return intl.formatMessage({ id: 'employeePublication.audit.viewDetails' });
  };

  const navigate = useNavigate();
  const [review, setReview] = useState(initialReview && capabilities.administrator);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Publication[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [approvingId, setApprovingId] = useState<string>();
  const approvalInFlight = useRef(false);
  const loadSequence = useRef(0);
  const { confirmPublication, confirmationDialog } = usePublicationConfirmation();
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError(undefined);
    try {
      const result = await listPublications(review, page);
      if (sequence !== loadSequence.current) return;
      setRows(result.list);
      setTotal(result.total);
    } catch (error: any) {
      if (sequence !== loadSequence.current) return;
      setRows([]);
      setTotal(0);
      setLoadError(publicationErrorMessage(error, intl.formatMessage({ id: 'employeePublication.retryLater' })));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [intl, review, page]);
  useEffect(() => {
    load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);
  const open = async (row: Publication) => {
    try {
      const detail = await getPublication(row.requestId);
      sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
      navigate(publicationUrl(detail));
    } catch (error: any) {
      message.error(publicationErrorMessage(error, intl.formatMessage({ id: 'employeePublication.cannotOpen' })));
    }
  };
  const approve = async (row: Publication) => {
    if (approvalInFlight.current) return;
    approvalInFlight.current = true;
    setApprovingId(row.requestId);
    try {
      // 预览验证列表修订号，并在实际通过前展示最新资源可用性。
      const current = await previewPublication(row);
      const decision = await confirmPublication(current);
      if (decision === 'edit') {
        sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
        navigate(publicationUrl(current));
      }
      if (decision !== 'publish') return;
      const result = await publicationAction('approve', current.publication);
      if (result.publication.status === 'PUBLISHED') {
        message.success(intl.formatMessage({ id: 'employeePublication.approvedAndPublished' }));
        if (result.dependencies.some((dependency) => dependency.warning)) {
          message.warning(intl.formatMessage({ id: 'employeePublication.resourceWarning' }));
        }
      } else
        message.error(
          result.publication.publishError || intl.formatMessage({ id: 'employeePublication.publishFailedRetry' })
        );
    } catch (error: any) {
      message.error(publicationErrorMessage(error, intl.formatMessage({ id: 'employeePublication.approvalFailed' })));
    } finally {
      await load();
      // 员工发布审批完成后同步工作区和申请页签的待审角标。
      onAuditComplete?.();
      approvalInFlight.current = false;
      setApprovingId(undefined);
    }
  };
  return (
    <div className={styles.container}>
      {confirmationDialog}
      <div className={styles.toolbar}>
        <div className={styles.toolbarControls}>
          {toolbarExtra}
          <Segmented
            disabled={!!approvingId}
            value={review ? 'review' : 'mine'}
            onChange={(value) => {
              setReview(value === 'review');
              setPage(1);
            }}
            options={[
              { label: intl.formatMessage({ id: 'employeePublication.audit.mine' }), value: 'mine' },
              ...(capabilities?.administrator
                ? [{ label: intl.formatMessage({ id: 'employeePublication.audit.records' }), value: 'review' }]
                : []),
            ]}
          />
        </div>
        <Space size="middle">
          {!loading && !loadError && (
            <span className={styles.secondary}>
              {intl.formatMessage({ id: 'employeePublication.audit.total' }, { count: total })}
            </span>
          )}
          <Button icon={<ReloadOutlined />} loading={loading} disabled={!!approvingId} onClick={load}>
            {intl.formatMessage({ id: 'employeePublication.refresh' })}
          </Button>
        </Space>
      </div>
      <div className={styles.description}>
        {review
          ? intl.formatMessage({ id: 'employeePublication.audit.reviewDescription' })
          : intl.formatMessage({ id: 'employeePublication.audit.mineDescription' })}
      </div>
      {loadError ? (
        <Alert
          type="error"
          showIcon
          message={intl.formatMessage({ id: 'employeePublication.audit.loadFailed' })}
          description={loadError}
          action={<Button onClick={load}>{intl.formatMessage({ id: 'employeePublication.reload' })}</Button>}
        />
      ) : (
        <div className={styles.tableWrap}>
          <Table<Publication>
            rowKey="requestId"
            tableLayout="fixed"
            scroll={{ x: 1200 }}
            sticky
            loading={loading}
            dataSource={rows}
            pagination={{
              current: page,
              pageSize: 20,
              total,
              onChange: setPage,
              showSizeChanger: false,
              disabled: !!approvingId,
            }}
            locale={{
              emptyText: loading ? (
                intl.formatMessage({ id: 'employeePublication.audit.loading' })
              ) : (
                <Empty
                  className={styles.empty}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    review
                      ? intl.formatMessage({ id: 'employeePublication.audit.emptyRecords' })
                      : intl.formatMessage({ id: 'employeePublication.audit.emptyMine' })
                  }
                />
              ),
            }}
            columns={[
              {
                title: intl.formatMessage({ id: 'employeePublication.digitalEmployee' }),
                dataIndex: 'employeeName',
                width: 230,
                render: (name, row) => (
                  <div className={styles.employee}>
                    <Button
                      type="link"
                      className={styles.employeeLink}
                      title={name}
                      disabled={loading || !!approvingId}
                      onClick={() => open(row)}
                    >
                      <span className={styles.employeeName}>
                        {name || intl.formatMessage({ id: 'employeePublication.audit.unnamed' })}
                      </span>
                    </Button>
                    <span className={styles.secondary}>
                      {intl.formatMessage({ id: 'employeePublication.authorLabel' })}
                      {row.authorName || '—'}
                    </span>
                  </div>
                ),
              },
              {
                title: intl.formatMessage({ id: 'employeePublication.audit.status' }),
                dataIndex: 'status',
                width: 110,
                render: (status) => (
                  <Tag {...statusAppearance[status as keyof typeof statusAppearance]}>
                    {intl.formatMessage({ id: `employeePublication.status.${status}`, defaultMessage: status })}
                  </Tag>
                ),
              },
              {
                title: intl.formatMessage({ id: 'employeePublication.audit.reviewInfo' }),
                width: 185,
                render: (_, row) => (
                  <div className={styles.reviewInfo}>
                    {row.reviewerName || row.reviewedAt ? (
                      <>
                        <span>
                          {intl.formatMessage({ id: 'employeePublication.reviewerLabel' })}
                          {row.reviewerName || '—'}
                        </span>
                        <span className={styles.secondary}>
                          {intl.formatMessage({ id: 'employeePublication.audit.reviewedAtLabel' })}
                          {formatTime(row.reviewedAt)}
                        </span>
                      </>
                    ) : (
                      <span className={styles.secondary}>
                        {row.requiresAdminVipReview && ['PENDING', 'FAILED'].includes(row.status)
                          ? intl.formatMessage({ id: 'employeePublication.audit.awaitingAdminVip' })
                          : reviewPlaceholder[row.status] ||
                            intl.formatMessage({ id: 'employeePublication.audit.noReview' })}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                title: intl.formatMessage({ id: 'employeePublication.audit.notes' }),
                render: (_, row) => (
                  <div className={styles.notes}>
                    {row.publishError && <PublicationNote text={row.publishError} error />}
                    {row.comment && <PublicationNote text={row.comment} />}
                    {!row.publishError && !row.comment && (
                      <span className={styles.secondary}>
                        {row.status === 'PUBLISHED'
                          ? intl.formatMessage({ id: 'employeePublication.publishedDescription' })
                          : statusDescription[row.status] || '—'}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                title: intl.formatMessage({ id: 'employeePublication.audit.updatedAt' }),
                dataIndex: 'updatedAt',
                width: 165,
                render: (time) => formatTime(time),
              },
              {
                title: intl.formatMessage({ id: 'employeePublication.actions' }),
                width: 210,
                fixed: 'right',
                render: (_, row) => (
                  <Space size={8}>
                    <Button type="link" size="small" disabled={loading || !!approvingId} onClick={() => open(row)}>
                      {detailLabel(row, review, capabilities?.administrator)}
                    </Button>
                    {capabilities?.administrator && row.canReview && (
                      <Button
                        type="primary"
                        size="small"
                        loading={approvingId === row.requestId}
                        disabled={loading || !!approvingId}
                        onClick={() => approve(row)}
                      >
                        {['FAILED', 'APPLYING'].includes(row.status)
                          ? intl.formatMessage({ id: 'employeePublication.retryPublish' })
                          : intl.formatMessage({ id: 'employeePublication.approveAndPublish' })}
                      </Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

export default function PublicationAuditList(props: PublicationAuditListProps) {
  const capabilities = useEmployeePublicationCapabilities();
  if (capabilities?.enabled !== true) return null;
  return <EnabledPublicationAuditList capabilities={capabilities} {...props} />;
}
