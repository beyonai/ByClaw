// tslint:disable:ordered-imports
import React, { useEffect, useMemo, useReducer, useState } from 'react';
// @ts-ignore
import { useDispatch, useIntl, useSelector, getLocale, useNavigate, useSearchParams } from '@umijs/max';
import { Spin, Tabs, message } from 'antd';
import classnames from 'classnames';
import { compact, head, isEmpty, size } from 'lodash';

// import Popularity from './components/Popularity';

import { getRuntimeActualUrl } from '@/utils';
import { getTopLevelCatalogs } from '@/utils/catalog';
import { agentHandler } from '@/utils/agent';
import { deleteDigitalEmployee, getAllDigitalEmployeesV2 } from '@/service/digitalEmployees';
import Empty from '@/components/Empty';
import InfiniteScroll from '@/components/InfiniteScroll';
import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import ResourceCard from '@/components/Resources/components/ResourceCard';

import { IAgentCache, IAgent } from '@/typescript/agent';
import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { canJumpAgent, getAgentChatAvatar, getAgentPath } from '@/utils/agent';
import useTracker from '@/hooks/useTracker';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import { applyResourceUse } from '@/pages/manager/service/resources';
import type { IOnOkParams } from '@/components/Resources/components/ResourceFilter';

type DisableActionList = Array<'delete' | 'apply' | 'unapply' | 'edit'>;

export const disableActionList: DisableActionList = ['delete', 'unapply'];

const ALL_CATEGORY_KEY = '__ALL__';

type ICategory = {
  dirName: string;
  catalogId: string | number;
};

