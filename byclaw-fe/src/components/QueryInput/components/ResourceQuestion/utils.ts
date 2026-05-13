import { RichInputResourceList } from '../../RichInput';
import { POST } from '@/service/common/request';
import { getChatResourceId } from '../../RichInput/utils';
import { IResourceType } from '../../RichInput/types';

// 防抖相关的状态
let debounceTimer: NodeJS.Timeout | null = null;
const pendingResourceIds = new Set<string>();
let pendingResolvers: Array<{
  resolve: (value: any[]) => void;
  reject: (reason?: any) => void;
}> = [];

// 缓存 resourceId -> ResourceItem
const resourceCache: Record<string, RichInputResourceList[0]> = {};

/**
 * 实际执行请求的函数
 */
async function executeRequest(resourceIds: string[]) {
  try {
    const res = await POST<{
      data: {
        resourceId: string;
        resourceName: string;
        resourceBizType: string; // 这个就是ResourceList中的resourceType
        avatar?: string;
      }[];
    }>('/byaiService/new/resource/queryResourceDetailListByIds', { resourceIds });
    return res.data || [];
  } catch (error) {
    console.error('获取资源列表失败:', error);
    return [];
  }
}

/**
 * 防抖版本的请求函数
 * 在 500ms 内收集所有的 resourceIds，合并去重后一次性发送请求
 */
function debouncedRequest(resourceIds: string[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    // 将新的 resourceIds 添加到待处理集合中
    resourceIds.forEach((id) => pendingResourceIds.add(id));

    // 保存 resolve 和 reject 函数
    pendingResolvers.push({ resolve, reject });

    // 清除之前的定时器
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    // 设置新的定时器
    debounceTimer = setTimeout(async () => {
      // 获取所有待处理的 resourceIds（去重后）
      const idsToRequest = Array.from(pendingResourceIds);

      // 清空待处理集合
      pendingResourceIds.clear();

      // 保存所有的 resolvers
      let resolvers = [...pendingResolvers];
      pendingResolvers = [];

      // 清空定时器引用
      debounceTimer = null;

      if (idsToRequest.length === 0) {
        // 如果没有需要请求的 IDs，直接返回空数组
        resolvers.forEach(({ resolve }) => resolve([]));
        return;
      }

      try {
        // 执行请求
        const result = await executeRequest(idsToRequest);
        // 所有等待的 Promise 都返回相同的结果
        resolvers.forEach(({ resolve }) => resolve(result));
      } catch (error) {
        // 如果请求失败，所有等待的 Promise 都 reject
        resolvers.forEach(({ reject }) => reject(error));
      } finally {
        resolvers = [];
      }
    }, 500);
  });
}

async function qryResourceListByIds(resourceIds: string[], debounced?: boolean) {
  if (debounced) {
    return debouncedRequest(resourceIds);
  }
  return executeRequest(resourceIds);
}

/**
 * 从 resourceType_resourceId 格式的字符串中提取 resourceId
 * @param part resourceType_resourceId 格式的字符串
 * @returns resourceId，如果格式不正确则返回 null
 */
const extractResourceIdFromPart = (part: string): string | null => {
  const parts = part.split('_');
  if (parts.length >= 2) {
    // 处理可能有多个下划线的情况，最后一个部分是 resourceId，前面的是 resourceType
    return parts[parts.length - 1];
  }
  return null;
};

export const extractResourceIds = (text: string): string[] => {
  // 使用正则表达式提取所有 {{...}} 格式的内容
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = Array.from(text.matchAll(regex));

  if (matches.length === 0) {
    return [];
  }

  // 解析出所有的 resourceId
  const resourceIds = new Set<string>();

  matches.forEach((match) => {
    const content = match[1]; // 获取 {{}} 里面的内容

    // 支持两种格式：
    // 1. resourceType_resourceId
    // 2. resourceType_resourceId#resourceType_resourceId (通过 # 拼接两部分)

    // 先按 # 分割，处理可能存在的拼接情况
    const parts = content.split('#');

    parts.forEach((part) => {
      const resourceId = extractResourceIdFromPart(part.trim());
      if (resourceId) {
        resourceIds.add(resourceId);
      }
    });
  });

  return Array.from(resourceIds);
};

export async function getResourceListByResourceIds(
  resourceIds: string[],
  debounced?: boolean
): Promise<RichInputResourceList> {
  if (!resourceIds.length) {
    return [];
  }

  // 已缓存的直接使用，未缓存的再请求
  const idsToFetch = resourceIds.filter((id) => !resourceCache[id]);

  if (idsToFetch.length) {
    const resourceDataList = await qryResourceListByIds(idsToFetch, debounced);

    resourceDataList.forEach((item) => {
      const resourceType = item.resourceBizType as IResourceType;
      resourceCache[item.resourceId] = {
        resourceType,
        id: getChatResourceId(item.resourceId, resourceType),
        resourceId: String(item.resourceId),
        resourceName: item.resourceName,
        chatAvatar: item.avatar,
      };
    });
  }

  // 按传入顺序返回
  const resourceList: RichInputResourceList = [];
  resourceIds.forEach((id) => {
    const resource = resourceCache[id];
    if (resource) {
      resourceList.push(resource);
    }
  });

  return resourceList;
}
