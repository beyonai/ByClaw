import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { Spin } from 'antd';
import { useIntl } from '@umijs/max';
import InfiniteScroll from '@/components/InfiniteScroll';
import Empty from '@/components/Empty';
import ResourceCard from '../ResourceCard';
import { listResourceUseAuth, deleteResource, deleteKnowledge } from '@/pages/manager/service/resources';
import { useRequest } from '@/hooks/useRequest';
import type { KnowledgeCapability } from '@/service/knowledgeCenter';
import { buildResourceListFilterParam, getBaseResourceBizTypeList } from '../../utils';
import styles from './index.module.less';

interface IResourceItem {
  resourceId: string;
  resourceName: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  createUserName?: string;
  createTime?: number | string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  canEdit?: boolean;
  canManageAuth?: boolean;
  canUseAuth?: boolean;
  canDelete?: boolean;
  canApplyUse?: boolean;
  canAuditUse?: boolean;
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
}

const PAGE_SIZE_DEFAULT = 30;

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
}) => {
  // 根据 resourceType 生成 resourceBizTypeList，使用useMemo缓存结果
  const baseResourceBizTypeList = useMemo(() => getBaseResourceBizTypeList(resourceType), [resourceType]);

  const intl = useIntl();
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<IResourceItem[]>([]);
  const [pageInfo, setPageInfo] = useState({
    pageNum: 1,
    pageSize: PAGE_SIZE_DEFAULT,
    total: 0,
  });

  const hasMore = pageInfo.total > list.length;

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
        const rows = (pageData?.list || pageData?.rows || []) as IResourceItem[];
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
      import('antd').then(({ message }) => {
        message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
        onRefresh();
      });
    },
  });

  useEffect(() => {
    getList({ pageIndex: 1 });
  }, [baseResourceBizTypeList, activeTab, catalogId, dropdownParam, getList]);

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

  return (
    <div id={getScrollableTarget} className={styles.scrollArea}>
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
            className={styles.infiniteScroll}
            scrollThreshold="80px"
            hasChildren={list.length > 0}
          >
            <div className={styles.cardGrid}>
              {list.map((item) => (
                <ResourceCard
                  key={item.resourceId}
                  resource={item}
                  resourceType={resourceType}
                  onCardClick={() => onDetail(item)}
                  actionConfig={{
                    scene: activeTab === 'personal' ? 'personal' : 'enterprise',
                    onEdit: () => onEdit(item),
                    onAuth: (authType) => onAuth(item, authType),
                    onApplyUse: () => onApplyUse(item),
                    onAuditUse: () => onAuditUse(item),
                    onDelete: () => handleDel(item),
                  }}
                />
              ))}
            </div>
          </InfiniteScroll>
        )}
      </Spin>
    </div>
  );
};

export default ResourceList;
