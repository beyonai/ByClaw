import { AppstoreOutlined, BarsOutlined, LeftOutlined, SearchOutlined } from '@ant-design/icons';
import { getIntl, useNavigate, useIntl } from '@umijs/max';
import { Button, Empty, Input, Spin, Tabs, message } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import InfiniteScroll from '@/components/InfiniteScroll';
import ResourceCard from '@/components/Resources/components/ResourceCard';
import {
  ResourceQuickFilterBar,
  ResourceQuickFilterGroup,
} from '@/components/Resources/components/ResourceQuickFilters';
import useEmployeeRowRefresh, {
  employeeRowId,
  removeEmployeeRow,
  updateEmployeeRow,
} from '@/hooks/useEmployeeRowRefresh';
import { EmployeePreviewModal } from '@/pages/digitalEmployees';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import { applyResourceUse } from '@/pages/manager/service/resources';
import {
  deleteDigitalEmployee,
  queryManagedEnterpriseEmployees,
  queryMyCreated,
  shelfDigitalEmployee,
  unShelfDigitalEmployee,
} from '@/service/digitalEmployees';
import type { IAgentCache } from '@/typescript/agent';
import { getAgentChatAvatar, agentHandler } from '@/utils/agent';
import type { ResourceActionFeedback } from '@/utils/resourceActionFeedback';
import styles from './index.module.less';

type OwnerTab = 'personal' | 'enterprise';
type ResourceFilter = 'all' | 'employee' | 'group';
type EnterpriseScope = 'all' | 'created' | 'managed';
type EmployeeStatusFilter = 'all' | '0' | '1' | '2' | '3' | '-1';
type ViewMode = 'card' | 'list';
const PAGE_SIZE = 12;
const VIEW_STORAGE_KEY = 'byclaw-my-employees-view';

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'card';
  } catch {
    // 浏览器禁止存储时仍可正常使用默认卡片视图。
    return 'card';
  }
}

function normalizeList(value: any): IAgentCache[] {
  return (value?.list || value?.data?.list || [])
    .filter((item: any) => `${item?.resourceStatus ?? item?.metaStatus ?? ''}` !== '-1')
    .map((item: any) => agentHandler(item));
}

