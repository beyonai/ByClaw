import { POST } from '@/service/common/request';
import { getFavoriteSourceMapper, getKnowledgeResourceMapper, getWebSearchSourceMapper } from './utils';
import type { KnowledgeSource, WebSearchResource, WebSearchResult, SourceTreeNodeId } from './types';
import { generateUniqueId } from '@/utils/math';
import { SourceTreeNodeTypeMap } from './const';
import { ResourceTypeMap } from '@/constants/resource';

type SpaceDirItemResponse = {
  dirId: number;
  parentDirId: number;
  name: string;
  dataType: string;
  dataId: number;
};

type SpaceDirResponse = {
  pageInfo: {
    pageNum: number;
    pageSize: number;
    total: number;
    list: KnowledgeSource[];
  };
  selectedKbs?: SpaceDirItemResponse[];
};

let cachedPersonalKnowledgeBaseList: KnowledgeSource[] | null = null;
let cachedEnterpriseKnowledgeBaseList: KnowledgeSource[] | null = null;

/** 获取个人知识库 */
export const getPersonalKnowledgeBaseList = async (sessionId?: string) => {
  if (cachedPersonalKnowledgeBaseList && !sessionId) {
    return {
      list: cachedPersonalKnowledgeBaseList,
      total: cachedPersonalKnowledgeBaseList.length,
    };
  }
  const resp = await POST<SpaceDirResponse>('/byaiService/spaceDir/listPersonalKb', {
    sessionId,
    pageNum: 1,
    pageSize: 9999,
  });
  const list = resp?.pageInfo?.list ?? [];
  const myList = list.map(getKnowledgeResourceMapper(SourceTreeNodeTypeMap.knowledgeBase));
  if (!sessionId) {
    cachedPersonalKnowledgeBaseList = myList;
  }
  return {
    checkedIds: resp?.selectedKbs?.map((item) => `${SourceTreeNodeTypeMap.knowledgeBase}-${item.dataId}`),
    list: myList,
    total: myList.length,
  };
};

/** 获取企业知识库总数量 */
export const getEnterpriseKnowledgeBaseList = async (sessionId?: string) => {
  if (cachedEnterpriseKnowledgeBaseList && !sessionId) {
    return {
      list: cachedEnterpriseKnowledgeBaseList,
      total: cachedEnterpriseKnowledgeBaseList.length,
    };
  }
  const resp = await POST<SpaceDirResponse>('/byaiService/spaceDir/listEnterpriseKb', {
    sessionId,
    pageNum: 1,
    pageSize: 9999,
  });
  const list = resp?.pageInfo?.list ?? [];
  const myList = list.map(getKnowledgeResourceMapper(SourceTreeNodeTypeMap.enterpriseKnowledgeBase));

  if (!sessionId) {
    cachedEnterpriseKnowledgeBaseList = myList;
  }

  return {
    checkedIds: resp?.selectedKbs?.map((item) => `${SourceTreeNodeTypeMap.enterpriseKnowledgeBase}-${item.dataId}`),
    list: myList,
    total: myList.length,
  };
};

let cachedSkillList: KnowledgeSource[] | null = null;

const mapSkillItemToKnowledgeSource = (item: SpaceDirItemResponse): KnowledgeSource => {
  const id = `${SourceTreeNodeTypeMap.skill}-${item.dataId}` as SourceTreeNodeId;
  return {
    id,
    title: item.name,
    type: SourceTreeNodeTypeMap.skill,
    resourceId: String(item.dataId),
    dirId: item.dirId,
    parentDirId: item.parentDirId,
    dataType: item.dataType,
    dataId: item.dataId,
  };
};

/** 获取技能列表（支持树结构，结果会被缓存） */
export const getSkillList = async () => {
  if (cachedSkillList) {
    return {
      list: cachedSkillList,
      total: cachedSkillList.length,
    };
  }

  const resp = await POST<SpaceDirItemResponse[]>('/byaiService/spaceDir/listSkills', {});
  const rawList = resp ?? [];

  const mcpList = rawList.filter((item) => item.dataType === ResourceTypeMap.MCP);
  // MCP应该作为一个整体来勾选，下面的工具不应该具备单独勾选的能力
  const toolListOfMcp = rawList.filter((item) => {
    return item.dataType === ResourceTypeMap.TOOL && mcpList.some((mcp) => mcp.dataId === item.parentDirId);
  });

  const list = rawList
    .filter((item) => {
      return !toolListOfMcp.some((tool) => tool.dataId === item.dataId);
    })
    .map(mapSkillItemToKnowledgeSource);
  cachedSkillList = list;

  return {
    list,
    // 该接口无分页，total 直接为列表长度
    total: list.length,
  };
};

export const getCachedSkillList = () => cachedSkillList;

export const fetchWebSearch = async (
  query: string
): Promise<{
  requestId: string;
  results: WebSearchResult[];
}> => {
  const resp = await POST<{
    requestId: string;
    textList: WebSearchResult[];
  }>('/byaiService/web-search/query', {
    query,
  });
  return {
    requestId: resp?.requestId ?? '',
    results: (resp?.textList ?? []).map((item) => ({
      ...item,
      checked: true,
      uuid: generateUniqueId(),
      // 使用 heading_chain 作为 title
      title: item.data?.heading_chain || '未命名结果',
    })),
  };
};

