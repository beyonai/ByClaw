// @ts-nocheck
import { POST, GET } from '@/service/common/request';

export async function getDashboardConfigList() {
  return GET('/byaiService/operations/dashboard/config/list');
}

export async function queryDashboardData(params: any) {
  return POST('/byaiService/operations/dashboard/query', {
    queryCode: params.queryCode,
    params: params.params || {},
  });
}
