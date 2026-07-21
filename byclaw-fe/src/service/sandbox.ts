import { POST } from './common/request';

export interface SandboxInfo {
  userCode: string;
  sandboxType: string;
  sandboxId: string;
  endpoints?: string[];
  instanceEndpoints?: Record<string, string>;
  token?: string;
  status?: string;
}

export interface LaunchSandboxResult {
  endpoint: string;
  sandboxId: string;
  endpoints?: string[];
  instanceEndpoints?: Record<string, string>;
}

/**
 * 查询沙箱信息
 */
export async function getSandboxInfo(params: { userCode?: string; sandboxType?: string }): Promise<SandboxInfo[]> {
  return POST('/sandbox/getSandboxInfo', params);
}

/**
 * 释放沙箱
 */
export async function removeSandbox(params: { userCode: string; resourceId?: number | null }): Promise<void> {
  return POST('/sandbox/removeSandbox', params);
}

/**
 * 按用户工号启动沙箱
 */
export async function launchSandboxByUserCode(params: {
  userCode: string;
  serviceKey?: string;
}): Promise<LaunchSandboxResult> {
  return POST('/sandbox/launchByUserCode', params);
}

/**
 * 沙箱心跳
 */
export async function sandboxHeartbeat(params: { resourceId?: number }): Promise<void> {
  return POST('/sandbox/heartbeat', params);
}

/**
 * 沙箱续约
 */
export async function renewSandbox(params: { userCode?: string; resourceId?: number }): Promise<SandboxInfo> {
  return POST('/sandbox/renewSandbox', params);
}
