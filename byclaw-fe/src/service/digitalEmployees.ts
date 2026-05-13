import { GET, POST } from '@/service/common/request';

const withResourceImplDefaults = (params: any = {}) => ({
  ...params,
  implType: params?.implType ?? '',
  workerAgentType: params?.workerAgentType ?? '',
});

export const getResourceListByPage = (data: any, cancelToken?: any) =>
  POST<any>('/byaiService/datasetController/selectDatasetByQo', data, { cancelToken });

// 我创建的数字员工
export const queryMyCreated = (data: any, cancelToken?: any) =>
  POST<any>('/byaiService/auth/privilegeGrant/queryPersonalDigitalEmployeeList', data, { cancelToken });

// 发现数字员工
export const getAllDigitalEmployees = (payload = {}) =>
  POST<any>('/byaiService/api/v1/digitEmploy/discover', {
    ...payload,
  });

// 热度排行榜
export const queryPopular = (payload = {}) =>
  POST<any>('/byaiService/api/v2/digitEmploy/queryPopular', {
    ...payload,
  });

export const getAllDigitalEmployeesV2 = (payload = {}, cancelToken?: any) =>
  POST<any>(
    '/byaiService/api/v2/digitEmploy/discover',
    {
      ...payload,
    },
    {
      cancelToken,
    }
  );

// 技能广场资源分页查询（开放接口）
export const queryResourcesByPage = (payload = {}, cancelToken?: any) =>
  POST<any>(
    '/byaiService/open/api/v1/queryResourcesByPage',
    {
      ...payload,
    },
    {
      cancelToken,
      // responseCfg: {
      //   customHandle: true,
      // },
    }
  );

// 我的全部数字员工（分页）
export const queryMyCreatedAndSubscribedAgentsV2 = (payload = {}, cancelToken?: any) =>
  POST<any>(
    '/byaiService/api/v2/digitEmploy/queryMyCreatedAndSubscribedAgents',
    {
      ...payload,
    },
    {
      cancelToken,
    }
  );
// 我的常用数字员工（分页）
export const queryMyUsual = (payload = {}, cancelToken?: any) =>
  POST<any>(
    '/byaiService/api/v2/digitEmploy/queryMyUsual',
    {
      ...payload,
    },
    {
      cancelToken,
    }
  );
// 我的最近添加数字员工（分页）
export const queryRecentlyAdded = (payload = {}, cancelToken?: any) =>
  POST<any>(
    '/byaiService/api/v2/digitEmploy/queryRecentlyAdded',
    {
      ...payload,
    },
    {
      cancelToken,
    }
  );

// 数字员工目录
export const getDigitEmployDir = (payload = {}) =>
  GET<any>('/byaiService/api/v1/digitEmployDir/all', {
    ...payload,
  });

// 目录类型，1-智能体，2-文档库 3-插件 4-数据库，5-MCP服务
export const queryCatalogTree = (payload = {}) =>
  POST<any>('/byaiService/digitalEmployeeController/queryCatalogTree', {
    ...payload,
  });

// 获取数字员工详情（与后台 digitalEmployeeController/findDetailsById 一致）
export function getCompositeAppInfo(params: { resourceId?: string; id?: string } & Record<string, unknown> = {}) {
  const resourceId = params?.resourceId ?? params?.id;
  if (resourceId !== undefined && resourceId !== null && `${resourceId}` !== '') {
    return POST<any>('/byaiService/digitalEmployeeController/findDetailsById', {
      resourceId: String(resourceId),
    });
  }
  return POST<any>('/byaiService/api/v1/digitEmploy/getCompositeAppInfo', {
    ...params,
  });
}

// 编辑更新数字员工详情
export function updateCompositeAppInfo(params = {}) {
  return POST<any>('/byaiService/api/v1/updateCompositeAppInfo', {
    ...params,
  });
}

// 更新数字员工详情 - 修改名称描述用
export function updateResource(params = {}) {
  return POST<any>('/byaiService/tool/updateResourceBasicInfo', {
    ...withResourceImplDefaults(params),
  });
}

// 删除数字员工（新接口）
export function deleteDigitalEmployee(params = {}) {
  return POST<any>('/byaiService/digitalEmployeeController/deleteDigitalEmployee', {
    ...params,
  });
}

// 设置默认数字员工
export function setDefaultDigitalEmployee(params = {}) {
  return POST<any>('/byaiService/digitalEmployeeController/setDefaultDigitalEmployee', {
    ...params,
  });
}

// 置顶数字员工
export function isTopAgent(params = {}) {
  return POST<any>('/byaiService/api/v1/digitEmploy/isTop', {
    ...params,
  });
}

// 获取模型列表
export function getModelList(params = {}) {
  return POST<any>('/byaiService/api/v1/digitEmploy/getModelList', {
    ...params,
  });
}

// 申请数字员工
export function employeeApply(params = {}) {
  return POST<any>('/byaiService/api/v1/employeeApply', {
    ...params,
  });
}

// 移除数字员工
export function employeeUnApply(params = {}) {
  return POST<any>('/byaiService/api/v1/digitEmploy/canclePriv', {
    ...params,
  });
}

// 数字员工列表查询
export const queryAllDigitalEmployeeList = (payload = {}, cancelToken?: any) =>
  POST<any>(
    '/byaiService/digitalEmployeeController/queryAllDigitalEmployeeList',
    {
      ...payload,
    },
    {
      cancelToken,
    }
  );
