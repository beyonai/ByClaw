import { LeftOutlined } from '@ant-design/icons';
import { useNavigate } from '@umijs/max';
import { Badge, Button, Empty, Pagination, Popconfirm, Segmented, Space, Spin, Table, Tabs, Tag, message } from 'antd';
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

type OwnerTab = 'personal' | 'enterprise' | 'audit';
type ResourceFilter = 'all' | 'employee' | 'group';
type EnterpriseScope = 'created' | 'managed';

type AuditRow = ResourceUseApplyAuditItem & {
  resourceId: string;
  resourceName: string;
  employeeType: string;
  avatar?: string;
  chatAvatar?: string;
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
  const [actionKey, setActionKey] = useState('');

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
      const queryResources = async (request: typeof queryMyCreated, agentTypeValue?: string) => {
        const res = await request({
          pageNum: 1,
          pageSize: 200,
          permission: 'PENDING_MY_APPROVAL',
          agentType: agentTypeValue,
        });
        return normalizeList(res);
      };
      const resources = (
        await Promise.all([
          queryResources(queryMyCreated),
          queryResources(queryMyCreated, '017'),
          queryResources(queryManagedEnterpriseEmployees),
          queryResources(queryManagedEnterpriseEmployees, '017'),
        ])
      ).flat();
      const uniqueResources = Array.from(
        new Map(resources.map((item: any) => [`${item.resourceId || item.id || item.agentId}`, item])).values()
      );
      const rows = await Promise.all(
        uniqueResources.map(async (resource: any) => {
          const resourceId = `${resource.resourceId || resource.id || resource.agentId}`;
          const applies: any = await queryUseApplyList({ resourceId });
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
      setAuditRows(
        rows.flat().sort((left, right) => {
          const leftTime = left.applyTime ? new Date(left.applyTime).getTime() : 0;
          const rightTime = right.applyTime ? new Date(right.applyTime).getTime() : 0;
          return rightTime - leftTime;
        })
      );
    } finally {
      setAuditLoading(false);
    }
  }, []);

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
    (employee: IAgentCache) => {
      const targetId = employee.agentId || employee.id || employee.resourceId;
      if (!targetId) return;
      const normalizedEmployee = agentHandler(employee);
      navigate('/employees', {
        state: {
          keepSiderActiveKey: 'agent',
          selectedAgentId: `${targetId}`,
          selectedEmployee: normalizedEmployee,
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

  const tabItems = useMemo(
    () => [
      { key: 'personal', label: '个人' },
      { key: 'enterprise', label: '企业' },
      {
        key: 'audit',
        label: (
          <Badge count={auditRows.length} size="small" offset={[2, 2]}>
            <span className={styles.auditTabLabel}>审核中心</span>
          </Badge>
        ),
      },
    ],
    [auditRows.length]
  );

  return (
    <div className={styles.container}>
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
                    onCardClick={() => undefined}
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
        <Spin spinning={auditLoading}>
          <Table<AuditRow>
            rowKey={(row) => `${row.resourceId}-${row.privilegeGrantId}`}
            dataSource={auditRows}
            pagination={false}
            columns={[
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
                render: (value) =>
                  value && dayjs(value).isValid() ? dayjs(value).format('YYYY-MM-DD HH:mm') : value || '-',
              },
              { title: '状态', dataIndex: 'applyStatus', render: (value) => <Tag color="processing">{value}</Tag> },
              {
                title: '操作',
                render: (_, row) => (
                  <Space>
                    <Popconfirm
                      title="确认通过该使用申请吗？"
                      okText="确认"
                      cancelText="取消"
                      onConfirm={() => handleAudit(row, 'approve')}
                    >
                      <Button
                        type="link"
                        size="small"
                        loading={actionKey === `approve-${row.resourceId}-${row.userId}`}
                      >
                        通过
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title="确认驳回该使用申请吗？"
                      okText="确认"
                      cancelText="取消"
                      onConfirm={() => handleAudit(row, 'reject')}
                    >
                      <Button
                        danger
                        type="link"
                        size="small"
                        loading={actionKey === `reject-${row.resourceId}-${row.userId}`}
                      >
                        驳回
                      </Button>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Spin>
      )}
    </div>
  );
};

export default MyEmployeesPage;
