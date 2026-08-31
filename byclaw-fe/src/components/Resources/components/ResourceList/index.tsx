import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { Spin, message } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import InfiniteScroll from '@/components/InfiniteScroll';
import Empty from '@/components/Empty';
import ResourceCard from '../ResourceCard';
import {
  listResourceUseAuth,
  deleteResource,
  deleteKnowledge,
  queryWorkspacePersonalSkillList,
} from '@/pages/manager/service/resources';
import { findDetailsById } from '@/pages/manager/service/DigitalEmployeeMgr';
import { useRequest } from '@/hooks/useRequest';
import useGlobal from '@/hooks/useGlobal';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import type { KnowledgeCapability } from '@/service/knowledgeCenter';
import { buildResourceListFilterParam, getBaseResourceBizTypeList } from '../../utils';
import { isWorkspaceSkill, mapWorkspaceSkillRows } from '../../workspaceSkill/utils';
import { useDigitalEmployeeManagePermission } from '../../workspaceSkill/useDigitalEmployeeManagePermission';
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
  ownerType?: string;
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
const WIDE_CARD_RESOURCE_TYPES = new Set(['KG_DOC', 'TOOL']);

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
  const { agentId, agentInfo } = useGlobal();
  const { userInfo, defaultDigEmployeeId } = useSelector(
    ({ user, employees }: { user: any; employees: IEmployeesState }) => ({
      userInfo: user.userInfo,
      defaultDigEmployeeId: employees.defaultDigEmployeeId,
    })
  );
  const activeDigitalEmployeeId =
    agentId || agentInfo?.agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;
  const userCode = userInfo?.userCode;
  // 通过 ref 读取，避免把 activeDigitalEmployeeId/userCode 放进 getList 依赖；
  // 否则切换数字员工会让所有资源类型(含 KG_DOC/TOOL/...)的列表都触发一次冗余刷新。
  const activeDigitalEmployeeIdRef = useRef(activeDigitalEmployeeId);
  activeDigitalEmployeeIdRef.current = activeDigitalEmployeeId;
  const userCodeRef = useRef(userCode);
  userCodeRef.current = userCode;
  // 工作空间技能删除入口需当前用户对该数字员工有管理权限，无权限时隐藏（后端同样会拦截）。
  const canManageActiveEmployee = useDigitalEmployeeManagePermission(
    resourceType === 'SKILL' ? activeDigitalEmployeeId : undefined
  );
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<IResourceItem[]>([]);
  const [installedResourceIds, setInstalledResourceIds] = useState<ReadonlySet<string>>(new Set());
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: PAGE_SIZE_DEFAULT,
    total: 0,
  });

  // 工作空间技能不计入分页 total（它来自独立接口、仅首页追加），
  // hasMore 只按已加载的“已资源化技能”数量与 total 比较，避免提前判定到底而漏翻页。
  const loadedResourcedCount = useMemo(() => list.filter((item) => !isWorkspaceSkill(item)).length, [list]);
  const hasMore = pageInfo.total > loadedResourcedCount;
  const isSkillPosterMode = resourceType === 'SKILL' && skillCardViewMode === 'new';
  // 知识和工具卡片信息较多，尤其右侧资源面板打开时，需要减少列数以保证名称和描述可读。
  const useWideCardLayout = WIDE_CARD_RESOURCE_TYPES.has(resourceType);

  const getList = useCallback(
    async (params?: Record<string, any>, append = false) => {
      const pageNum = params?.pageIndex ?? params?.pageNum ?? 1;
      const pageSize = params?.pageSize ?? 30; // 直接使用固定值，避免依赖pageInfo.pageSize
      const keyword = `${params?.searchValue ?? searchValue ?? ''}`.trim();
      const selectedCatalogId = `${params?.catalogId ?? catalogId ?? ''}`;
      const filterParam = params?.dropdownParam ?? dropdownParam;
      setLoading(true);
      try {
        // “我可用的”包含当前用户创建及被授权的全部资源，不限定 owner_type；
        // “官方推荐”沿用企业资源口径。
        const ownerTypes = activeTab === 'installed' ? ['personal', 'enterprise'] : [activeTab];
        const responses = await Promise.all(
          ownerTypes.map(async (ownerType) => {
            const ownerFilterParam = buildResourceListFilterParam(ownerType, filterParam);
            const response = await listResourceUseAuth({
              keyword,
              pageNum,
              pageSize,
              ...(activeTab === 'personal' ? {} : { ownerType }),
              catalogId: selectedCatalogId || undefined,
              ...ownerFilterParam,
              resourceBizTypeList: ownerFilterParam.resourceBizTypeList?.length
                ? ownerFilterParam.resourceBizTypeList
                : baseResourceBizTypeList,
            });
            return { ownerType, pageData: response?.data || response || {} };
          })
        );

        const rows = responses.flatMap(({ ownerType, pageData }) =>
          ((pageData?.list || pageData?.rows || []) as IResourceItem[]).map((item) => ({
            ...item,
            ownerType: item.ownerType || ownerType,
            resourceLogoUrl: item.resourceLogoUrl || item.avatar,
          }))
        );
        const total = responses.reduce((sum, { pageData }) => sum + Number(pageData?.total || 0), 0);

        // 个人技能 tab 首页追加“用户开发(工作空间)技能”。仅在第一页、无目录筛选时拉取，
        // 翻页只走 listResourceUseAuth；后端已按个人已资源化技能去重，前端无需再去重。
        let workspaceRows: IResourceItem[] = [];
        const shouldLoadWorkspaceSkills =
          resourceType === 'SKILL' &&
          (activeTab === 'personal' || activeTab === 'installed') &&
          !append &&
          pageNum === 1 &&
          !selectedCatalogId;
        if (shouldLoadWorkspaceSkills && activeDigitalEmployeeIdRef.current) {
          try {
            const workspaceRes = await queryWorkspacePersonalSkillList({
              keyword,
              resourceId: `${activeDigitalEmployeeIdRef.current}`,
              userCode: userCodeRef.current,
            });
            const workspaceData = (workspaceRes as any)?.data ?? workspaceRes;
            workspaceRows = mapWorkspaceSkillRows(
              Array.isArray(workspaceData) ? workspaceData : workspaceData?.list || workspaceData?.rows || []
            ) as IResourceItem[];
          } catch (error) {
            console.warn('query workspace personal skills failed', error);
          }
        }

        const nextRows = workspaceRows.length ? [...workspaceRows, ...rows] : rows;
        setList((prev) => {
          const mergedRows = append ? [...prev, ...rows] : nextRows;
          return Array.from(
            new Map(mergedRows.map((item) => [`${item.ownerType || ''}:${item.resourceId}`, item])).values()
          );
        });
        setPageInfo({
          pageNum,
          pageSize,
          total,
        });
      } finally {
        setLoading(false);
      }
    },
    [activeTab, baseResourceBizTypeList, catalogId, dropdownParam, resourceType, searchValue]
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
        scene: item.ownerType === 'personal' || activeTab === 'personal' ? 'personal' : 'enterprise',
        installedResourceIds,
        canManageWorkspaceSkill: canManageActiveEmployee,
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
                className={
                  isSkillPosterMode
                    ? styles.skillPosterList
                    : [styles.employeeList, useWideCardLayout ? styles.wideResourceList : ''].filter(Boolean).join(' ')
                }
              >
                {list.map((item) => renderResourceCard(item))}
              </div>
            </div>
          </InfiniteScroll>
        )}
      </Spin>
    </div>
  );
};

export default ResourceList;
