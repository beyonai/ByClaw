// tslint:disable:ordered-imports
import React, { useEffect, useMemo, useReducer, useState } from 'react';
// @ts-ignore
import { useDispatch, useIntl, useSelector, useNavigate, useSearchParams } from '@umijs/max';
import { Spin, Tabs, message } from 'antd';
import classnames from 'classnames';
import { compact, head, isEmpty, size } from 'lodash';

// import Popularity from './components/Popularity';

import { getRuntimeActualUrl } from '@/utils';
import { getTopLevelCatalogs } from '@/utils/catalog';
import { agentHandler } from '@/utils/agent';
import {
  deleteDigitalEmployee,
  getAllDigitalEmployeesV2,
  queryMyCreatedAndSubscribedAgentsV2,
  shelfDigitalEmployee,
  unShelfDigitalEmployee,
} from '@/service/digitalEmployees';
import Empty from '@/components/Empty';
import InfiniteScroll from '@/components/InfiniteScroll';
import useEmployeeRowRefresh, {
  employeeRowId,
  removeEmployeeRow,
  updateEmployeeRow,
} from '@/hooks/useEmployeeRowRefresh';
import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import ResourceCard from '@/components/Resources/components/ResourceCard';

import { IAgentCache, IAgent } from '@/typescript/agent';
import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { getAgentChatAvatar } from '@/utils/agent';
import useTracker from '@/hooks/useTracker';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import { applyResourceUse } from '@/pages/manager/service/resources';
import type { IOnOkParams } from '@/components/Resources/components/ResourceFilter';
import { getDcSystemConfig } from '@/pages/manager/service/session';

type DisableActionList = Array<'delete' | 'apply' | 'unapply' | 'edit'>;

export const disableActionList: DisableActionList = ['delete', 'unapply'];

const ALL_CATEGORY_KEY = '__ALL__';
const DEFAULT_DIGITAL_EMPLOYEE_FILTER: IOnOkParams = { resourceStatus: '2' };

type ICategory = {
  dirName: string;
  catalogId: string | number;
};

const getBannerUrl = (bannerList: any[], labels: string | string[]) => {
  const labelList = Array.isArray(labels) ? labels : [labels];
  const banner = bannerList.find((item) => labelList.includes(item?.label));
  return `${banner?.url ?? ''}`.trim().replace(/^`|`$/g, '').trim();
};

const parseBannerList = (value: any) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

