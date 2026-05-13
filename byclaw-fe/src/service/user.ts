import { GET, POST } from '@/service/common/request';

export const loginByUsername = (data: any, cancelToken?: any) =>
  POST<any>('/byaiService/system/session/loginByUsername', data, {
    cancelToken,
    responseCfg: {
      hideErrorTips: true,
      customHandle: true,
    },
  });

export const getLoginInfo = () =>
  GET<any>(
    '/byaiService/system/session/currentUser',
    { terminal: 'PC' },
    {
      responseCfg: {
        hideErrorTips: false,
        customHandle: true,
      },
    }
  );

export const logout = () => GET<any>('/byaiService/system/session/logout');

export const updatePassword = (data: any) => POST<any>('/byaiService/system/user/updatePassword', data);

export const batchAdd = (data: any) => POST<any>('/byaiService/customer/leads/batchAdd', data);

export const sendSMS = (data: any) => POST<any>('/byaiService/system/session/sms/send', data);

export const registerByPhone = (data: any, cancelToken?: any) =>
  POST<any>('/byaiService/system/session/registerByPhone', data, { cancelToken });

export const loginByPhone = (data: any, cancelToken?: any) =>
  POST<any>('/byaiService/system/session/loginByPhone', data, { cancelToken });

export const queryMyDepartmentRange = (data: any, cancelToken?: any) =>
  POST<any>('/byaiService/api/v2/digitEmploy/queryMyDepartmentRange', data, { cancelToken });
