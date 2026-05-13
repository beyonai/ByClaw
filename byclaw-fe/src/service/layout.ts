import { GET, POST } from '@/service/common/request';

export const qryConversations = (data: any) =>
  POST<any>('/byaiService/assiman/qryConversations', data, {
    responseCfg: {
      hideErrorTips: true,
    },
  });

export const updateConversation = (data: any) => POST<any>('/byaiService/assiman/updateConversation', data);

export const removeConversation = (params: any) => GET<any>('/byaiService/assiman/removeConversation', params);

export const getDefaultByaiAgent = (data: any) => POST<any>('/byaiService/assiman/getDefaultByaiAgent', data);

// 模糊搜索
export const getSearchList = (payload: any, cancelToken?: AbortController) =>
  POST<any>(
    '/byaiService/assiman/find',
    {
      ...payload,
    },
    { cancelToken }
  );

export const getDcSystemConfigValueByCode = (payload: any, cancelToken?: AbortController) =>
  POST<any>(
    '/byaiService/system/staticdata/getDcSystemConfigValueByCode',
    {
      ...payload,
    },
    { cancelToken }
  );

export const getDcSystemConfigValueByCodes = (payload: any, cancelToken?: AbortController) =>
  POST<any>(
    '/byaiService/system/staticdata/getDcSystemConfigValueByCodes',
    {
      ...payload,
    },
    { cancelToken }
  );
