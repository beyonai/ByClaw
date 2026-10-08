import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Popconfirm, Segmented, Space, Spin, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useIntl } from '@umijs/max';
import { SearchOutlined } from '@ant-design/icons';
import {
  approveUseApply,
  queryResourceUseApplyAudit,
  rejectUseApply,
  type ResourceUseApplyAuditItem,
} from '@/pages/manager/service/resources';
import { getResourceAuditItems } from '@/utils/approvalCenter';
import useAuditSearch from '@/hooks/useAuditSearch';
import styles from './index.module.less';

type AuditFilter = 'pending' | 'history';
type AuditAction = 'approve' | 'reject';

interface ResourceAuditCenterProps {
  resourceBizTypeList: string[];
  refreshKey?: number;
  onPendingCountChange?: (count: number) => void;
  onAuditComplete?: () => void;
  toolbarExtra?: React.ReactNode;
}

type AuditRow = ResourceUseApplyAuditItem & {
  resourceId: string;
  resourceName: string;
  resourceBizType: string;
};

const formatAuditStatus = (status: unknown, history: boolean) => {
  const normalized = `${status ?? ''}`.trim().toUpperCase();
  if (['X', 'A', 'APPROVED', 'PASS', '审核通过', '通过'].includes(normalized)) {
    return 'approved';
  }
  if (['R', 'REJECTED', 'REJECT', '已驳回', '驳回'].includes(normalized)) {
    return 'rejected';
  }
  return history ? `${status || 'processed'}` : 'pending';
};

const getAuditStatusLabel = (status: string, formatMessage: (descriptor: { id: string }) => string) => {
  if (status === 'approved') return formatMessage({ id: 'resource.useApplyApproveSuccess' });
  if (status === 'rejected') return formatMessage({ id: 'resource.useApplyRejectSuccess' });
  if (status === 'pending') return formatMessage({ id: 'resourceCenter.pending' });
  return status;
};

const isProcessedAuditStatus = (status: unknown) => {
  const normalized = `${status ?? ''}`.trim().toUpperCase();
  return ['X', 'R', 'APPROVED', 'PASS', 'REJECTED', 'REJECT', '审核通过', '已驳回', '通过', '驳回'].includes(
    normalized
  );
};

const getAuditRows = (response: any, history: boolean, resourceBizTypeList: string[]): AuditRow[] => {
  return getResourceAuditItems(response, resourceBizTypeList)
    .filter((item: any) => !history || isProcessedAuditStatus(item?.applyStatus))
    .map((item: any) => ({
      ...item,
      resourceId: `${item.resourceId}`,
      resourceName: item.resourceName || '-',
      resourceBizType: `${item.resourceBizType || '-'}`.trim().toUpperCase(),
      userId: `${item.userId ?? ''}`,
      userName: item.userName || `${item.userId ?? '-'}`,
      applyStatus: formatAuditStatus(item.applyStatus, history),
    }))
    .sort((left: AuditRow, right: AuditRow) => {
      const leftTime = left.applyTime ? new Date(left.applyTime).getTime() : 0;
      const rightTime = right.applyTime ? new Date(right.applyTime).getTime() : 0;
      return rightTime - leftTime;
    });
};

const getAuditRowKey = (row: AuditRow) =>
  `${row.auditType || 'USE'}-${row.privilegeGrantId || ''}-${row.resourceId}-${row.userId}`;

const getResourceTypeMessageId = (resourceBizType: string) => {
  if (resourceBizType === 'SKILL') return 'common.skill';
  if (resourceBizType?.startsWith('KG_')) return 'resource.knowledge';
  if (resourceBizType === 'MCP') return 'resource.mcp';
  if (resourceBizType === 'TOOLKIT') return 'resource.toolkit';
  if (resourceBizType === 'AGENT') return 'resource.agent';
  if (resourceBizType === 'TOOL') return 'common.tool';
  return '';
};

