import type { ResourceActionFeedback } from '@/utils/resourceActionFeedback';
import useEmployeeRowRefresh, {
  employeeRowId,
  removeEmployeeRow,
  updateEmployeeRow,
} from '@/hooks/useEmployeeRowRefresh';
import { LeftOutlined, SearchOutlined } from '@ant-design/icons';
import { getIntl, useNavigate, useIntl } from '@umijs/max';
import { Empty, Input, Segmented, Spin, Tabs, message } from 'antd';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { applyResourceUse } from '@/pages/manager/service/resources';
import styles from './index.module.less';
import { EmployeePreviewModal } from '@/pages/digitalEmployees';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';

type OwnerTab = 'personal' | 'enterprise';
type ResourceFilter = 'all' | 'employee' | 'group';
type EnterpriseScope = 'all' | 'created' | 'managed';
type EmployeeStatusFilter = 'all' | '0' | '1' | '2' | '3' | '-1';
const PAGE_SIZE = 20;

const normalizeList = (value: any) =>
  (value?.list || value?.data?.list || [])
    .filter((item: any) => `${item?.resourceStatus ?? item?.metaStatus ?? ''}` !== '-1')
    .map((item: any) => agentHandler(item));

const MyEmployeesPage: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<OwnerTab>('personal');
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmployeeStatusFilter>('all');
  const [enterpriseScope, setEnterpriseScope] = useState<EnterpriseScope>('all');
  const [loading, setLoading] = useState(false);
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
  const [preview, setPreview] = useState<IAgentCache | null>(null);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [authRecord, setAuthRecord] = useState<IAgentCache | null>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const employeeRequestRef = useRef(0);
  const employeeLoadingRef = useRef(false);

  const agentType = resourceFilter === 'group' ? '017' : undefined;

  const loadEmployees = useCallback(
    async (requestedPage = 1) => {
      if (requestedPage > 1 && employeeLoadingRef.current) return;
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
        const scopedEnterpriseType = enterpriseScope === 'created' ? 'owner' : 'managerExcludingOwner';
        const enterpriseQueryType = enterpriseScope === 'all' ? 'ownerOrManager' : scopedEnterpriseType;
        const type = activeTab === 'enterprise' ? enterpriseQueryType : 'owner';
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

  const handleDelete = useCallback(async (employee: IAgentCache, feedback: ResourceActionFeedback = message) => {
    const resourceId = employee.resourceId ?? employee.id;
    if (!resourceId) return;
    try {
      await deleteDigitalEmployee({ resourceId: String(resourceId) });
      feedback.success(getIntl().formatMessage({ id: 'ui.employee.deleteSuccess' }));
      removeEmployeeRow(employeeRowId(employee));
    } catch (error: any) {
      feedback.error(error?.message || getIntl().formatMessage({ id: 'ui.employee.deleteFailed' }));
    }
  }, []);

  const handleShelfStatusChange = useCallback(
    async (employee: IAgentCache, action: 'shelf' | 'unShelf', feedback: ResourceActionFeedback = message) => {
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
        feedback.success(
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
        await refreshPromise.catch(() => {
          feedback.warning(getIntl().formatMessage({ id: 'resource.rowRefreshFailed' }));
        });
      } catch (error: any) {
        feedback.error(
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

  const tabItems = useMemo(
    () => [
      { key: 'personal', label: intl.formatMessage({ id: 'myEmployees.personal' }) },
      { key: 'enterprise', label: intl.formatMessage({ id: 'myEmployees.enterprise' }) },
    ],
    [intl]
  );

  return (
    <div id="myEmployeesScroller" className={styles.container}>
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
                    onDelete: (feedback) => handleDelete(employee, feedback),
                    // 删除数据使用独立回调，复用删除接口及成功后的列表移除逻辑。
                    onDeleteData: (feedback) => handleDelete(employee, feedback),
                    onShelf: (feedback) => handleShelfStatusChange(employee, 'shelf', feedback),
                    onUnShelf: (feedback) => handleShelfStatusChange(employee, 'unShelf', feedback),
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