/** 个人知识库 Mock 搜索 */
export const mockSearchKnowledgeBase = async (
  query: string
): Promise<{
  requestId: string;
  results: WebSearchResult[];
}> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const mockResults: WebSearchResult[] = [
        {
          uuid: generateUniqueId(),
          title: `个人笔记：关于${query}的学习总结`,
          score: 0.95,
          checked: true,
          data: {
            doc_id: 1,
            heading_chain: `个人笔记：关于${query}的学习总结`,
            content: `这是我在学习${query}过程中记录的一些要点和心得体会...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `${query}相关技术文档整理`,
          score: 0.88,
          checked: true,
          data: {
            doc_id: 2,
            heading_chain: `${query}相关技术文档整理`,
            content: `整理了${query}的核心概念、使用方法和最佳实践...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `我的${query}项目经验`,
          score: 0.82,
          checked: true,
          data: {
            doc_id: 3,
            heading_chain: `我的${query}项目经验`,
            content: `在实际项目中应用${query}的经验总结，包括遇到的问题和解决方案...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `${query}相关参考资料`,
          score: 0.75,
          checked: true,
          data: {
            doc_id: 4,
            heading_chain: `${query}相关参考资料`,
            content: `收集了一些关于${query}的优质文章和教程链接...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `${query}知识点速查表`,
          score: 0.7,
          checked: true,
          data: {
            doc_id: 5,
            heading_chain: `${query}知识点速查表`,
            content: `${query}常用命令、API和快捷操作速查...`,
            url: '',
            favicon: '',
          },
        },
      ];

      resolve({
        requestId: generateUniqueId(),
        results: mockResults,
      });
    }, 800); // 模拟 800ms 延迟
  });
};

/** 企业知识库 Mock 搜索 */
export const mockSearchEnterpriseKnowledgeBase = async (
  query: string
): Promise<{
  requestId: string;
  results: WebSearchResult[];
}> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      const mockResults: WebSearchResult[] = [
        {
          uuid: generateUniqueId(),
          title: `企业标准：${query}操作规范`,
          score: 0.98,
          checked: true,
          data: {
            doc_id: 101,
            heading_chain: `企业标准：${query}操作规范`,
            content: `公司内部关于${query}的标准操作流程和规范要求...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `${query}部门工作手册`,
          score: 0.92,
          checked: true,
          data: {
            doc_id: 102,
            heading_chain: `${query}部门工作手册`,
            content: `${query}相关部门的工作职责、流程和协作规范...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `公司${query}项目案例分析`,
          score: 0.87,
          checked: true,
          data: {
            doc_id: 103,
            heading_chain: `公司${query}项目案例分析`,
            content: `分析公司内部${query}相关项目的成功案例和经验...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `${query}技术白皮书`,
          score: 0.83,
          checked: true,
          data: {
            doc_id: 104,
            heading_chain: `${query}技术白皮书`,
            content: `公司技术团队编写的${query}技术白皮书，包含架构设计和实现细节...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `${query}培训资料汇总`,
          score: 0.78,
          checked: true,
          data: {
            doc_id: 105,
            heading_chain: `${query}培训资料汇总`,
            content: `公司内部关于${query}的培训课程资料和PPT...`,
            url: '',
            favicon: '',
          },
        },
        {
          uuid: generateUniqueId(),
          title: `${query}相关决策会议纪要`,
          score: 0.72,
          checked: true,
          data: {
            doc_id: 106,
            heading_chain: `${query}相关决策会议纪要`,
            content: `关于${query}相关项目的决策会议记录和决议事项...`,
            url: '',
            favicon: '',
          },
        },
      ];

      resolve({
        requestId: generateUniqueId(),
        results: mockResults,
      });
    }, 1000); // 模拟 1000ms 延迟
  });
};

export const importWebSearchResults = async (
  requestId: string,
  results: WebSearchResult[],
  options: { sessionId?: string; agentId?: string }
) => {
  const resp = await POST<{
    sessionId: string;
    archiveDocs: WebSearchResource[];
  }>('/byaiService/web-search/archive-selected', {
    requestId,
    textList: results,
    ...(options || {}),
  });
  return {
    sessionId: resp?.sessionId ?? '',
    list: (resp?.archiveDocs ?? []).map(getWebSearchSourceMapper),
  };
};

export const getFavoriteList = async () => {
  const resp = await POST<
    {
      dirId: number;
      dataId: number;
      parentDirId: number;
      name: string;
    }[]
  >('/byaiService/spaceDir/listCollectResource', {});
  const list = resp?.filter((item) => !!item.dataId)?.map(getFavoriteSourceMapper) ?? [];
  return {
    list,
    paged: false,
    total: list.length,
  };
};

export async function uploadFile(file: File, options: { sessionId?: string; agentId?: string }) {
  const form = new FormData();
  form.append('files', file);
  if (options.sessionId) {
    form.append('sessionId', options.sessionId);
  }
  if (options.agentId) {
    form.append('agentId', options.agentId);
  }
  const resp = await POST('/byaiService/spaceDir/importFiles', form, {
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  });
  return resp;
}

export async function batchSaveSelectedResources(payload: {
  agentId: string;
  sessionId?: string;
  dirType: string;
  resourceIds: string[];
}) {
  const resp = await POST<{
    sessionId: string;
  }>('/byaiService/spaceDir/importSelectedDataset', payload);
  return resp?.sessionId ?? '';
}

export async function addSelectedResource(payload: {
  sessionId?: string;
  agentId: string;
  spaceDataList: {
    dataType: 'RESOURCE';
    dataId: any;
  }[];
  dirType: string;
}) {
  const resp = await POST<{
    sessionId: string;
  }>('/byaiService/spaceDir/selectedResource', payload);
  return resp?.sessionId ?? '';
}

export async function removeSelectedResource(payload: {
  sessionId?: string;
  agentId: string;
  spaceDataList: {
    dataType: 'RESOURCE';
    dataId: any;
  }[];
  dirType: string;
}) {
  const resp = await POST<{
    sessionId: string;
  }>('/byaiService/spaceDir/unSelectedResource', payload);
  return resp?.sessionId ?? '';
}
