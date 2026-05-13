import { POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

// 查询用户列表
export async function getUsersByOrgId(params: any) {
  return POST('/byaiService/system/user/getUsersByOrgId', params, withCustomHandle);
}

// 查询单个用户
export async function searchUser(params: any) {
  return POST('/byaiService/system/user/searchUser', params, withCustomHandle);
}

// 新增用户
export async function addUser(params: any) {
  return POST('/byaiService/system/user/addUser', params, withCustomHandle);
}

// 修改用户
export async function updateUser(params: any) {
  return POST('/byaiService/system/user/updateUser', params, withCustomHandle);
}

// 删除用户
export async function delUser(params: any) {
  return POST('/byaiService/system/user/delUser', params, withCustomHandle);
}

// 岗位类别
export async function searchPositionList(params: any) {
  return POST('/byaiService/system/position/searchPositionList', params, withCustomHandle);
}

// 用户外系统列表
export async function getUserExternalSystemList(params: any) {
  return POST('/byaiService/system/UserExternalSystemController/getUserExternalSystemList', params, withCustomHandle);
}

// 新增外系统
export async function addUserExternalSystem(params: any) {
  return POST('/byaiService/system/UserExternalSystemController/addUserExternalSystem', params, withCustomHandle);
}

// 移除外系统
export async function removeUserExternalSystem(params: any) {
  return POST('/byaiService/system/UserExternalSystemController/removeUserExternalSystem', params, withCustomHandle);
}

// 批量删除
export async function batchDelUser(params: any) {
  return POST('/byaiService/system/user/batchDelUser', params, withCustomHandle);
}

// 重置密码
export async function resetPassword(params: any) {
  return POST('/byaiService/system/user/resetPassword', params, withCustomHandle);
}

// 组织添加成员
export async function addUserByOrg(params: any) {
  return POST('/byaiService/system/organization/addUserByOrg', params, withCustomHandle);
}

// 设置数据权限
export async function setDataPermission(params: any) {
  return POST('/auth/privilegeGrant/mangerOrgUseAuth', params, withCustomHandle);
}

// 获取数据权限
export async function getDataPermission(params: any) {
  return POST('/auth/privilegeGrant/listMangerOrgUseDetail', params, withCustomHandle);
}
