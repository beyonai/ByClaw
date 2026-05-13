import { ConfigType, POST } from '@/service/common/request';

// 批量获取系统配置
export function bathQryPropertyKey(params: any) {
  return POST<any>('/byaiService/system/property/bathQryPropertyKey', params);
}

export const getDcSystemConfigListByStandType = (standType: string, config?: ConfigType) =>
  POST<any>(
    '/byaiService/system/staticdata/getDcSystemConfigListByStandType',
    {
      standType,
    },
    config
  );
