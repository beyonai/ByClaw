// tslint:disable:ordered-imports
import React, { useEffect, useMemo, useReducer, useState } from 'react';
// @ts-ignore
import { useDispatch, useNavigate, useIntl, useSelector, useSearchParams } from '@umijs/max';
import classnames from 'classnames';
import { Spin, message, Tabs } from 'antd';
import { isEmpty, size, head, compact } from 'lodash';
import Empty from '@/components/Empty';
import { deleteDigitalEmployee, queryMyCreated, setDefaultDigitalEmployee } from '@/service/digitalEmployees';
import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import { agentHandler } from '@/utils/agent';
import { getTopLevelCatalogs } from '@/utils/catalog';
import InfiniteScroll from '@/components/InfiniteScroll';

import ResourceCard from '@/components/Resources/components/ResourceCard';
import { IAgentCache } from '@/typescript/agent';
import useGlobal from '@/hooks/useGlobal';
import { canJumpAgent, getAgentChatAvatar, getAgentPath } from '@/utils/agent';
import useTracker from '@/hooks/useTracker';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import ApplyForModal from '@/pages/digitalEmployees/components/ApplyForModal';
import type { IOnOkParams } from '@/components/Resources/components/ResourceFilter';
import styles from './index.module.less';

export type EmployeeCategoryKey = 'ALL' | 'create' | 'authorize';

const ALL_CATEGORY_KEY = '__ALL__';

type ICategory = {
  dirName: string;
  catalogId: string | number;
};

type IProps = {
  searchName?: string;
  dropdownParam?: IOnOkParams;
  buildFilterParam?: (activeTab: string, filterParam?: IOnOkParams) => Record<string, any>;
};

