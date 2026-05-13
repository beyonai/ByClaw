/* eslint-disable */
import { GET, POST } from '@/service/common/request';

/***** 静态数据（配置组列表） *****/
export async function selectSystemConfigListByQo(params: any) {
  return POST('/byaiService/system/systemConfigListController/selectSystemConfigListByQo', {
    ...params,
  });
}

export async function deleteByParamGroupCode(params: any) {
  return GET(
    '/byaiService/system/systemConfigListController/deleteByParamGroupCode',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function clearOneByParamGroupCode(params: any) {
  return GET(
    '/byaiService/system/systemConfigListController/clearOneByParamGroupCode',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function getByParamGroupCode(params: any) {
  return GET(
    '/byaiService/system/systemConfigListController/getByParamGroupCode',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function clearAllSystemConfigListCache() {
  return GET(
    '/byaiService/system/systemConfigListController/clearAllSystemConfigListCache',
    {},
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function saveSystemConfigList(params: any) {
  return POST(
    '/byaiService/system/systemConfigListController/saveSystemConfigList',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function updateSystemConfigList(params: any) {
  return POST(
    '/byaiService/system/systemConfigListController/updateSystemConfigList',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

/***** 系统参数（单条配置） *****/

export async function selectSystemConfigByQo(params: any) {
  return POST('/byaiService/system/systemConfigController/selectSystemConfigByQo', {
    ...params,
  });
}

export async function updateSystemConfig(params: any) {
  return POST(
    '/byaiService/system/systemConfigController/updateSystemConfig',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function deleteSystemConfigById(params: any) {
  return GET(
    '/byaiService/system/systemConfigController/deleteSystemConfigById',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function saveSystemConfig(params: any) {
  return POST(
    '/byaiService/system/systemConfigController/saveSystemConfig',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function clearOneSystemConfigCache(params: any) {
  return GET(
    '/byaiService/system/systemConfigController/clearOneSystemConfigCache',
    {
      ...params,
    },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function clearAllSystemConfigCache() {
  return GET(
    '/byaiService/system/systemConfigController/clearAllSystemConfigCache',
    {},
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );
}

export async function createFileAgent() {
  return GET('/byaiService/new/resource/createFileAgent', {});
}
