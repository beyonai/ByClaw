import { useCallback } from 'react';
import { extractResourceIds, getResourceListByResourceIds } from './utils';

export default function useQryResourceList() {
  return useCallback(async (richText: string, debounced?: boolean) => {
    const resourceIds = extractResourceIds(richText);
    if (!resourceIds.length) {
      return [];
    }
    try {
      const res = await getResourceListByResourceIds(resourceIds, debounced);
      return res;
    } catch (error) {
      console.error('获取资源列表失败:', error);
      return [];
    }
  }, []);
}
