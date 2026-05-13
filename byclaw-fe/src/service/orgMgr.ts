import { POST } from '@/service/common/request';

// 查询全部组织
export async function getOrgTree(params: any) {
  return POST<any>('/byaiService/system/organization/getOrgTree', {
    ...params,
  });
}
