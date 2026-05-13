import useGlobal from '@/hooks/useGlobal';
import { concat, head } from 'lodash';
import { useState, useCallback } from 'react';
import { useDispatch } from '@umijs/max';
import { SourceRootId, SourceTreeNodeId, SourceTreeNode } from '../types';
import { SourceRootIdMap } from '../const';
import { getBusinessIdByNodeId, getDirTypeByNodeId, getDirTypeByRootId } from '../utils';
import { addSelectedResource, batchSaveSelectedResources, removeSelectedResource } from '../services';

export default function useCheck({ cacheSessionIdRef }: { cacheSessionIdRef: React.RefObject<string | undefined> }) {
  const dispatch = useDispatch();
  const { sessionId, agentId, setSessionId } = useGlobal();

  /** 已勾选的来源ID */
  const [checkedIds, setCheckedIds] = useState<SourceTreeNodeId[]>([]);

  /**
   * 处理来源勾选变化
   */
  const handleCheckChange = useCallback(
    (sourceTreeNode: SourceTreeNode | SourceTreeNode[], checked: boolean, rootId: SourceRootId) => {
      let originalCheckedIds: SourceTreeNodeId[] | undefined;

      const ids = concat([], sourceTreeNode).map((item) => item.id as SourceTreeNodeId);
      const isFromRootNode = Array.isArray(sourceTreeNode);

      setCheckedIds((prev) => {
        originalCheckedIds = prev;

        if (checked) {
          return [...new Set([...prev, ...ids])];
        }
        return prev.filter((item) => !ids.includes(item));
      });
      const onApiSuccess = (newSessionId: string) => {
        if (newSessionId && `${newSessionId}` !== `${sessionId}`) {
          dispatch({
            type: 'session/addSession',
            payload: {
              sessionId: `${newSessionId}`,
              sessionName: `搜问新会话_${new Date().getTime()}`,
            },
          });
          setSessionId?.(`${newSessionId}`);
          cacheSessionIdRef.current = `${newSessionId}`;
        }
        originalCheckedIds = undefined;
      };
      const onApiError = () => {
        if (originalCheckedIds) {
          setCheckedIds(originalCheckedIds);
        }
        originalCheckedIds = undefined;
      };
      if (isFromRootNode && checked) {
        if (
          [SourceRootIdMap.knowledgeBases, SourceRootIdMap.enterpriseKnowledgeBases, SourceRootIdMap.skills].includes(
            rootId
          )
        ) {
          const dirType = getDirTypeByRootId(
            rootId as Extract<SourceRootId, 'knowledgeBases' | 'enterpriseKnowledgeBases' | 'skills'>
          );
          batchSaveSelectedResources({
            agentId,
            sessionId,
            dirType,
            resourceIds: checked ? ids.map((item) => getBusinessIdByNodeId(item)) : [],
          }).then(onApiSuccess, onApiError);
        } else {
          const dirTypeMap: Record<string, string[]> = {};
          ids.forEach((item) => {
            const dirType = getDirTypeByNodeId(item);
            const businessId = getBusinessIdByNodeId(item);
            if (!businessId) {
              return;
            }
            if (!dirTypeMap[dirType]) {
              dirTypeMap[dirType] = [];
            }
            dirTypeMap[dirType].push(businessId);
          });

          Object.entries(dirTypeMap).forEach(([dirType, dataIds]) => {
            const api = checked ? addSelectedResource : removeSelectedResource;
            api({
              sessionId,
              agentId,
              dirType,
              spaceDataList: dataIds.map((dataId) => ({
                dataType: 'RESOURCE',
                dataId,
              })),
            }).then(onApiSuccess, onApiError);
          });
        }
        return;
      }

      const payload = {
        sessionId,
        agentId,
        spaceDataList: concat([], sourceTreeNode).map((item) => {
          return {
            dataType: item.sourceData?.dataType,
            dataId: getBusinessIdByNodeId(item.id as SourceTreeNodeId),
          };
        }),
        dirType: getDirTypeByNodeId(head(ids) as SourceTreeNodeId),
      };

      if (checked) {
        addSelectedResource(payload).then(onApiSuccess, onApiError);
      } else {
        removeSelectedResource(payload).then(onApiSuccess, onApiError);
      }
    },
    [agentId, sessionId, setSessionId]
  );

  return {
    checkedIds,
    setCheckedIds,
    handleCheckChange,
  };
}
