import { POST } from '@/service/common/request';
import {
  beShared,
  getResourceListByPage,
  type QueryDirAndFileByLevelParams,
  queryDirAndFileByLevel,
  deleteFolder,
  removeFile,
} from '@/service/knowledgeCenter';

import { IKnowledgeDetailTreeItem } from './types';

export function resolveTreeItemDirectoryPath(data: IKnowledgeDetailTreeItem): string {
  const fromRow = String(data.directoryPath ?? '').trim();
  if (fromRow) {
    return fromRow.startsWith('/') ? fromRow : `/${fromRow}`;
  }
  const dirName = String(data.collectionName ?? data.title ?? '').trim();
  return dirName ? `/${dirName}` : '';
}

// 我能看到的全部知识
export const qryAllKnowledgeBases = (data: any) => getResourceListByPage(data);

// 分享给我的知识
export const qrySharedKnowledgeBases = (data: any) => beShared(data);

// 我创建的知识
export const qryMyKnowledgeBases = (data: any) => getResourceListByPage(data);

export const qryFolderAndFileList = (data: QueryDirAndFileByLevelParams) => queryDirAndFileByLevel(data);

export const delFolderOrFile = (data: IKnowledgeDetailTreeItem, resourceId: string) => {
  if (data.type === 'directory') {
    const directoryPath = resolveTreeItemDirectoryPath(data);
    if (!directoryPath) {
      return Promise.reject(new Error('缺少 directoryPath'));
    }
    return deleteFolder({
      resourceId: Number(resourceId),
      directoryPath,
    });
  }
  const filePath = resolveTreeItemDirectoryPath(data);
  if (!filePath) {
    return Promise.reject(new Error('缺少 directoryPath'));
  }
  return removeFile({
    directoryPath: filePath,
    resourceId: String(resourceId),
  });
};

export const qryAgentKnowledgeBases = (data: any) => {
  return POST('/byaiService/resource/queryDigEmployeeRelations', data);
};
