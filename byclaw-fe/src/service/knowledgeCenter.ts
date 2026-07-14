import { GET, POST, type ConfigType } from '@/service/common/request';

const withResourceImplDefaults = (data: any = {}) => ({
  ...data,
  implType: data?.implType ?? '',
  workerAgentType: data?.workerAgentType ?? '',
});

export interface KnowledgeCapability {
  knowledgeMode: 'BYAI' | 'THIRD_PARTY';
  allowKnowledgeBaseCreate: boolean;
  allowKnowledgeBaseEdit: boolean;
  allowKnowledgeBaseDelete: boolean;
  allowKnowledgeImport: boolean;
}

// 查询我创建的文档库列表
export const getResourceListByPage = (data: any) => POST<any>('/byaiService/datasetController/selectDatasetByQo', data);

// 添加文档库（弃用）
export const createResource = (data: any) =>
  POST<any>('/byaiService/datasetController/createDataset', withResourceImplDefaults(data));

// 编辑文档库
export const updateResource = (data: any) =>
  POST<any>('/byaiService/datasetController/updateDataset', withResourceImplDefaults(data));

// 删除文档库
export const deleteResource = (data: any) => POST<any>('/byaiService/datasetController/deleteDataset', data);

// 添加文档库、一键发布
export const createAndShelf = (data: any) =>
  POST<any>('/byaiService/datasetController/createDataset', withResourceImplDefaults(data));

// 查询文档库详情
export const queryResourceDetail = (data: any) => {
  return GET<any>('/byaiService/datasetController/detail', data);
};

// 查询知识库页面能力开关
export const queryKnowledgeCapability = () =>
  GET<KnowledgeCapability>('/byaiService/datasetController/queryKnowledgeCapability');

// 分享文档库
export const share = (data: any) => POST<any>('/byaiService/datasetController/share', data);

// 获取分享详情
export const listAuthDetail = (data: any) => POST<any>('/byaiService/datasetController/listAuthDetail', data);

// 分享给我的文档库列表
export const beShared = (data: any) => POST<any>('/byaiService/datasetController/beShared', data);

// 查询授权给我的文档列表
export const queryAuthDoc = (data: any) => POST<any>('/byaiService/api/v2/resource/queryAuthDoc', data);

// 删除分享给我的文档库
export const delShare = (data: any) => POST<any>('/byaiService/datasetController/delShare', data);

// 新建文件夹
export const createFolder = (data: any) => POST<any>('/byaiService/datasetController/createFolder', data);

// 查询文件列表
export const getDataList = (data: any) => POST<any>('/byaiService/datasetController/getDataList', data);

/** 按层级查询目录与文件 */
export interface QueryDirAndFileByLevelParams {
  resourceId: number;

  /** 当前所在目录路径，根目录为 "/" */
  directoryPath: string;
  language?: string;
}

/** queryDirAndFileByLevel 单条记录 */
export interface QueryDirAndFileByLevelItem {
  id: number;
  name: string;
  type: 'directory' | 'file';
  fileId: number | null;
  fileName: string | null;
  createTime: string;

  /** 后端若返回则与构建、下载等接口的路径语义一致 */
  directoryPath?: string;
}

/** datasetController/build 请求体 */
export interface BuildDatasetPayload {
  directoryPath: string;
  resourceId: string;
}

// 查询文件夹和文件列表
export const queryDirAndFileByLevel = (data: QueryDirAndFileByLevelParams) =>
  POST<QueryDirAndFileByLevelItem[]>('/byaiService/datasetController/queryDirAndFileByLevel', data, {
    responseCfg: {
      hideErrorTips: true,
    },
  });

export interface SearchDirAndFilePayload extends QueryDirAndFileByLevelParams {
  keyword: string;
}

// 按关键字递归搜索知识库目录与文件
export const searchDirAndFile = (data: SearchDirAndFilePayload) =>
  POST<QueryDirAndFileByLevelItem[]>('/byaiService/datasetController/searchDirAndFile', data);

/** datasetController/renameFolder 请求体 */
export interface RenameFolderPayload {
  resourceId: number;
  directoryName: string;
  directoryPath: string;
}

// 文件夹重命名（body 仅含 resourceId、directoryName、directoryPath）
export const renameFolder = (data: RenameFolderPayload) =>
  POST<any>('/byaiService/datasetController/renameFolder', data, { languageConf: false });

/** datasetController/deleteFolder 请求体 */
export interface DeleteFolderPayload {
  resourceId: number;
  directoryPath: string;
}

// 删除文件夹（body 仅含 resourceId、directoryPath）
export const deleteFolder = (data: DeleteFolderPayload) =>
  POST<any>('/byaiService/datasetController/deleteFolder', data, { languageConf: false });

export interface KnowledgeItemsMovePayload {
  resourceId: number;
  sourcePath: string[];
  targetDirectoryPath?: string;
  targetFilePath?: string;
  overwrite?: boolean;
}

export interface KnowledgeItemsMoveItem {
  sourcePath: string;
  targetPath: string | null;
  success: boolean;
  error: string | null;
}

export interface KnowledgeItemsMoveResult {
  data: KnowledgeItemsMoveItem[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

// 批量移动知识库文件或目录；targetDirectoryPath 与 targetFilePath 二选一
export const moveKnowledgeItems = (data: KnowledgeItemsMovePayload) =>
  POST<KnowledgeItemsMoveResult>('/byaiService/datasetController/moveKnowledgeItems', data, {
    languageConf: false,
    responseCfg: {
      hideErrorTips: true,
    },
  });

// 获取目录树
export const catalogTree = (data: any) => POST<any>('/byaiService/datasetController/catalogTree', data);

/** 删除知识库文件（body 仅含 directoryPath、resourceId，不再附带 language） */
export interface RemoveFilePayload {
  directoryPath: string;
  resourceId: string;
}

// 修改文件
export const updateFileInfo = (data: any) => POST<any>('/byaiService/datasetController/updateFileInfo', data);

// 权限列表
export const getPriviledgeList = (data: any) => POST<any>('/byaiService/datasetController/getPriviledgeList', data);

// 文件构建
export const buildDataset = (data: BuildDatasetPayload) => POST<any>('/byaiService/datasetController/build', data);

/** datasetController/fileBuildStatus 查询参数 */
export interface FileBuildStatusParams {
  resourceId: string | number;
  directoryPath: string;
}

// 查询文件构建状态
export const getFileBuildStatus = (data: FileBuildStatusParams) =>
  GET<any>('/byaiService/datasetController/fileBuildStatus', data);

// 上传文件
export const uploadFiles = (data: FormData) =>
  POST<any>('/byaiService/datasetController/uploadFiles', data, {
    timeout: 8 * 60 * 1000,
    headers: {
      'Content-Type': 'multipart/form-data; charset=utf-8',
    },
  });

export interface CheckUploadFileConflictsPayload {
  resourceId: string | number;
  directoryPath: string;
  fileNames: string[];
}

export interface CheckUploadFileConflictsResult {
  conflict: boolean;
  overwritePaths: string[];
}

// 上传前检查同路径同名文件，供前端做覆盖确认
export const checkUploadFileConflicts = (data: CheckUploadFileConflictsPayload) =>
  POST<CheckUploadFileConflictsResult>('/byaiService/datasetController/checkUploadFileConflicts', data);

// 删除文件
export const removeFile = (data: RemoveFilePayload, config?: ConfigType) =>
  POST<any>('/byaiService/datasetController/removeFile', data, {
    languageConf: false,
    ...config,
  });
