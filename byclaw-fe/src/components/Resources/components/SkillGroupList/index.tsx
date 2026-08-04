import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import { useIntl } from '@umijs/max';
import InfiniteScroll from '@/components/InfiniteScroll';
import useGlobal from '@/hooks/useGlobal';
import { pageSkillGroups } from '@/pages/manager/service/resources';
import type { SkillGroup } from '@/pages/manager/service/resources';
import SkillGroupCard from '../SkillGroupCard';
import styles from './index.module.less';

const PAGE_SIZE = 20;
export const SKILL_GROUP_SCROLL_TARGET_ID = 'skill-group-list-scroll-target';

export interface SkillGroupListProps {
  keyword?: string;
  activeDigitalEmployeeId?: string;
  ownerType?: string;
  resourceStatus?: number | string;
  catalogId?: string;
  onOpenDetail?: (group: SkillGroup) => void;
}

export interface NormalizedSkillGroupPage {
  rows: SkillGroup[];
  pageNum: number;
  total: number;
  totalPages: number;
}

export const getSkillGroupResourceId = (group: SkillGroup): string | null => {
  if (group.resourceId === undefined || group.resourceId === null) return null;
  const resourceId = `${group.resourceId}`.trim();
  return resourceId || null;
};

export const mergeSkillGroups = (current: SkillGroup[], incoming: SkillGroup[]): SkillGroup[] => {
  const seenIds = new Set<string>();
  return [...current, ...incoming].filter((group) => {
    const resourceId = getSkillGroupResourceId(group);
    if (!resourceId) return false;
    if (seenIds.has(resourceId)) return false;
    seenIds.add(resourceId);
    return true;
  });
};

export const isSkillGroupRequestActive = (mounted: boolean, generation: number, currentGeneration: number) =>
  mounted && generation === currentGeneration;

export const normalizeSkillGroupPage = (response: any, requestedPage = 1): NormalizedSkillGroupPage => {
  const page = response?.data ?? response ?? {};
  const rows = Array.isArray(page?.list) ? page.list : Array.isArray(page?.rows) ? page.rows : [];
  const pageNum = Number(page?.pageNum ?? page?.pageIndex ?? requestedPage) || requestedPage;
  const total = Number(page?.total ?? rows.length) || 0;
  const pageSize = Number(page?.pageSize ?? PAGE_SIZE) || PAGE_SIZE;
  const totalPages = Number(page?.totalPages ?? page?.pages ?? Math.ceil(total / pageSize)) || 0;
  return { rows, pageNum, total, totalPages };
};

const SkillGroupList: React.FC<SkillGroupListProps> = ({
  keyword = '',
  activeDigitalEmployeeId,
  ownerType,
  resourceStatus,
  catalogId,
  onOpenDetail,
}) => {
  const intl = useIntl();
  const { agentId, EventEmitter } = useGlobal();
  const [groups, setGroups] = useState<SkillGroup[]>([]);
  const [page, setPage] = useState({ pageNum: 0, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const digitalEmployeeId = `${activeDigitalEmployeeId ?? agentId ?? ''}`;

  const loadPage = useCallback(
    async (pageNum: number, append: boolean, generation = requestGenerationRef.current) => {
      if (append && loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(false);
      try {
        const response = await pageSkillGroups({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: keyword.trim() || undefined,
          ownerType,
          resourceStatus,
          catalogId,
        });
        const next = normalizeSkillGroupPage(response, pageNum);
        if (!isSkillGroupRequestActive(mountedRef.current, generation, requestGenerationRef.current)) return;
        setGroups((current) => (append ? mergeSkillGroups(current, next.rows) : mergeSkillGroups([], next.rows)));
        setPage({ pageNum: next.pageNum, total: next.total, totalPages: next.totalPages });
      } catch {
        if (!isSkillGroupRequestActive(mountedRef.current, generation, requestGenerationRef.current)) return;
        setError(true);
        if (!append) setGroups([]);
      } finally {
        if (isSkillGroupRequestActive(mountedRef.current, generation, requestGenerationRef.current)) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [catalogId, keyword, ownerType, resourceStatus]
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    },
    []
  );

  useEffect(() => {
    requestGenerationRef.current += 1;
    const generation = requestGenerationRef.current;
    setGroups([]);
    setPage({ pageNum: 0, total: 0, totalPages: 0 });
    void loadPage(1, false, generation);
  }, [loadPage]);

  const handleOpen = (group: SkillGroup) => {
    const groupId = `${group.resourceId}`;
    const title = group.resourceName;
    EventEmitter.emit('beyond-absolute-driver-message', { groupId, digitalEmployeeId });
    EventEmitter.emit('beyond-absolute-driver-open-type', { drawerType: 'skillGroupDetail', title });
    onOpenDetail?.(group);
  };

  const hasMore = page.totalPages ? page.pageNum < page.totalPages : groups.length < page.total;
  const empty = !loading && !error && groups.length === 0;

  return (
    <div className={styles.wrapper}>
      <div id={SKILL_GROUP_SCROLL_TARGET_ID} className={styles.scrollTarget}>
        {loading && groups.length === 0 ? <Spin data-testid="skill-group-loading" /> : null}
        {error ? (
          <div data-testid="skill-group-error">{intl.formatMessage({ id: 'common.operationFailed' })}</div>
        ) : null}
        {empty ? <div data-testid="skill-group-empty">{intl.formatMessage({ id: 'common.none' })}</div> : null}
        <InfiniteScroll
          dataLength={groups.length}
          next={() => loadPage(page.pageNum + 1, true)}
          hasMore={hasMore}
          loader={loading ? <Spin size="small" /> : null}
          scrollableTarget={SKILL_GROUP_SCROLL_TARGET_ID}
          endMessage={null}
        >
          <div className={styles.grid}>
            {groups.map((group) => (
              <SkillGroupCard key={`${group.resourceId}`} group={group} onClick={handleOpen} />
            ))}
          </div>
        </InfiniteScroll>
      </div>
    </div>
  );
};

export default SkillGroupList;
