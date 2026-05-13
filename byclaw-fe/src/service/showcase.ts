import { POST } from '@/service/common/request';

export const getShowcaseList = (payload: any = {}) =>
  POST<any>(
    '/byaiService/showcase/list',
    { ...payload },
    {
      responseCfg: {
        customHandle: true,
      },
    }
  );

export const deleteShowcase = (payload: any = {}) => POST<any>('/byaiService/showcase/delete', { ...payload });

export const saveShowcaseToDoc = (payload: any = {}) => POST<any>('/byaiService/showcase/saveToDoc', { ...payload });

export const renameShowcase = (payload: { id: number; name: string }) =>
  POST<any>('/byaiService/showcase/rename', payload);
