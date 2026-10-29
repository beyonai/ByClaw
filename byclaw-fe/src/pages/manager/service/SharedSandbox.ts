import { POST } from '@/service/common/request';
import { getIntl } from '@umijs/max';

export interface SharedConfig {
  id?: string;
  serviceKey: string;
  sourceServiceKey?: string;
  profileKey: string;
  enabled: boolean | number;
  maxOnlineUsers: number;
  userIdleTimeoutSeconds: number;
  emptyReleaseDelaySeconds: number;
  version?: number;
  resourceRequests?: Record<string, string>;
  resourceLimits?: Record<string, string>;
}

export interface SharedRecord {
  id: string;
  sandboxId?: string;
  serviceKey: string;
  profileKey: string;
  poolScope: 'GLOBAL' | 'TENANT';
  enterpriseId?: string;
  status: string;
  capacity: number;
  occupiedSlots: number;
  onlineUsers: number;
  createTime?: string | number;
  releaseTime?: string | number;
  releaseReason?: string;
}

export interface SharedMember {
  storageMode?: 'LOGICAL' | 'USER_NAS_QUOTA';
  id: string;
  sandboxRecordId: string;
  enterpriseId?: string;
  userId?: string;
  userCode: string;
  userName?: string;
  generation: number;
  status: string;
  lastHeartbeatAt?: string | number;
  assignedAt?: string | number;
  releasedAt?: string | number;
  releaseReason?: string;
}

export interface SharedPage<T> {
  records: T[];
  total: number;
}

async function request<T>(operation: string, params: object = {}): Promise<T> {
  const response = await POST(`/byaiService/sandbox/shared/${operation}`, params, {
    responseCfg: { customHandle: true },
  });
  if (response?.code !== 0) {
    throw new Error(response?.msg || getIntl().formatMessage({ id: 'sandboxMgr.shared.operationFailed' }));
  }
  return response.data as T;
}

export const listSharedConfigs = () => request<SharedConfig[]>('listConfigs');
export const saveSharedConfig = (config: SharedConfig) => request<SharedConfig>('saveConfig', config);
export const deleteSharedConfig = (config: SharedConfig) => request<void>('deleteConfig', config);
export const listSharedRecords = (params: object) => request<SharedPage<SharedRecord>>('listRecords', params);
export const listSharedMembers = (params: object) => request<SharedPage<SharedMember>>('listMembers', params);
export const releaseSharedInstance = (sandboxRecordId: string) => request<void>('releaseInstance', { sandboxRecordId });

export const releaseSharedMember = (member: SharedMember) =>
  request<boolean>('releaseMember', {
    mappingId: member.id,
    generation: member.generation,
    reason: 'manual',
    force: true,
  });
