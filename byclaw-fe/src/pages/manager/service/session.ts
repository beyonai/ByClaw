// @ts-nocheck
import { POST, type ConfigType } from '@/service/common/request';

export async function getDcSystemConfig<T = any>(params: any, config?: ConfigType) {
  return POST<T>('/byaiService/system/staticdata/getDcSystemConfig', params, config);
}

export const getDcSystemConfigValueByCodes = (payload: any) => {
  return POST('/byaiService/system/session/getDcSystemConfigValueByCodes', payload);
};

export async function getDcSystemConfigListByStandType(params: any) {
  return POST(
    '/byaiService/system/staticdata/getDcSystemConfigListByStandType',
    { ...params },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function bathQryPropertyKey(params: any) {
  return POST('/byaiService/system/property/bathQryPropertyKey', params);
}

export async function currentUser() {
  return POST('/byaiService/system/session/currentUser');
}

// 获取企业信息
export async function getEnterprise(params: any) {
  return POST('/byaiService/system/enterprise/getEnterprise', params);
}

// 企业信息修改
export async function updateEnterprise(params: any) {
  return POST('/byaiService/system/enterprise/update', params);
}

// 单个查询系统配置文件参数
export async function qryPropertyKey(params: any) {
  return POST('/byaiService/system/property/qryPropertyKey', params);
}

// 获取所有不同的参数
export async function getAllDistinctParams(params: any) {
  return POST('/byaiService/system/staticdata/getAllDistinctParams', params);
}

// 清除缓存
export async function clearCache(params: any) {
  return POST('/byaiService/system/staticdata/clearCache', params);
}
