import { POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

// 获取数字员工授权列表
export function listDigitalEmployeeAuth(params: any) {
  return POST('/byaiService/auth/privilegeGrant/listDigitalEmployeeAuth', params, withCustomHandle);
}

// 获取数字资源授权列表
export function listResourceAuth(params: any) {
  return POST('/byaiService/auth/privilegeGrant/listResourceAuth', params, withCustomHandle);
}

// 获取归属数字员工列表
export function listOwnEmployee(params: any) {
  return POST('/byaiService/auth/privilegeGrant/listOwnEmployee', params, withCustomHandle);
}

// 获取归属数字资源列表
export function listOwnResource(params: any) {
  return POST('/byaiService/auth/privilegeGrant/listOwnResource', params, withCustomHandle);
}

// 综合查询
export function findAll(params: any) {
  return POST('/byaiService/auth/privilegeGrant/findAll', params, withCustomHandle);
}

// 组织查询
export function findOrg(params: any) {
  return POST('/byaiService/auth/privilegeGrant/findOrg', params, withCustomHandle);
}

// 人员查询
export function findUser(params: any) {
  return POST('/byaiService/auth/privilegeGrant/findUser', params, withCustomHandle);
}

// 岗位查询
export function findPosition(params: any) {
  return POST('/byaiService/auth/privilegeGrant/findPosition', params, withCustomHandle);
}

// 驻地查询
export function findStation(params: any) {
  return POST('/byaiService/auth/privilegeGrant/findStation', params, withCustomHandle);
}
