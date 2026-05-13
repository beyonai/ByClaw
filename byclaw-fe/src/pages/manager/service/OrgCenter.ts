// @ts-nocheck
import { GET, POST } from '@/service/common/request';
import { getDcSystemConfigListByStandType } from './session';

const withPageNum = (payload: any = {}) => {
  const nextPayload = { ...payload };
  if (
    nextPayload.pageIndex !== null &&
    nextPayload.pageIndex !== undefined &&
    (nextPayload.pageNum === null || nextPayload.pageNum === undefined)
  ) {
    nextPayload.pageNum = nextPayload.pageIndex;
  }
  return nextPayload;
};

export const getIsOrgManager = () =>
  GET('/byaiService/system/organization/isOrgManager', {
    language: 'zh-CN',
  });

export const getOrgTree = (payload: any) => POST('/byaiService/system/organization/getOrgTree', payload);

export const searchOrg = (payload: any) => POST('/byaiService/system/organization/searchOrg', payload);

export const searchPositionList = (payload: any) =>
  POST('/byaiService/system/position/searchPositionList', withPageNum(payload));

export const searchPositionUsersByQo = (payload: any) =>
  POST('/byaiService/system/position/searchPositionUsersByQo', withPageNum(payload));

export const getUsersByOrgId = (payload: any) =>
  POST('/byaiService/system/user/getUsersByOrgId', withPageNum(payload)).then((res) => {
    return res;
  });

export const addPosition = (payload: any) => POST('/byaiService/system/position/addPosition', payload);

export const updatePosition = (payload: any) => POST('/byaiService/system/position/updatePosition', payload);

export const removePosition = (payload: any) => POST('/byaiService/system/position/removePosition', payload);

export const getPostDefaultList = () => getDcSystemConfigListByStandType({ standType: 'USER_TYPE' });

// 获取驻地树
export const getStationTree = (params: any) =>
  POST('/byaiService/system/station/getStationTree', { ...params }, { responseCfg: { customHandle: true } });
