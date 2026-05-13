import { GET, POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export const getMessages = (payload: { sessionId: string; pageNum?: number; pageSize?: number; messageId?: string }) =>
  POST<any>('/byaiService/assiman/getMessages', {
    ...payload,
  });
export const getMessageById = (payload: { messageId: string }) =>
  POST<any>('/byaiService/chat/getMessageById', {
    ...payload,
  });

export const updateMesFeedback = (data: any) =>
  POST<any>('/byaiService/assiman/updateMesFeedback', data, withCustomHandle);

// 删除回答消息
export const delMessage = (data: any) => POST<any>('/byaiService/assiman/deleteMessage', data);

// 获取反馈类型字典列表
export const getContentFeedbackType = () => GET<any>('/byaiService/assiman/getContentFeedbackType');

// 获取反馈类型字典列表
export const getForwardMessage = (messageId: string, cancelToken?: AbortController) =>
  GET<any>(`/byaiService/assiman/getForwardMessage/${messageId}`, {}, { cancelToken });

// 模糊查询数字员工和企业员工
export const findAssiman = (payload: any = {}) => POST<any>('/byaiService/assiman/find', { ...payload });

export const createGroupChat = (payload: any = {}) => POST<any>('/byaiService/group/createGroupChat', payload);

export const addMessage = (payload: any = {}) => POST<any>('/byaiService/group/addMessage', payload);

// 获取消息卡片的状态
export const getMessageState = (payload: { resComIds: string[] }) =>
  POST<any>('/byaiService/menTaskController/getResComList', {
    ...payload,
  });

// 收藏
export const collectCase = (payload: any) =>
  POST<any>('/byaiService/showcase/create', {
    ...payload,
  });
// 取消收藏
export const cancelCollectCase = (payload: any) =>
  POST<any>('/byaiService/showcase/cancelCollect', {
    ...payload,
  });

export const getChatHistory = (payload: any) =>
  POST<any>('/byaiService/showcase/getChatHistory', {
    ...payload,
  });

export const stopChat = (payload: any) =>
  POST<any>('/byaiService/chat/stopChat', {
    ...payload,
  });

export const getMessageByIds = (payload: any) =>
  POST<any>('/byaiService/assiman/getMessageByIds', {
    ...payload,
  });
