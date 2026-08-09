import { GET, POST } from '@/service/common/request';

export interface PersonalParam {
  paramId?: number | string;
  key?: string;
  value?: string;
  description?: string;
  status?: 'NORMAL' | 'DISABLED' | string;
  enabled?: boolean;
  hasValue?: boolean;
  valueLast4?: string;
  updateTime?: string;
  source?: 'USER' | 'CONNECTOR' | string;
  sourceRef?: string;
  managed?: boolean;
  editable?: boolean;
  deletable?: boolean;
  enableable?: boolean;
}

export interface PersonalParamQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  updateTimeSort?: 'ascend' | 'descend';
}

export interface PersonalParamPageResult {
  list?: PersonalParam[];
  total?: number;
  pageNum?: number;
  pageSize?: number;
}

export const queryPersonalParams = (params?: PersonalParamQuery) =>
  GET<PersonalParamPageResult>('/byaiService/userPrivateParam/list', params);

export const savePersonalParam = (data: PersonalParam) =>
  POST<PersonalParam>('/byaiService/userPrivateParam/save', data);

export const deletePersonalParam = (paramId: number | string) =>
  POST<boolean>('/byaiService/userPrivateParam/delete', { paramId });

export const enablePersonalParam = (paramId: number | string, enabled: boolean) =>
  POST<PersonalParam>('/byaiService/userPrivateParam/enable', { paramId, enabled });
