import { GET, POST } from '@/service/common/request';

type Resp<T = any> = { code: number; msg: string; data: T; success?: boolean };
type PageData<T = any> = { rows?: T[]; list?: T[]; total: number };

const withCustomHandle = {
  responseCfg: {
    customHandle: true,
  },
};

export async function getMyModels(params: any) {
  return POST<Resp<PageData>>('/byaiService/personal/model/list', { ...params }, withCustomHandle);
}

export async function getMyModelDetail(params: any) {
  return POST<Resp>('/byaiService/personal/model/detail', { ...params }, withCustomHandle);
}

export async function upsertMyModel(params: any) {
  return POST<Resp>('/byaiService/personal/model/upsert', { ...params }, withCustomHandle);
}

export async function deleteMyModel(params: any) {
  return POST<Resp>('/byaiService/personal/model/delete', { ...params }, withCustomHandle);
}

export async function getMyQuota() {
  return GET<Resp>('/byaiService/personal/model/quota', {}, withCustomHandle);
}

export async function getPublicModels(params: any) {
  return POST<Resp<PageData>>('/byaiService/personal/model/listPublic', { ...params }, withCustomHandle);
}

export async function setModelStatus(params: { id: number | string; status: string }) {
  return POST<Resp>('/byaiService/personal/model/setStatus', { ...params }, withCustomHandle);
}
