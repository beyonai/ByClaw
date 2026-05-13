import { POST } from '@/service/common/request';

// 查询用户列表、组织下的成员
export async function getUsersByOrgId(params: any) {
  return POST<any>('/byaiService/system/user/getUsersByOrgId', params);
}
