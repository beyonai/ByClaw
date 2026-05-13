// 知识库相关类型定义
export interface IKnowledgeBaseItem {
  resourceId: string;
  resourceBizType: string;
  resourceName: string;
  resourceDesc: string;
  resourceLogoUrl?: string;
  resourceType: React.Key;
  resourceSourcePkId: string;
  createBy: string;
  manUserId: string;
  resourceStatus: string;
  isTop: string;
}

// 知识库文档类型定义
export interface IKnowledgeCollectionItem {
  id: string;
  collectionName: string;
  datasetId: string;
  type: 'file' | 'directory';
  fileId?: string;
  parentId: string;
  createUserId?: string;
}

export interface IKnowledgeDetailTreeItem extends IKnowledgeCollectionItem {
  key: string;
  title: string;

  /** 与 queryDirAndFileByLevel 一致，用于展开子级、请求子列表 */
  directoryPath?: string;
  children?: IKnowledgeDetailTreeItem[];
}
