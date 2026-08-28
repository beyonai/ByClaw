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
} from '@/service/digitalEmployees';
import Empty from '@/components/Empty';
import InfiniteScroll from '@/components/InfiniteScroll';
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
import { sortDefaultDigitalEmployeeFirst } from '@/pages/digitalEmployees/utils';

type DisableActionList = Array<'delete' | 'apply' | 'unapply' | 'edit'>;

export const disableActionList: DisableActionList = ['delete', 'unapply'];

const ALL_CATEGORY_KEY = '__ALL__';

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
    buildFilterParam?: (activeTab: string, filterParam?: IOnOkParams) => Record<string, any>;
    mode?: 'employee' | 'group';
    source?: 'official' | 'available';
    onEmployeeClick?: (employee: IAgentCache) => void;
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
    hideCategories = false,
    compactLayout = false,
    scrollableTarget,
  } = props;
  const isEmployeeGroup = mode === 'group';
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

  const { employeesTypeList, defaultDigEmployeeId, userInfo } = useSelector((state: any) => ({
    employeesTypeList: state.employees?.employeesTypeList,
    defaultDigEmployeeId: state.employees?.defaultDigEmployeeId,
    userInfo: state.user?.userInfo,
  }));

  const [curActiveLink, setCurActiveLink] = useState<string>(() => searchParams.get(catalogSearchParamKey) || '');
  const [list, setList] = useState<IAgentCache[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [selectRecord, setSelectRecord] = useState<IAgentCache | null>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);
  const [paginationInfo, paginationDispatch] = useReducer(paginationReducer, getDefaultPagination({ pageSize: 30 }));
  const [bannerList, setBannerList] = useState<any[]>([]);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const hasInitializedRef = React.useRef(false);

  const hasMore = paginationInfo.total > size(list);

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
      if (abortControllerRef.current && !abortControllerRef.current?.signal?.aborted) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      if (pageNum === 1) {
        setList([]);
      }

      const params: Record<string, any> = {
        pageNum,
        pageSize: paginationInfo.pageSize,
        keyword,
        ...(buildFilterParam?.(listTabKey, filterParam) || {}),
        ...(source === 'official' ? { ownerType: 'enterprise' } : {}),
        ...(isEmployeeGroup ? { agentType: '017' } : {}),
        orderField: 'updateTime',
        orderBy: 'desc',
      };

      if (catalogId !== undefined && catalogId !== null && `${catalogId}` !== '' && catalogId !== ALL_CATEGORY_KEY) {
        params.catalogId = catalogId;
      }

      let request;
      if (source === 'available') {
        request = queryMyCreatedAndSubscribedAgentsV2(
          { ...params, agentType: isEmployeeGroup ? '017' : undefined, excludeEmployeeGroup: !isEmployeeGroup },
          abortControllerRef.current
        );
      } else {
        request = getAllDigitalEmployeesV2(params, abortControllerRef.current);
      }

      return request
        .then((res) => {
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

      if (pageNum === 1) {
        setIsLoading(true);
      }

      return myGetAllDigitalEmployeesV2(keyword, targetCatalogId, pageNum, filterParam).finally(() => {
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
              return {
                ...item,
                isDefault,
                canSetDefault: isDefault ? false : item.canSetDefault,
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
    };
    EventEmitter.on('beyond-update-employee', handler);

    const handleResourceChanged = () => {
      getSearch(searchName || '', dropdownParam, 1, curActiveLink);
    };
    window.addEventListener('resourceDeleted', handleResourceChanged);
    window.addEventListener('resourceRestored', handleResourceChanged);

    return () => {
      EventEmitter.off('beyond-update-employee', handler);
      window.removeEventListener('resourceDeleted', handleResourceChanged);
      window.removeEventListener('resourceRestored', handleResourceChanged);
    };
  }, [EventEmitter, curActiveLink, dropdownParam, getSearch, searchName]);

  const defaultResourceId = defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;
  const visibleList = useMemo(
    () => sortDefaultDigitalEmployeeFirst(list, defaultResourceId),
    [defaultResourceId, list]
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
    (employee: IAgentCache) => {
      deleteDigitalEmployee({
        resourceId: String(employee.resourceId ?? employee.id),
      })
        .then(() => {
          message.success(intl.formatMessage({ id: 'digitalEmployees.deleteSuccess' }));
          EventEmitter.emit('beyond-update-employee', {
            updateList: [
              {
                ...employee,
                resourceStatus: 3,
              },
            ],
          });
          getSearch(searchName || '', dropdownParam, 1, curActiveLink);
        })
        .catch((error: any) => {
          message.error(error?.message || error || intl.formatMessage({ id: 'common.deleteFailed' }));
        });
    },
    [EventEmitter, curActiveLink, dropdownParam, getSearch, intl, searchName]
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
            {!isLoading && isEmpty(list) ? (
              <div className="full-height full-width ub ub-ac ub-pc">
                <Empty />
              </div>
            ) : (
              <InfiniteScroll
                ref={infiniteScrollRef}
                next={() => {
                  myGetAllDigitalEmployeesV2(
                    searchName || '',
                    curActiveLink,
                    paginationInfo.pageIndex + 1,
                    dropdownParam
                  );
                }}
                hasMore={hasMore}
                loader={
                  <div className="ub ub-ac ub-pc">
                    <Spin />
                  </div>
                }
                dataLength={list.length}
                scrollableTarget={scrollableTarget || scrollerId}
                className={classnames(styles.messageRowWrap, { [styles.hasMore]: hasMore })}
                scrollThreshold="50px"
                hasChildren={list.length > 0}
                topItemKey={head(visibleList)?.agentId}
                style={{
                  overflow: 'visible',
                }}
              >
                <div className={styles.employeeList}>
                  {visibleList.map((employee: IAgentCache) => {
                    return (
                      <ResourceCard
                        key={employee.agentId}
                        resource={employee}
                        resourceType="DIG_EMPLOYEE"
                        avatarNode={
                          <div className={styles.employeeAvatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>
                        }
                        onCardClick={(resource) => onClickEmployee((resource as IAgentCache) || employee)}
                        digitalEmployeeActionMode
                        actionConfig={{
                          scene: 'enterprise',
                          onChat: () => onChatEmployee(employee),
                          onEdit: () => onEditEmployee(employee),
                          onAuth: (type: any) => onAuthEmployee(employee, type),
                          onApplyUse: () => onApplyEmployee(employee),
                          onAuditUse: () => onAuditEmployee(employee),
                          onDelete: () => onDeleteEmployee(employee),
                        }}
                      />
                    );
                  })}
                </div>
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
            getSearch(searchName || '', dropdownParam, 1, curActiveLink);
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
          getSearch(searchName || '', dropdownParam, 1, curActiveLink);
        }}
      />
    </div>
  );
}

export default React.forwardRef(AllDigitalEmployees);
