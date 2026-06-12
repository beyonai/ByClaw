import { GET, POST } from '@/service/common/request';

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

export async function launchByUserCode(params: { userCode: string; serviceKey?: string }) {
  return POST('/byaiService/sandbox/launchByUserCode', { ...params }, withCustomHandle);
}

export async function getPreferredServiceKey(userCode: string) {
  return GET('/byaiService/sandbox/preferredServiceKey', { userCode }, withCustomHandle);
}

export async function removePreferredServiceKey(params: { userCode: string }) {
  return POST('/byaiService/sandbox/removePreferredServiceKey', { ...params }, withCustomHandle);
}

export async function resizeSandbox(params: any) {
  return POST('/byaiService/sandbox/resize', { ...params }, withCustomHandle);
}

export async function listResizeRecords(params: any) {
  return POST('/byaiService/sandbox/listResizeRecords', { ...params }, withCustomHandle);
}

export async function listServiceProfiles(params: { serviceType?: string; enabledOnly?: boolean }) {
  return POST('/byaiService/sandbox/listServiceProfiles', { ...params }, withCustomHandle);
}
