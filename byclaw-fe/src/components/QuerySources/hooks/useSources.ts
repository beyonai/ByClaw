import { useCallback, useEffect, useState } from 'react';
import { generateUniqueId } from '@/utils/math';
import { SourceRootIdMap, SourceTreeNodeTypeMap } from '../const';
import type { SourceRootId, KnowledgeSource, SourceTreeNodeId, ISource } from '../types';
import {
  getEnterpriseKnowledgeBaseList,
  getFavoriteList,
  getPersonalKnowledgeBaseList,
  getSkillList,
} from '../services';
import { ResourceTypeMap } from '@/constants/resource';
import { debounce } from 'lodash';

const emptyArr: any[] = [];

/** 当某个分组总数量小于该阈值时，直接在树中展示；否则在树的最后一个节点展示“更多”按钮 */
export const INLINE_TREE_THRESHOLD = 20;

/** 获取技能总数量（同时会缓存完整技能列表，供后续使用） */
const getSkillListInfo = async () => {
  const result = await getSkillList();
  // TOOLKIT 是一个工具集目录，不需要在树里面展示出来
  const list = result?.list?.filter((item) => item.dataType !== ResourceTypeMap.TOOLKIT) ?? [];
  return {
    ...result,
    list,
    total: list.length,
  };
};

type UseSourcesProps = {
  setCheckedIds: React.Dispatch<React.SetStateAction<SourceTreeNodeId[]>>;
  visibleRootIds?: SourceRootId[];
  sessionId?: string;
  cacheSessionIdRef: React.RefObject<string | undefined>;
};

export const useSources = ({
  sessionId,
  setCheckedIds,
  visibleRootIds = emptyArr,
  cacheSessionIdRef,
}: UseSourcesProps) => {
  const [sources, setSources] = useState<ISource>({
    userImported: { items: [], totalCount: 0, totalItems: [] },
    favorites: { items: [], totalCount: 0, totalItems: [] },
    knowledgeBases: { items: [], totalCount: 0, totalItems: [] },
    enterpriseKnowledgeBases: { items: [], totalCount: 0, totalItems: [] },
    skills: { items: [], totalCount: 0, totalItems: [] },
  });
  const [loading, setLoading] = useState(false);

  const initGroups = debounce(async () => {
    const allGroups: SourceRootId[] = [
      SourceRootIdMap.knowledgeBases,
      SourceRootIdMap.enterpriseKnowledgeBases,
      SourceRootIdMap.skills,
      SourceRootIdMap.favorites,
    ];

    const enabledGroups = allGroups.filter((groupId) => {
      return visibleRootIds?.includes(groupId as SourceRootId);
    });

    if (enabledGroups.length === 0) {
      return;
    }

    if (!sessionId) {
      setSources((prev) => ({
        ...prev,
        [SourceRootIdMap.userImported]: {
          items: [],
          totalCount: 0,
        },
      }));
    }

    setLoading(true);
    // 并行拉取各分组统计（真实接口），items 默认置空
    type PromiseResult = {
      list: KnowledgeSource[];
      total: number;
      paged?: boolean;
      checkedIds?: SourceTreeNodeId[];
    };
    const results: PromiseResult[] = await Promise.all(
      enabledGroups.map((groupId) => {
        if (groupId === SourceRootIdMap.knowledgeBases) {
          return getPersonalKnowledgeBaseList(sessionId);
        }
        if (groupId === SourceRootIdMap.enterpriseKnowledgeBases) {
          return getEnterpriseKnowledgeBaseList(sessionId);
        }
        if (groupId === SourceRootIdMap.skills) {
          return getSkillListInfo();
        }
        if (groupId === SourceRootIdMap.favorites) {
          return getFavoriteList();
        }
        return Promise.resolve({ list: [], total: 0 });
      })
    );
    setSources((prev) => {
      const checkedIds: SourceTreeNodeId[] = [];
      const next = { ...prev };
      enabledGroups.forEach((groupId: SourceRootId, index) => {
        const result = results[index];
        const isLargeDataMode = result.paged !== false && result.total > INLINE_TREE_THRESHOLD;
        const items = result.list.slice(0, INLINE_TREE_THRESHOLD);
        if (isLargeDataMode) {
          items.push({
            id: `${SourceTreeNodeTypeMap.more}-${generateUniqueId()}`,
            title: '查看更多',
            type: SourceTreeNodeTypeMap.more,
          });
        }

        if (!sessionId) {
        } else if (result.checkedIds) {
          checkedIds.push(...result.checkedIds);
        }

        next[groupId] = {
          ...next[groupId],
          items,
          totalItems: result.list,
          totalCount: result.total,
        };
      });

      setCheckedIds(checkedIds);

      return next;
    });
    setLoading(false);
  }, 500);

  /* TODO:
    如果是搜问模式，且传入了sessionId，则需要根据sessionId查出来上一次勾选过的内容；
    如果是functioncloud，则需要查询当前用户上一次勾选过的内容
  */

  useEffect(() => {
    if (`${cacheSessionIdRef.current}` === `${sessionId}`) return;
    initGroups();
  }, [sessionId]);
  useEffect(() => {
    initGroups();
  }, [visibleRootIds]);

  const renameUserImportedNode = useCallback((nodeId: SourceTreeNodeId, newTitle: string) => {
    if (!newTitle) return;
    setSources((prev) => {
      const bucket = prev[SourceRootIdMap.userImported];
      if (!bucket) return prev;
      return {
        ...prev,
        [SourceRootIdMap.userImported]: {
          ...bucket,
          items: bucket.items.map((item) =>
            item.id === nodeId
              ? {
                ...item,
                title: newTitle,
                fileName: newTitle,
              }
              : item
          ),
        },
      };
    });
  }, []);

  const deleteUserImportedNode = useCallback(
    (nodeId: SourceTreeNodeId) => {
      setSources((prev) => {
        const bucket = prev[SourceRootIdMap.userImported];
        if (!bucket) return prev;
        const nextItems = bucket.items.filter((item) => item.id !== nodeId);
        return {
          ...prev,
          [SourceRootIdMap.userImported]: {
            ...bucket,
            items: nextItems,
            totalCount: Math.max(0, bucket.totalCount - 1),
          },
        };
      });
      setCheckedIds((prev) => prev.filter((id) => id !== nodeId));
    },
    [setCheckedIds]
  );

  return {
    sources,
    setSources,
    loading,
    renameUserImportedNode,
    deleteUserImportedNode,
  };
};