function AllDigitalEmployees(
  props: {
    searchName?: string;
    dropdownParam?: IOnOkParams;
    buildFilterParam?: (
      activeTab: string,
      filterParam?: IOnOkParams,
      source?: 'official' | 'available'
    ) => Record<string, any>;
    mode?: 'employee' | 'group' | 'all';
    source?: 'official' | 'available';
    onEmployeeClick?: (employee: IAgentCache) => void;
    onChatEmployee?: (employee: IAgentCache) => void;
    hideCategories?: boolean;
    compactLayout?: boolean;
    scrollableTarget?: string;
  },
  ref: any
) {
  const {
    searchName,
    dropdownParam,
    buildFilterParam,
    mode = 'employee',
    source = 'official',
    onEmployeeClick,
    onChatEmployee: onChatEmployeeProp,
    hideCategories = false,
    compactLayout = false,
    scrollableTarget,
  } = props;
  const isEmployeeGroup = mode === 'group';
  const isAllEmployees = mode === 'all';
  const listTabKey = isEmployeeGroup ? 'group' : 'enterprise';
  const catalogSearchParamKey = isEmployeeGroup ? 'groupCatalogId' : 'enterpriseCatalogId';
  const scrollerId = isEmployeeGroup ? 'allDigitalEmployeeGroupsScroller' : 'allDigitalEmployeesScroller';

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();

  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { trackerEmployeeClick } = useTracker();

  const infiniteScrollRef = React.useRef(null);
  const abortControllerRef = React.useRef<AbortController>(null);

  const { employeesTypeList } = useSelector((state: any) => ({
    employeesTypeList: state.employees?.employeesTypeList,
  }));

  const [curActiveLink, setCurActiveLink] = useState<string>(() => searchParams.get(catalogSearchParamKey) || '');
  const [list, setList] = useState<IAgentCache[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [selectRecord, setSelectRecord] = useState<IAgentCache | null>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);
  const [paginationInfo, paginationDispatch] = useReducer(paginationReducer, getDefaultPagination({ pageSize: 20 }));
  const [bannerList, setBannerList] = useState<any[]>([]);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const hasInitializedRef = React.useRef(false);
  // 分页请求复用当前筛选条件，避免滚动加载下一页时丢失 resourceStatus 等参数。
  const activeFilterParamRef = React.useRef<IOnOkParams | undefined>(
    dropdownParam || DEFAULT_DIGITAL_EMPLOYEE_FILTER
  );

  const shouldKeepEmployee = React.useCallback(
    (employee: IAgentCache) => {
      const status = `${employee?.resourceStatus ?? employee?.metaStatus ?? ''}`;
      // “我可用的”接口只返回可使用的已上架员工，操作下架后当前行应立即移出列表。
      if (source === 'available') return status === '2';

      // 父页面通过 getSearch 传递筛选条件，当前值以分页请求复用的 ref 为准。
      const selectedStatus = `${activeFilterParamRef.current?.resourceStatus ?? '2'}`;
      if (selectedStatus === '') return status !== '-1';
      return status === selectedStatus;
    },
    [source]
  );

  const refreshEmployee = useEmployeeRowRefresh(list, setList, () => {
    paginationDispatch({ type: 'change', item: { total: Math.max(0, paginationInfo.total - 1) } });
  }, shouldKeepEmployee);

  const customBannerUrl = getBannerUrl(bannerList, [intl.formatMessage({ id: 'digitalEmployees.title' }), '数字员工']);
  const bannerUrl = customBannerUrl ? getRuntimeActualUrl(customBannerUrl) : '';

  useEffect(() => {
    getDcSystemConfig({ paramCode: 'BYAI_BANNER' })
      .then((res: any) => {
        setBannerList(parseBannerList(res?.paramValue));
      })
      .catch(() => {
        setBannerList([]);
      })
      .finally(() => {
        setBannerLoaded(true);
      });
  }, []);

  const myEmployeesTypeList = useMemo((): ICategory[] => {
    const allCategory: ICategory = {
      dirName: intl.formatMessage({ id: 'digitalEmployees.skillSquare.allCategory' }),
      catalogId: ALL_CATEGORY_KEY,
    };

    if (isEmpty(employeesTypeList)) return [allCategory];

    const categoryList: ICategory[] = getTopLevelCatalogs(employeesTypeList).map((item) => ({
      dirName: item.catalogName,
      catalogId: item.catalogId,
    }));

    return [allCategory, ...categoryList];
  }, [employeesTypeList, intl]);

  const myGetAllDigitalEmployeesV2 = React.useCallback(
    (keyword: string = '', catalogId?: string | number, pageNum: number = 1, filterParam?: IOnOkParams) => {
      // 直接触发的分页请求也复用最近一次筛选，兼容“我可用的”两类列表。
      const effectiveFilterParam =
        filterParam ?? activeFilterParamRef.current ?? DEFAULT_DIGITAL_EMPLOYEE_FILTER;
      activeFilterParamRef.current = effectiveFilterParam;
      if (abortControllerRef.current && !abortControllerRef.current?.signal?.aborted) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const requestController = abortControllerRef.current;

      if (pageNum === 1) {
        setList([]);
      }

      const params: Record<string, any> = {
        pageNum,
        pageSize: paginationInfo.pageSize,
        keyword,
        ...(buildFilterParam?.(listTabKey, effectiveFilterParam, source) || {}),
        ...(source === 'official' ? { ownerType: 'enterprise' } : {}),
        ...(isEmployeeGroup ? { agentType: '017' } : {}),
        ...(source === 'official' && isAllEmployees ? { includeEmployeeGroup: true, employeeGroupFirst: true } : {}),
        orderField: 'updateTime',
        orderBy: 'desc',
      };

      if (catalogId !== undefined && catalogId !== null && `${catalogId}` !== '' && catalogId !== ALL_CATEGORY_KEY) {
        params.catalogId = catalogId;
      }

      let request;
      if (source === 'available') {
        // 合并模式不限定 agentType，统一查询数字员工组和数字员工后再分块展示；
        // 兼容旧模式时仍分别使用 agentType/excludeEmployeeGroup 过滤。
        const availableTypeParams = isAllEmployees
          ? {}
          : { agentType: isEmployeeGroup ? '017' : undefined, excludeEmployeeGroup: !isEmployeeGroup };
        request = queryMyCreatedAndSubscribedAgentsV2(
          { ...params, ...availableTypeParams },
          abortControllerRef.current
        );
      } else {
        request = getAllDigitalEmployeesV2(params, abortControllerRef.current);
      }

      return request
        .then((res) => {
          if (requestController.signal.aborted) return;
          const { list: responseList, ...rest } = res || {};
          const mappedList = responseList?.map?.((item: IAgent) => agentHandler(item)) || [];

          if (pageNum === 1) {
            setList(mappedList);
          } else {
            setList((prevList) => [...prevList, ...mappedList]);
          }

          paginationDispatch({
            type: 'change',
            item: {
              pageIndex: Number(rest.pageNum) || pageNum,
              total: Number(rest.total) || 0,
              pageCount: Number(rest.totalPages) || 0,
            },
          });
        })
        .catch((e) => {
          console.error(e);
        });
    },
    [buildFilterParam, isEmployeeGroup, listTabKey, paginationInfo.pageSize, source]
  );

  const getSearch = React.useCallback(
    (
      keyword: string = '',
      filterParam: IOnOkParams | undefined = dropdownParam,
      pageNum: number = 1,
      catalogId?: string | number
    ) => {
      const targetCatalogId = catalogId ?? (curActiveLink || myEmployeesTypeList?.[0]?.catalogId || ALL_CATEGORY_KEY);
      const effectiveFilterParam =
        filterParam ?? activeFilterParamRef.current ?? DEFAULT_DIGITAL_EMPLOYEE_FILTER;
      activeFilterParamRef.current = effectiveFilterParam;

      if (pageNum === 1) {
        setIsLoading(true);
      }

      return myGetAllDigitalEmployeesV2(keyword, targetCatalogId, pageNum, effectiveFilterParam).finally(() => {
        setIsLoading(false);
      });
    },
    [curActiveLink, dropdownParam, myEmployeesTypeList, myGetAllDigitalEmployeesV2]
  );

  useEffect(() => {
    dispatch({
      type: 'employees/getDigitEmployDir',
    });
  }, [dispatch]);

  useEffect(() => {
    const firstEmployeesType = myEmployeesTypeList[0];
    if (!firstEmployeesType) return;

    const catalogIdFromUrl = searchParams.get(catalogSearchParamKey);
    const catalogIds = myEmployeesTypeList.map((item) => `${item.catalogId}`);
    const validCatalogIdFromUrl = catalogIdFromUrl && catalogIds.includes(catalogIdFromUrl) ? catalogIdFromUrl : '';
    const validCurActiveLink = curActiveLink && catalogIds.includes(curActiveLink) ? curActiveLink : '';
    const nextCatalogId = validCatalogIdFromUrl || validCurActiveLink || `${firstEmployeesType.catalogId}`;

    if (!hasInitializedRef.current || curActiveLink !== nextCatalogId) {
      setCurActiveLink(nextCatalogId);
      getSearch(searchName || '', dropdownParam, 1, nextCatalogId);
      hasInitializedRef.current = true;
    }
  }, [catalogSearchParamKey, curActiveLink, dropdownParam, getSearch, myEmployeesTypeList, searchName, searchParams]);

  useEffect(() => {
    if (!curActiveLink) return;
    if (!myEmployeesTypeList.some((item) => `${item.catalogId}` === curActiveLink)) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextSearchParams.get(catalogSearchParamKey) !== curActiveLink) {
      nextSearchParams.set(catalogSearchParamKey, curActiveLink);
      setSearchParams(nextSearchParams);
    }
  }, [catalogSearchParamKey, curActiveLink, myEmployeesTypeList, searchParams, setSearchParams]);

  React.useImperativeHandle(
    ref,
    () => ({
      getSearch,
      getCurrentCatalogId: () => (curActiveLink && curActiveLink !== ALL_CATEGORY_KEY ? curActiveLink : undefined),
    }),
    [curActiveLink, getSearch]
  );

  useEffect(() => {
    return () => {
      if (abortControllerRef.current && !abortControllerRef.current?.signal?.aborted) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handler = (param: {
      unApplyList?: string[];
      ApplyList?: string[];
      delIdList?: string[];
      updateList?: Partial<IAgentCache>[];
      defaultResourceId?: string;
    }) => {
      const { unApplyList = [], ApplyList = [], delIdList = [], updateList = [], defaultResourceId } = param || {};

      setList((prevList) => {
        return compact([
          ...prevList.map((item: IAgentCache) => {
            const itemIdentity = `${item.resourceId ?? item.id ?? item.agentId ?? ''}`;
            if (defaultResourceId) {
              const isDefault = itemIdentity === `${defaultResourceId}`;
              let canSetDefault = item.canSetDefault;
              if (isDefault) {
                canSetDefault = false;
              } else if (item.operationPermissionsLoaded === true) {
                canSetDefault =
                  `${item.resourceStatus ?? item.metaStatus ?? ''}` !== '3' &&
                  (item.hasManagePermission === true || item.hasUsePermission === true);
              }
              return {
                ...item,
                isDefault,
                canSetDefault,
                ownerType: !isDefault && item.ownerType === 'personal_default' ? 'personal' : item.ownerType,
              };
            }
            if (ApplyList.includes(itemIdentity)) {
              return {
                ...item,
                approveStatus: 'S',
              };
            }
            if (unApplyList.includes(itemIdentity)) {
              return {
                ...item,
                approveStatus: '',
                grantType: undefined,
                authorizeMe: false,
              };
            }
            if (delIdList.includes(`${item.agentId}`)) {
              return null;
            }
            const matchedUpdate = updateList.find((updateItem) => `${updateItem.agentId}` === `${item.agentId}`);
            if (matchedUpdate) {
              return {
                ...item,
                ...matchedUpdate,
              };
            }
            return item;
          }),
        ]);
      });
      if (ApplyList.length || unApplyList.length || defaultResourceId) {
        [...new Set([...ApplyList, ...unApplyList, ...(defaultResourceId ? [defaultResourceId] : [])])].forEach(
          (id) => void refreshEmployee(id).catch(console.error)
        );
      }
    };
    EventEmitter.on('beyond-update-employee', handler);

    const handleResourceChanged = (event: Event) => {
      const resourceId = (event as CustomEvent).detail?.resourceId;
      if (!resourceId) return;
      if (event.type === 'resourceDeleted') removeEmployeeRow(`${resourceId}`);
      else void refreshEmployee(`${resourceId}`).catch(console.error);
    };
    window.addEventListener('resourceDeleted', handleResourceChanged);
    window.addEventListener('resourceRestored', handleResourceChanged);

    return () => {
      EventEmitter.off('beyond-update-employee', handler);
      window.removeEventListener('resourceDeleted', handleResourceChanged);
      window.removeEventListener('resourceRestored', handleResourceChanged);
    };
  }, [EventEmitter, refreshEmployee]);

  // 列表顺序完全采用接口返回顺序，避免前端二次排序覆盖后端排序规则。
  const visibleList = useMemo(() => list.filter((item) => shouldKeepEmployee(item)), [list, shouldKeepEmployee]);
  const hasMore = paginationInfo.total > size(visibleList);

  // 合并查询模式按资源类型分块展示，保证“我可用的”和“官方推荐”都先显示员工组、再显示数字员工。
  const employeeGroupList = useMemo(
    () => (isAllEmployees ? visibleList.filter((item) => `${item.agentType}` === '017') : []),
    [isAllEmployees, visibleList]
  );
  const employeeList = useMemo(
    () => (isAllEmployees ? visibleList.filter((item) => `${item.agentType}` !== '017') : visibleList),
    [isAllEmployees, visibleList]
  );

  const showNoUsePermissionWarning = React.useCallback(() => {
    message.destroy();
    message.warning(intl.formatMessage({ id: 'digitalEmployees.noUsePermissionApplyFirst' }));
  }, [intl]);

  const onClickEmployee = React.useCallback(
    (employee: IAgentCache) => {
      if (onEmployeeClick) {
        onEmployeeClick(employee);
        return;
      }
      if (employee.canApplyUse) {
        showNoUsePermissionWarning();
        return;
      }

      if (employee.agentId) {
        const normalizedEmployee = agentHandler(employee);
        trackerEmployeeClick(normalizedEmployee, 'marketAgentRedirect');
        dispatch({
          type: 'employees/updateEmployee',
          payload: {
            employee: normalizedEmployee,
          },
        });
        setAgentId?.(`${normalizedEmployee.agentId}`);
        setSessionId?.('');
        const nextSearchParams = new URLSearchParams({
          tab: listTabKey,
          [catalogSearchParamKey]: curActiveLink,
        });
        // 员工模块内统一打开员工详情，查询参数仅用于返回时恢复企业员工列表位置。
        navigate(`/employees?${nextSearchParams.toString()}`, {
          // 路由状态保留本次点击目标，避免返回列表后历史 agentId 覆盖新选择。
          state: {
            keepSiderActiveKey: 'agent',
            selectedAgentId: `${normalizedEmployee.agentId}`,
            selectedEmployee: normalizedEmployee,
          },
        });
        return;
      }

      message.destroy();
      message.error(intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
    },
    [
      curActiveLink,
      catalogSearchParamKey,
      dispatch,
      intl,
      navigate,
      setAgentId,
      setSessionId,
      showNoUsePermissionWarning,
      trackerEmployeeClick,
      listTabKey,
      onEmployeeClick,
    ]
  );

  const onChatEmployee = React.useCallback(
    (employee: IAgentCache) => {
      const normalizedEmployee = agentHandler(employee);
      const targetId = normalizedEmployee.agentId || normalizedEmployee.id || normalizedEmployee.resourceId;
      if (!targetId) {
        message.error(intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
        return;
      }
      trackerEmployeeClick(normalizedEmployee, 'marketAgentRedirect');
      dispatch({
        type: 'employees/updateEmployee',
        payload: { employee: normalizedEmployee },
      });
      setAgentId?.(`${targetId}`);
      setSessionId?.('');
      const nextSearchParams = new URLSearchParams({
        tab: listTabKey,
        [catalogSearchParamKey]: curActiveLink,
      });
      navigate(`/employees?${nextSearchParams.toString()}`, {
        state: {
          keepSiderActiveKey: 'agent',
          selectedAgentId: `${targetId}`,
          selectedEmployee: normalizedEmployee,
        },
      });
    },
    [
      catalogSearchParamKey,
      curActiveLink,
      dispatch,
      intl,
      listTabKey,
      navigate,
      setAgentId,
      setSessionId,
      trackerEmployeeClick,
    ]
  );
  const chatEmployee = onChatEmployeeProp || onChatEmployee;

  const onEditEmployee = React.useCallback(
    (employee: IAgentCache) => {
      const resourceId = employee?.resourceId ?? employee?.id ?? employee?.agentId;
      sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
      const nextSearchParams = new URLSearchParams({
        digitalType: employee?.createType || 'FROM_MANUALLY',
        appId: `${resourceId}`,
        tab: listTabKey,
        [catalogSearchParamKey]: curActiveLink,
      });
      navigate(`/digitalEmployeesCreate?${nextSearchParams.toString()}`);
    },
    [catalogSearchParamKey, curActiveLink, listTabKey, navigate]
  );

  const onDeleteEmployee = React.useCallback(
    async (employee: IAgentCache) => {
      const resourceId = employeeRowId(employee);
      try {
        await deleteDigitalEmployee({ resourceId });
        message.success(intl.formatMessage({ id: 'digitalEmployees.deleteSuccess' }));
        removeEmployeeRow(resourceId);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'common.deleteFailed' }));
      }
    },
    [intl]
  );

  const onChangeShelfStatus = React.useCallback(
    async (employee: IAgentCache, action: 'shelf' | 'unShelf') => {
      const resourceId = String(employee.resourceId ?? employee.id ?? employee.agentId ?? '');
      if (!resourceId) return;
      try {
        const request = action === 'shelf' ? shelfDigitalEmployee : unShelfDigitalEmployee;
        const response: any = await request({ resourceId });
        if (response?.success === false || (response?.code !== undefined && response.code !== 0)) {
          throw new Error(response?.msg || intl.formatMessage({ id: 'common.operationFailed' }));
        }
        message.success(
          intl.formatMessage({
            id: action === 'shelf' ? 'digitalEmployees.shelfSuccess' : 'digitalEmployees.unShelfSuccess',
          })
        );
        const refreshPromise = refreshEmployee(employee);
        updateEmployeeRow({
          resourceId,
          resourceStatus: action === 'shelf' ? 2 : 3,
        });
        await refreshPromise;
      } catch (error: any) {
        message.error(error?.message || error || intl.formatMessage({ id: 'common.operationFailed' }));
      }
    },
    [intl, refreshEmployee]
  );

  const onAuthEmployee = React.useCallback((employee: IAgentCache, type: 'useAuth' | 'mgrAuth') => {
    setSelectRecord(employee);
    setAuthType(type);
    setAuthDrawerOpen(true);
  }, []);

  const onAuditEmployee = React.useCallback((employee: IAgentCache) => {
    setSelectRecord(employee);
    setUseApplyAuditOpen(true);
  }, []);

  const onApplyEmployee = React.useCallback(
    async (employee: IAgentCache) => {
      // 与 EmployeeRelatedToMe.onApplyEmployee 取值口径对齐：优先 resourceId，回退 id
      const resourceId = `${employee.resourceId ?? employee.id ?? ''}`;
      try {
        await applyResourceUse({ resourceId });
        message.success(intl.formatMessage({ id: 'digitalEmployees.applySuccess' }));

        EventEmitter.emit('beyond-update-employee', {
          ApplyList: [resourceId],
        });
      } catch (error: any) {
        message.error(error?.message || error || intl.formatMessage({ id: 'common.operateFailed' }));
      }
    },
    [EventEmitter, intl]
  );

  const renderEmployeeCard = (employee: IAgentCache) => (
    <ResourceCard
      key={employee.agentId}
      resource={employee}
      resourceType="DIG_EMPLOYEE"
      avatarNode={<div className={styles.employeeAvatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>}
      onCardClick={(resource) => onClickEmployee((resource as IAgentCache) || employee)}
      digitalEmployeeActionMode
      actionConfig={{
        scene: 'enterprise',
        hiddenMenuItemKeys: source === 'available' ? ['authorize'] : [],
        onChat: () => chatEmployee(employee),
        onEdit: () => onEditEmployee(employee),
        onAuth: (type: any) => onAuthEmployee(employee, type),
        onApplyUse: () => onApplyEmployee(employee),
        onAuditUse: () => onAuditEmployee(employee),
        onDelete: () => onDeleteEmployee(employee),
        onDeleteData: () => onDeleteEmployee(employee),
        onShelf: () => onChangeShelfStatus(employee, 'shelf'),
        onUnShelf: () => onChangeShelfStatus(employee, 'unShelf'),
        // 两个 Tab 的卡片统一展示数字员工状态标签；我可用的不展示上下架操作。
        enableDigitalEmployeeLifecycle: source === 'official',
        // 已下架且当前用户具备删除权限时展示“删除数据”；权限由列表接口返回。
        enableDigitalEmployeeDelete: true,
        showDigitalEmployeeTypeTag: false,
      }}
    />
  );

  return (
    <div
      className={classnames('full-width ub ub-ver', {
        'full-height': !compactLayout,
        [styles.compactLayout]: compactLayout,
      })}
    >
      {bannerLoaded && bannerUrl && (
        <div className="mb-16">
          <img className={styles.marketBg} src={bannerUrl} alt="poster" />
        </div>
      )}
      {!hideCategories && (
        <div
          id="guideStep2-5"
          className={classnames('ub ub-ac gap8', styles.body)}
          style={{ marginBottom: '16px', minHeight: '35px' }}
        >
          <Tabs
            className={classnames('ub-f1', styles.tabs)}
            activeKey={curActiveLink}
            items={myEmployeesTypeList.map((_) => {
              return {
                label: _.dirName,
                key: `${_.catalogId}`,
              };
            })}
            onChange={(activeKey) => {
              const nextActiveKey = `${activeKey}`;
              const nextSearchParams = new URLSearchParams(searchParams);
              nextSearchParams.set(catalogSearchParamKey, nextActiveKey);
              setCurActiveLink(nextActiveKey);
              setSearchParams(nextSearchParams);
              getSearch(searchName || '', dropdownParam, 1, activeKey);
            }}
          />
        </div>
      )}
      <div
        className={classnames('ub ub-ver overflow-auto hideThumb', { 'ub-f1': !compactLayout })}
        style={{ position: 'relative', maxHeight: compactLayout ? 'none' : undefined }}
        id={scrollableTarget ? undefined : scrollerId}
      >
        <div className={classnames(styles.sectionsContainer, { 'ub-f1': !compactLayout })}>
          <Spin
            wrapperClassName={styles.spinningWrapper}
            tip={intl.formatMessage({ id: 'common.loading' })}
            spinning={isLoading}
          >
            {!isLoading && isEmpty(visibleList) ? (
              <div className="full-height full-width ub ub-ac ub-pc">
                <Empty />
              </div>
            ) : (
              <InfiniteScroll
                ref={infiniteScrollRef}
                next={() => {
                  return myGetAllDigitalEmployeesV2(
                    searchName || '',
                    curActiveLink,
                    paginationInfo.pageIndex + 1,
                    activeFilterParamRef.current
                  );
                }}
                autoFill
                isLoading={isLoading}
                hasMore={hasMore}
                loader={
                  <div className="ub ub-ac ub-pc">
                    <Spin />
                  </div>
                }
                dataLength={visibleList.length}
                scrollableTarget={scrollableTarget || scrollerId}
                className={classnames(styles.messageRowWrap, { [styles.hasMore]: hasMore })}
                scrollThreshold="50px"
                hasChildren={visibleList.length > 0}
                topItemKey={head(visibleList)?.agentId}
                style={{
                  overflow: 'visible',
                }}
              >
                {isAllEmployees && employeeGroupList.length > 0 && (
                  <section className={styles.allEmployeesSection}>
                    <div className={styles.allEmployeesSectionTitle}>
                      {intl.formatMessage({ id: 'digitalEmployees.employeeGroup' })}
                    </div>
                    <div className={styles.employeeList}>
                      {employeeGroupList.map((employee) => renderEmployeeCard(employee))}
                    </div>
                  </section>
                )}
                {isAllEmployees && employeeList.length > 0 && (
                  <section className={styles.allEmployeesSection}>
                    <div className={styles.allEmployeesSectionTitle}>
                      {intl.formatMessage({ id: 'digitalEmployees.title' })}
                    </div>
                    <div className={styles.employeeList}>
                      {employeeList.map((employee) => renderEmployeeCard(employee))}
                    </div>
                  </section>
                )}
                {!isAllEmployees && (
                  <div className={styles.employeeList}>
                    {employeeList.map((employee) => renderEmployeeCard(employee))}
                  </div>
                )}
              </InfiniteScroll>
            )}
          </Spin>
        </div>
      </div>
      {authDrawerOpen && selectRecord && (
        <AuthListDrawer
          authType={authType}
          record={selectRecord}
          authApiPath={`/byaiService/auth/privilegeGrant/${
            authType === 'useAuth' ? 'setResourceUsers' : 'setResourceManagers'
          }`}
          onCancel={() => {
            setAuthDrawerOpen(false);
            setSelectRecord(null);
          }}
          onSuccess={() => {
            void refreshEmployee(selectRecord).catch(console.error);
          }}
          headerInfo={{
            title: selectRecord?.resourceName || selectRecord?.name,
            content: selectRecord?.resourceDesc,
            icon: <div className={styles.employeeAvatar}>{getAgentChatAvatar(selectRecord.chatAvatar)}</div>,
          }}
        />
      )}
      <UseApplyAuditDrawer
        open={useApplyAuditOpen}
        record={selectRecord}
        onCancel={() => {
          setUseApplyAuditOpen(false);
          setSelectRecord(null);
        }}
        onSuccess={() => {
          void refreshEmployee(selectRecord).catch(console.error);
        }}
      />
    </div>
  );
}

export default React.forwardRef(AllDigitalEmployees);
