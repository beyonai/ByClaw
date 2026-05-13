import {
  SourceTreeNodeType,
  KnowledgeSource,
  WebSearchResource,
  SourceRootId,
  SourceTreeNodeId,
  ISource,
} from './types';
import { SourceRootIdMap, SourceTreeNodeTypeMap } from './const';
import { agentTypeMap } from '@/constants/agent';
import { ResourceTypeMap } from '@/constants/resource';

export function isSeachQueryMode(agentType?: string) {
  return agentType === agentTypeMap.searchAndQuery;
}

export function isFunctionCloudMode(agentType?: string) {
  return agentType === agentTypeMap.functionCloud;
}

export function getSourceRootIdBySourceTreeNodeType(SourceTreeNodeType: SourceTreeNodeType) {
  switch (SourceTreeNodeType) {
    case SourceTreeNodeTypeMap.knowledgeBase:
      return SourceRootIdMap.knowledgeBases;
    case SourceTreeNodeTypeMap.enterpriseKnowledgeBase:
      return SourceRootIdMap.enterpriseKnowledgeBases;
    case SourceTreeNodeTypeMap.skill:
      return SourceRootIdMap.skills;
    case SourceTreeNodeTypeMap.favorite:
      return SourceRootIdMap.favorites;
    case SourceTreeNodeTypeMap.file:
    case SourceTreeNodeTypeMap.webSearch:
      return SourceRootIdMap.userImported;
    default:
      return '';
  }
}

export function getSourceRootIdByNodeId(id: SourceTreeNodeId): SourceRootId | '' {
  const type = id.split('-')[0];

  return getSourceRootIdBySourceTreeNodeType(type as SourceTreeNodeType);
}

export function getKnowledgeSourceId(sourceItem: any, type: SourceTreeNodeType): KnowledgeSource['id'] {
  return `${type}-${sourceItem.dataId}`;
}

export function getKnowledgeResourceMapper(type: SourceTreeNodeType) {
  return (item: any) =>
    ({
      ...item,
      type,
      id: getKnowledgeSourceId(item, type),
      title: item.name,
    } as KnowledgeSource);
}

export function getWebSearchSourceId(result: WebSearchResource): KnowledgeSource['id'] {
  return `${SourceTreeNodeTypeMap.webSearch}-${result.docArchiveId}`;
}

export function getWebSearchSourceMapper(result: WebSearchResource) {
  return {
    ...result,
    type: SourceTreeNodeTypeMap.webSearch,
    id: getWebSearchSourceId(result),
  } as KnowledgeSource;
}

export function getFavoriteSourceMapper(result: { dataId: number; name: string }) {
  return {
    ...result,
    type: SourceTreeNodeTypeMap.favorite,
    id: `${SourceTreeNodeTypeMap.favorite}-${result.dataId}`,
    title: result.name,
  } as KnowledgeSource;
}

export function getSkillNodeIconType(skillItem: KnowledgeSource) {
  if (skillItem.dataType === ResourceTypeMap.MCP) {
    return 'icon-disanfang';
  }
  return 'icon-chajian';
}

export function getBusinessIdByNodeId(nodeId: SourceTreeNodeId) {
  return nodeId.split('-')[1];
}

export function getDirTypeByRootId(
  rootId: Extract<SourceRootId, 'knowledgeBases' | 'enterpriseKnowledgeBases' | 'skills'>
) {
  switch (rootId) {
    case SourceRootIdMap.knowledgeBases:
      return 'PERSONAL_KB';
    case SourceRootIdMap.enterpriseKnowledgeBases:
      return 'ENTERPRISE_KB';
    case SourceRootIdMap.skills:
      return 'SKILL';
    default:
      return '';
  }
}

export function getDirTypeByNodeId(nodeId: SourceTreeNodeId) {
  const type = nodeId.split('-')[0];
  switch (type) {
    case SourceTreeNodeTypeMap.knowledgeBase:
      return 'PERSONAL_KB';
    case SourceTreeNodeTypeMap.enterpriseKnowledgeBase:
      return 'ENTERPRISE_KB';
    case SourceTreeNodeTypeMap.skill:
      return 'SKILL';
    case SourceTreeNodeTypeMap.file:
      return 'IMPORT';
    case SourceTreeNodeTypeMap.webSearch:
      return 'WEB_SEARCH';
    case SourceTreeNodeTypeMap.favorite:
      return 'COLLECT';
    default:
      return '';
  }
}

/**
 * 根据当前树数据，从已勾选的 ID 中筛选出对应的 sourceData 列表
 * @param checkedIds 已勾选的节点ID列表
 * @param source 所有来源数据
 * @returns 匹配到的知识来源列表
 */
export const getCheckedSourcesBySource = (checkedIds: SourceTreeNodeId[], source: ISource): KnowledgeSource[] => {
  if (!checkedIds.length || !source) {
    return [];
  }

  const result: KnowledgeSource[] = [];

  checkedIds.forEach((nodeId) => {
    const sourceRootId = getSourceRootIdByNodeId(nodeId);
    if (!sourceRootId) {
      return;
    }
    const bucket = source[sourceRootId];
    if (!bucket) {
      return;
    }

    const targetItem = bucket.totalItems?.find((item) => item.id === nodeId);

    if (targetItem) {
      result.push(targetItem);
    }
  });

  return result;
};

export const filterCheckedSourcesByVisibleRootIds = (
  checkedIds: SourceTreeNodeId[],
  visibleRootIds: SourceRootId[]
): SourceTreeNodeId[] => {
  return checkedIds.filter((nodeId) => {
    const sourceRootId = getSourceRootIdByNodeId(nodeId);
    return visibleRootIds.includes(sourceRootId as SourceRootId);
  });
};
