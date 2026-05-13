import { GET, POST } from '@/service/common/request';

export const submitForm = (payload: any) =>
  POST<any>('/byaiService/chat/submitForm', {
    ...payload,
  });

export const toApproveForm = (payload: any, cancelToken?: AbortController) =>
  POST<any>('/byaiService/api/v1/employeeApply/approve', { ...payload }, { cancelToken });

// 新艾特列表数据/数字员工数据（我订阅的+我创建的），支持分页、模糊搜索，但响应不快
export const getAgentListByPage = (payload: any, cancelToken?: AbortController) =>
  GET<any>('/byaiService/api/v1/digitEmploy/canChatPage', { ...payload }, { cancelToken });

export const validateTask = (payload: any, cancelToken?: AbortController) =>
  POST<any>('/byaiService/chat/validateTask', { ...payload }, { cancelToken });
