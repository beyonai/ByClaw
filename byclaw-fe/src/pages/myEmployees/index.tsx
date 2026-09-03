import { LeftOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from '@umijs/max';
import { Badge, Button, Empty, Pagination, Popconfirm, Segmented, Space, Spin, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import ResourceCard from '@/components/Resources/components/ResourceCard';
import { getAgentChatAvatar, agentHandler } from '@/utils/agent';
import type { IAgentCache } from '@/typescript/agent';
import { deleteDigitalEmployee, queryManagedEnterpriseEmployees, queryMyCreated } from '@/service/digitalEmployees';
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

type OwnerTab = 'personal' | 'enterprise' | 'audit';
type ResourceFilter = 'all' | 'employee' | 'group';
type EnterpriseScope = 'created' | 'managed';
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

const normalizeList = (value: any) => (value?.list || value?.data?.list || []).map((item: any) => agentHandler(item));

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
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<OwnerTab>('personal');
  const location = useLocation();
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [enterpriseScope, setEnterpriseScope] = useState<EnterpriseScope>('created');
  const [loading, setLoading] = useState(false);
  const [historyAuditLoading, setHistoryAuditLoading] = useState(false);
  const [list, setList] = useState<IAgentCache[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
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

  const agentType = resourceFilter === 'group' ? '017' : undefined;

  const loadEmployees = useCallback(async () => {
    if (activeTab === 'audit') return;
    setLoading(true);
    try {
      const request = activeTab === 'personal' ? queryMyCreated : queryManagedEnterpriseEmployees;
      const type =
        activeTab === 'enterprise' ? (enterpriseScope === 'created' ? 'owner' : 'managerExcludingOwner') : 'manageable';
      const commonParams = { pageNum, pageSize: PAGE_SIZE, type, agentType, resourceStatus: 2 };
      if (resourceFilter === 'all') {
        const [employees, groups] = await Promise.all([
          request({ ...commonParams, pageNum: 1, pageSize: 200, agentType: undefined }),
          request({ ...commonParams, pageNum: 1, pageSize: 200, agentType: '017' }),
        ]);
        const employeeList = normalizeList(employees);
        const groupList = normalizeList(groups);
        setList([...employeeList, ...groupList]);
        setTotal(employeeList.length + groupList.length);
      } else {
        const res = await request(commonParams);
        const nextList = normalizeList(res);
        setList(nextList);
        setTotal(Number(res?.total || nextList.length));
      }
    } finally {
      setLoading(false);
    }
  }, [activeTab, agentType, enterpriseScope, pageNum, resourceFilter]);

  useEffect(() => {
    loadEmployees();
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

  const auditRows = auditFilter === 'pending' ? pendingAuditRows : historyAuditRows;
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
        await loadEmployees();
      } catch (error: any) {
        message.error(error?.message || '使用申请失败');
      }
    },
    [loadEmployees]
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

  const handleDelete = useCallback(
    async (employee: IAgentCache) => {
      const resourceId = employee.resourceId ?? employee.id;
      if (!resourceId) return;
      try {
        await deleteDigitalEmployee({ resourceId: String(resourceId) });
        message.success('注销成功');
        await loadEmployees();
      } catch (error: any) {
        message.error(error?.message || '注销失败');
      }
    },
    [loadEmployees]
  );

  const auditColumns: ColumnsType<AuditRow> = [
    {
      title: '数字员工名称',
      dataIndex: 'resourceName',
      render: (value, row) => (
        <div className={styles.auditEmployeeName}>
          <div className={styles.auditEmployeeAvatar}>{getAgentChatAvatar(row.chatAvatar || row.avatar)}</div>
          <span>{value}</span>
        </div>
      ),
    },
    { title: '类型', dataIndex: 'employeeType' },
    { title: '申请用户', dataIndex: 'userName' },
    {
      title: '申请时间',
      dataIndex: 'applyTime',
      render: (value) => (value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : value || '-'),
    },
  ];

  if (auditFilter === 'history') {
    auditColumns.push({
      title: '处理时间',
      dataIndex: 'auditTime',
      render: (value) => (value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : value || '-'),
    });
  }

  if (auditFilter === 'pending') {
    auditColumns.push({
      title: '状态',
      dataIndex: 'applyStatus',
      render: (value) => (
        <Tag color={value === '已驳回' ? 'error' : value === '审核通过' ? 'success' : 'processing'}>{value}</Tag>
      ),
    });
    auditColumns.push({
      title: '操作',
      render: (_: unknown, row: AuditRow) => (
        <Space>
          <Popconfirm
            title="确认通过该使用申请吗？"
            okText="确认"
            cancelText="取消"
            onConfirm={() => handleAudit(row, 'approve')}
          >
            <Button type="link" size="small" loading={actionKey === `approve-${row.resourceId}-${row.userId}`}>
              通过
            </Button>
          </Popconfirm>
          <Popconfirm
            title="确认驳回该使用申请吗？"
            okText="确认"
            cancelText="取消"
            onConfirm={() => handleAudit(row, 'reject')}
          >
            <Button danger type="link" size="small" loading={actionKey === `reject-${row.resourceId}-${row.userId}`}>
              驳回
            </Button>
          </Popconfirm>
        </Space>
      ),
    });
  }

  const tabItems = useMemo(
    () => [
      { key: 'personal', label: '个人' },
      { key: 'enterprise', label: '企业' },
      {
        key: 'audit',
        label: (
          <Badge count={auditPendingCount} size="small" offset={[2, -2]}>
            <span className={styles.auditTabLabel}>审核中心</span>
          </Badge>
        ),
      },
    ],
    [auditPendingCount]
  );

  return (
    <div className={`${styles.container} ${activeTab === 'audit' ? styles.auditContainer : ''}`}>
      <div className={styles.back} onClick={() => navigate('/digitalEmployees')}>
        <LeftOutlined /> 返回全部
      </div>
      <Tabs
        className={styles.header}
        activeKey={activeTab}
        items={tabItems}
        onChange={(key) => {
          setActiveTab(key as OwnerTab);
          setResourceFilter('all');
          setEnterpriseScope('created');
          setPageNum(1);
        }}
      />
      {activeTab !== 'audit' ? (
        <>
          <div className={styles.toolbar}>
            <Segmented
              value={resourceFilter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'employee', label: '数字员工' },
                { value: 'group', label: '数字员工组' },
              ]}
              onChange={(value) => {
                setResourceFilter(value as ResourceFilter);
                setPageNum(1);
              }}
            />
            {activeTab === 'enterprise' && (
              <Segmented
                value={enterpriseScope}
                options={[
                  { value: 'created', label: '我创建的' },
                  { value: 'managed', label: '我授权的' },
                ]}
                onChange={(value) => {
                  setEnterpriseScope(value as EnterpriseScope);
                  setPageNum(1);
                }}
              />
            )}
          </div>
          <Spin spinning={loading}>
            {list.length ? (
              <div className={styles.grid}>
                {list.map((employee) => (
                  <ResourceCard
                    key={`${employee.resourceId || employee.id || employee.agentId}`}
                    resource={employee}
                    resourceType="DIG_EMPLOYEE"
                    avatarNode={<div className={styles.avatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>}
                    onCardClick={(resource) => setPreview((resource || employee) as IAgentCache)}
                    digitalEmployeeActionMode
                    actionConfig={{
                      scene: activeTab,
                      onChat: () => handleChat(employee),
                      onApplyUse: () => handleApplyUse(employee),
                      onEdit: () => handleEdit(employee),
                      onAuth: (type) => handleAuth(employee, type),
                      onDelete: () => handleDelete(employee),
                    }}
                  />
                ))}
              </div>
            ) : (
              <Empty className={styles.empty} />
            )}
            {resourceFilter !== 'all' && total > PAGE_SIZE && (
              <Pagination
                current={pageNum}
                pageSize={PAGE_SIZE}
                total={total}
                showSizeChanger={false}
                onChange={setPageNum}
              />
            )}
          </Spin>
        </>
      ) : (
        <div className={styles.auditPanel}>
          <div className={styles.auditFilter}>
            <Segmented
              value={auditFilter}
              options={[
                { value: 'pending', label: '未审核' },
                { value: 'history', label: '历史审核' },
              ]}
              onChange={(value) => setAuditFilter(value as AuditFilter)}
            />
          </div>
          <Spin spinning={auditLoading} wrapperClassName={styles.auditTableSpin}>
            <div className={styles.auditTableWrap}>
              <Table<AuditRow>
                rowKey={(row) => `${row.resourceId}-${row.privilegeGrantId}`}
                dataSource={auditRows}
                pagination={false}
                sticky
                columns={auditColumns}
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
            loadEmployees();
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
