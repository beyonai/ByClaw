import { POST } from '@/service/common/request';

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export async function listSandboxRecords(params: any) {
  return POST('/byaiService/sandbox/listRecords', { ...params }, withCustomHandle);
}

export async function removeSandboxById(params: any) {
  return POST('/byaiService/sandbox/removeSandboxById', { ...params }, withCustomHandle);
}

export async function updateSandbox(params: any) {
  return POST('/byaiService/sandbox/updateSandbox', { ...params }, withCustomHandle);
}

// ==================== 沙箱服务规格配置管理接口 ====================

export async function listServiceSpec() {
  return POST('/byaiService/sandbox/listServiceSpec', {}, withCustomHandle);
}

export async function getServiceSpec(params: { serviceKey: string }) {
  return POST('/byaiService/sandbox/getServiceSpec', { ...params }, withCustomHandle);
}

export async function saveServiceSpec(params: any) {
  return POST('/byaiService/sandbox/saveServiceSpec', { ...params }, withCustomHandle);
}

export async function deleteServiceSpec(params: { serviceKey: string }) {
  return POST('/byaiService/sandbox/deleteServiceSpec', { ...params }, withCustomHandle);
}
