import { GET, POST } from '@/service/common/request';

export const loginBySso = (payload: any = {}) =>
  GET<any>('/byaiService/system/session/loginBySso', {
    ...payload,
  });

export const casCallback = (payload: any = {}) =>
  GET<any>('/byaiService/system/social/casCallback', {
    ...payload,
  });

export const getSSOUrl = (systemCode: string) =>
  GET<any>(`/byaiService/system/social/getSSOUrl?systemCode=${systemCode}`);

export const iwhaleCallback = (payload: any = {}) =>
  GET<any>('/byaiService/system/social/iwhaleCallback', {
    ...payload,
  });

export const feiLianCallback = (payload: any = {}) =>
  GET<any>('/byaiService/system/social/feiLianCallback', {
    ...payload,
  });

export const dingtalkCallback = (payload: any = {}) =>
  GET<any>('/byaiService/system/social/dingtalkCallback', {
    ...payload,
  });

export const getCaptcha = (payload: any = {}) =>
  GET<any>('/byaiService/system/session/captcha', payload, {
    responseType: 'blob',
  });

export const getAccessToken = (payload: any = {}) =>
  POST<any>('/byaiService/system/userAccessToken/list', {
    ...payload,
  });

export const createAccessToken = (payload: any = {}) =>
  POST<any>('/byaiService/system/userAccessToken/createToken', {
    ...payload,
  });

export const removeAccessToken = (payload: any = {}) =>
  POST<any>('/byaiService/system/userAccessToken/removeToken', {
    ...payload,
  });

export const getDebugSession = (payload: { agentId?: string } = {}) =>
  GET<any>('/byaiService/digitalEmployeeController/debugSession', {
    ...payload,
  });

export const getDcSystemConfigListByStandType = (payload: any = {}) =>
  POST<any>('/byaiService/system/staticdata/getDcSystemConfigListByStandType', {
    ...payload,
  });

// 获取模板类型  不鉴权
export const getTemplateTypes = (payload: any = {}) =>
  POST<any>('/byaiService/api/v1/template-sessions/getTemplateTypes', {
    ...payload,
  });

// 不鉴权
export const getDcSystemConfigValueByCode = (payload: any = {}) =>
  POST<any>('/byaiService/system/session/getDcSystemConfigValueByCode', {
    ...payload,
  });

export const getDcSystemConfigValueByCodes = (payload: any = {}) =>
  POST<any>('/byaiService/system/session/getDcSystemConfigValueByCodes', {
    ...payload,
  });
