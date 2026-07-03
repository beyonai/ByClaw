import { DragType } from '@/components/QueryInput/withDrag';
import {
  parseResourceTargetContent,
  PROPERTY_RESOURCE_TYPE,
  type ResourceItem,
  type ResourceSiderType,
} from '@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem';

export const getArrayData = (response: any) => {
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data?.rows)) return response.data.rows;
  if (Array.isArray(response?.data?.list)) return response.data.list;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response)) return response;
  return [];
};

export const resourceSiderTypeByTabKey: Partial<Record<string, ResourceSiderType>> = {
  tool: 'TOOL',
  view: 'VIEW',
  object: 'OBJECT',
  skill: 'SKILL',
};

export const getEmployeeResourceQuoteType = (tabKey: string) => {
  const resourceType = resourceSiderTypeByTabKey[tabKey];
  if (resourceType === 'TOOL') return DragType.tool;
  if (resourceType === 'SKILL') return DragType.SKILL;
  if (resourceType === 'VIEW' || resourceType === 'OBJECT') return DragType.OBJECT;
  return null;
};

export const getEmployeeResourceDrillItems = (itemOrDetail: any): ResourceItem[] => {
  const targetContent = parseResourceTargetContent(itemOrDetail);
  const drillItems: ResourceItem[] = [];
  const quoteDisabled = itemOrDetail?.quoteDisabled;

  if (targetContent?.objects?.length) {
    targetContent.objects.forEach((object: any) => {
      drillItems.push({
        resourceId: object.resourceId,
        resourceName: object.resourceName,
        resourceCode: object.resourceCode,
        resourceDesc: object.resourceDesc,
        resourceBizType: 'OBJECT',
        quoteDisabled,
      });
    });
  }

  if (targetContent?.fields?.length) {
    targetContent.fields.forEach((field: any) => {
      drillItems.push({
        ...field,
        resourceId: field.propertyCode,
        resourceName: field.propertyName,
        resourceDesc: field.propertyCode,
        resourceBizType: PROPERTY_RESOURCE_TYPE,
        quoteDisabled,
      });
    });
  }

  return drillItems;
};

export const normalizeResourceItem = (item: any): ResourceItem => ({
  ...item,
  resourceId: item.resourceId ?? item.resourceSourcePkId ?? item.id ?? item.dataId ?? item.resourceCode,
  resourceName: item.resourceName || item.name || item.title || item.resourceCode || '',
  resourceDesc: item.resourceDesc || item.description || item.desc,
  resourceBizType: item.resourceBizType || item.resourceType,
  resourceSourcePkId: item.resourceSourcePkId ?? item.dataId ?? item.resourceId ?? item.id,
});

export const normalizeKnowledgeResourceItem = (item: any, options: { quoteDisabled?: boolean } = {}) => ({
  ...item,
  resourceId: item.resourceId ?? item.resourceSourcePkId ?? item.id ?? item.dataId ?? item.resourceCode,
  resourceName: item.resourceName || item.name || item.knowledgeBaseName || item.title || '',
  resourceDesc: item.resourceDesc || item.description || item.desc || item.knowledgeBaseComment || '',
  resourceBizType: item.resourceBizType || 'KG_DOC',
  resourceType: item.resourceType || item.resourceBizType || 'KG_DOC',
  resourceSourcePkId: item.resourceSourcePkId ?? item.datasetId ?? item.dataId ?? item.resourceId ?? item.id,
  quoteDisabled: options.quoteDisabled ?? item.quoteDisabled,
});
