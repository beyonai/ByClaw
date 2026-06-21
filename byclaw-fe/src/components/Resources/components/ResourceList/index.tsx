import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Spin, message } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import InfiniteScroll from '@/components/InfiniteScroll';
import Empty from '@/components/Empty';
import ResourceCard from '../ResourceCard';
import { listResourceUseAuth, deleteResource, deleteKnowledge } from '@/pages/manager/service/resources';
import { findDetailsById } from '@/pages/manager/service/DigitalEmployeeMgr';
import { useRequest } from '@/hooks/useRequest';
import useGlobal from '@/hooks/useGlobal';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import type { KnowledgeCapability } from '@/service/knowledgeCenter';
import { buildResourceListFilterParam, getBaseResourceBizTypeList } from '../../utils';
import styles from './index.module.less';

interface IResourceItem {
  resourceId: string;
  resourceName: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  avatar?: string;
  createUserName?: string;
  creatorName?: string;
  createTime?: number | string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  canEdit?: boolean;
  canManageAuth?: boolean;
  canUseAuth?: boolean;
  canDelete?: boolean;
  canApplyUse?: boolean;
  canAuditUse?: boolean;
  skillType?: string;
  sourceType?: string;
  version?: string;
  skillUrl?: string;
  skillPackageFormat?: string;
  skillOriginalFilename?: string;
  skillPackageSize?: number | string;
  skillPackageHash?: string;
  targetContent?: string;
  syncStatus?: string;
  syncError?: string;
  lastSyncTime?: string;
  useCount?: number | string;
}

interface ResourceListProps {
  resourceType: string;
  activeTab: string;
  searchValue: string;
  catalogId: string;
  dropdownParam: any;
  resourceName: string;
  knowledgeCapability?: KnowledgeCapability | null;
  knowledgeCapabilityDisabledTip?: string;
  onDetail: (item: IResourceItem) => void;
  onEdit: (item: IResourceItem) => void;
  onAuth: (item: IResourceItem, authType: 'useAuth' | 'mgrAuth') => void;
  onApplyUse: (item: IResourceItem) => void;
  onAuditUse: (item: IResourceItem) => void;
  onRefresh: () => void;
  skillCardViewMode?: 'current' | 'new';
}

const PAGE_SIZE_DEFAULT = 30;

const getSkillPosterColumnCount = (width: number) => {
  if (width >= 1680) return 5;
  if (width >= 1280) return 4;
  if (width >= 960) return 3;
  if (width >= 640) return 2;
  return 1;
};

const normalizeResponseData = (response: any) => response?.data ?? response;

const collectInstalledResourceIds = (detail: any) => {
  const installedIds = new Set<string>();
  const relResourceList = Array.isArray(detail?.relResourceList) ? detail.relResourceList : [];
  const relSkills = Array.isArray(detail?.relSkills) ? detail.relSkills : [];
  [...relResourceList, ...relSkills].forEach((item: any) => {
    const resourceId = item?.resourceId ?? item?.relResourceId ?? item?.skillId;
    if (resourceId !== undefined && resourceId !== null && `${resourceId}` !== '') {
      installedIds.add(`${resourceId}`);
    }
  });
  return installedIds;
};

