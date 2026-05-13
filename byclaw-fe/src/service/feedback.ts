import { POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export const sendFeedback = (data: any) => POST<any>('/byaiService/system/feedback/save', data, withCustomHandle);

export const uploadFeedbackFile = (data: any) =>
  POST<any>('/byaiService/system/feedback/uploadFeedbackFile', data, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    responseCfg: {
      customHandle: true,
    },
  });
