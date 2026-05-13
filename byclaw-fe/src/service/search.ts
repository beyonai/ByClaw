import { POST, GET } from '@/service/common/request';
// 综合查询all、数字员工查询digit、企业人员查询user、群成员查询session
export function findAll(params: any) {
  return POST<any>('/byaiService/assiman/find', params);
}

// 人员查询
export function findUser(...params: any) {
  return POST<any>('/byaiService/auth/privilegeGrant/findUser', ...params);
}

// 人员详细查询
export function getUserSuas(params: any) {
  return GET<any>(`/byaiService/assiman/getUserSuas?userId=${params.userId}`);
}
