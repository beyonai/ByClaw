import { LeftOutlined } from '@ant-design/icons';
import { useNavigate } from '@umijs/max';
import { Badge, Button, Empty, Pagination, Popconfirm, Segmented, Space, Spin, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import ResourceCard from '@/components/Resources/components/ResourceCard';
import { getAgentChatAvatar, agentHandler } from '@/utils/agent';
import { IAgentCache } from '@/typescript/agent';
import { queryManagedEnterpriseEmployees, queryMyCreated } from '@/service/digitalEmployees';
import {
  approveUseApply,
  applyResourceUse,
  queryUseApplyList,
  rejectUseApply,
  ResourceUseApplyAuditItem,
} from '@/pages/manager/service/resources';
import styles from './index.module.less';
import { EmployeePreviewModal } from '@/pages/digitalEmployees';

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

const PAGE_SIZE = 20;

const normalizeList = (value: any) => (value?.list || value?.data?.list || []).map((item: any) => agentHandler(item));

const MyEmployeesPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<OwnerTab>('personal');
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [enterpriseScope, setEnterpriseScope] = useState<EnterpriseScope>('created');
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [list, setList] = useState<IAgentCache[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditPendingCount, setAuditPendingCount] = useState(0);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('pending');
  const [actionKey, setActionKey] = useState('');
  const [preview, setPreview] = useState<IAgentCache | null>(null);

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

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const queryResources = async (
        request: typeof queryMyCreated,
        agentTypeValue?: string,
        pending = auditFilter === 'pending'
      ) => {
        const res = await request({
          pageNum: 1,
          pageSize: 200,
          ...(pending ? { permission: 'PENDING_MY_APPROVAL' } : { type: 'manageable', resourceStatus: 2 }),
          agentType: agentTypeValue,
        });
        return normalizeList(res);
      };
      const pendingResources = (
        await Promise.all([
          queryResources(queryMyCreated, undefined, true),
          queryResources(queryMyCreated, '017', true),
          queryResources(queryManagedEnterpriseEmployees, undefined, true),
          queryResources(queryManagedEnterpriseEmployees, '017', true),
        ])
      ).flat();
      const pendingResourceMap = new Map(
        pendingResources.map((item: any) => [`${item.resourceId || item.id || item.agentId}`, item])
      );
      if (auditFilter === 'pending') {
        setAuditPendingCount(pendingResourceMap.size);
      }
      let resources = pendingResources;
      if (auditFilter === 'history') {
        resources = (
          await Promise.all([
            queryResources(queryMyCreated),
            queryResources(queryMyCreated, '017'),
            queryResources(queryManagedEnterpriseEmployees),
            queryResources(queryManagedEnterpriseEmployees, '017'),
          ])
        ).flat();
      }
      const uniqueResources = Array.from(
        new Map(resources.map((item: any) => [`${item.resourceId || item.id || item.agentId}`, item])).values()
      );
      const rows = await Promise.all(
        uniqueResources.map(async (resource: any) => {
          const resourceId = `${resource.resourceId || resource.id || resource.agentId}`;
          const applies: any = await queryUseApplyList({ resourceId, history: auditFilter === 'history' });
          return (applies?.data || applies || []).map((item: ResourceUseApplyAuditItem) => ({
            ...item,
            resourceId,
            resourceName: resource.resourceName || resource.name,
            employeeType: `${resource.agentType}` === '017' ? '数字员工组' : '数字员工',
            avatar: resource.avatar,
            chatAvatar: resource.chatAvatar,
          }));
        })
      );
      const sortedRows = rows
        .flat()
        // 历史审核只展示已处理记录，兼容后端旧版本偶尔返回的待审核数据。
        .filter(
          (row) => auditFilter !== 'history' || !['P', 'PENDING', '待审核'].includes(`${row.applyStatus}`.toUpperCase())
        )
        .map((row) => ({ ...row, applyStatus: formatAuditStatus(row.applyStatus, auditFilter === 'history') }))
        .sort((left, right) => {
          const leftTime = left.applyTime ? new Date(left.applyTime).getTime() : 0;
          const rightTime = right.applyTime ? new Date(right.applyTime).getTime() : 0;
          return rightTime - leftTime;
        });
      setAuditRows(sortedRows);
      if (auditFilter === 'pending') {
        setAuditPendingCount(sortedRows.length);
      } else {
        const pendingResourceIds = Array.from(pendingResourceMap.keys());
        const pendingApplyRows = await Promise.all(
          pendingResourceIds.map(async (resourceId) => {
            const applies: any = await queryUseApplyList({ resourceId });
            return applies?.data || applies || [];
          })
        );
        setAuditPendingCount(pendingApplyRows.reduce((count, applies) => count + applies.length, 0));
      }
    } finally {
      setAuditLoading(false);
    }
  }, [auditFilter]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit, activeTab]);

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
      await loadAudit();
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
    </div>
  );
};

export default MyEmployeesPage;
