import { POST } from '@/service/common/request';

// 批量设置消息为已读
export const batchReadMessages = (payload: any = {}) =>
  POST<any>('/byaiService/group/batchReadMessages', { ...payload });

// 转发消息
export const addForwardMessage = (payload: any = {}) =>
  POST<any>('/byaiService/group/addForwardMessage', { ...payload });

// 获取模板消息
export const getTemplateSessionDetail = (payload: any = {}) =>
  POST<any>('/byaiService/api/v1/template-sessions/getTemplateSessionDetail', { ...payload });

// 工作空间列表
export const getWorkspaceList = (payload: { sessionId: string }, abortController: AbortController) =>
  POST<any>('/byaiService/workspace/list', { ...payload }, { cancelToken: abortController });

// 文件保存到会话空间
export const createBatch = (payload: any = {}) => POST<any>('/byaiService/workspace/createBatch', { ...payload });

// 工作空间保存到会话空间
export const saveToShowcaseBatch = (payload: { workspaceIds: string[] }) =>
  POST<any>('/byaiService/workspace/saveToShowcaseBatch', { ...payload });

export const deleteWorkspace = (payload: { id: string }) => POST<any>('/byaiService/workspace/delete', { ...payload });

// 查询搜问最近会话
export const queryRecentlySearchAsk = (payload: {
  pageNum: number;
  pageSize: number;
  keyword?: string;
  objectId: string;
}) => POST<any>('/byaiService/searchAsk/queryRecentlySearchAsk', { ...payload });