const ResourceList: React.FC<ResourceListProps> = ({
  resourceType,
  activeTab,
  searchValue,
  catalogId,
  dropdownParam,
  onDetail,
  onEdit,
  onAuth,
  onApplyUse,
  onAuditUse,
  onRefresh,
  skillCardViewMode = 'current',
}) => {
  // 根据 resourceType 生成 resourceBizTypeList，使用useMemo缓存结果
  const baseResourceBizTypeList = useMemo(() => getBaseResourceBizTypeList(resourceType), [resourceType]);

  const intl = useIntl();
  const { agentInfo } = useGlobal();
  const { userInfo, defaultDigEmployeeId } = useSelector(
    ({ user, employees }: { user: any; employees: IEmployeesState }) => ({
      userInfo: user.userInfo,
      defaultDigEmployeeId: employees.defaultDigEmployeeId,
    })
  );
  const activeDigitalEmployeeId = agentInfo?.agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<IResourceItem[]>([]);
  const [installedResourceIds, setInstalledResourceIds] = useState<ReadonlySet<string>>(new Set());
  const [skillPosterColumnCount, setSkillPosterColumnCount] = useState(1);
  const skillPosterListRef = useRef<HTMLDivElement>(null);
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: PAGE_SIZE_DEFAULT,
    total: 0,
  });

  const hasMore = pageInfo.total > list.length;
  const isSkillPosterMode = resourceType === 'SKILL' && skillCardViewMode === 'new';

  const getList = useCallback(
    async (params?: Record<string, any>, append = false) => {
      const pageNum = params?.pageIndex ?? params?.pageNum ?? 1;
      const pageSize = params?.pageSize ?? 30; // 直接使用固定值，避免依赖pageInfo.pageSize
      const keyword = `${params?.searchValue ?? searchValue ?? ''}`.trim();
      const selectedCatalogId = `${params?.catalogId ?? catalogId ?? ''}`;
      const filterParam = params?.dropdownParam ?? dropdownParam;
      const requestFilterParam = buildResourceListFilterParam(activeTab, filterParam);
      setLoading(true);
      try {
        const res = await listResourceUseAuth({
          keyword,
          pageNum,
          pageSize,
          ownerType: activeTab,
          catalogId: selectedCatalogId || undefined,
          ...requestFilterParam,
          resourceBizTypeList: requestFilterParam.resourceBizTypeList?.length
            ? requestFilterParam.resourceBizTypeList
            : baseResourceBizTypeList,
        });

        const pageData = res?.data || res || {};
        const rows = ((pageData?.list || pageData?.rows || []) as IResourceItem[]).map((item) => ({
          ...item,
          resourceLogoUrl: item.resourceLogoUrl || item.avatar,
        }));
        setList((prev) => (append ? [...prev, ...rows] : rows));
        setPageInfo({
          pageNum: Number(pageData?.pageNum || pageNum || 1),
          pageSize: Number(pageData?.pageSize || pageSize || 30),
          total: Number(pageData?.total || 0),
        });
      } finally {
        setLoading(false);
      }
    },
    [activeTab, baseResourceBizTypeList, catalogId, dropdownParam, searchValue]
  );

  const { mutate: handleDel } = useRequest({
    mutationFn: (params: any) => {
      if (resourceType === 'KG_DOC') {
        return deleteKnowledge({ resourceId: params.resourceId });
      }
      return deleteResource({ resourceId: params.resourceId });
    },
    onSuccess: () => {
      message.success(intl.formatMessage({ id: 'common.deactivateSuccess' }));
      onRefresh();
    },
  });

  useEffect(() => {
    getList({ pageIndex: 1 });
  }, [baseResourceBizTypeList, activeTab, catalogId, dropdownParam, getList]);

  useEffect(() => {
    let cancelled = false;
    if (resourceType !== 'SKILL' || !activeDigitalEmployeeId) {
      setInstalledResourceIds(new Set());
      return () => {
        cancelled = true;
      };
    }
    findDetailsById({ resourceId: `${activeDigitalEmployeeId}` })
      .then((res) => {
        if (cancelled) return;
        setInstalledResourceIds(collectInstalledResourceIds(normalizeResponseData(res)));
      })
      .catch(() => {
        if (cancelled) return;
        setInstalledResourceIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [activeDigitalEmployeeId, resourceType]);

  // 监听资源操作事件，刷新列表
  useEffect(() => {
    const handleResourceChanged = () => {
      onRefresh();
    };
    window.addEventListener('resourceRestored', handleResourceChanged);
    window.addEventListener('resourceDeleted', handleResourceChanged);
    return () => {
      window.removeEventListener('resourceRestored', handleResourceChanged);
      window.removeEventListener('resourceDeleted', handleResourceChanged);
    };
  }, [onRefresh]);

  useEffect(() => {
    const handleResourceInstalled = (event: Event) => {
      const resourceId = (event as CustomEvent<{ resourceId?: string | number }>).detail?.resourceId;
      if (resourceType !== 'SKILL' || resourceId === undefined || resourceId === null || `${resourceId}` === '') {
        return;
      }
      setInstalledResourceIds((prev) => {
        const next = new Set(prev);
        next.add(`${resourceId}`);
        return next;
      });
    };
    window.addEventListener('digitalEmployeeResourceInstalled', handleResourceInstalled);
    return () => {
      window.removeEventListener('digitalEmployeeResourceInstalled', handleResourceInstalled);
    };
  }, [resourceType]);

  useEffect(() => {
    if (!isSkillPosterMode) {
      setSkillPosterColumnCount(1);
      return undefined;
    }

    const target = skillPosterListRef.current;
    let rafId = 0;
    let timerId = 0;

    const updateColumnCount = () => {
      window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        const width =
          skillPosterListRef.current?.clientWidth ||
          skillPosterListRef.current?.parentElement?.clientWidth ||
          window.innerWidth;
        setSkillPosterColumnCount(getSkillPosterColumnCount(width));
      });
    };

    updateColumnCount();
    timerId = window.setTimeout(updateColumnCount, 80);

    if (!target || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateColumnCount);
      return () => {
        window.cancelAnimationFrame(rafId);
        window.clearTimeout(timerId);
        window.removeEventListener('resize', updateColumnCount);
      };
    }

    const resizeObserver = new ResizeObserver(updateColumnCount);
    resizeObserver.observe(target);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      resizeObserver.disconnect();
    };
  }, [isSkillPosterMode, list.length, loading]);

  const skillPosterColumns = useMemo(() => {
    const columns = Array.from({ length: skillPosterColumnCount }, () => [] as IResourceItem[]);
    list.forEach((item, index) => {
      columns[index % skillPosterColumnCount].push(item);
    });
    return columns;
  }, [list, skillPosterColumnCount]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    // 直接使用当前的pageInfo状态，避免将其作为依赖项
    getList(
      {
        pageNum: pageInfo.pageNum + 1,
        pageSize: pageInfo.pageSize,
        searchValue,
        catalogId,
      },
      true
    );
  }, [catalogId, getList, hasMore, loading, pageInfo.pageNum, pageInfo.pageSize, searchValue]);

  // 获取滚动区域的ID
  const getScrollableTarget = useMemo(() => {
    return `${resourceType}ListScroller`;
  }, [resourceType]);

  const renderResourceCard = (item: IResourceItem) => (
    <ResourceCard
      key={item.resourceId}
      resource={item}
      resourceType={resourceType}
      variant={isSkillPosterMode ? 'skillPoster' : 'default'}
      onCardClick={() => onDetail(item)}
      actionConfig={{
        scene: activeTab === 'personal' ? 'personal' : 'enterprise',
        installedResourceIds,
        onEdit: () => onEdit(item),
        onAuth: (authType) => onAuth(item, authType),
        onApplyUse: () => onApplyUse(item),
        onAuditUse: () => onAuditUse(item),
        onDelete: () => handleDel(item),
      }}
    />
  );

  return (
    <div id={getScrollableTarget} className={styles.sectionsContainer}>
      <Spin
        wrapperClassName={styles.spinningWrapper}
        tip={intl.formatMessage({ id: 'common.loading' })}
        spinning={loading}
      >
        {!loading && list.length === 0 && (
          <div className={styles.emptyWrap}>
            <Empty description={intl.formatMessage({ id: 'common.noData' })} />
          </div>
        )}

        {list.length > 0 && (
          <InfiniteScroll
            next={loadMore}
            hasMore={hasMore}
            loader={
              <div className="ub ub-ac ub-pc">
                <Spin />
              </div>
            }
            dataLength={list.length}
            scrollableTarget={getScrollableTarget}
            className={styles.messageRowWrap}
            scrollThreshold="50px"
            hasChildren={list.length > 0}
            style={{
              overflow: 'visible',
            }}
          >
            <div className={styles.categorySection}>
              <div
                ref={skillPosterListRef}
                className={isSkillPosterMode ? styles.skillPosterList : styles.employeeList}
                style={
                  isSkillPosterMode
                    ? ({ '--skill-poster-column-count': skillPosterColumnCount } as React.CSSProperties)
                    : undefined
                }
              >
                {isSkillPosterMode &&
                  skillPosterColumns.map((columnItems, columnIndex) => (
                    <div className={styles.skillPosterColumn} key={`skill-poster-column-${columnIndex}`}>
                      {columnItems.map((item) => renderResourceCard(item))}
                    </div>
                  ))}
                {!isSkillPosterMode && list.map((item) => renderResourceCard(item))}
              </div>
            </div>
          </InfiniteScroll>
        )}
      </Spin>
    </div>
  );
};

export default ResourceList;
