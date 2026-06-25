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

export async function saveServiceProfile(params: any) {
  return POST('/byaiService/sandbox/saveServiceProfile', { ...params }, withCustomHandle);
}

export async function deleteServiceProfile(params: { id?: number; serviceType?: string; profileKey?: string }) {
  return POST('/byaiService/sandbox/deleteServiceProfile', { ...params }, withCustomHandle);
}

export async function getSandboxHealthGlobalSwitch() {
  return POST('/byaiService/sandbox/health/config/getGlobalSwitch', {}, withCustomHandle);
}

export async function saveSandboxHealthGlobalSwitch(params: { enabled: boolean }) {
  return POST('/byaiService/sandbox/health/config/saveGlobalSwitch', { ...params }, withCustomHandle);
}

export async function listSandboxHealthWatermarkModels(params: any) {
  return POST('/byaiService/sandbox/health/watermark/list', { ...params }, withCustomHandle);
}

export async function saveSandboxHealthWatermarkModel(params: any) {
  return POST('/byaiService/sandbox/health/watermark/save', { ...params }, withCustomHandle);
}

export async function deleteSandboxHealthWatermarkModel(params: { id: number }) {
  return POST('/byaiService/sandbox/health/watermark/delete', { ...params }, withCustomHandle);
}

export async function enableSandboxHealthWatermarkModel(params: { id: number; enabled: boolean }) {
  return POST('/byaiService/sandbox/health/watermark/enable', { ...params }, withCustomHandle);
}

export async function previewSandboxHealthWatermark(params: any) {
  return POST('/byaiService/sandbox/health/watermark/preview', { ...params }, withCustomHandle);
}