function AllDigitalEmployees(
  props: {
    searchName?: string;
    dropdownParam?: IOnOkParams;
    buildFilterParam?: (activeTab: string, filterParam?: IOnOkParams) => Record<string, any>;
  },
  ref: any
) {
  const { searchName, dropdownParam, buildFilterParam } = props;

  const local = getLocale();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const intl = useIntl();
  const [searchParams, setSearchParams] = useSearchParams();

  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { trackerEmployeeClick } = useTracker();

  const infiniteScrollRef = React.useRef(null);
  const abortControllerRef = React.useRef<AbortController>(null);

  const { employeesTypeList } = useSelector((state: any) => state.employees);

  const [curActiveLink, setCurActiveLink] = useState<string>(() => searchParams.get('enterpriseCatalogId') || '');
  const [list, setList] = useState<IAgentCache[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [selectRecord, setSelectRecord] = useState<IAgentCache | null>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);
  const [paginationInfo, paginationDispatch] = useReducer(paginationReducer, getDefaultPagination({ pageSize: 30 }));
  const hasInitializedRef = React.useRef(false);

  const hasMore = paginationInfo.total > size(list);

  const isEN = React.useMemo(() => {
    return local.includes('en');
  }, [local]);

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
        ...(buildFilterParam?.('enterprise', filterParam) || {}),
        ownerType: 'enterprise',
      };

      if (catalogId !== undefined && catalogId !== null && `${catalogId}` !== '' && catalogId !== ALL_CATEGORY_KEY) {
        params.catalogId = catalogId;
      }

      return getAllDigitalEmployeesV2(params, abortControllerRef.current)
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
    [buildFilterParam, paginationInfo.pageSize]
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

    const catalogIdFromUrl = searchParams.get('enterpriseCatalogId');
    const catalogIds = myEmployeesTypeList.map((item) => `${item.catalogId}`);
    const validCatalogIdFromUrl = catalogIdFromUrl && catalogIds.includes(catalogIdFromUrl) ? catalogIdFromUrl : '';
    const validCurActiveLink = curActiveLink && catalogIds.includes(curActiveLink) ? curActiveLink : '';
    const nextCatalogId = validCatalogIdFromUrl || validCurActiveLink || `${firstEmployeesType.catalogId}`;

    if (!hasInitializedRef.current || curActiveLink !== nextCatalogId) {
      setCurActiveLink(nextCatalogId);
      getSearch(searchName || '', dropdownParam, 1, nextCatalogId);
      hasInitializedRef.current = true;
    }
  }, [curActiveLink, dropdownParam, getSearch, myEmployeesTypeList, searchName, searchParams]);

  useEffect(() => {
    if (!curActiveLink) return;
    if (!myEmployeesTypeList.some((item) => `${item.catalogId}` === curActiveLink)) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextSearchParams.get('enterpriseCatalogId') !== curActiveLink) {
      nextSearchParams.set('enterpriseCatalogId', curActiveLink);
      setSearchParams(nextSearchParams);
    }
  }, [curActiveLink, myEmployeesTypeList, searchParams, setSearchParams]);

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
    const handler = (param: { unApplyList?: string[]; ApplyList?: string[]; delIdList?: string[] }) => {
      const { unApplyList = [], ApplyList = [], delIdList = [] } = param || {};

      setList((prevList) => {
        return compact([
          ...prevList.map((item: IAgentCache) => {
            if (ApplyList.includes(`${item.id}`)) {
              return {
                ...item,
                approveStatus: 'S',
              };
            }
            if (unApplyList.includes(`${item.id}`)) {
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

  const onClickEmployee = React.useCallback(
    (employee: IAgentCache) => {
      if (employee.agentId && canJumpAgent(employee)) {
        trackerEmployeeClick(employee, 'marketAgentRedirect');
        setAgentId?.(`${employee.agentId}`);
        setSessionId?.('');
        const nextSearchParams = new URLSearchParams({
          tab: 'enterprise',
          enterpriseCatalogId: curActiveLink,
        });
        navigate(`${getAgentPath(employee)}?${nextSearchParams.toString()}`);
        return;
      }

      message.destroy();
      message.error(intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
    },
    [curActiveLink, intl, navigate, setAgentId, setSessionId, trackerEmployeeClick]
  );

  const onEditEmployee = React.useCallback(
    (employee: IAgentCache) => {
      const resourceId = employee?.resourceId ?? employee?.id ?? employee?.agentId;
      sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
      const nextSearchParams = new URLSearchParams({
        digitalType: employee?.createType || 'FROM_MANUALLY',
        appId: `${resourceId}`,
        tab: 'enterprise',
        enterpriseCatalogId: curActiveLink,
      });
      navigate(`/digitalEmployeesCreate?${nextSearchParams.toString()}`);
    },
    [curActiveLink, navigate]
  );

  const onDeleteEmployee = React.useCallback(
    (employee: IAgentCache) => {
      deleteDigitalEmployee({
        resourceId: String(employee.resourceId ?? employee.id),
      })
        .then(() => {
          message.success(intl.formatMessage({ id: 'digitalEmployees.deleteSuccess' }));
          EventEmitter.emit('beyond-update-employee', {
            delIdList: [employee.agentId],
          });
        })
        .catch((error: any) => {
          message.error(error?.message || error || intl.formatMessage({ id: 'common.deleteFailed' }));
        });
    },
    [EventEmitter, intl]
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

        getSearch(searchName || '', dropdownParam, 1, curActiveLink);
      } catch (error: any) {
        message.error(error?.message || error || intl.formatMessage({ id: 'common.operateFailed' }));
      }
    },
    [applyResourceUse, EventEmitter, intl, searchName, dropdownParam, curActiveLink]
  );

  return (
    <div className="full-width full-height ub ub-ver">
      <div className="mb-16">
        <img
          className={styles.marketBg}
          src={getRuntimeActualUrl(isEN ? '/beyond/market-en.png' : '/beyond/market.png')}
          alt="poster"
        />
      </div>
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
            nextSearchParams.set('enterpriseCatalogId', nextActiveKey);
            setCurActiveLink(nextActiveKey);
            setSearchParams(nextSearchParams);
            getSearch(searchName || '', dropdownParam, 1, activeKey);
          }}
        />
      </div>
      <div
        className="ub ub-f1 ub-ver overflow-auto hideThumb"
        style={{ position: 'relative' }}
        id="allDigitalEmployeesScroller"
      >
        <div className={classnames(styles.sectionsContainer, 'ub-f1')}>
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
                scrollableTarget="allDigitalEmployeesScroller"
                className={classnames(styles.messageRowWrap, { [styles.hasMore]: hasMore })}
                scrollThreshold="50px"
                hasChildren={list.length > 0}
                topItemKey={head(list)?.agentId}
                style={{
                  overflow: 'visible',
                }}
              >
                <div className={styles.employeeList}>
                  {list.map((employee: IAgentCache) => {
                    return (
                      <ResourceCard
                        key={employee.agentId}
                        resource={employee}
                        avatarNode={
                          <div className={styles.employeeAvatar}>{getAgentChatAvatar(employee.chatAvatar)}</div>
                        }
                        onCardClick={() => onClickEmployee(employee)}
                        actionConfig={{
                          scene: 'enterprise',
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