const ResourceAuditCenter: React.FC<ResourceAuditCenterProps> = ({
  resourceBizTypeList,
  refreshKey = 0,
  onPendingCountChange,
  onAuditComplete,
  toolbarExtra,
}) => {
  const intl = useIntl();
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('pending');
  const [pendingRows, setPendingRows] = useState<AuditRow[]>([]);
  const [historyRows, setHistoryRows] = useState<AuditRow[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionKey, setActionKey] = useState('');
  const requestSequence = useRef({ pending: 0, history: 0 });
  const employeeMode = resourceBizTypeList.includes('DIG_EMPLOYEE');

  const bizTypeKey = resourceBizTypeList.join(',');
  const loadAuditRows = useCallback(
    async (history: boolean) => {
      const scope = history ? 'history' : 'pending';
      const sequence = ++requestSequence.current[scope];
      const setLoadingState = history ? setHistoryLoading : setLoading;
      setLoadingState(true);
      try {
        const response = await queryResourceUseApplyAudit({ history, resourceBizTypeList });
        if (sequence !== requestSequence.current[scope]) return;
        const rows = getAuditRows(response, history, resourceBizTypeList);
        if (history) {
          setHistoryRows(rows);
          setHistoryLoaded(true);
        } else {
          setPendingRows(rows);
        }
      } catch (error: any) {
        if (sequence === requestSequence.current[scope]) {
          message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
        }
      } finally {
        if (sequence === requestSequence.current[scope]) setLoadingState(false);
      }
    },
    [intl, resourceBizTypeList]
  );

  useEffect(() => {
    setPendingRows([]);
    setHistoryLoaded(false);
    setHistoryRows([]);
    void loadAuditRows(false);
    return () => {
      // 类型切换或卸载后，迟到的响应不能覆盖当前审批列表。
      requestSequence.current.pending += 1;
      requestSequence.current.history += 1;
    };
  }, [bizTypeKey, loadAuditRows, refreshKey]);

  useEffect(() => {
    if (auditFilter === 'history' && !historyLoaded) {
      void loadAuditRows(true);
    }
  }, [auditFilter, historyLoaded, loadAuditRows]);

  useEffect(() => {
    onPendingCountChange?.(pendingRows.length);
  }, [onPendingCountChange, pendingRows.length]);

  const {
    auditKeyword,
    setAuditKeyword,
    filteredRows: auditRows,
  } = useAuditSearch(auditFilter === 'pending' ? pendingRows : historyRows);
  const auditLoading = auditFilter === 'pending' ? loading : historyLoading;

  const handleAudit = useCallback(
    async (row: AuditRow, action: AuditAction) => {
      const key = `${action}-${getAuditRowKey(row)}`;
      setActionKey(key);
      try {
        const params = {
          resourceId: row.resourceId,
          applyUserId: row.userId,
          ...(row.auditType === 'SKILL_PUBLICATION' ? { auditType: row.auditType } : {}),
        };
        if (action === 'approve') {
          await approveUseApply(params);
          message.success(intl.formatMessage({ id: 'resourceCenter.approve' }));
        } else {
          await rejectUseApply(params);
          message.success(intl.formatMessage({ id: 'resourceCenter.reject' }));
        }
        const nextStatus = action === 'approve' ? 'approved' : 'rejected';
        setPendingRows((rows) => rows.filter((item) => getAuditRowKey(item) !== getAuditRowKey(row)));
        if (historyLoaded) {
          setHistoryRows((rows) => [
            { ...row, applyStatus: nextStatus, auditTime: new Date().toISOString() },
            ...rows.filter((item) => getAuditRowKey(item) !== getAuditRowKey(row)),
          ]);
        }
        onAuditComplete?.();
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
      } finally {
        setActionKey('');
      }
    },
    [historyLoaded, intl, onAuditComplete]
  );

  const auditColumns = useMemo<ColumnsType<AuditRow>>(() => {
    const columns: ColumnsType<AuditRow> = [
      {
        title: intl.formatMessage({ id: 'resourceCenter.resourceName' }),
        dataIndex: 'resourceName',
        key: 'resourceName',
        width: 260,
        render: (value: string) => (
          <span className={styles.resourceName} title={value}>
            {value}
          </span>
        ),
      },
      {
        title: intl.formatMessage({ id: 'resourceCenter.resourceType' }),
        key: 'resourceBizType',
        width: 140,
        render: (_, row) => {
          if (row.resourceBizType === 'DIG_EMPLOYEE') {
            return intl.formatMessage({
              id: `${row.agentType}` === '017' ? 'common.digitalEmployeeGroup' : 'common.digitalEmployee',
            });
          }
          const messageId = getResourceTypeMessageId(row.resourceBizType);
          return messageId ? intl.formatMessage({ id: messageId }) : row.resourceBizType;
        },
      },
      {
        title: intl.formatMessage({ id: 'resourceCenter.applicant' }),
        dataIndex: 'userName',
        key: 'userName',
        width: 160,
      },
      {
        title: intl.formatMessage({ id: 'resourceCenter.applicationTime' }),
        dataIndex: 'applyTime',
        key: 'applyTime',
        width: 190,
      },
    ];

    // 员工申请均为使用权限，发布审核已有独立视图；其他资源保留申请类型以区分技能上架审核。
    if (!employeeMode) {
      columns.splice(2, 0, {
        title: intl.formatMessage({ id: 'resource.auditApplicationType' }),
        key: 'auditType',
        width: 150,
        render: (_, row) =>
          intl.formatMessage({
            id: row.auditType === 'SKILL_PUBLICATION' ? 'resource.skillPublicationAudit' : 'resource.resourceUseAudit',
          }),
      });
    }

    if (auditFilter === 'history') {
      columns.push(
        {
          title: intl.formatMessage({ id: 'resourceCenter.auditResult' }),
          dataIndex: 'applyStatus',
          key: 'applyStatus',
          width: 120,
          render: (value: string) => (
            <Tag color={value === 'approved' ? 'success' : 'error'}>
              {getAuditStatusLabel(value, (descriptor) => intl.formatMessage(descriptor))}
            </Tag>
          ),
        },
        {
          title: intl.formatMessage({ id: 'resourceCenter.auditor' }),
          dataIndex: 'auditUserName',
          key: 'auditUserName',
          width: 150,
          render: (value: string) => value || '-',
        },
        {
          title: intl.formatMessage({ id: 'resourceCenter.processedTime' }),
          dataIndex: 'auditTime',
          key: 'auditTime',
          width: 190,
          render: (value: string) => value || '-',
        }
      );
    } else {
      columns.push(
        {
          title: intl.formatMessage({ id: 'resourceCenter.status' }),
          key: 'applyStatus',
          width: 120,
          render: () => (
            <Tag color="warning">{getAuditStatusLabel('pending', (descriptor) => intl.formatMessage(descriptor))}</Tag>
          ),
        },
        {
          title: intl.formatMessage({ id: 'resourceCenter.actions' }),
          key: 'actions',
          width: 170,
          render: (_, row) => (
            <Space size="small">
              <Popconfirm
                title={intl.formatMessage({ id: 'resourceCenter.confirmApprove' })}
                okText={intl.formatMessage({ id: 'common.confirm' })}
                cancelText={intl.formatMessage({ id: 'common.cancel' })}
                onConfirm={() => void handleAudit(row, 'approve')}
              >
                <Button type="link" size="small" loading={actionKey === `approve-${getAuditRowKey(row)}`}>
                  {intl.formatMessage({ id: 'resourceCenter.approve' })}
                </Button>
              </Popconfirm>
              <Popconfirm
                title={intl.formatMessage({ id: 'resourceCenter.confirmReject' })}
                okText={intl.formatMessage({ id: 'common.confirm' })}
                cancelText={intl.formatMessage({ id: 'common.cancel' })}
                onConfirm={() => void handleAudit(row, 'reject')}
              >
                <Button danger type="link" size="small" loading={actionKey === `reject-${getAuditRowKey(row)}`}>
                  {intl.formatMessage({ id: 'resourceCenter.reject' })}
                </Button>
              </Popconfirm>
            </Space>
          ),
        }
      );
    }
    return columns;
  }, [actionKey, auditFilter, employeeMode, handleAudit, intl]);

  return (
    <div className={styles.panel}>
      <div className={styles.filter}>
        {employeeMode && (
          <Input
            className={styles.search}
            suffix={<SearchOutlined />}
            allowClear
            placeholder={intl.formatMessage({ id: 'myEmployees.searchPlaceholder' })}
            value={auditKeyword}
            onChange={(event) => setAuditKeyword(event.target.value)}
          />
        )}
        {/* 员工审批类型切换跟随搜索框，复用同一行筛选工具栏。 */}
        {toolbarExtra}
        <Segmented
          value={auditFilter}
          options={[
            { value: 'pending', label: intl.formatMessage({ id: 'resourceCenter.unreviewed' }) },
            { value: 'history', label: intl.formatMessage({ id: 'resourceCenter.reviewHistory' }) },
          ]}
          onChange={(value) => setAuditFilter(value as AuditFilter)}
        />
      </div>
      <Spin spinning={auditLoading} wrapperClassName={styles.tableSpin}>
        <div className={styles.tableWrap}>
          <Table<AuditRow>
            rowKey={getAuditRowKey}
            dataSource={auditRows}
            pagination={false}
            sticky
            tableLayout="fixed"
            scroll={{ x: 1100 }}
            columns={auditColumns}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
          />
        </div>
      </Spin>
    </div>
  );
};

export default ResourceAuditCenter;
