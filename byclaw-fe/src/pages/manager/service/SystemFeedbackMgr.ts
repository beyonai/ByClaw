import { GET, POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export interface SystemFeedbackQueryParams {
  pageNum?: number;
  pageSize?: number;
  feedbackType?: string;
  title?: string;
  content?: string;
}

export const querySystemFeedbackList = (params: SystemFeedbackQueryParams) =>
  POST<any>('/byaiService/system/feedback/manage/list', params, withCustomHandle);

export const querySystemFeedbackDetail = (feedbackId: number) =>
  GET<any>('/byaiService/system/feedback/manage/detail', { feedbackId }, withCustomHandle);

export const readSystemFeedbackAttachment = (attachFileId: number, download = false) =>
  GET<any>(
    '/byaiService/system/feedback/manage/attachment',
    { attachFileId, download },
    {
      responseType: 'blob',
    }
  );

export const exportSystemFeedbackList = (params: SystemFeedbackQueryParams) =>
  POST<any>('/byaiService/system/feedback/manage/export', params, {
    responseType: 'blob',
  });
