import useEmployeeRowRefresh, {
  employeeRowId,
  removeEmployeeRow,
  updateEmployeeRow,
} from '@/hooks/useEmployeeRowRefresh';
import { LeftOutlined, SearchOutlined } from '@ant-design/icons';
import { getIntl, useLocation, useNavigate, useIntl } from '@umijs/max';
import { Badge, Button, Empty, Input, Popconfirm, Segmented, Space, Spin, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import InfiniteScroll from '@/components/InfiniteScroll';
import ResourceCard from '@/components/Resources/components/ResourceCard';
import { getAgentChatAvatar, agentHandler } from '@/utils/agent';
import type { IAgentCache } from '@/typescript/agent';
import {
  deleteDigitalEmployee,
  queryManagedEnterpriseEmployees,
  queryMyCreated,
  shelfDigitalEmployee,
  unShelfDigitalEmployee,
} from '@/service/digitalEmployees';
import {
  approveUseApply,
  applyResourceUse,
  queryDigitalEmployeeUseApplyAudit,
  rejectUseApply,
  type ResourceUseApplyAuditItem,
} from '@/pages/manager/service/resources';
import styles from './index.module.less';
import { EmployeePreviewModal } from '@/pages/digitalEmployees';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import useAuditSearch from './useAuditSearch';

type OwnerTab = 'personal' | 'enterprise' | 'audit';
type ResourceFilter = 'all' | 'employee' | 'group';
type EnterpriseScope = 'all' | 'created' | 'managed';
type EmployeeStatusFilter = 'all' | '0' | '1' | '2' | '3' | '-1';
type AuditFilter = 'pending' | 'history';

type AuditRow = ResourceUseApplyAuditItem & {
  resourceId: string;
  resourceName: string;
  employeeType: string;
  avatar?: string;
  chatAvatar?: string;
};

const formatAuditStatus = (status: unknown, history: boolean) => {
  const normalized = `${status ?? ''}`.trim().toUpperCase();
  if (normalized === 'X' || normalized === 'A' || normalized === 'APPROVED' || normalized === 'PASS') {
    return '审核通过';
  }
  if (normalized === 'R' || normalized === 'REJECTED' || normalized === 'REJECT') {
    return '已驳回';
  }
  if (history) {
    return `${status || '已处理'}`;
  }
  return '待审核';
};

const isProcessedAuditStatus = (status: unknown) => {
  const normalized = `${status ?? ''}`.trim().toUpperCase();
  return ['X', 'R', 'APPROVED', 'PASS', 'REJECTED', 'REJECT', '审核通过', '已驳回', '通过', '驳回'].includes(
    normalized
  );
};

const PAGE_SIZE = 20;

const normalizeList = (value: any) =>
  (value?.list || value?.data?.list || [])
    .filter((item: any) => `${item?.resourceStatus ?? item?.metaStatus ?? ''}` !== '-1')
    .map((item: any) => agentHandler(item));

const normalizeAuditRows = (response: any, history: boolean): AuditRow[] => {
  const auditItems = response?.data || response || [];
  return (Array.isArray(auditItems) ? auditItems : auditItems.list || [])
    .map((item: any) => ({
      ...item,
      resourceName: item.resourceName,
      employeeType: `${item.agentType}` === '017' ? '数字员工组' : '数字员工',
      avatar: item.avatar,
      chatAvatar: item.avatar,
    }))
    .filter((row: AuditRow) => !history || isProcessedAuditStatus(row.applyStatus))
    .map((row: AuditRow) => ({
      ...row,
      applyStatus: formatAuditStatus(row.applyStatus, history),
    }))
    .sort((left: AuditRow, right: AuditRow) => {
      const leftTime = left.applyTime ? new Date(left.applyTime).getTime() : 0;
      const rightTime = right.applyTime ? new Date(right.applyTime).getTime() : 0;
      return rightTime - leftTime;
    });
};

const getAuditRowKey = (row: AuditRow) => `${row.privilegeGrantId || ''}-${row.resourceId || ''}-${row.userId || ''}`;

const MyEmployeesPage: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<OwnerTab>('personal');
  const location = useLocation();
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmployeeStatusFilter>('all');
  const [enterpriseScope, setEnterpriseScope] = useState<EnterpriseScope>('all');
  const [loading, setLoading] = useState(false);
  const [historyAuditLoading, setHistoryAuditLoading] = useState(false);
  const [list, setList] = useState<IAgentCache[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const shouldKeepEmployee = useCallback(
    (employee: IAgentCache) => {
      const selectedStatus = `${statusFilter}`;
      if (selectedStatus === 'all') return `${employee?.resourceStatus ?? employee?.metaStatus ?? ''}` !== '-1';
      return `${employee?.resourceStatus ?? employee?.metaStatus ?? ''}` === selectedStatus;
    },
    [statusFilter]
  );
  const refreshEmployee = useEmployeeRowRefresh(
    list,
    setList,
    () => {
      setTotal((current) => Math.max(0, current - 1));
    },
    shouldKeepEmployee
  );
  const [pendingAuditRows, setPendingAuditRows] = useState<AuditRow[]>(() => {
    // 待审核数据由数字员工首页通过路由状态传入，避免进入“我的员工”后再次请求。
    const routeState = location.state as { pendingAuditRows?: ResourceUseApplyAuditItem[] } | null;
    return normalizeAuditRows(routeState?.pendingAuditRows || [], false);
  });
  const [historyAuditRows, setHistoryAuditRows] = useState<AuditRow[]>([]);
  const [historyAuditLoaded, setHistoryAuditLoaded] = useState(false);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('pending');
  const [actionKey, setActionKey] = useState('');
  const [preview, setPreview] = useState<IAgentCache | null>(null);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [authRecord, setAuthRecord] = useState<IAgentCache | null>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const historyAuditRequestedRef = useRef(false);
  const employeeRequestRef = useRef(0);
  const employeeLoadingRef = useRef(false);

  const agentType = resourceFilter === 'group' ? '017' : undefined;

  const loadEmployees = useCallback(
    async (requestedPage = 1) => {
      if (activeTab === 'audit' || (requestedPage > 1 && employeeLoadingRef.current)) return;
      const requestId = ++employeeRequestRef.current;
      employeeLoadingRef.current = true;
      setLoading(true);
      if (requestedPage === 1) {
        setList([]);
        setTotal(0);
        setPageNum(1);
      }
      try {
        const request = activeTab === 'personal' ? queryMyCreated : queryManagedEnterpriseEmployees;
        // 企业“全部”仅合并本人创建和授权管理的数据，不因管理员角色扩大为全库列表。
        const type =
          activeTab !== 'enterprise'
            ? 'owner'
            : enterpriseScope === 'all'
            ? 'ownerOrManager'
            : enterpriseScope === 'created'
            ? 'owner'
            : 'managerExcludingOwner';
        const res = await request({
          pageNum: requestedPage,
          pageSize: PAGE_SIZE,
          type,
          agentType,
          includeEmployeeGroup: resourceFilter === 'all',
          keyword: debouncedKeyword.trim() || undefined,
          ...(statusFilter === 'all' ? { includeAllResourceStatus: true } : { resourceStatus: Number(statusFilter) }),
        });
        if (requestId !== employeeRequestRef.current) return;
        const nextList = normalizeList(res);
        setList((current) => (requestedPage === 1 ? nextList : [...current, ...nextList]));
        setPageNum(requestedPage);
        setTotal(Number(res?.total ?? res?.data?.total ?? 0));
      } catch (error: any) {
        if (requestId === employeeRequestRef.current) {
          message.error(error?.message || intl.formatMessage({ id: 'common.operateFailed' }));
        }
      } finally {
        if (requestId === employeeRequestRef.current) {
          employeeLoadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [activeTab, agentType, debouncedKeyword, enterpriseScope, intl, resourceFilter, statusFilter]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(keyword);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    void loadEmployees();
    return () => {
      employeeRequestRef.current += 1;
      employeeLoadingRef.current = false;
    };
  }, [loadEmployees]);

  const loadHistoryAudit = useCallback(async () => {
    // 历史审核仅在首次切换到对应页签时请求，后续切换复用本地缓存。
    if (historyAuditRequestedRef.current) return;
    historyAuditRequestedRef.current = true;
    setHistoryAuditLoading(true);
    try {
      const response: any = await queryDigitalEmployeeUseApplyAudit({ history: true });
      setHistoryAuditRows(normalizeAuditRows(response, true));
      setHistoryAuditLoaded(true);
    } catch {
      // 加载失败后允许用户重新切换页签再次请求。
      historyAuditRequestedRef.current = false;
    } finally {
      setHistoryAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auditFilter === 'history' && !historyAuditLoaded) {
      loadHistoryAudit();
    }
  }, [auditFilter, historyAuditLoaded, loadHistoryAudit]);

  const {
    auditKeyword,
    setAuditKeyword,
    filteredRows: auditRows,
  } = useAuditSearch(auditFilter === 'pending' ? pendingAuditRows : historyAuditRows);
  const auditPendingCount = pendingAuditRows.length;
  const auditLoading = auditFilter === 'history' && historyAuditLoading;

  const handleAudit = async (row: AuditRow, action: 'approve' | 'reject') => {
    const key = `${action}-${row.resourceId}-${row.userId}`;
    setActionKey(key);
    try {
      const params = { resourceId: row.resourceId, applyUserId: row.userId };
      if (action === 'approve') {
        await approveUseApply(params);
        message.success('审核通过');
      } else {
        await rejectUseApply(params);
        message.success('已驳回');
      }
      // 审核成功后直接从待审核缓存剔除当前记录，无需重新请求整个审核列表。
      setPendingAuditRows((rows) => rows.filter((item) => getAuditRowKey(item) !== getAuditRowKey(row)));
      if (historyAuditLoaded) {
        const historyRow = {
          ...row,
          applyStatus: action === 'approve' ? '审核通过' : '已驳回',
          // 本地同步历史列表时记录处理时间，避免审核后重新查询整个列表。
          auditTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
        };
        setHistoryAuditRows((rows) => [
          historyRow,
          ...rows.filter((item) => getAuditRowKey(item) !== getAuditRowKey(historyRow)),
        ]);
      }
    } finally {
      setActionKey('');
    }
  };

  const handleChat = useCallback(
    (employee: IAgentCache, question?: string) => {
      const targetId = employee.agentId || employee.id || employee.resourceId;
      if (!targetId) return;
      const normalizedEmployee = agentHandler(employee);
      navigate('/employees', {
        state: {
          keepSiderActiveKey: 'agent',
          selectedAgentId: `${targetId}`,
          selectedEmployee: normalizedEmployee,
          initialQuestion: question,
        },
      });
    },
    [navigate]
  );

  const handleApplyUse = useCallback(
    async (employee: IAgentCache) => {
      const resourceId = `${employee.resourceId ?? employee.id ?? employee.agentId ?? ''}`;
      if (!resourceId) return;
      try {
        await applyResourceUse({ resourceId });
        message.success('申请已提交，等待授权通过');
        await refreshEmployee(employee);
      } catch (error: any) {
        message.error(error?.message || '使用申请失败');
      }
    },
    [refreshEmployee]
  );

  const handleEdit = useCallback(
    (employee: IAgentCache) => {
      const resourceId = employee.resourceId ?? employee.id ?? employee.agentId;
      if (!resourceId) return;
      sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
      navigate(
        `/digitalEmployeesCreate?${new URLSearchParams({
          digitalType: employee.createType || 'FROM_MANUALLY',
          appId: `${resourceId}`,
          tab: activeTab,
        }).toString()}`
      );
    },
    [activeTab, navigate]
  );

  const handleAuth = useCallback((employee: IAgentCache, type: 'useAuth' | 'mgrAuth') => {
    setAuthRecord(employee);
    setAuthType(type);
    setAuthDrawerOpen(true);
  }, []);

  const handleDelete = useCallback(async (employee: IAgentCache) => {
    const resourceId = employee.resourceId ?? employee.id;
    if (!resourceId) return;
    try {
      await deleteDigitalEmployee({ resourceId: String(resourceId) });
      message.success(getIntl().formatMessage({ id: 'ui.employee.deleteSuccess' }));
      removeEmployeeRow(employeeRowId(employee));
    } catch (error: any) {
      message.error(error?.message || getIntl().formatMessage({ id: 'ui.employee.deleteFailed' }));
    }
  }, []);

  const handleShelfStatusChange = useCallback(
    async (employee: IAgentCache, action: 'shelf' | 'unShelf') => {
      const resourceId = employee.resourceId ?? employee.id ?? employee.agentId;
      if (!resourceId) return;
      try {
        const request = action === 'shelf' ? shelfDigitalEmployee : unShelfDigitalEmployee;
        const response: any = await request({ resourceId: String(resourceId) });
        if (response?.success === false || (response?.code !== undefined && response.code !== 0)) {
          throw new Error(
            response?.msg ||
              getIntl().formatMessage(
                { id: 'ui.employee.actionFailed' },
                {
                  v0: getIntl().formatMessage({
                    id: action === 'shelf' ? 'ui.employee.publish' : 'ui.employee.unpublish',
                  }),
                }
              )
          );
        }
        message.success(
          getIntl().formatMessage(
            { id: 'ui.employee.actionSuccess' },
            {
              v0: getIntl().formatMessage({ id: action === 'shelf' ? 'ui.employee.publish' : 'ui.employee.unpublish' }),
            }
          )
        );
        // 仅更新操作员工的状态与权限，保留分页和滚动位置。
        const refreshPromise = refreshEmployee(employee);
        updateEmployeeRow({
          resourceId: String(resourceId),
          resourceStatus: action === 'shelf' ? 2 : 3,
        });
        await refreshPromise;
      } catch (error: any) {
        message.error(
          error?.message ||
            getIntl().formatMessage(
              { id: 'ui.employee.actionFailed' },
              {
                v0: getIntl().formatMessage({
                  id: action === 'shelf' ? 'ui.employee.publish' : 'ui.employee.unpublish',
                }),
              }
            )
        );
      }
    },
    [refreshEmployee]
  );

  const auditColumns: ColumnsType<AuditRow> = [
    {
      title: intl.formatMessage({ id: 'myEmployees.employeeName' }),
      dataIndex: 'resourceName',
      // 名称列承接其余列之外的可用宽度，长名称保持单行并可悬停查看全文。
      render: (value, row) => (
        <div className={styles.auditEmployeeName}>
          <div className={styles.auditEmployeeAvatar}>{getAgentChatAvatar(row.chatAvatar || row.avatar)}</div>
          <span className={styles.auditEmployeeNameText} title={value}>
            {value}
          </span>
        </div>
      ),
    },
    // 辅助信息使用紧凑列宽，把更多空间留给数字员工名称。
    {
      title: intl.formatMessage({ id: 'myEmployees.type' }),
      dataIndex: 'employeeType',
      width: 110,
      // 保留数据中的员工类型，渲染时再翻译以支持切换语言。
      render: (value) =>
        intl.formatMessage({ id: value === '数字员工组' ? 'common.digitalEmployeeGroup' : 'common.digitalEmployee' }),
    },
    { title: intl.formatMessage({ id: 'myEmployees.applicant' }), dataIndex: 'userName', width: 120, ellipsis: true },
    {
      title: intl.formatMessage({ id: 'myEmployees.applicationTime' }),
      dataIndex: 'applyTime',
      width: 170,
      render: (value) => (value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : value || '-'),
    },
  ];

  if (auditFilter === 'history') {
    // 历史记录按审核结果、审核人、处理时间排列，便于先看结论再追溯处理信息。
    auditColumns.push({
      title: intl.formatMessage({ id: 'myEmployees.auditResult' }),
      dataIndex: 'applyStatus',
      width: 120,
      render: (value) => {
        const status = `${value || ''}`;
        const result = status === '审核通过' ? '通过' : status === '已驳回' ? '驳回' : status;
        const color = result === '通过' ? 'success' : result === '驳回' ? 'error' : 'default';
        // 状态比较沿用接口原值，仅翻译展示标签。
        const label =
          result === '通过'
            ? intl.formatMessage({ id: 'ui.employee.approved' })
            : result === '驳回'
            ? intl.formatMessage({ id: 'ui.employee.rejected' })
            : result;
        return <Tag color={color}>{label || '-'}</Tag>;
      },
    });
    // 审核人只对历史记录展示，待审核记录尚未产生处理人。
    auditColumns.push({
      title: intl.formatMessage({ id: 'myEmployees.auditor' }),
      dataIndex: 'auditUserName',
      width: 120,
      ellipsis: true,
      render: (value) => value || '-',
    });
    auditColumns.push({
      title: intl.formatMessage({ id: 'myEmployees.processedTime' }),
      dataIndex: 'auditTime',
      width: 170,
      render: (value) => (value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : value || '-'),
    });
  }

  if (auditFilter === 'pending') {
    auditColumns.push({
      title: intl.formatMessage({ id: 'myEmployees.status' }),
      dataIndex: 'applyStatus',
      width: 100,
      render: (value) => (
        <Tag color={value === '已驳回' ? 'error' : value === '审核通过' ? 'success' : 'processing'}>{value}</Tag>
      ),
    });
    auditColumns.push({
      title: intl.formatMessage({ id: 'myEmployees.actions' }),
      width: 150,
      render: (_: unknown, row: AuditRow) => (
        <Space>
          <Popconfirm
            title={intl.formatMessage({ id: 'myEmployees.confirmApprove' })}
            okText={intl.formatMessage({ id: 'common.confirm' })}
            cancelText={intl.formatMessage({ id: 'common.cancel' })}
            onConfirm={() => handleAudit(row, 'approve')}
          >
            <Button type="link" size="small" loading={actionKey === `approve-${row.resourceId}-${row.userId}`}>
              {intl.formatMessage({ id: 'myEmployees.approve' })}
            </Button>
          </Popconfirm>
          <Popconfirm
            title={intl.formatMessage({ id: 'myEmployees.confirmReject' })}
            okText={intl.formatMessage({ id: 'common.confirm' })}
            cancelText={intl.formatMessage({ id: 'common.cancel' })}
            onConfirm={() => handleAudit(row, 'reject')}
          >
            <Button danger type="link" size="small" loading={actionKey === `reject-${row.resourceId}-${row.userId}`}>
              {intl.formatMessage({ id: 'myEmployees.reject' })}
            </Button>
          </Popconfirm>
        </Space>
      ),
    });
  }

  const tabItems = useMemo(
    () => [
      { key: 'personal', label: intl.formatMessage({ id: 'myEmployees.personal' }) },
      { key: 'enterprise', label: intl.formatMessage({ id: 'myEmployees.enterprise' }) },
      {
        key: 'audit',
        label: (
          <Badge count={auditPendingCount} size="small" offset={[2, -2]}>
            <span className={styles.auditTabLabel}>{intl.formatMessage({ id: 'myEmployees.auditCenter' })}</span>
          </Badge>
        ),
      },
    ],
    [auditPendingCount, intl]
  );

  return (
    <div
      id="myEmployeesScroller"
      className={`${styles.container} ${activeTab === 'audit' ? styles.auditContainer : ''}`}
    >
      <div className={styles.back} onClick={() => navigate('/digitalEmployees')}>
        <LeftOutlined /> {intl.formatMessage({ id: 'myEmployees.backToAll' })}
      </div>
      <Tabs
        className={styles.header}
        activeKey={activeTab}
        items={tabItems}
        onChange={(key) => {
          setActiveTab(key as OwnerTab);
          setResourceFilter('all');
          setKeyword('');
          setStatusFilter('all');
          setEnterpriseScope('all');
        }}
      />
      {activeTab !== 'audit' ? (
        <>
          <div className={styles.toolbar}>
            <Input
              className={styles.employeeSearch}
              suffix={<SearchOutlined onClick={() => void loadEmployees()} />}
              allowClear
              placeholder={intl.formatMessage({ id: 'myEmployees.searchPlaceholder' })}
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
              }}
              onPressEnter={() => void loadEmployees()}
            />
            <div className={styles.rightFilters}>
              <Segmented
                value={resourceFilter}
                options={[
                  { value: 'all', label: intl.formatMessage({ id: 'myEmployees.all' }) },
                  { value: 'employee', label: intl.formatMessage({ id: 'myEmployees.employee' }) },
                  { value: 'group', label: intl.formatMessage({ id: 'myEmployees.group' }) },
                ]}
                onChange={(value) => {
                  setResourceFilter(value as ResourceFilter);
                }}
              />
              {activeTab === 'enterprise' && (
                <div className={styles.enterpriseFilters}>
                  <Segmented
                    value={enterpriseScope}
                    options={[
                      { value: 'all', label: intl.formatMessage({ id: 'myEmployees.all' }) },
                      { value: 'created', label: intl.formatMessage({ id: 'myEmployees.createdByMe' }) },
                      { value: 'managed', label: intl.formatMessage({ id: 'myEmployees.managedByMe' }) },
                    ]}
                    onChange={(value) => {
                      setEnterpriseScope(value as EnterpriseScope);
                    }}
                  />
                  <Segmented
                    value={statusFilter}
                    options={[
                      { value: 'all', label: intl.formatMessage({ id: 'myEmployees.all' }) },
                      { value: '0', label: intl.formatMessage({ id: 'resourceStatus.draft' }) },
                      { value: '2', label: intl.formatMessage({ id: 'resourceStatus.published' }) },
                      { value: '3', label: intl.formatMessage({ id: 'resourceStatus.unpublished' }) },
                    ]}
                    onChange={(value) => {
                      setStatusFilter(value as EmployeeStatusFilter);
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <Spin spinning={loading}>
            <InfiniteScroll
              autoFill
              isLoading={loading}
              next={() => loadEmployees(pageNum + 1)}
              hasMore={list.length < total}
              dataLength={list.length}
              scrollableTarget="myEmployeesScroller"
              appendItemsAutoScrollBottom={false}
              scrollThreshold="50px"
              style={{ overflow: 'visible' }}
              loader={<Spin />}
            >
              {list.length ? (
                <div className={styles.grid}>
                  {list.map((employee) => (
                    <ResourceCard
                      key={employee.resourceId || employee.id || employee.agentId}
                      resource={employee}
                      resourceType="DIG_EMPLOYEE"
                      avatarNode={<div className={styles.avatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>}
                      onCardClick={(resource) => setPreview((resource || employee) as IAgentCache)}
                      digitalEmployeeActionMode
                      actionConfig={{
                        scene: activeTab,
                        // 个人页签统一隐藏使用授权入口，企业页签仍按后端权限展示。
                        hiddenMenuItemKeys: activeTab === 'personal' ? ['use'] : [],
                        onChat: () => handleChat(employee),
                        onApplyUse: () => handleApplyUse(employee),
                        onEdit: () => handleEdit(employee),
                        onAuth: (type) => handleAuth(employee, type),
                        onDelete: () => handleDelete(employee),
                        // 删除数据使用独立回调，复用删除接口及成功后的列表移除逻辑。
                        onDeleteData: () => handleDelete(employee),
                        onShelf: () => handleShelfStatusChange(employee, 'shelf'),
                        onUnShelf: () => handleShelfStatusChange(employee, 'unShelf'),
                        // 我的员工卡片统一按资源状态展示标签，并保留创建人/管理人的操作权限。
                        showDigitalEmployeeTypeTag: false,
                        // 个人页签不提供上下架操作，企业页签继续按权限展示。
                        enableDigitalEmployeeLifecycle: activeTab === 'enterprise',
                        // 个人、企业页签统一按后端 canDelete 展示删除数据入口。
                        enableDigitalEmployeeDelete: true,
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
              )}
            </InfiniteScroll>
          </Spin>
        </>
      ) : (
        <div className={styles.auditPanel}>
          <div className={styles.auditToolbar}>
            <Input
              className={styles.auditSearch}
              suffix={<SearchOutlined />}
              allowClear
              aria-label={intl.formatMessage({ id: 'myEmployees.searchPlaceholder' })}
              placeholder={intl.formatMessage({ id: 'myEmployees.searchPlaceholder' })}
              value={auditKeyword}
              onChange={(event) => setAuditKeyword(event.target.value)}
            />
            <Segmented
              value={auditFilter}
              options={[
                { value: 'pending', label: intl.formatMessage({ id: 'myEmployees.unreviewed' }) },
                { value: 'history', label: intl.formatMessage({ id: 'myEmployees.reviewHistory' }) },
              ]}
              onChange={(value) => setAuditFilter(value as AuditFilter)}
            />
          </div>
          <Spin spinning={auditLoading} wrapperClassName={styles.auditTableSpin}>
            <div className={styles.auditTableWrap}>
              {/* 固定辅助列宽，窄屏横向滚动，避免名称列被挤压换行。 */}
              <Table<AuditRow>
                rowKey={(row) => `${row.resourceId}-${row.privilegeGrantId}`}
                dataSource={auditRows}
                pagination={false}
                sticky
                tableLayout="fixed"
                scroll={{ x: 1120 }}
                columns={auditColumns}
                locale={{
                  emptyText: (
                    <div className={styles.emptyState}>
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    </div>
                  ),
                }}
              />
            </div>
          </Spin>
        </div>
      )}
      <EmployeePreviewModal
        employee={preview}
        onClose={() => setPreview(null)}
        onCreateTask={(question?: string) => {
          if (!preview) return;
          const employee = preview;
          setPreview(null);
          handleChat(employee, question);
        }}
      />
      {authDrawerOpen && authRecord && (
        <AuthListDrawer
          authType={authType}
          record={authRecord}
          authApiPath={`/byaiService/auth/privilegeGrant/${
            authType === 'useAuth' ? 'setResourceUsers' : 'setResourceManagers'
          }`}
          onCancel={() => {
            setAuthDrawerOpen(false);
            setAuthRecord(null);
          }}
          onSuccess={() => {
            setAuthDrawerOpen(false);
            setAuthRecord(null);
            void refreshEmployee(authRecord).catch(console.error);
          }}
          headerInfo={{
            title: authRecord.resourceName || authRecord.name,
            content: authRecord.resourceDesc,
            icon: <div className={styles.avatar}>{getAgentChatAvatar(authRecord.chatAvatar)}</div>,
          }}
        />
      )}
    </div>
  );
};

export default MyEmployeesPage;
