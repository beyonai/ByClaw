import { POST, GET } from '@/service/common/request';

export const listTasksByPage = (data: any, queryOpt: any = {}) =>
  POST<any>('/byaiService/menTaskController/listTasksByPage', data, queryOpt);

export const createTaskConversation = (data: any) =>
  POST<any>('/byaiService/menTaskController/createTaskConversation', data);

export const updateTask = (data: any) => POST<any>('/byaiService/menTaskController/updateTask', data);

// 修改bot卡片消息资源
export const updateResCom = (payload: any = {}) =>
  POST<any>('/byaiService/menTaskController/updateResCom', { ...payload });

// 内部待办审批通过/不通过
export const approveTask = (payload: any = {}) =>
  POST<any>('/byaiService/menTaskController/approveTask', { ...payload });

// 创建定时任务
export const createScheduleTask = (data: any) => POST<any>('/byaiService/scheduleTask/create', data);

// 查询定时任务列表
export const getScheduleTaskList = (data: any) => GET<any>(`/byaiService/scheduleTask/listTask/${data.resourceId}`);

// 删除定时任务
export const deleteScheduleTask = (taskId: number) => POST<any>(`/byaiService/scheduleTask/delete?taskId=${taskId}`);

// 更新定时任务
export const updateScheduleTask = (data: any) => POST<any>('/byaiService/scheduleTask/update', data);
