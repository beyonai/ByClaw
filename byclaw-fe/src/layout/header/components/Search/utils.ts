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

  if (targetContent?.objects?.length) {
    targetContent.objects.forEach((object: any) => {
      drillItems.push({
        resourceId: object.resourceId,
        resourceName: object.resourceName,
        resourceCode: object.resourceCode,
        resourceDesc: object.resourceDesc,
        resourceBizType: 'OBJECT',
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
      });
    });
  }

  return drillItems;
};

export const normalizeResourceItem = (item: any): ResourceItem => ({
  ...item,
  resourceId: item.resourceId ?? item.resourceSourcePkId ?? item.resourceCode,
  resourceName: item.resourceName || item.name || item.resourceCode || '',
  resourceDesc: item.resourceDesc || item.description,
});
