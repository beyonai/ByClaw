import { GET, POST } from '@/service/common/request';

export const superAgentChat = (tags: string[]) => POST<any>('/byaiService/chat/superAgentChat', tags);

type ListTasksBySessionPageParams = {
  sessionId: string | number;
  taskType?: string;
  pageNum?: number;
  pageSize?: number;
};

export type ListTasksBySessionPageItem = {
  id: string;
  title: string;
  content: string;
  sessionId: string;
  createTime: string;
  statusCd: string;
  createByName: string;
  statusCdName: string;
  taskExtId: string;
  taskId: string;
};

type ListTasksBySessionPageResponse = {
  list: ListTasksBySessionPageItem[];
  total: number;
  pageNum: number;
};

// 会话-任务列表
export const listTasksBySessionPage = (data: ListTasksBySessionPageParams) =>
  POST<ListTasksBySessionPageResponse>('/byaiService/menTaskController/listTasksBySessionPage', data);

// 会话-根据任务查询待办
export const getTodoListByTask = (data: any) => POST<any>('/byaiService/menTaskController/listTasksByPTask', data);

// 获取搜索结果列表
export const getSearchList = (data: any) =>
  // GET<any>('/byaiService/resource/getSearchList?sessionId=10031560&taskId=1470264662154018816', data);
  GET<any>('/byaiService/resource/getSearchList', data);

/** 获取会话空间的文件列表 */
export const getWorkSpaceFile = (data: { taskId: any; sessionId: any; matchMode?: string; fileName?: string }) =>
  POST<any>('/byaiService/resource/getTaskFileList', data);

/** 获取会话空间的文件目录 */
export const getCatalogsByTaskId = (taskId: any) =>
  GET<any>(`/byaiService/resource/getCatalogsByTaskId?taskId=${taskId}`);

/** 上传会话空间的文件 */
export const uploadFile = (data: any) =>
  POST<any>('/byaiService/resource/uploadFile', data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

/** 删除会话空间的文件目录 */
export const deleteCatalog = (data: any) => POST<any>('/byaiService/resource/deleteCatalog', data);

/** 删除会话空间的文件 */
export const deleteFiles = (data: any) => POST<any>('/byaiService/resource/deleteFiles', data);

/** 查询会话成员 */
export const querySessionMembers = (data: { sessionId: string | number } & Record<string, any>) =>
  POST<any>('/byaiService/group/querySessionMembers', {
    ...data,
    sessionId: Number(data.sessionId),
  });

/** 下载会话空间的文件 */
export const downloadFile = (data: { fileId: string }, config: Record<string, any> = {}) =>
  GET<any>(
    `/byaiService/datasetController/download?fileId=${data.fileId}`,
    {},
    {
      responseType: 'blob',
      ...config,
    }
  );

type WriteTxtParams = {
  userCode: string;
  sessionId: string;
  filePath: string;
  content: string;
};

/** 保存会话到工作空间 */
export const writeTxt = (data: WriteTxtParams) => POST<any>('/byaiService/open/api/v1/conversation/writeTxt', data);

/** 查询用户当前会话的 ByClaw 文件 */
export const qryByClawFileByUserCode = (data: { userCode?: string; keyword?: string; sessionId?: string }) =>
  POST<any>('/byaiService/tool/qryByClawFileByUserCode', data);