function MyEmployeesPage() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [activeTab, setActiveTab] = useState<OwnerTab>('personal');
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmployeeStatusFilter>('all');
  const [enterpriseScope, setEnterpriseScope] = useState<EnterpriseScope>('all');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<IAgentCache[]>([]);
  const [pageNum, setPageNum] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const shouldKeepEmployee = useCallback(
    (employee: IAgentCache) => {
      const selectedStatus = `${statusFilter}`;
      if (selectedStatus === 'all') return `${employee?.resourceStatus ?? employee?.metaStatus ?? ''}` !== '-1';
      return `${employee?.resourceStatus ?? employee?.metaStatus ?? ''}` === selectedStatus;
    },
    [statusFilter]
  );
  const refreshEmployee = useEmployeeRowRefresh(list, setList, () => undefined, shouldKeepEmployee);
  const [preview, setPreview] = useState<IAgentCache | null>(null);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [authRecord, setAuthRecord] = useState<IAgentCache | null>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const employeeRequestRef = useRef(0);
  const employeeLoadingRef = useRef(false);

  const agentType = resourceFilter === 'group' ? '017' : undefined;

  const loadEmployees = useCallback(
    async (requestedPage = 1) => {
      // 滚动和不足一屏的自动补齐可能同时触发，只允许一个追加请求在途。
      if (requestedPage > 1 && employeeLoadingRef.current) return;
      employeeRequestRef.current += 1;
      const requestId = employeeRequestRef.current;
      employeeLoadingRef.current = true;
      setLoading(true);
      if (requestedPage === 1) {
        setList([]);
        setPageNum(1);
        setHasMore(false);
        document.getElementById('myEmployeesScroller')?.scrollTo?.({ top: 0 });
      }
      try {
        const request = activeTab === 'personal' ? queryMyCreated : queryManagedEnterpriseEmployees;
        // 普通用户“全部”合并本人创建和授权管理，adminvip 的企业员工范围由后端按会话放行。
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
        const nextTotal = Number(res?.total ?? res?.data?.total ?? 0);

        // 两种视图共用已加载记录；继续加载只追加，筛选和搜索从首批重新查询。
        setList((current) => (requestedPage === 1 ? nextList : [...current, ...nextList]));
        setPageNum(requestedPage);
        // 空批次也终止续载，避免服务端总数滞后时不断请求空页。
        setHasMore(nextList.length > 0 && requestedPage * PAGE_SIZE < nextTotal);
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
    };
  }, [loadEmployees]);

  function changeView(nextView: ViewMode) {
    setViewMode(nextView);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, nextView);
    } catch {
      // 存储不可用只影响下次打开时的偏好，不影响本次视图切换。
    }
  }

  function resetFilters() {
    setResourceFilter('all');
    setEnterpriseScope('all');
    setStatusFilter('all');
    setKeyword('');
    setDebouncedKeyword('');
  }

  function searchEmployees() {
    // 回车和搜索按钮立即使用当前输入，避免防抖尚未完成时请求上一个关键词。
    if (keyword !== debouncedKeyword) {
      setDebouncedKeyword(keyword);
      return;
    }
    void loadEmployees();
  }

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
        message.success(intl.formatMessage({ id: 'resource.useApplication.submitted' }));
        await refreshEmployee(employee);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'resource.useApplication.failed' }));
      }
    },
    [refreshEmployee, intl]
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
        // 仅更新操作员工的状态与权限，保留已加载记录和滚动位置。
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

  // 搜索与视图切换共用顶部工具栏，窄屏由样式整体换行。
  const employeeSearch = (
    <Input
      className={styles.employeeSearch}
      suffix={
        <button
          type="button"
          className={styles.searchButton}
          aria-label={intl.formatMessage({ id: 'myEmployees.searchPlaceholder' })}
          onClick={searchEmployees}
        >
          <SearchOutlined />
        </button>
      }
      allowClear
      aria-label={intl.formatMessage({ id: 'myEmployees.searchPlaceholder' })}
      placeholder={intl.formatMessage({ id: 'myEmployees.searchPlaceholder' })}
      value={keyword}
      onChange={(event) => {
        setKeyword(event.target.value);
      }}
      onPressEnter={searchEmployees}
    />
  );

  const employeeTools = (
    <div className={styles.headerTools}>
      {employeeSearch}
      <div className={styles.viewSwitch} role="group" aria-label={intl.formatMessage({ id: 'myEmployees.view' })}>
        {(['card', 'list'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={viewMode === mode ? styles.activeView : undefined}
            aria-pressed={viewMode === mode}
            onClick={() => changeView(mode)}
          >
            {/* 图标仅作装饰，按钮的无障碍名称统一使用下方国际化文案。 */}
            {mode === 'card' ? <AppstoreOutlined aria-hidden="true" /> : <BarsOutlined aria-hidden="true" />}
            {intl.formatMessage({ id: `myEmployees.${mode}View` })}
          </button>
        ))}
      </div>
    </div>
  );
  const hasFilters = resourceFilter !== 'all' || enterpriseScope !== 'all' || statusFilter !== 'all' || keyword !== '';
  const columnLabels = [
    'myEmployees.employeeName',
    'myEmployees.description',
    'resource.creator',
    'myEmployees.type',
    ...(activeTab === 'enterprise' ? ['common.belong', 'myEmployees.status'] : []),
    'myEmployees.actions',
  ];
  // 卡片和表格使用同一资源组件，确保发布、授权和注销始终遵循同一套权限及确认流程。
  function renderEmployee(employee: IAgentCache) {
    return (
      <ResourceCard
        variant={viewMode === 'list' ? 'employeeRow' : 'employeeManagement'}
        key={employee.resourceId || employee.id || employee.agentId}
        resource={employee}
        resourceType="DIG_EMPLOYEE"
        avatarNode={<div className={styles.avatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>}
        onCardClick={(resource) => setPreview((resource || employee) as IAgentCache)}
        digitalEmployeeActionMode
        actionConfig={{
          scene: activeTab,
          // 授权入口统一消费后端权限，个人资源由后端返回 false，不再按页签二次过滤。
          hiddenMenuItemKeys: [],
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
          // 个人归属的上下架限制由后端控制，不再按页签隐藏获准操作。
          enableDigitalEmployeeLifecycle: true,
          // 个人、企业页签统一按后端 canDelete 展示删除数据入口。
          enableDigitalEmployeeDelete: true,
        }}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.fixedHeader}>
        <button type="button" className={styles.back} onClick={() => navigate('/digitalEmployees')}>
          <LeftOutlined /> {intl.formatMessage({ id: 'myEmployees.backToAll' })}
        </button>
        <Tabs
          className={styles.header}
          activeKey={activeTab}
          items={tabItems}
          tabBarExtraContent={{ right: employeeTools }}
          onChange={(key) => {
            setActiveTab(key as OwnerTab);
            resetFilters();
          }}
        />
        <div className={styles.toolbar}>
          <ResourceQuickFilterBar className={styles.filters}>
            <ResourceQuickFilterGroup
              title={intl.formatMessage({ id: 'resource.type' })}
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
              <>
                <ResourceQuickFilterGroup
                  title={intl.formatMessage({ id: 'common.belong' })}
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
                <ResourceQuickFilterGroup
                  title={intl.formatMessage({ id: 'common.status' })}
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
              </>
            )}
          </ResourceQuickFilterBar>
        </div>
        {hasFilters && (
          <div className={styles.filterActions}>
            <Button type="link" size="small" onClick={resetFilters}>
              {intl.formatMessage({ id: 'myEmployees.resetFilters' })}
            </Button>
          </div>
        )}
      </div>
      <div id="myEmployeesScroller" className={styles.listScroller}>
        <Spin spinning={loading && list.length === 0}>
          <InfiniteScroll
            autoFill
            isLoading={loading}
            next={() => loadEmployees(pageNum + 1)}
            hasMore={hasMore}
            dataLength={list.length}
            scrollableTarget="myEmployeesScroller"
            appendItemsAutoScrollBottom={false}
            scrollThreshold="50px"
            style={{ overflow: 'visible' }}
            loader={
              <div className={styles.loadMore}>
                <Spin />
              </div>
            }
          >
            {list.length > 0 && viewMode === 'card' && <div className={styles.grid}>{list.map(renderEmployee)}</div>}
            {list.length > 0 && viewMode === 'list' && (
              <div
                className={activeTab === 'enterprise' ? styles.enterpriseTableWrap : styles.tableWrap}
                role="region"
                aria-label={intl.formatMessage({ id: 'myEmployees.listView' })}
                tabIndex={0}
              >
                <table className={activeTab === 'enterprise' ? styles.enterpriseTable : styles.employeeTable}>
                  <thead>
                    <tr>
                      {columnLabels.map((label) => (
                        <th key={label} scope="col">
                          {intl.formatMessage({ id: label })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{list.map(renderEmployee)}</tbody>
                </table>
              </div>
            )}
            {list.length === 0 && (
              <div className={styles.emptyState}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={intl.formatMessage({ id: 'myEmployees.empty' })}
                >
                  {hasFilters && (
                    <Button type="link" onClick={resetFilters}>
                      {intl.formatMessage({ id: 'myEmployees.clearFilters' })}
                    </Button>
                  )}
                </Empty>
              </div>
            )}
          </InfiniteScroll>
        </Spin>
      </div>
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
}

export default MyEmployeesPage;