function EmployeeRelatedToMe(props: IProps, ref: any) {
  const { searchName, dropdownParam, buildFilterParam } = props;

  const infiniteScrollRef = React.useRef(null);
  const abortControllerRef = React.useRef<AbortController>(null);

  const intl = useIntl();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { EventEmitter, setAgentId, setSessionId } = useGlobal();
  const { trackerEmployeeClick } = useTracker();

  const { employeesTypeList } = useSelector(({ employees }) => ({
    ...employees,
  }));

  const [curActiveLink, setCurActiveLink] = useState<string>(() => searchParams.get('personalCatalogId') || '');
  const [list, setList] = useState<IAgentCache[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);
  const [selectRecord, setSelectRecord] = useState<IAgentCache | null>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const [showApply, setShowApply] = useState(false);
  const [curApplyId, setCurApplyId] = useState<string>('');
  const hasInitializedRef = React.useRef(false);

  const [paginationInfo, paginationDispatch] = useReducer(paginationReducer, getDefaultPagination({ pageSize: 30 }));

  const hasMore = paginationInfo.total > size(list);

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

  // const sortBySuperHelperFirst = React.useCallback((items: IAgentCache[] = []) => {
  //   return [...items].sort((a, b) => {
  //     const aIsPersonalDefault = a?.ownerType === 'personal_default' ? 2 : 0;
  //     const bIsPersonalDefault = b?.ownerType === 'personal_default' ? 2 : 0;
  //     const aIsSuper = a?.ownerType === 'personal' ? 1 : 0;
  //     const bIsSuper = b?.ownerType === 'personal' ? 1 : 0;
  //     return bIsPersonalDefault + bIsSuper - (aIsPersonalDefault + aIsSuper);
  //   });
  // }, []);

  const myQueryMyCreated = React.useCallback(
    (keyword: string | undefined, pageNum: number, catalogId?: string | number, filterParam?: IOnOkParams) => {
      if (abortControllerRef.current && !abortControllerRef.current?.signal?.aborted) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      if (pageNum === 1) {
        setList([]);
      }

      const params: Record<string, any> = {
        keyword,
        pageNum,
        pageSize: paginationInfo.pageSize,
        terminals: ['ALL', 'PC', 'APP'], // 终端类型
        ...(buildFilterParam?.('personal', filterParam) || {}),
      };

      if (catalogId !== undefined && catalogId !== null && `${catalogId}` !== '' && catalogId !== ALL_CATEGORY_KEY) {
        params.catalogId = catalogId;
      }

      return queryMyCreated(params, abortControllerRef.current)
        .then((res) => {
          const { list, ...rest } = res || {};
          if (list) {
            const mappedList = list.map((i: IAgentCache) => agentHandler(i));
            if (pageNum === 1) {
              setList(mappedList);
            } else {
              setList((prevList) => {
                return [...prevList, ...mappedList];
              });
            }

            paginationDispatch({
              type: 'change',
              item: {
                pageIndex: Number(rest.pageNum),
                total: Number(rest.total),
                pageCount: Number(rest.totalPages),
              },
            });
          }
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

      return myQueryMyCreated(keyword, pageNum, targetCatalogId, filterParam).finally(() => {
        setIsLoading(false);
      });
    },
    [curActiveLink, dropdownParam, myEmployeesTypeList, myQueryMyCreated]
  );

  React.useImperativeHandle(
    ref,
    () => ({
      getSearch,
      getCurrentCatalogId: () => (curActiveLink && curActiveLink !== ALL_CATEGORY_KEY ? curActiveLink : undefined),
    }),
    [curActiveLink, getSearch, list]
  );

  useEffect(() => {
    dispatch({
      type: 'employees/getDigitEmployDir',
    });
  }, [dispatch]);

  useEffect(() => {
    const firstEmployeesType = myEmployeesTypeList[0];
    if (!firstEmployeesType) return;

    const catalogIdFromUrl = searchParams.get('personalCatalogId');
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
    if (nextSearchParams.get('personalCatalogId') !== curActiveLink) {
      nextSearchParams.set('personalCatalogId', curActiveLink);
      setSearchParams(nextSearchParams);
    }
  }, [curActiveLink, myEmployeesTypeList, searchParams, setSearchParams]);

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
    }) => {
      const { unApplyList = [], ApplyList = [], delIdList = [], updateList = [] } = param || {};
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

  const onClickEmployee = React.useCallback(
    (employee: IAgentCache) => {
      if (employee.agentId && canJumpAgent(employee)) {
        trackerEmployeeClick(employee, 'marketAgentRedirect');
        setAgentId?.(`${employee.agentId}`);
        setSessionId?.('');
        const nextSearchParams = new URLSearchParams({
          tab: 'personal',
          personalCatalogId: curActiveLink,
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
        tab: 'personal',
        personalCatalogId: curActiveLink,
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

  const onSetDefaultAssistant = React.useCallback(
    (employee: IAgentCache) => {
      const resourceId = employee?.resourceId ?? employee?.id ?? employee?.agentId;
      if (!resourceId) return;

      setIsLoading(true);

      setDefaultDigitalEmployee({
        ownerType: 'personal_default',
        resourceId,
      })
        .then((data) => {
          if (!data) return;
          message.success(intl.formatMessage({ id: 'resource.setDefaultAssistantSuccess' }));

          getSearch(searchName || '', dropdownParam, 1, curActiveLink);

          const {
            newResourceId,
            newPersonalDefaultTagName,
            newOwnerType,
            oldResourceId,
            oldPersonalDefaultTagName,
            oldOwnerType,
          } = data;

          // 刷新数字员工前端缓存数据
          dispatch({
            type: 'employees/setDefaultEmployee',
            payload: { resourceId: `${newResourceId}` },
          });

          EventEmitter.emit('beyond-update-employee', {
            updateList: [
              {
                agentId: newResourceId,
                ownerType: newOwnerType,
                tagName: newPersonalDefaultTagName,
              },
              {
                agentId: oldResourceId,
                ownerType: oldOwnerType,
                tagName: oldPersonalDefaultTagName,
              },
            ],
          });
        })
        .catch((error: any) => {
          message.error(error?.message || error || intl.formatMessage({ id: 'common.operateFailed' }));
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [curActiveLink, dropdownParam, getSearch, searchName, EventEmitter, setIsLoading]
  );

  const onAuthEmployee = React.useCallback((employee: IAgentCache, type: 'useAuth' | 'mgrAuth') => {
    setSelectRecord(employee);
    setAuthType(type);
    setAuthDrawerOpen(true);
  }, []);

  const onApplyEmployee = React.useCallback((employee: IAgentCache) => {
    setCurApplyId(`${employee.resourceId ?? employee.id}`);
    setShowApply(true);
  }, []);

  const onAuditEmployee = React.useCallback((employee: IAgentCache) => {
    setSelectRecord(employee);
    setUseApplyAuditOpen(true);
  }, []);

  return (
    <div className="full-width full-height ub ub-ver">
      <div className={classnames('ub ub-ac gap8', styles.body)} style={{ marginBottom: '16px', minHeight: '35px' }}>
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
            nextSearchParams.set('personalCatalogId', nextActiveKey);
            setCurActiveLink(nextActiveKey);
            setSearchParams(nextSearchParams);
            getSearch(searchName || '', dropdownParam, 1, activeKey);
          }}
        />
      </div>
      <Spin
        spinning={isLoading}
        wrapperClassName={styles.spinningWrapper}
        tip={intl.formatMessage({ id: 'common.loading' })}
      >
        {isEmpty(list) ? (
          <div className="ub ub-ac ub-pc ub-ver full-height full-width">
            <Empty />
            {/* <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                sessionStorage.setItem(
                  'EmployeeDetail_prevRoute',
                  `${window.location.pathname}${window.location.search}`
                );
                navigate('/digitalEmployeesCreate?ownerType=personal');
              }}
            >
              {intl.formatMessage({ id: 'digitalEmployees.create' })}
            </Button> */}
          </div>
        ) : (
          <div className={classnames(styles.sectionsContainer, 'hideThumb ub-f1')} id="EmployeeRelatedToMeScroller">
            <InfiniteScroll
              ref={infiniteScrollRef}
              next={() => {
                myQueryMyCreated(searchName, paginationInfo.pageIndex + 1, curActiveLink, dropdownParam);
              }}
              hasMore={hasMore}
              loader={
                <div className="ub ub-ac ub-pc">
                  <Spin />
                </div>
              }
              dataLength={list.length}
              scrollableTarget="EmployeeRelatedToMeScroller"
              className={classnames(styles.messageRowWrap, { [styles.hasMore]: hasMore })}
              scrollThreshold="50px"
              hasChildren={list.length > 0}
              topItemKey={head(list)?.agentId}
              style={{
                overflow: 'visible',
              }}
            >
              <div className={styles.categorySection}>
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
                          scene: 'personal',
                          showSetDefault: true,
                          onEdit: () => onEditEmployee(employee),
                          onAuth: (type: any) => onAuthEmployee(employee, type),
                          onApplyUse: () => onApplyEmployee(employee),
                          onAuditUse: () => onAuditEmployee(employee),
                          onDelete: () => onDeleteEmployee(employee),
                          onSetDefault: () => onSetDefaultAssistant(employee),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </InfiniteScroll>
          </div>
        )}
      </Spin>
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
      <ApplyForModal
        id={curApplyId}
        visible={showApply}
        onClose={() => {
          setShowApply(false);
          setCurApplyId('');
        }}
        onSuccess={() => {
          getSearch(searchName || '', dropdownParam, 1, curActiveLink);
        }}
      />
    </div>
  );
}

export default React.forwardRef(EmployeeRelatedToMe);
