import {
  getPublication,
  previewPublication,
  listPublications,
  publicationAction,
  publicationStatus,
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
import { useNavigate } from '@umijs/max';
import { Alert, Button, Empty, Segmented, Space, Table, Tag, Typography, message } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
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
const statusDescription: Record<string, string> = {
  DRAFT: '配置尚未提交，提交后进入发布流程。',
  PENDING: '等待审核，可进入详情查看待发布配置。',
  APPLYING: '正在发布官方副本，请稍后刷新查看结果。',
  PUBLISHED: '本次申请已发布到官方推荐。',
  REJECTED: '审核未通过，请查看详情了解审核结果。',
  WITHDRAWN: '申请已撤回。',
  FAILED: '发布未完成，请查看详情确认失败原因。',
};
const formatTime = (value?: string) =>
  value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
const reviewPlaceholder: Record<string, string> = { DRAFT: '尚未提交审核', PENDING: '等待管理员审核' };
const detailLabel = (row: Publication, review: boolean, administrator?: boolean) => {
  if (row.status === 'DRAFT' && !review) return '继续编辑';
  if (['REJECTED', 'WITHDRAWN', 'PUBLISHED'].includes(row.status)) return '查看结果';
  if (row.status === 'PENDING' && administrator && row.canReview) return '查看 / 编辑';
  return '查看详情';
};

function PublicationNote({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <div className={styles.noteBlock}>
      <span className={error ? styles.errorLabel : styles.secondary}>{error ? '失败原因' : '审核意见'}</span>
      <Typography.Paragraph
        className={styles.note}
        type={error ? 'danger' : undefined}
        ellipsis={{ rows: 2, expandable: 'collapsible', symbol: (expanded) => (expanded ? '收起' : '展开') }}
      >
        {text}
      </Typography.Paragraph>
    </div>
  );
}

function EnabledPublicationAuditList({ capabilities }: { capabilities: { administrator: boolean } }) {
  const navigate = useNavigate();
  const [review, setReview] = useState(false);
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
      setLoadError(publicationErrorMessage(error, '请稍后重试'));
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [review, page]);
  useEffect(() => {
    load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);
  const open = async (row: Publication) => {
    try {
      const detail = await getPublication(row.requestId);
      sessionStorage.setItem('EmployeeDetail_prevRoute', '/myEmployees');
      navigate(publicationUrl(detail));
    } catch (error: any) {
      message.error(publicationErrorMessage(error, '无法查看此申请'));
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
        sessionStorage.setItem('EmployeeDetail_prevRoute', '/myEmployees');
        navigate(publicationUrl(current));
      }
      if (decision !== 'publish') return;
      const result = await publicationAction('approve', current.publication);
      if (result.publication.status === 'PUBLISHED') {
        message.success('审核通过，已发布到官方推荐');
        if (result.dependencies.some((dependency) => dependency.warning)) {
          message.warning('部分关联资源可能不可用，请进入申请详情查看可用性提醒');
        }
      } else message.error(result.publication.publishError || '发布失败，请查看申请详情后重试');
    } catch (error: any) {
      message.error(publicationErrorMessage(error, '审批失败，请刷新后重试'));
    } finally {
      await load();
      approvalInFlight.current = false;
      setApprovingId(undefined);
    }
  };
  return (
    <div className={styles.container}>
      {confirmationDialog}
      <div className={styles.toolbar}>
        <Segmented
          disabled={!!approvingId}
          value={review ? 'review' : 'mine'}
          onChange={(value) => {
            setReview(value === 'review');
            setPage(1);
          }}
          options={[
            { label: '我的发布申请', value: 'mine' },
            ...(capabilities?.administrator ? [{ label: '发布审核及记录', value: 'review' }] : []),
          ]}
        />
        <Space size="middle">
          {!loading && !loadError && <span className={styles.secondary}>共 {total} 条申请</span>}
          <Button icon={<ReloadOutlined />} loading={loading} disabled={!!approvingId} onClick={load}>
            刷新
          </Button>
        </Space>
      </div>
      <div className={styles.description}>
        {review
          ? '查看发布申请与处理记录。可直接通过并发布，也可进入详情查看或调整待审配置。'
          : '跟踪我的申请进度与审核结果。被驳回后，可进入详情查看意见并修改后重新申请。'}
      </div>
      {loadError ? (
        <Alert
          type="error"
          showIcon
          message="发布申请加载失败"
          description={loadError}
          action={<Button onClick={load}>重新加载</Button>}
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
                '正在加载申请…'
              ) : (
                <Empty
                  className={styles.empty}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={review ? '暂无发布申请记录' : '你还没有发布申请，可从个人员工卡片发起发布'}
                />
              ),
            }}
            columns={[
              {
                title: '数字员工',
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
                      <span className={styles.employeeName}>{name || '未命名数字员工'}</span>
                    </Button>
                    <span className={styles.secondary}>创建者：{row.authorName || '—'}</span>
                  </div>
                ),
              },
              {
                title: '发布状态',
                dataIndex: 'status',
                width: 110,
                render: (status) => (
                  <Tag {...statusAppearance[status as keyof typeof statusAppearance]}>
                    {publicationStatus[status] || status}
                  </Tag>
                ),
              },
              {
                title: '审核信息',
                width: 185,
                render: (_, row) => (
                  <div className={styles.reviewInfo}>
                    {row.reviewerName || row.reviewedAt ? (
                      <>
                        <span>审核人：{row.reviewerName || '—'}</span>
                        <span className={styles.secondary}>审核于 {formatTime(row.reviewedAt)}</span>
                      </>
                    ) : (
                      <span className={styles.secondary}>
                        {row.requiresAdminVipReview && ['PENDING', 'FAILED'].includes(row.status)
                          ? '等待超管 adminvip 审核'
                          : reviewPlaceholder[row.status] || '暂无审核记录'}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                title: '审核意见 / 发布说明',
                render: (_, row) => (
                  <div className={styles.notes}>
                    {row.publishError && <PublicationNote text={row.publishError} error />}
                    {row.comment && <PublicationNote text={row.comment} />}
                    {!row.publishError && !row.comment && (
                      <span className={styles.secondary}>{statusDescription[row.status] || '—'}</span>
                    )}
                  </div>
                ),
              },
              { title: '最近更新', dataIndex: 'updatedAt', width: 165, render: (time) => formatTime(time) },
              {
                title: '操作',
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
                        {['FAILED', 'APPLYING'].includes(row.status) ? '重试发布' : '通过并发布'}
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

export default function PublicationAuditList() {
  const capabilities = useEmployeePublicationCapabilities();
  if (capabilities?.enabled !== true) return null;
  return <EnabledPublicationAuditList capabilities={capabilities} />;
}
